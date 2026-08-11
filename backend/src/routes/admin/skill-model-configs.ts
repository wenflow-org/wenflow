import { Router } from 'express';
import skillModelConfigService from '../../services/skillModelConfig.service';
import { preserveConfiguredSecret, toSecretSafeResponse } from '../../utils/secret-redaction';
import { normalizeEndpointIdentity } from '../../utils/endpoint-identity';
import { getPlatformReliabilitySettings } from '../../services/reliability-settings.service';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../../middleware/audit-context';

const router = Router();

/**
 * Phase 2：skill_model_configs 只承载路由/可靠性。
 * temperature / maxTokens 由 File-as-Truth（agent_prompts ACTIVE）独占，写入时剥离。
 */
function pickEditableConfig(body: any) {
  return {
    tier: body?.tier,
    model: body?.model,
    thinkingMode: body?.thinkingMode,
    reasoningEffort: body?.reasoningEffort,
    endpoint: body?.endpoint,
    apiKey: body?.apiKey,
    requestTimeoutMs: body?.requestTimeoutMs,
    maxLogicalRetries: body?.maxLogicalRetries,
    enabled: body?.enabled,
  };
}

router.get('/', async (req, res) => {
  try {
    const configs = await skillModelConfigService.getAll();
    res.json({ success: true, data: toSecretSafeResponse(configs) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:skillId', async (req, res) => {
  try {
    const config = await skillModelConfigService.get(req.params.skillId);
    if (!config) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    const { resolveLlmCallParams } = await import('../../services/resolve-llm-call-params');
    const llm = await resolveLlmCallParams({
      skillId: req.params.skillId,
      includeRouteFallback: true,
    }).catch(() => null);
    res.json({
      success: true,
      data: {
        ...toSecretSafeResponse(config),
        generationParams: llm
          ? {
              model: llm.model ?? null,
              temperature: llm.temperature ?? null,
              maxTokens: llm.maxTokens ?? null,
              sources: llm.sources,
              owner: 'agent_prompts.ACTIVE (File-as-Truth)',
            }
          : null,
        routingOnly: true,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:skillId', async (req, res) => {
  try {
    const existing = await skillModelConfigService.get(req.params.skillId);
    // 操作审计：保存前快照旧配置（apiKey 等敏感字段由审计中间件统一脱敏）
    setAuditAction(res, 'skill-model-config-update', { targetType: 'skill-model-config', targetId: req.params.skillId });
    setAuditBefore(res, existing);
    const body = req.body || {};
    if (body.temperature !== undefined || body.maxTokens !== undefined) {
      // 兼容旧客户端：忽略生成参数写入，不报 400，避免阻断保存路由字段
      // 权威源：prompts/*.md → agent_prompts ACTIVE（见 resolveLlmGenerationParams）
    }
    if (
      body.requestTimeoutMs !== undefined
      && body.requestTimeoutMs !== null
      && (!Number.isInteger(body.requestTimeoutMs) || body.requestTimeoutMs < 10_000 || body.requestTimeoutMs > 300_000)
    ) {
      return res.status(400).json({ success: false, error: 'requestTimeoutMs 必须是 10000 到 300000 的整数或 null' });
    }
    if (
      body.maxLogicalRetries !== undefined
      && body.maxLogicalRetries !== null
      && (!Number.isInteger(body.maxLogicalRetries) || body.maxLogicalRetries < 0 || body.maxLogicalRetries > 2)
    ) {
      return res.status(400).json({ success: false, error: 'maxLogicalRetries 必须是 0 到 2 的整数或 null' });
    }
    if (body.maxLogicalRetries != null) {
      const reliabilitySettings = await getPlatformReliabilitySettings();
      if (body.maxLogicalRetries > reliabilitySettings.maxLogicalRetries) {
        return res.status(400).json({
          success: false,
          error: `maxLogicalRetries 不能超过平台上限 ${reliabilitySettings.maxLogicalRetries}`
        });
      }
    }
    const endpointProvided = Object.prototype.hasOwnProperty.call(body, 'endpoint');
    if (endpointProvided && body.endpoint !== null && typeof body.endpoint !== 'string') {
      return res.status(400).json({ success: false, error: 'endpoint 必须是字符串或 null' });
    }
    const endpointChanged = endpointProvided
      && normalizeEndpointIdentity(body.endpoint) !== normalizeEndpointIdentity(existing?.endpoint);
    const finalEndpoint = endpointProvided
      ? normalizeEndpointIdentity(body.endpoint)
      : normalizeEndpointIdentity(existing?.endpoint);
    if (typeof body.apiKey === 'string' && body.apiKey.trim() && !finalEndpoint) {
      return res.status(400).json({ success: false, error: '配置独立 apiKey 时必须同时提供 endpoint' });
    }
    if (endpointChanged
      && normalizeEndpointIdentity(body.endpoint)
      && !(typeof body.apiKey === 'string' && body.apiKey.trim())) {
      return res.status(400).json({ success: false, error: '更换 endpoint 时必须提供新的 apiKey' });
    }
    const input = preserveConfiguredSecret(
      pickEditableConfig(body),
      endpointChanged ? { ...existing, apiKey: null } as any : existing as any
    );
    if (endpointChanged && !(typeof body.apiKey === 'string' && body.apiKey.trim())) {
      input.apiKey = null;
    }
    const config = await skillModelConfigService.upsert(req.params.skillId, input);
    // 操作审计：保存后快照新配置
    setAuditAfter(res, config);
    const { resolveLlmCallParams } = await import('../../services/resolve-llm-call-params');
    const llm = await resolveLlmCallParams({
      skillId: req.params.skillId,
      includeRouteFallback: true,
    }).catch(() => null);
    res.json({
      success: true,
      data: {
        ...toSecretSafeResponse(config),
        // 生成参数只读投影（不回写本表）
        generationParams: llm
          ? {
              model: llm.model ?? null,
              temperature: llm.temperature ?? null,
              maxTokens: llm.maxTokens ?? null,
              sources: llm.sources,
              owner: 'agent_prompts.ACTIVE (File-as-Truth)',
            }
          : null,
        routingOnly: true,
      },
      message: '路由/可靠性配置已更新（temperature/maxTokens 由 ACTIVE Prompt 管理，未写入节点覆盖表）',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:skillId', async (req, res) => {
  try {
    await skillModelConfigService.delete(req.params.skillId);
    res.json({ success: true, message: '配置已删除' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
