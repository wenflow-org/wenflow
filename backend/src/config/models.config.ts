/**
 * 统一的模型配置模块（模型目录唯一真实来源，Single Source of Truth）。
 *
 * 目录本体是 **File-as-Truth 配置文件** `backend/config/llm-providers.json`
 * （供应商 → 端点/密钥环境变量 → 模型能力表），本模块负责：
 * 1. 启动加载 + schema 校验（文件存在但非法 = fail-loud 拒绝启动；文件缺失 = 内置兜底目录）；
 * 2. 把目录摊平进历史导出（AVAILABLE_MODELS / MODEL_MAP / MODEL_ALIASES / MODELS_BY_TIER），
 *    所有下游消费方（别名过滤、skill 兜底链校验、成本价目表、/api/config/available-models）
 *    **零改动**看到自定义模型；
 * 3. 热重载：文件 mtime 变化后由路由层在下次解析前触发 reload（改动无需重启，
 *    解析失败的文件保留上一次好目录并在 status 里带 error）。
 *
 * 模型引用两种写法：
 * - 裸 id（`deepseek-v4.1-flash`）：全局唯一，历史 DB 配置全部是这种，天然兼容；
 * - 限定式 `providerId/modelId`：需要精确指到某通道时使用（仅当 providerId 命中已注册
 *   供应商且 modelId 在其目录内才按限定式解析，否则整体按裸 id / 字面量处理——
 *   聚合网关的模型 id 自带 `/`（如 openrouter 风格）不会被误伤）。
 *
 * 规则与示例见 `config/llm-providers.json` 的 $header/$rules 与 doc/MODEL_GATEWAY_DESIGN.md §4.2。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 模型单价（USD / 1M tokens）。
 *
 * ⚠️ 这是**占位结构**：数值必须来自【财务权威单价源】。
 * - 不要凭经验估算，也不要把厂商页面临时价当权威值。
 * - 三个字段都可选；某字段未配置（undefined）表示"该口径金额未知"，
 *   成本计算器会返回 `usd: null / pricingKnown: false`，**不会**用 0 冒充成本。
 * - 仅改价时才更新此表；首版不含 `effectiveFrom`，调价历史见
 *   `doc/UPGRADE_DIRECTION_20Q.md` §2 Q20 / §7（后续可增量迁到系统库 `model_pricing`）。
 */
export interface ModelPricing {
  /** 未命中缓存的输入 token 单价（USD / 1M tokens） */
  inputPer1M?: number;
  /** 命中 KV 前缀缓存的输入 token 单价（USD / 1M tokens）；缺省时按 inputPer1M 全价计（不折扣） */
  cachedInputPer1M?: number;
  /** 输出 token 单价（USD / 1M tokens） */
  outputPer1M?: number;
}

export interface ModelDefinition {
  id: string;
  label: string;
  tier: 'chat' | 'reasoning';
  /** 旧字段（'deepseek' | 'agnes' 展示口径）。新条目按 providerId 展示，此字段留作兼容。 */
  provider: string;
  /** 所属供应商 id（llm-providers.json 的 provider key；内置兜底为 'platform'） */
  providerId: string;
  /** 所属供应商显示名 */
  providerName?: string;
  /**
   * 供应商自带端点（provider 声明了 baseUrl 时存在）。
   * 路由层规则：模型解析落到带端点的供应商 ⇒ endpoint/apiKey 改用该供应商
   * （apiKey 从 `apiKeyEnv` 环境变量读取；user 自带 provider 的路由不受此覆盖）。
   */
  providerEndpoint?: { baseUrl: string; apiKeyEnv: string };
  supportsThinking?: boolean;
  /** 是否支持 `reasoning_effort` 字段（不支持时即使 supportsThinking 也不发该字段） */
  supportsReasoningEffort?: boolean;
  /**
   * 输出 token 硬上限（上游限制）。语义 = **能力上限**，不是请求参数：
   * 只在调用方声明值越界时用于封顶（见 doc/MODEL_GATEWAY_DESIGN.md §4.3）。
   */
  maxOutputTokens?: number;
  /**
   * 调用方（prompt/code/route）**未声明**输出预算时的缺省值。
   * 未配置则回退 `GLOBAL_DEFAULT_MAX_TOKENS`。
   */
  defaultMaxTokens?: number;
  /**
   * 开启思考（`thinking:{type:'enabled'}`）时，为推理额外预留的 token 预算。
   * 与输出预算**分离**：最终 `max_tokens = 声明输出 + reasoningReserveTokens`（不超过硬上限），
   * 避免推理消耗吃光输出预算导致 `content` 为空。
   */
  reasoningReserveTokens?: number;
  /**
   * 降级候选（主模型在「可降级错误」上耗尽重试后按序尝试）。
   * 空/未配置 = 不降级（默认）。见 doc/MODEL_GATEWAY_DESIGN.md §4.5。
   * 注意：当前运行时降级**只换模型名不换端点**，跨供应商候选在保存侧被拒绝（见 §4.5）。
   */
  fallbacks?: string[];
  /**
   * 本地并发上限（同模型同时进行的上游请求数）。未配置 = 不限（默认）。
   * 超限与上游 429 同构，交回统一退避/降级链路；见 doc/MODEL_GATEWAY_DESIGN.md §4.6。
   */
  maxParallelRequests?: number;
  /**
   * 可选单价（USD / 1M tokens），只影响只读成本核算，**不影响模型选择/路由行为**。
   * 默认留空 = 金额未知；权威价格落地后再逐模型补齐。
   */
  pricing?: ModelPricing;
  description?: string;
}

/** llm-providers.json 的 provider 条目（含未 enabled 的示例条目，供总览/前端展示全貌）。 */
export interface ProviderDefinition {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** 推荐通道（UI 置顶标识；DeepSeek 官方/平台通道为 true） */
  recommended: boolean;
  /** 端点来源：'inherit' = 沿用平台路由解析；'own' = 供应商自带 baseUrl */
  endpointSource: 'inherit' | 'own';
  baseUrl?: string;
  apiKeyEnv?: string;
  models: ModelDefinition[];
}

export interface RegistryStatus {
  path: string;
  /** 'file' = 目录来自配置文件；'embedded-fallback' = 文件缺失，用内置兜底目录 */
  source: 'file' | 'embedded-fallback';
  mtimeMs: number | null;
  /** 最近一次热重载失败的报错（保留上一次好目录时出现）；无错为 null */
  lastError: string | null;
}

/** 注册表快照（加载/解析的统一产物；applySnapshot 原地灌进历史导出）。 */
interface RegistrySnapshot {
  models: ModelDefinition[];
  providers: ProviderDefinition[];
  aliases: Record<string, string[]>;
  defaults: { chat: string; reasoning: string };
  source: RegistryStatus['source'];
}

/** 逻辑别名 → 模型 id 列表。业务/配置只写别名（chat / reasoning / light），由别名层展开为具体模型。 */
export const MODEL_ALIASES: Record<string, string[]> = {};

/** 可用模型列表（启动时由加载器摊平填充；热重载时**原地变更**，引用永不失效）。 */
export const AVAILABLE_MODELS: ModelDefinition[] = [];

/** 按 tier 分组（对象身份不变，属性随热重载更新）。 */
export const MODELS_BY_TIER = {
  chat: [] as ModelDefinition[],
  reasoning: [] as ModelDefinition[]
};

/** 模型 ID 映射（用于快速查找；Map 身份不变，内容随热重载更新）。 */
export const MODEL_MAP = new Map<string, ModelDefinition>();

/**
 * 默认模型配置（内置兜底值）。
 * 运行时生效值走 `getModelDefaults()`（跟随配置文件）；此处仅为兼容保留的初始快照。
 */
export const DEFAULT_MODELS = {
  chat: 'deepseek-v4-flash',
  reasoning: 'deepseek-v4-pro'
} as const;

// ---------------------------------------------------------------------------
// 加载器内部态（不在模块顶层导出，避免外部持有过期引用）
// ---------------------------------------------------------------------------

/** 配置文件路径：env 可覆盖（测试/多部署）；每次调用时解析，改 env 后下一次 reload 即生效。 */
function resolveConfigPath(): string {
  return (process.env.LLM_PROVIDERS_CONFIG || '').trim()
    || path.resolve(__dirname, '../../config/llm-providers.json');
}

const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** 限定式引用 `providerId/modelId` → 定义（仅命中已注册供应商+其目录内模型时才有值）。 */
const QUALIFIED_MODEL_MAP = new Map<string, ModelDefinition>();

let activeProviders: ProviderDefinition[] = [];
let activeDefaults: { chat: string; reasoning: string } = { ...DEFAULT_MODELS };
let activeSource: RegistryStatus['source'] = 'embedded-fallback';
let lastMtimeMs: number | null = null;
let lastReloadError: string | null = null;

function buildEmbeddedFallback(): RegistrySnapshot {
  const models: ModelDefinition[] = [
    {
      id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', tier: 'chat', provider: 'deepseek', providerId: 'platform',
      supportsThinking: true, supportsReasoningEffort: true, maxOutputTokens: 131072, defaultMaxTokens: 32768,
      reasoningReserveTokens: 8192, fallbacks: [],
      description: 'V4.1 Flash：标准运行模型（字面 id，2026-09-28 起全链统一）'
    },
    {
      id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', tier: 'chat', provider: 'deepseek', providerId: 'platform',
      supportsThinking: true, supportsReasoningEffort: true, maxOutputTokens: 131072, defaultMaxTokens: 32768,
      reasoningReserveTokens: 8192, fallbacks: ['agnes-3.0-flash'],
      description: 'V4 Flash（含混别名：部分渠道实际由 V4.1 部署服务，输出量波动大）'
    },
    {
      id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', tier: 'reasoning', provider: 'deepseek', providerId: 'platform',
      supportsThinking: true, supportsReasoningEffort: true, maxOutputTokens: 131072, defaultMaxTokens: 32768,
      reasoningReserveTokens: 16384, fallbacks: ['deepseek-v4-flash'],
      description: '强大推理能力，适合复杂任务和深度思考'
    },
    {
      id: 'agnes-3.0-flash', label: 'Agnes 3.0 Flash', tier: 'chat', provider: 'agnes', providerId: 'platform',
      supportsThinking: false, supportsReasoningEffort: false, maxOutputTokens: 65536, defaultMaxTokens: 32768,
      description: '轻量快速模型，TPS 高，适合 skill 高频调用'
    }
  ];
  const platform: ProviderDefinition = {
    id: 'platform', name: '平台通道（继承）', enabled: true, recommended: true, endpointSource: 'inherit', models
  };
  return {
    models,
    providers: [platform],
    aliases: {
      chat: ['deepseek-v4-flash', 'agnes-3.0-flash'],
      reasoning: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      light: ['agnes-3.0-flash']
    },
    defaults: { chat: 'deepseek-v4-flash', reasoning: 'deepseek-v4-pro' },
    source: 'embedded-fallback'
  };
}

/** 把快照**原地**灌进历史导出（数组/Map/对象身份不变，热重载后旧引用继续有效）。 */
function applySnapshot(snapshot: RegistrySnapshot): void {
  const enabledProviders = snapshot.providers.filter((p) => p.enabled);
  const allEnabledModels = enabledProviders.flatMap((p) => p.models);

  // 多通道重名允许（同一模型经聚合网关与官方 API 各服务一份是常态）：
  // 裸 id 归声明在前的启用通道（first-wins，总览告警提示歧义）；
  // 限定式 providerId/modelId 全量入限定表，跨通道精确引用不受影响。
  MODEL_MAP.clear();
  QUALIFIED_MODEL_MAP.clear();
  const seen = new Set<string>();
  const models: ModelDefinition[] = [];
  for (const m of allEnabledModels) {
    QUALIFIED_MODEL_MAP.set(`${m.providerId}/${m.id}`, m);
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    models.push(m);
    MODEL_MAP.set(m.id, m);
  }

  AVAILABLE_MODELS.length = 0;
  AVAILABLE_MODELS.push(...models);

  MODELS_BY_TIER.chat = models.filter((m) => m.tier === 'chat');
  MODELS_BY_TIER.reasoning = models.filter((m) => m.tier === 'reasoning');

  for (const key of Object.keys(MODEL_ALIASES)) delete MODEL_ALIASES[key];
  Object.assign(MODEL_ALIASES, snapshot.aliases);

  activeProviders = snapshot.providers;
  activeDefaults = snapshot.defaults;
  activeSource = snapshot.source;
}

function asNumber(value: unknown, field: string, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`llm-providers.json：${where} 的 ${field} 必须是正数，实际 ${JSON.stringify(value)}`);
  }
  return value;
}

function parseModelEntry(providerId: string, providerName: string, endpoint: { baseUrl: string; apiKeyEnv: string } | null, modelId: string, raw: unknown): ModelDefinition {
  const where = `provider「${providerId}」模型「${modelId}」`;
  if (!MODEL_ID_PATTERN.test(modelId)) {
    throw new Error(`llm-providers.json：${where} 的 id 非法（允许 [a-zA-Z0-9._-]，不能带 /）`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`llm-providers.json：${where} 必须是对象`);
  }
  const b = raw as Record<string, unknown>;
  const tier = b.tier === 'reasoning' ? 'reasoning' : b.tier === 'chat' ? 'chat' : null;
  if (!tier) throw new Error(`llm-providers.json：${where} 的 tier 必须是 chat 或 reasoning`);
  const def: ModelDefinition = {
    id: modelId,
    label: typeof b.label === 'string' && b.label.trim() ? b.label.trim() : modelId,
    tier,
    provider: providerId,
    providerId,
    providerName,
    ...(endpoint ? { providerEndpoint: endpoint } : {}),
    ...(b.supportsThinking === true ? { supportsThinking: true } : b.supportsThinking === false ? { supportsThinking: false } : {}),
    ...(b.supportsReasoningEffort === true ? { supportsReasoningEffort: true } : b.supportsReasoningEffort === false ? { supportsReasoningEffort: false } : {}),
    ...(b.maxOutputTokens != null ? { maxOutputTokens: asNumber(b.maxOutputTokens, 'maxOutputTokens', where) } : {}),
    ...(b.defaultMaxTokens != null ? { defaultMaxTokens: asNumber(b.defaultMaxTokens, 'defaultMaxTokens', where) } : {}),
    ...(b.reasoningReserveTokens != null ? { reasoningReserveTokens: asNumber(b.reasoningReserveTokens, 'reasoningReserveTokens', where) } : {}),
    ...(b.maxParallelRequests != null ? { maxParallelRequests: asNumber(b.maxParallelRequests, 'maxParallelRequests', where) } : {}),
    ...(Array.isArray(b.fallbacks) ? { fallbacks: b.fallbacks.map((x) => String(x).trim()).filter(Boolean) } : {}),
    ...(b.pricing && typeof b.pricing === 'object' && !Array.isArray(b.pricing) ? { pricing: b.pricing as ModelPricing } : {}),
    ...(typeof b.description === 'string' && b.description.trim() ? { description: b.description.trim() } : {})
  };
  if (def.supportsReasoningEffort === true && def.supportsThinking !== true) {
    throw new Error(`llm-providers.json：${where} 声明了 supportsReasoningEffort 但未开 supportsThinking（矛盾）`);
  }
  return def;
}

/**
 * 解析 llm-providers.json 文本 → 注册表快照。任何结构性问题直接抛错（带文件定位语义）。
 * 语义约定：文件存在但非法 = fail-loud；调用方（启动）不吞这个错。
 */
export function parseLlmProvidersConfig(raw: string): RegistrySnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`llm-providers.json 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('llm-providers.json：顶层必须是对象');
  }
  const root = parsed as Record<string, unknown>;
  if (!root.providers || typeof root.providers !== 'object' || Array.isArray(root.providers)) {
    throw new Error('llm-providers.json：缺少 providers 对象');
  }

  const providers: ProviderDefinition[] = [];
  for (const [providerId, value] of Object.entries(root.providers as Record<string, unknown>)) {
    if (!PROVIDER_ID_PATTERN.test(providerId)) {
      throw new Error(`llm-providers.json：provider id「${providerId}」非法（允许 [a-z0-9_-]）`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`llm-providers.json：provider「${providerId}」必须是对象`);
    }
    const p = value as Record<string, unknown>;
    const baseUrl = typeof p.baseUrl === 'string' ? p.baseUrl.trim() : '';
    const apiKeyEnv = typeof p.apiKeyEnv === 'string' ? p.apiKeyEnv.trim() : '';
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      throw new Error(`llm-providers.json：provider「${providerId}」的 baseUrl 必须以 http(s):// 开头`);
    }
    if (baseUrl && !apiKeyEnv) {
      throw new Error(`llm-providers.json：provider「${providerId}」声明了 baseUrl 就必须给 apiKeyEnv（密钥只走环境变量，严禁写进本文件）`);
    }
    if (!baseUrl && apiKeyEnv) {
      throw new Error(`llm-providers.json：provider「${providerId}」只有继承通道不应声明 apiKeyEnv`);
    }
    if (!p.models || typeof p.models !== 'object' || Array.isArray(p.models)) {
      throw new Error(`llm-providers.json：provider「${providerId}」缺少 models 对象`);
    }
    const endpoint = baseUrl ? { baseUrl, apiKeyEnv } : null;
    const models = Object.entries(p.models as Record<string, unknown>).map(([modelId, m]) =>
      parseModelEntry(providerId, String(p.name || providerId), endpoint, modelId, m)
    );
    // 跨 provider 重名合法（裸 id first-wins + 总览告警，见 applySnapshot）；provider 内 JSON 键天然唯一
    providers.push({
      id: providerId,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : providerId,
      ...(typeof p.description === 'string' && p.description.trim() ? { description: p.description.trim() } : {}),
      enabled: p.enabled !== false,
      recommended: p.recommended === true,
      endpointSource: baseUrl ? 'own' : 'inherit',
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      models
    });
  }
  if (!providers.some((p) => p.enabled && p.models.length)) {
    throw new Error('llm-providers.json：没有任何 enabled 的 provider 提供模型（注册表为空会令全平台无法路由）');
  }

  const aliases: Record<string, string[]> = {};
  if (root.aliases != null) {
    if (typeof root.aliases !== 'object' || Array.isArray(root.aliases)) {
      throw new Error('llm-providers.json：aliases 必须是对象');
    }
    for (const [alias, members] of Object.entries(root.aliases as Record<string, unknown>)) {
      if (!/^[a-z0-9_-]+$/.test(alias)) {
        throw new Error(`llm-providers.json：别名「${alias}」非法（允许 [a-z0-9_-]）`);
      }
      if (!Array.isArray(members)) {
        throw new Error(`llm-providers.json：别名「${alias}」的成员必须是字符串数组`);
      }
      aliases[alias] = members.map((x) => String(x).trim()).filter(Boolean);
    }
  }

  const defaults: { chat: string; reasoning: string } = { chat: DEFAULT_MODELS.chat, reasoning: DEFAULT_MODELS.reasoning };
  if (root.defaults != null) {
    if (typeof root.defaults !== 'object' || Array.isArray(root.defaults)) {
      throw new Error('llm-providers.json：defaults 必须是对象');
    }
    const d = root.defaults as Record<string, unknown>;
    if (d.chat != null) {
      if (typeof d.chat !== 'string' || !d.chat.trim()) throw new Error('llm-providers.json：defaults.chat 必须是非空字符串');
      defaults.chat = d.chat.trim();
    }
    if (d.reasoning != null) {
      if (typeof d.reasoning !== 'string' || !d.reasoning.trim()) throw new Error('llm-providers.json：defaults.reasoning 必须是非空字符串');
      defaults.reasoning = d.reasoning.trim();
    }
  }

  return { models: providers.flatMap((p) => p.models), providers, aliases, defaults, source: 'file' };
}

function initFromDisk(): void {
  const configPath = resolveConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    // 文件缺失 = 用内置兜底目录（fresh clone / 文件被挪走时后端必须能起）
    applySnapshot(buildEmbeddedFallback());
    return;
  }
  // 文件存在但非法 = fail-loud（静默回退会把运维配置错误藏起来）
  const snapshot = parseLlmProvidersConfig(raw);
  applySnapshot(snapshot);
  try { lastMtimeMs = fs.statSync(configPath).mtimeMs; } catch { lastMtimeMs = null; }
}
initFromDisk();

/**
 * 热重载：文件 mtime 变化时重读并原地更新注册表。
 * 解析失败时**保留上一次好目录**并把错误记入 status（运行中的服务不能因一次坏编辑崩溃）。
 * 由路由层在每次 resolve 前调用（stat 开销远小于一次 LLM 调用）。
 */
export function reloadLlmProvidersIfChanged(): { reloaded: boolean; error: string | null } {
  const configPath = resolveConfigPath();
  let st: fs.Stats;
  try {
    st = fs.statSync(configPath);
  } catch {
    lastReloadError = `配置文件不可读：${configPath}`;
    return { reloaded: false, error: lastReloadError };
  }
  if (lastMtimeMs !== null && st.mtimeMs === lastMtimeMs && activeSource === 'file') {
    lastReloadError = null;
    return { reloaded: false, error: null };
  }
  try {
    const snapshot = parseLlmProvidersConfig(fs.readFileSync(configPath, 'utf-8'));
    applySnapshot(snapshot);
    lastMtimeMs = st.mtimeMs;
    lastReloadError = null;
    return { reloaded: true, error: null };
  } catch (e) {
    lastReloadError = e instanceof Error ? e.message : String(e);
    return { reloaded: false, error: lastReloadError };
  }
}

/** 注册表加载状态（model-registry 总览/健康检查用）。 */
export function getLlmRegistryStatus(): RegistryStatus {
  return { path: resolveConfigPath(), source: activeSource, mtimeMs: lastMtimeMs, lastError: lastReloadError };
}

/** 全部 provider 条目（含 enabled=false 的示例/停用条目，供总览与前端展示全貌）。 */
export function getProviderCatalog(): ProviderDefinition[] {
  return activeProviders;
}

/** 运行时生效的别名默认值（跟随配置文件；DEFAULT_MODELS 仅为兼容快照）。 */
export function getModelDefaults(): { chat: string; reasoning: string } {
  return { ...activeDefaults };
}

/**
 * 解析模型引用：`providerId/modelId` 限定式（仅当命中已注册供应商+目录内模型）或裸 id。
 * 未命中返回 null —— 调用方按「字面量透传」（历史行为：未知 id 原样发给上游）处理。
 */
export function resolveModelRef(ref: string): { providerId: string; modelId: string; definition: ModelDefinition } | null {
  const value = String(ref || '').trim();
  if (!value) return null;
  const slash = value.indexOf('/');
  if (slash > 0) {
    const def = QUALIFIED_MODEL_MAP.get(value);
    if (def) return { providerId: def.providerId, modelId: def.id, definition: def };
  }
  const bare = MODEL_MAP.get(value);
  if (bare) return { providerId: bare.providerId, modelId: bare.id, definition: bare };
  return null;
}

// ---------------------------------------------------------------------------
// 历史查询 API（签名与语义不变；全部读 call-time 状态，天然跟随热重载）
// ---------------------------------------------------------------------------

/** 是否为已声明的逻辑别名（大小写不敏感）。 */
export function isModelAlias(value: string): boolean {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODEL_ALIASES, key);
}

/**
 * 展开别名成员：DB 覆盖优先，其次配置文件注册表；过滤未注册/重复的模型 id，保留声明顺序。
 */
export function getModelAliasMembers(
  alias: string,
  overrides?: Record<string, string[] | null | undefined> | null
): string[] {
  const key = String(alias || '').trim().toLowerCase();
  const override = overrides?.[key];
  const declared = (override && override.length ? override : MODEL_ALIASES[key]) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of declared) {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed || seen.has(trimmed) || !MODEL_MAP.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * 检查是否为支持 Thinking Mode 的模型
 */
export function supportsThinkingMode(modelId: string): boolean {
  const model = MODEL_MAP.get(modelId);
  return model?.supportsThinking ?? false;
}

/**
 * 检查是否为 DeepSeek V4 模型（兼容旧逻辑）
 */
export function isDeepSeekV4Model(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return normalized === 'deepseek-v4-flash' || normalized === 'deepseek-v4-pro';
}

/**
 * 检查是否为 DeepSeek 推理模型
 */
export function isReasoningModel(modelId: string): boolean {
  const model = MODEL_MAP.get(modelId);
  return model?.tier === 'reasoning';
}

/**
 * 获取模型的显示标签
 */
export function getModelLabel(modelId: string): string {
  return MODEL_MAP.get(modelId)?.label ?? modelId;
}

/**
 * 获取模型的输出 token 上限（上游硬限制）；未知模型返回 null（由调用方决定默认 floor）。
 */
export function getModelMaxOutputTokens(modelId: string): number | null {
  return MODEL_MAP.get(modelId)?.maxOutputTokens ?? null;
}

/** 取模型完整定义（能力注册表入口）。 */
export function getModelDefinition(modelId: string): ModelDefinition | undefined {
  return MODEL_MAP.get(modelId);
}

/** 调用方未声明输出预算时的模型级缺省值；未配置返回 null。 */
export function getModelDefaultMaxTokens(modelId: string): number | null {
  return MODEL_MAP.get(modelId)?.defaultMaxTokens ?? null;
}

/** 开启思考时为推理预留的额外 token 预算（与输出预算分离）；未配置返回 0。 */
export function getModelReasoningReserveTokens(modelId: string): number {
  return MODEL_MAP.get(modelId)?.reasoningReserveTokens ?? 0;
}

/** 模型是否支持 `reasoning_effort` 字段。 */
export function supportsReasoningEffort(modelId: string): boolean {
  return MODEL_MAP.get(modelId)?.supportsReasoningEffort ?? false;
}

/** 取模型的降级候选（已过滤不存在的模型 id 与重复项）；未配置返回空数组。 */
export function getModelFallbacks(modelId: string): string[] {
  const declared = MODEL_MAP.get(modelId)?.fallbacks ?? [];
  const seen = new Set<string>([modelId]);
  const out: string[] = [];
  for (const id of declared) {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed || seen.has(trimmed) || !MODEL_MAP.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * 验证模型 ID 是否有效
 */
export function isValidModel(modelId: string): boolean {
  return MODEL_MAP.has(modelId);
}

/**
 * 获取所有模型 ID 列表（用于验证和配置）
 */
export function getAllModelIds(): string[] {
  return AVAILABLE_MODELS.map((m) => m.id);
}
