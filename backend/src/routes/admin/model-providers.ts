import { Router } from 'express';
import apiConfigService from '../../services/apiConfig.service';
import { safeHttpRequest } from '../../utils/safe-http';
import { resolveChatCompletionsUrl } from '../../gateway/api-gateway/chat-protocol-adapter';
import { getProviderCatalog } from '../../config/models.config';
import { resolveProviderApiKey } from '../../services/provider-secrets.service';
import {
  PLATFORM_PROVIDER_ID,
  RegistryEditError,
  addModel,
  buildProvidersView,
  clearProviderKey,
  createProvider,
  deleteModel,
  deleteProvider,
  updateModel,
  updateProvider
} from '../../services/admin/model-providers.service';
import { setAuditAction, setAuditAfter } from '../../middleware/audit-context';

const router = Router();

/**
 * 模型供应商注册表编辑接口（2026-10-18 BYOK 编辑器）。
 *
 * 真源仍是 `backend/config/llm-providers.json`：这些接口只提供「带校验的写文件」，
 * 写成功即热重载生效（见 services/admin/model-providers.service.ts）。
 * 密钥不落文件：表单里填的密钥落 system.db 密文（provider_secrets）。
 *
 * 特例：`platform`（平台自带通道）在文件里没有 baseUrl，端点与密钥在 platform_api_configs，
 * 仍由既有 `PUT /api/admin/api-config` 管；本组接口拒绝删除它。
 */

function fail(res: import('express').Response, error: unknown): void {
  if (error instanceof RegistryEditError) {
    res.status(error.status).json({
      success: false,
      error: error.message,
      code: error.code,
      ...(error.warnings.length ? { warnings: error.warnings } : {})
    });
    return;
  }
  res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
}

/** 写操作统一回吐最新视图：弹层保存后前端不用再拉一次列表 */
async function okWithView(res: import('express').Response, warnings: string[], message: string): Promise<void> {
  res.json({ success: true, data: await buildProvidersView(), warnings, message });
}

router.get('/', async (_req, res) => {
  try {
    res.json({ success: true, data: await buildProvidersView() });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await createProvider(body);
    setAuditAction(res, 'model-provider-create', { targetType: 'model-provider', targetId: result.id });
    setAuditAfter(res, { ...body, apiKey: body.apiKey ? '***' : undefined });
    await okWithView(res, result.warnings, `供应商「${result.id}」已建立`);
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const body = req.body ?? {};
    // 平台通道的地址/密钥归 platform_api_configs：这里只放行展示名/说明/启用位，
    // 以及 system 角色能力（它本身就是通道能力，不是连接配置）。
    const patch = req.params.id === PLATFORM_PROVIDER_ID
      ? {
          name: body.name,
          description: body.description,
          enabled: body.enabled,
          ...(body.supportsSystemRole !== undefined ? { supportsSystemRole: body.supportsSystemRole } : {}),
        }
      : body;
    const result = await updateProvider(req.params.id, patch);
    setAuditAction(res, 'model-provider-update', { targetType: 'model-provider', targetId: req.params.id });
    setAuditAfter(res, { ...body, apiKey: body.apiKey ? '***' : undefined });
    await okWithView(res, result.warnings, `供应商「${req.params.id}」已更新`);
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await deleteProvider(req.params.id);
    setAuditAction(res, 'model-provider-delete', { targetType: 'model-provider', targetId: req.params.id });
    await okWithView(res, result.warnings, `供应商「${req.params.id}」已删除`);
  } catch (error) {
    fail(res, error);
  }
});

/** 移除密钥：注册表里的 apiKeyEnv 名保留（环境变量仍是回落来源） */
router.delete('/:id/secret', async (req, res) => {
  try {
    await clearProviderKey(req.params.id);
    setAuditAction(res, 'model-provider-key-clear', { targetType: 'model-provider', targetId: req.params.id });
    await okWithView(res, [], '密钥已移除（环境变量回落仍生效）');
  } catch (error) {
    fail(res, error);
  }
});

router.post('/:id/models', async (req, res) => {
  try {
    const result = await addModel(req.params.id, req.body ?? {});
    setAuditAction(res, 'model-provider-model-add', { targetType: 'model-provider', targetId: req.params.id });
    setAuditAfter(res, { ...req.body, modelId: result.modelId });
    await okWithView(res, result.warnings, `模型「${result.modelId}」已添加`);
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/:id/models/:modelId', async (req, res) => {
  try {
    const result = await updateModel(req.params.id, req.params.modelId, req.body ?? {});
    setAuditAction(res, 'model-provider-model-update', { targetType: 'model-provider', targetId: req.params.id });
    setAuditAfter(res, { ...req.body, modelId: req.params.modelId });
    await okWithView(res, result.warnings, `模型「${req.params.modelId}」已更新`);
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/:id/models/:modelId', async (req, res) => {
  try {
    const result = await deleteModel(req.params.id, req.params.modelId);
    setAuditAction(res, 'model-provider-model-delete', { targetType: 'model-provider', targetId: req.params.id });
    await okWithView(res, result.warnings, `模型「${req.params.modelId}」已删除`);
  } catch (error) {
    fail(res, error);
  }
});

/** 供应商端点与密钥是否真的能用：拉一次上游模型清单（GET /models） */
router.post('/:id/models/pull', async (req, res) => {
  try {
    const provider = providerOf(req.params.id);
    if (!provider.baseUrl) {
      res.status(400).json({ success: false, error: '「平台」沿用平台地址，模型清单由上游与登记表对比给出。' });
      return;
    }
    const resolved = await resolveProviderApiKey(provider.id, provider.apiKeyEnv ?? undefined);
    if (!resolved) {
      res.status(400).json({ success: false, error: '还没有可用密钥：请先填写密钥再获取模型列表。' });
      return;
    }
    const result = await apiConfigService.testConnection(provider.baseUrl, resolved.apiKey);
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error || '拉取模型列表失败' });
      return;
    }
    res.json({
      success: true,
      data: {
        models: result.models ?? [],
        registered: provider.models.map((m) => m.id)
      }
    });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * 显式测试：用**该供应商自己的**地址与密钥发一次最小请求，回显原文与耗时。
 * 与「路由层能不能用」同一套判据（真实调用），不是干跑校验。
 */
router.post('/:id/test', async (req, res) => {
  try {
    const provider = providerOf(req.params.id);
    const modelId = String(req.body?.modelId || provider.models[0]?.id || '').trim();
    if (!modelId) {
      res.status(400).json({ success: false, error: '该供应商下还没有模型，先添加一个再测试。' });
      return;
    }
    const baseUrl = provider.baseUrl || (await apiConfigService.getConfig()).apiUrl;
    const apiKey = provider.baseUrl
      ? (await resolveProviderApiKey(provider.id, provider.apiKeyEnv ?? undefined))?.apiKey
      : (await apiConfigService.getConfig()).apiKey;
    if (!baseUrl || !apiKey) {
      res.status(400).json({ success: false, error: provider.baseUrl ? '还没有可用密钥：请先填写密钥。' : '平台服务地址或密钥未配置。' });
      return;
    }
    const endpoint = resolveChatCompletionsUrl(baseUrl);
    const prompt = String(req.body?.prompt || '请用一句中文确认模型测试成功。').trim();
    const startedAt = Date.now();
    const response = await safeHttpRequest<{
      model?: unknown
      error?: { message?: unknown }
      choices?: Array<{ message?: { content?: unknown } }>
      usage?: unknown
    }>(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: {
        model: modelId,
        temperature: 0.2,
        max_tokens: 64,
        messages: [
          { role: 'system', content: '你是 API 模型连通性测试助手。请简洁返回。' },
          { role: 'user', content: prompt }
        ]
      },
      timeoutMs: 30_000
    });
    const durationMs = Date.now() - startedAt;
    const payload = response.data;
    if (response.status < 200 || response.status >= 300) {
      res.status(400).json({
        success: false,
        error: payload?.error?.message || `HTTP ${response.status}: ${response.statusText}`,
        data: { model: modelId, durationMs }
      });
      return;
    }
    res.json({
      success: true,
      data: {
        model: payload?.model || modelId,
        durationMs,
        content: payload?.choices?.[0]?.message?.content || '',
        usage: payload?.usage ?? null
      }
    });
  } catch (error) {
    fail(res, error);
  }
});

/** 从**生效注册表**取供应商（密钥解析等要用解析后的条目，而不是文件的原始对象） */
function providerOf(providerId: string): {
  id: string;
  baseUrl: string | null;
  apiKeyEnv: string | null;
  models: Array<{ id: string }>;
} {
  const provider = getProviderCatalog().find((p) => p.id === providerId);
  if (!provider) {
    throw new RegistryEditError(`供应商「${providerId}」不在注册表里。`, 404, 'not-found');
  }
  return {
    id: provider.id,
    baseUrl: provider.baseUrl ?? null,
    apiKeyEnv: provider.apiKeyEnv ?? null,
    models: provider.models.map((m) => ({ id: m.id }))
  };
}

export default router;
