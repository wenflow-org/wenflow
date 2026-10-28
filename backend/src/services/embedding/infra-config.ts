/**
 * 基础设施模型配置（embedding / rerank）的纯数据层。
 *
 * 定位（2026-10-20 用户拍板）：embedding/rerank 不是插件，是平台必需的基础设施模型。
 * 它们和 LLM 一样需要 provider / endpoint / key / model / timeout / 批量，只是不参与
 * 对话路由。配置真源 = `platform_settings.infraModels`（JSON），密钥走
 * `provider_secrets` 密文；环境变量只作为首次部署与回落来源。
 *
 * 本文件不碰数据库，只负责默认值、合并与校验，便于单测。
 */

export type InfraModelKind = 'embedding' | 'rerank';
export type InfraProvider = 'bge';
/** inherit = 沿用平台通道的 base URL 与密钥；own = 本条目独立配置地址与密钥 */
export type InfraConnectionMode = 'inherit' | 'own';

export const INFRA_SETTING_KEY = 'infraModels';

/** provider_secrets.providerId：与 LLM 供应商分开命名，避免未来同名冲突 */
export const INFRA_PROVIDER_IDS: Record<InfraModelKind, string> = {
  embedding: 'infra-embedding',
  rerank: 'infra-rerank',
};

export interface InfraModelEntry {
  provider: InfraProvider;
  /** 连接方式；inherit 时 endpoint 仅作切换回 own 的留档，运行时不使用 */
  connectionMode: InfraConnectionMode;
  endpoint: string;
  model: string;
  apiKeyEnv: string;
  timeoutMs: number;
  /** 仅 embedding 使用；rerank 固定 null */
  batchSize: number | null;
  /** 由上游返回值观测，不在配置时强制；仅作展示/索引失效辅助 */
  dimensions: number | null;
}

export interface InfraModelsConfig {
  embedding: InfraModelEntry;
  rerank: InfraModelEntry;
  /** 基建必需：缺失不阻断主流程（fail-open），但健康面必须告警 */
  required: boolean;
}

export const DEFAULT_EMBEDDING_MODEL = 'BAAI/bge-m3';
export const DEFAULT_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';
export const DEFAULT_INFRA_TIMEOUT_MS = 20_000;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 32;
export const MAX_INFRA_TIMEOUT_MS = 120_000;
export const MAX_EMBEDDING_BATCH_SIZE = 128;
export const MAX_EMBEDDING_DIMENSIONS = 16_384;

/**
 * 沿用平台连接时，按类型从平台 base URL 推导端点。
 * 与对话侧同一套 `/v1` 约定：`.../v1` 只补类型路径，裸域名补 `/v1/...`。
 * 非标准网关请切到 own 模式直接填完整地址。
 */
export function resolveInfraEndpoint(baseUrl: string, kind: InfraModelKind): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  const suffix = kind === 'embedding' ? '/embeddings' : '/rerank';
  return /\/v1$/i.test(base) ? `${base}${suffix}` : `${base}/v1${suffix}`;
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** 首次部署/未落库时的默认配置：全部来自环境变量（历史行为） */
export function defaultInfraModelsConfig(env: NodeJS.ProcessEnv = process.env): InfraModelsConfig {
  return {
    embedding: {
      provider: 'bge',
      connectionMode: 'own',
      endpoint: (env.EMBEDDING_API_URL || '').trim(),
      model: (env.EMBEDDING_MODEL || '').trim() || DEFAULT_EMBEDDING_MODEL,
      apiKeyEnv: 'EMBEDDING_API_KEY',
      timeoutMs: positiveInt(env.EMBEDDING_TIMEOUT_MS) ?? DEFAULT_INFRA_TIMEOUT_MS,
      batchSize: positiveInt(env.EMBEDDING_BATCH_SIZE) ?? DEFAULT_EMBEDDING_BATCH_SIZE,
      dimensions: null,
    },
    rerank: {
      provider: 'bge',
      connectionMode: 'own',
      endpoint: (env.RERANK_API_URL || '').trim(),
      model: (env.RERANK_MODEL || '').trim() || DEFAULT_RERANK_MODEL,
      // 当前 BGE 网关两接口共用一把 key；独立 key 用 RERANK_API_KEY，缺省回落 embedding key
      apiKeyEnv: 'RERANK_API_KEY',
      timeoutMs: positiveInt(env.EMBEDDING_TIMEOUT_MS) ?? DEFAULT_INFRA_TIMEOUT_MS,
      batchSize: null,
      dimensions: null,
    },
    required: true,
  };
}

function mergeText(base: string, value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : base;
}

function mergeInt(base: number | null, value: unknown): number | null {
  const n = positiveInt(value);
  return n ?? base;
}

function mergeEntry(kind: InfraModelKind, base: InfraModelEntry, input: Partial<InfraModelEntry> | undefined): InfraModelEntry {
  if (!input) return base;
  return {
    provider: input.provider === 'bge' ? 'bge' : base.provider,
    connectionMode: input.connectionMode === 'inherit' || input.connectionMode === 'own'
      ? input.connectionMode
      : base.connectionMode,
    endpoint: mergeText(base.endpoint, input.endpoint),
    model: mergeText(base.model, input.model),
    apiKeyEnv: mergeText(base.apiKeyEnv, input.apiKeyEnv),
    timeoutMs: mergeInt(base.timeoutMs, input.timeoutMs) ?? base.timeoutMs,
    batchSize: kind === 'embedding' ? mergeInt(base.batchSize, input.batchSize) : null,
    dimensions: input.dimensions === null ? null : mergeInt(base.dimensions, input.dimensions),
  };
}

/** 平台配置覆盖默认值；只覆盖显式给出的字段，空字符串/非法数字回落到默认 */
export function mergeInfraModelsConfig(
  base: InfraModelsConfig,
  input: Partial<{ embedding: Partial<InfraModelEntry>; rerank: Partial<InfraModelEntry>; required: boolean }> | null | undefined,
): InfraModelsConfig {
  if (!input) return base;
  return {
    embedding: mergeEntry('embedding', base.embedding, input.embedding),
    rerank: mergeEntry('rerank', base.rerank, input.rerank),
    required: typeof input.required === 'boolean' ? input.required : base.required,
  };
}

/** 返回错误消息数组；空数组 = 合法 */
export function validateInfraModelsConfig(config: InfraModelsConfig): string[] {
  const errors: string[] = [];
  for (const kind of ['embedding', 'rerank'] as const) {
    const entry = config[kind];
    const where = kind === 'embedding' ? '向量化' : '重排';
    if (entry.provider !== 'bge') {
      errors.push(`${where}：当前只支持 bge provider`);
    }
    /* 未填服务地址 = 尚未配置，是合法状态：两个基础设施模型各自独立可选，
       允许先配向量化、之后再配重排（消费方对缺失项 fail-open）。
       沿用平台连接时不要求地址；own 模式仍按原规则校验。 */
    const inherit = entry.connectionMode === 'inherit';
    if (!inherit && !entry.endpoint) {
      continue;
    }
    if (!entry.model) {
      errors.push(`${where}：模型 id 不能为空`);
    }
    if (!inherit) {
      if (!/^https?:\/\//i.test(entry.endpoint)) {
        errors.push(`${where}：服务地址必须以 http:// 或 https:// 开头`);
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.apiKeyEnv)) {
        errors.push(`${where}：密钥环境变量名只能包含字母、数字和下划线`);
      }
    }
    if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs < 1_000 || entry.timeoutMs > MAX_INFRA_TIMEOUT_MS) {
      errors.push(`${where}：超时必须是 1000-${MAX_INFRA_TIMEOUT_MS} 之间的整数毫秒`);
    }
    if (kind === 'embedding') {
      if (entry.batchSize === null || !Number.isInteger(entry.batchSize) || entry.batchSize < 1 || entry.batchSize > MAX_EMBEDDING_BATCH_SIZE) {
        errors.push(`向量化：批量大小必须是 1-${MAX_EMBEDDING_BATCH_SIZE} 之间的整数`);
      }
    }
    if (entry.dimensions !== null && (!Number.isInteger(entry.dimensions) || entry.dimensions < 1 || entry.dimensions > MAX_EMBEDDING_DIMENSIONS)) {
      errors.push(`${where}：向量维度必须是 1-${MAX_EMBEDDING_DIMENSIONS} 之间的整数，或留空由上游返回`);
    }
  }
  return errors;
}

/** 仅保留可落库字段：绝不让 apiKey 进入 platform_settings */
export function toPersistedInfraModelsConfig(config: InfraModelsConfig): InfraModelsConfig {
  return {
    embedding: { ...config.embedding },
    rerank: { ...config.rerank },
    required: config.required,
  };
}
