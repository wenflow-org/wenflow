import { Router } from 'express';
import skillModelConfigService from '../../services/skillModelConfig.service';
import { preserveConfiguredSecret, toSecretSafeResponse } from '../../utils/secret-redaction';
import { normalizeEndpointIdentity } from '../../utils/endpoint-identity';
import { getPlatformReliabilitySettings } from '../../services/reliability-settings.service';
import { getModelDefinition } from '../../config/models.config';
import { scanPromptFiles } from '../../composers/prompt-files/loader';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../../middleware/audit-context';

const router = Router();

// ── 通道能力探测缓存（保存时校验 fallback 候选是否真的在该通道可服务）──
// 2026-09-28 教训：registry 声明的 agnes-3.0-flash 在新 key 分组不存在，400→503 空气兜底。
// 出网走 utils/safe-http（协议/保留地址/凭据内嵌 URL 检查，policy=runtime 与 executor 同款）。
const CHANNEL_PROBE_TTL_MS = 30 * 60 * 1000;
const channelModelCache = new Map<string, { at: number; models: Set<string> | null }>();

async function probeChannelModels(endpoint: string, apiKey: string): Promise<Set<string> | null> {
  const cacheKey = `${endpoint}|${apiKey.length}:${apiKey.slice(0, 8)}`;
  const hit = channelModelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CHANNEL_PROBE_TTL_MS) return hit.models;
  const miss = (models: Set<string> | null) => { channelModelCache.set(cacheKey, { at: Date.now(), models }); return models; };
  try {
    let origin: string;
    try { origin = new URL(endpoint).origin; } catch { return miss(null); }
    const { safeHttpRequest } = await import('../../utils/safe-http');
    const res = await safeHttpRequest<{ data?: Array<{ id?: string }> }>(`${origin}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 8000,
      maxResponseBytes: 1024 * 1024,
      responseType: 'json',
      privateNetworkPolicy: 'runtime',
    });
    if (res.status < 200 || res.status >= 300 || !Array.isArray(res.data?.data)) return miss(null);
    const ids = new Set<string>(res.data.data
      .map((m: any) => String(m?.id || '').trim())
      .filter((x: string) => x.length > 0));
    return miss(ids);
  } catch {
    return miss(null);
  }
}

/** endpoint 必须带 scheme（executor.resolveChatCompletionsUrl 才能拼出合法 URL） */
function hasValidScheme(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const GHOST_PREFIX = 'skill:'; // 前缀行=展示名，运行时按裸 skillId 读取，写它无效

/** 参数覆盖校验：{temperature:0..2, topP:0..1, maxTokens:256..131072}，null=清空 */
function validateParamOverrides(raw: unknown):
  { ok: true; value: Record<string, number> | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'paramOverrides 必须是对象或 null' };
  const b = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  if (b.temperature !== undefined && b.temperature !== null) {
    const v = Number(b.temperature);
    if (!Number.isFinite(v) || v < 0 || v > 2) return { ok: false, error: 'temperature 须在 0 到 2 之间' };
    out.temperature = v;
  }
  if (b.topP !== undefined && b.topP !== null) {
    const v = Number(b.topP);
    if (!Number.isFinite(v) || v <= 0 || v > 1) return { ok: false, error: 'topP 须在 0 到 1 之间' };
    out.topP = v;
  }
  if (b.maxTokens !== undefined && b.maxTokens !== null) {
    const v = Number(b.maxTokens);
    if (!Number.isInteger(v) || v < 256 || v > 131072) return { ok: false, error: 'maxTokens 须是 256 到 131072 的整数' };
    out.maxTokens = v;
  }
  return { ok: true, value: out };
}

/** 兜底链校验：≤2 跳；候选须在 registry、与主模型同 tier、不重复不含主模型。
 *  通道可服务性由调用方探测（probeChannelModels）补充。*/
function validateFallbackChain(raw: unknown, primaryModel: string | null):
  { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'fallbackChain 必须是字符串数组' };
  const chain = raw.map(x => String(x || '').trim()).filter(Boolean);
  if (chain.length > 2) return { ok: false, error: 'fallbackChain 最多 2 跳' };
  const seen = new Set<string>();
  for (const m of chain) {
    if (seen.has(m)) return { ok: false, error: `fallbackChain 含重复模型: ${m}` };
    seen.add(m);
    const def = getModelDefinition(m);
    if (!def) return { ok: false, error: `fallback 候选不在模型注册表: ${m}` };
    if (primaryModel) {
      if (m === primaryModel) return { ok: false, error: `fallback 候选不能是主模型自身: ${m}` };
      const pDef = getModelDefinition(primaryModel);
      if (pDef && pDef.tier !== def.tier) {
        return { ok: false, error: `fallback 禁止跨 tier：${primaryModel}(${pDef.tier})→${m}(${def.tier})` };
      }
    }
  }
  return { ok: true, value: chain };
}

/**
 * 配置体系（2026-09-28 起，取代 Phase 2 只读路由模式）：
 * skill_model_configs = 运行时绑定层——路由（endpoint/key）、模型（tier/model/thinking/effort）、
 * 参数覆盖（paramOverrides：temperature/topP/maxTokens，缺字段=不覆盖）、兜底链（fallbackChain）。
 * 生成参数默认仍由 File-as-Truth（agent_prompts ACTIVE）提供，被覆盖时以覆盖为准，
 * 生效值与来源以 GET /:skillId 的 generationParams.sources 投影为准。
 */
function pickEditableConfig(body: any) {
  return {
    tier: body?.tier,
    model: body?.model,
    thinkingMode: body?.thinkingMode,
    reasoningEffort: body?.reasoningEffort,
    endpoint: body?.endpoint,
    apiKey: body?.apiKey,
    paramOverrides: body?.paramOverrides ?? undefined,
    fallbackChain: body?.fallbackChain ?? undefined,
    requestTimeoutMs: body?.requestTimeoutMs,
    maxLogicalRetries: body?.maxLogicalRetries,
    enabled: body?.enabled,
  };
}

router.get('/', async (req, res) => {
  try {
    const configs = await skillModelConfigService.getAll();
    // 幽灵行标注：skill: 前缀行是展示名，运行时按裸 skillId 读取，写它无效
    const data = toSecretSafeResponse(configs).map((c: any) => ({
      ...c,
      ghost: typeof c.skillId === 'string' && c.skillId.startsWith(GHOST_PREFIX),
    }));
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 覆盖矩阵：prompts/skill.*.md 注册表（技能全集）× skill_model_configs 实际行。
 * 未配置行 = 走平台默认路由（2026-09-28 教训：7 个课后链技能曾因此静默落到旧 key）。
 */
router.get('/coverage', async (req, res) => {
  try {
    const files = scanPromptFiles();
    const skillIds = files.files
      .map(f => f.agentId)
      .filter(id => id.startsWith('skill:'))
      .map(id => id.slice('skill:'.length))
      .filter(Boolean)
      .sort();
    const rows = await skillModelConfigService.getAll();
    const byId = new Map(rows.map(r => [r.skillId, r]));
    const skills = skillIds.map(id => {
      const row = byId.get(id);
      const endpoint = row?.endpoint || null;
      const source = endpoint ? 'skill-channel'
        : (row?.model ? 'skill-model-only' : 'platform-default');
      return {
        skillId: id,
        endpoint,
        model: row?.model ?? null,
        tier: row?.tier ?? 'chat',
        source,
        paramOverrides: row?.paramOverrides ? JSON.parse(row.paramOverrides) : null,
        fallbackChain: row?.fallbackChain ? JSON.parse(row.fallbackChain) : null,
      };
    });
    res.json({
      success: true,
      data: {
        total: skills.length,
        unconfigured: skills.filter(s => s.source === 'platform-default').map(s => s.skillId),
        skills,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 批量套用：对多个 skill 一次性写同一份通道/模型/参数/兜底配置。
 * 逐技能校验（与 PUT 一致：scheme/参数范围/兜底链），单个失败不影响其他，
 * 全部走操作审计（before=旧配置数组，after=新配置数组）。
 */
router.post('/bulk-apply', async (req, res) => {
  try {
    const body = req.body || {};
    const skillIds: string[] = Array.isArray(body.skillIds) ? body.skillIds.map(String) : [];
    if (!skillIds.length) {
      return res.status(400).json({ success: false, error: 'skillIds 不能为空' });
    }
    const endpoint = typeof body.endpoint === 'string' ? normalizeEndpointIdentity(body.endpoint) : '';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
    if (endpoint) {
      if (!hasValidScheme(endpoint)) {
        return res.status(400).json({ success: false, error: 'endpoint 必须带 http/https scheme' });
      }
      if (!apiKey) {
        return res.status(400).json({ success: false, error: '配置独立 endpoint 时必须同时提供 apiKey' });
      }
    }
    const paramOverridesRaw = body.paramOverrides ?? undefined;
    let paramOverridesValue: string | null | undefined;
    if (paramOverridesRaw !== undefined) {
      const v = validateParamOverrides(paramOverridesRaw);
      if ('error' in v) return res.status(400).json({ success: false, error: v.error });
      paramOverridesValue = v.value === null ? null : JSON.stringify(v.value);
    }
    const fallbackChainRaw = body.fallbackChain ?? undefined;
    let fallbackChainValue: string | null | undefined;
    if (fallbackChainRaw !== undefined) {
      const v = validateFallbackChain(fallbackChainRaw, model);
      if ('error' in v) return res.status(400).json({ success: false, error: v.error });
      fallbackChainValue = v.value === null ? null : JSON.stringify(v.value);
      if (v.value.length && endpoint && apiKey) {
        const available = await probeChannelModels(endpoint, apiKey);
        if (available) {
          const missing = v.value.filter(m => !available.has(m));
          if (missing.length) {
            return res.status(400).json({ success: false, error: `fallback 候选在该通道不可用：${missing.join(', ')}` });
          }
        }
      }
    }

    const before = await Promise.all(skillIds.map(id => skillModelConfigService.get(id).catch(() => null)));
    setAuditAction(res, 'skill-model-configs-bulk-apply', { targetType: 'skill-model-config', targetId: skillIds.join(',') });
    setAuditBefore(res, before);

    const results: Array<{ skillId: string; ok: boolean; error?: string }> = [];
    const after: any[] = [];
    for (const skillId of skillIds) {
      try {
        const input: any = pickEditableConfig({ ...body, skillIdChecked: true });
        if (paramOverridesValue !== undefined) input.paramOverrides = paramOverridesValue;
        if (fallbackChainValue !== undefined) input.fallbackChain = fallbackChainValue;
        const saved = await skillModelConfigService.upsert(skillId, input);
        after.push(saved);
        results.push({ skillId, ok: true });
      } catch (e: any) {
        results.push({ skillId, ok: false, error: e.message });
      }
    }
    setAuditAfter(res, after);
    const failed = results.filter(r => !r.ok);
    res.json({
      success: failed.length === 0,
      data: {
        applied: results.filter(r => r.ok).length,
        failed: failed.length,
        results,
      },
      message: failed.length ? '部分技能套用失败，详见 results' : '批量套用完成',
    });
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
        // 生效值投影：覆盖/File-as-Truth/路由合并后的真值 + 逐字段来源（前端来源徽标唯一数据源）
        generationParams: llm
          ? {
              model: llm.model ?? null,
              temperature: llm.temperature ?? null,
              topP: llm.topP ?? null,
              maxTokens: llm.maxTokens ?? null,
              sources: llm.sources,
              owner: '合并链：runtime-override > skill-override > ACTIVE Prompt > code > route',
            }
          : null,
        routingOnly: false,
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
      // 兼容旧客户端：忽略裸 temperature/maxTokens 写入（请改用 paramOverrides），不报 400
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
    // 幽灵行治理：skill: 前缀行运行时不可见（按裸 skillId 读取），写入它只会造出哑配置
    if (req.params.skillId.startsWith(GHOST_PREFIX)) {
      return res.status(400).json({
        success: false,
        error: `skillId 不允许 '${GHOST_PREFIX}' 前缀（前缀行是展示名，运行时读取裸 skillId 行；请改用裸名写入）`
      });
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
    // endpoint scheme 校验（2026-09-28 教训：无 scheme 会在 executor 拼 URL 时炸 NETWORK_POLICY_BLOCKED）
    if (finalEndpoint && !hasValidScheme(finalEndpoint)) {
      return res.status(400).json({ success: false, error: 'endpoint 必须带 http/https scheme（如 http://host:30001）' });
    }

    // 参数覆盖校验
    let paramOverridesValue: Record<string, number> | null | undefined;
    if (body.paramOverrides !== undefined) {
      const v = validateParamOverrides(body.paramOverrides);
      if ('error' in v) return res.status(400).json({ success: false, error: v.error });
      paramOverridesValue = v.value;
    }

    // 兜底链校验（registry / 同 tier / ≤2 跳）；主模型取最终生效 model
    const warnings: string[] = [];
    let fallbackChainValue: string[] | null | undefined;
    if (body.fallbackChain !== undefined) {
      const primaryModel = (typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null)
        || (typeof existing?.model === 'string' && existing.model.trim() ? existing.model.trim() : null);
      const v = validateFallbackChain(body.fallbackChain, primaryModel);
      if ('error' in v) return res.status(400).json({ success: false, error: v.error });
      fallbackChainValue = v.value;
      // 通道可服务性探测（能解析出 endpoint+key 才探；探测失败不阻断，只告警）
      const probeKey = (typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : '')
        || (existing?.apiKey && existing.apiKey !== '' ? existing.apiKey : '');
      if (fallbackChainValue.length && finalEndpoint && probeKey) {
        const available = await probeChannelModels(finalEndpoint, probeKey);
        if (available) {
          const missing = fallbackChainValue.filter(m => !available.has(m));
          if (missing.length) {
            return res.status(400).json({
              success: false,
              error: `fallback 候选在该通道不可用：${missing.join(', ')}（探测到 ${available.size} 个模型；空气兜底会以 503 掩盖真因）`
            });
          }
        } else {
          warnings.push('通道探测失败，fallback 候选未校验（保存时请确认通道模型列表）');
        }
      }
    }

    const input = preserveConfiguredSecret(
      pickEditableConfig(body),
      endpointChanged ? { ...existing, apiKey: null } as any : existing as any
    );
    if (endpointChanged && !(typeof body.apiKey === 'string' && body.apiKey.trim())) {
      input.apiKey = null;
    }
    if (paramOverridesValue !== undefined) {
      input.paramOverrides = paramOverridesValue === null ? null : JSON.stringify(paramOverridesValue);
    }
    if (fallbackChainValue !== undefined) {
      input.fallbackChain = fallbackChainValue === null ? null : JSON.stringify(fallbackChainValue);
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
        // 生效值投影（覆盖/File-as-Truth/路由三层合并后的真值 + 逐字段来源）
        generationParams: llm
          ? {
              model: llm.model ?? null,
              temperature: llm.temperature ?? null,
              topP: llm.topP ?? null,
              maxTokens: llm.maxTokens ?? null,
              sources: llm.sources,
              owner: '合并链：runtime-override > skill-override > ACTIVE Prompt > code > route',
            }
          : null,
        warnings,
        routingOnly: false,
      },
      message: '配置已更新（paramOverrides/fallbackChain 同表管理；生效值见 generationParams.sources）',
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
