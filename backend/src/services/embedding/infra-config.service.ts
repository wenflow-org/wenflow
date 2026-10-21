/**
 * 基础设施模型配置服务（embedding / rerank）。
 *
 * 真源：`platform_settings.infraModels`（JSON，非密钥字段）+ `provider_secrets`（密钥密文）。
 * 环境变量只作首次部署与回落。运行时读取是同步的（`readBgeConfig`），因此这里维护一份
 * 进程内快照：启动时 `loadInfraModelConfig()` 水合，管理端保存后再水合一次。
 *
 * 为什么不做成插件开关：embedding/rerank 是平台必需基础设施，缺失时消费方 fail-open
 * （语义召回退回结构化/余弦），不是流程节点。管理面只管理 provider/endpoint/key/model/
 * timeout/batch，和 LLM 模型配置同类。
 */
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import {
  INFRA_PROVIDER_IDS,
  INFRA_SETTING_KEY,
  defaultInfraModelsConfig,
  mergeInfraModelsConfig,
  toPersistedInfraModelsConfig,
  validateInfraModelsConfig,
  type InfraModelEntry,
  type InfraModelKind,
  type InfraModelsConfig,
} from './infra-config';
import {
  deleteProviderSecret,
  providerSecretSummary,
  resolveProviderApiKey,
  setProviderSecret,
} from '../provider-secrets.service';

export interface InfraModelRuntimeEntry extends InfraModelEntry {
  apiKey: string;
}

export interface InfraModelsRuntimeConfig {
  embedding: InfraModelRuntimeEntry;
  rerank: InfraModelRuntimeEntry;
  required: boolean;
  source: 'db' | 'env';
}

export interface InfraModelView extends InfraModelEntry {
  kind: InfraModelKind;
  configured: boolean;
  configSource: 'db' | 'env';
  keySource: 'db' | 'env' | 'inherit' | 'none';
  keyHint: string | null;
}

export interface InfraModelsView {
  required: boolean;
  embedding: InfraModelView;
  rerank: InfraModelView;
  warnings: string[];
}

export interface InfraModelStatus {
  required: boolean;
  source: 'db' | 'env';
  embedding: { configured: boolean; model: string; endpoint: string };
  rerank: { configured: boolean; model: string; endpoint: string };
}

export interface InfraModelsUpdateInput {
  embedding?: Partial<InfraModelEntry> & { apiKey?: string | null; clearKey?: boolean };
  rerank?: Partial<InfraModelEntry> & { apiKey?: string | null; clearKey?: boolean };
  required?: boolean;
}

export class InfraConfigError extends Error {
  readonly status = 400;
  readonly code = 'INFRA_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'InfraConfigError';
  }
}

let runtimeCache: InfraModelsRuntimeConfig | null = null;
let lastConfigErrors: string[] = [];

function envKey(name: string): string {
  return String(process.env[name] || '').trim();
}

function buildRuntime(
  config: InfraModelsConfig,
  source: 'db' | 'env',
  embeddingKey: string,
  rerankKey: string,
): InfraModelsRuntimeConfig {
  return {
    embedding: { ...config.embedding, apiKey: embeddingKey },
    rerank: { ...config.rerank, apiKey: rerankKey || embeddingKey },
    required: config.required,
    source,
  };
}

function isConfigured(entry: InfraModelRuntimeEntry): boolean {
  return Boolean(entry.apiKey && entry.endpoint);
}

function missingOf(runtime: InfraModelsRuntimeConfig): string[] {
  const missing: string[] = [];
  if (!isConfigured(runtime.embedding)) missing.push('embedding（向量化）');
  if (!isConfigured(runtime.rerank)) missing.push('rerank（重排）');
  return missing;
}

async function readStoredConfig(): Promise<{ config: InfraModelsConfig | null; errors: string[] }> {
  try {
    const row = await systemPrisma.platform_settings.findUnique({ where: { key: INFRA_SETTING_KEY } });
    if (!row?.value) return { config: null, errors: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return { config: null, errors: ['存储的基础设施配置不是合法 JSON'] };
    }
    return {
      config: mergeInfraModelsConfig(defaultInfraModelsConfig(), parsed as Parameters<typeof mergeInfraModelsConfig>[1]),
      errors: [],
    };
  } catch (error) {
    return {
      config: null,
      errors: [`平台设置暂时不可读，已回落环境变量：${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * 从平台设置水合运行时快照。DB 不可用/配置非法时回落环境变量，不抛错——
 * 基础设施不可用应由消费方 fail-open，而不是拖垮启动。
 */
export async function loadInfraModelConfig(): Promise<InfraModelsRuntimeConfig> {
  const defaults = defaultInfraModelsConfig();
  const stored = await readStoredConfig();
  let config = defaults;
  let source: 'db' | 'env' = 'env';
  lastConfigErrors = [];

  if (stored.config) {
    const errors = validateInfraModelsConfig(stored.config);
    if (errors.length) {
      lastConfigErrors = errors;
      logger.warn('[infra-models] 存储配置非法，已回落环境变量', { errors });
    } else {
      config = stored.config;
      source = 'db';
    }
  } else if (stored.errors.length) {
    lastConfigErrors = stored.errors;
  }

  const [embeddingSecret, rerankSecret] = await Promise.all([
    resolveProviderApiKey(INFRA_PROVIDER_IDS.embedding, config.embedding.apiKeyEnv),
    resolveProviderApiKey(INFRA_PROVIDER_IDS.rerank, config.rerank.apiKeyEnv),
  ]);
  const embeddingKey = embeddingSecret?.apiKey || envKey(config.embedding.apiKeyEnv);
  // 当前 BGE 网关两接口共用一把 key：独立 key 缺失时沿用 embedding key
  const rerankKey = rerankSecret?.apiKey || envKey(config.rerank.apiKeyEnv) || embeddingKey;

  runtimeCache = buildRuntime(config, source, embeddingKey, rerankKey);
  if (config.required) {
    const missing = missingOf(runtimeCache);
    if (missing.length) {
      logger.warn('[infra-models] 平台必需基础设施未完整配置', {
        missing,
        source,
        hint: '在「模型与接入 → 接入与模型 → 基础设施模型」补充地址/密钥，或配置相应的环境变量',
      });
    }
  }
  return runtimeCache;
}

/** 同步读取运行时快照；尚未水合时按环境变量兜底（保持 readBgeConfig 同步契约） */
export function getInfraModelConfigSync(): InfraModelsRuntimeConfig {
  if (runtimeCache) return runtimeCache;
  const config = defaultInfraModelsConfig();
  const embeddingKey = envKey(config.embedding.apiKeyEnv);
  const rerankKey = envKey(config.rerank.apiKeyEnv) || embeddingKey;
  return buildRuntime(config, 'env', embeddingKey, rerankKey);
}

/** 供模型注册表/健康面使用的同步状态（不查库） */
export function getInfraModelStatus(): InfraModelStatus {
  const runtime = getInfraModelConfigSync();
  return {
    required: runtime.required,
    source: runtime.source,
    embedding: {
      configured: isConfigured(runtime.embedding),
      model: runtime.embedding.model,
      endpoint: runtime.embedding.endpoint,
    },
    rerank: {
      configured: isConfigured(runtime.rerank),
      model: runtime.rerank.model,
      endpoint: runtime.rerank.endpoint,
    },
  };
}

async function toView(
  runtime: InfraModelsRuntimeConfig,
  kind: InfraModelKind,
): Promise<InfraModelView> {
  const entry = runtime[kind];
  const embeddingSummary = kind === 'rerank'
    ? await providerSecretSummary(INFRA_PROVIDER_IDS.embedding, runtime.embedding.apiKeyEnv)
    : null;
  const ownSummary = await providerSecretSummary(INFRA_PROVIDER_IDS[kind], entry.apiKeyEnv);
  const inherited = kind === 'rerank' && ownSummary.keySource === 'none' && embeddingSummary?.keySource !== 'none';
  return {
    kind,
    provider: entry.provider,
    endpoint: entry.endpoint,
    model: entry.model,
    apiKeyEnv: entry.apiKeyEnv,
    timeoutMs: entry.timeoutMs,
    batchSize: entry.batchSize,
    dimensions: entry.dimensions,
    configured: isConfigured(entry),
    configSource: runtime.source,
    keySource: inherited ? 'inherit' : ownSummary.keySource,
    keyHint: ownSummary.keyHint || (inherited ? embeddingSummary?.keyHint ?? null : null),
  };
}

/** 管理端 GET：配置 + 密钥来源 + 必需项缺口 */
export async function getInfraModelsView(): Promise<InfraModelsView> {
  const runtime = await loadInfraModelConfig();
  const [embedding, rerank] = await Promise.all([
    toView(runtime, 'embedding'),
    toView(runtime, 'rerank'),
  ]);
  const warnings = [...lastConfigErrors];
  if (runtime.required) {
    if (!embedding.configured) warnings.push('向量化未配置：资料语义召回会退回结构化路径。');
    if (!rerank.configured) warnings.push('重排未配置：语义召回会退回余弦序。');
  }
  return { required: runtime.required, embedding, rerank, warnings };
}

/** 管理端 PUT：只写非密钥配置到 platform_settings，密钥写 provider_secrets 密文 */
export async function saveInfraModels(input: InfraModelsUpdateInput): Promise<InfraModelsView> {
  const base = (await readStoredConfig()).config ?? defaultInfraModelsConfig();
  const merged = mergeInfraModelsConfig(base, {
    embedding: input.embedding,
    rerank: input.rerank,
    required: input.required,
  });
  const errors = validateInfraModelsConfig(merged);
  if (errors.length) {
    throw new InfraConfigError(errors.join('；'));
  }

  for (const kind of ['embedding', 'rerank'] as const) {
    const patch = input[kind];
    if (!patch) continue;
    const apiKey = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : '';
    if (apiKey) {
      await setProviderSecret(INFRA_PROVIDER_IDS[kind], apiKey, merged[kind].apiKeyEnv);
    }
    if (patch.clearKey) {
      await deleteProviderSecret(INFRA_PROVIDER_IDS[kind]);
    }
  }

  await systemPrisma.platform_settings.upsert({
    where: { key: INFRA_SETTING_KEY },
    update: { value: JSON.stringify(toPersistedInfraModelsConfig(merged)) },
    create: { key: INFRA_SETTING_KEY, value: JSON.stringify(toPersistedInfraModelsConfig(merged)) },
  });

  return getInfraModelsView();
}

/** 测试用：清掉进程内快照，让下一次读取重新按 env 兜底 */
export function resetInfraModelConfigCacheForTests(): void {
  runtimeCache = null;
  lastConfigErrors = [];
}
