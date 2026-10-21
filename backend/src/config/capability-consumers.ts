/**
 * 能力/配置字段的消费方账本（2026-10-21）。
 *
 * 为什么需要：`backend/config/llm-providers.json` 是 File-as-Truth，但解析器是
 * 逐字段白名单复制——写错键名、写了没人读的键，加载器**静默丢弃**；管理台又会在
 * 保存时原样保留未知键，于是形成「文件里有、运行时永远不生效、界面上也看不出来」
 * 的死配置。此前只能靠人工通读代码判断某个字段有没有消费者。
 *
 * 本账本把每个字段的消费面显式登记下来：
 * - `runtime`：影响路由/请求体/成本等运行时行为，必须至少有一个真实读取点；
 * - `display`：只用于管理台/选择器展示；
 * - `derived`：不从文件读取，由加载器推导（如 endpointSource）；
 * - `unsupported`：已知但零消费方，写入即无效（检查器会持续报警）。
 *
 * `scripts/check-capability-consumers.ts` 用它在 CI 里对账：
 * 1. 文件里出现的 provider/model 键必须在账本里登记（否则报 unknown）；
 * 2. 登记为 runtime/display 的条目，引用的消费点文件必须存在且含该符号；
 * 3. 登记为 unsupported 的字段一旦出现在真实文件里即报错。
 */
export type CapabilityConsumerKind = 'runtime' | 'display' | 'derived' | 'unsupported';

export interface CapabilityConsumerEntry {
  /** `provider.<field>` 或 `model.<field>` */
  field: string;
  kind: CapabilityConsumerKind;
  /** 消费点：`<相对 backend/src 的路径>#<符号或可搜索片段>` */
  consumers: string[];
  note?: string;
}

const PROVIDER_ENTRIES: CapabilityConsumerEntry[] = [
  {
    field: 'provider.enabled',
    kind: 'runtime',
    consumers: ['config/models.config.ts#enabledProviders', 'services/admin/model-providers.service.ts#buildProvidersView'],
  },
  {
    field: 'provider.baseUrl',
    kind: 'derived',
    consumers: [
      'config/models.config.ts#endpointSource',
      'gateway/api-gateway/router.ts#resolveBaseRoute',
    ],
    note: 'endpointSource 由 baseUrl 是否存在推导，文件里不直接写 endpointSource',
  },
  {
    field: 'provider.apiKeyEnv',
    kind: 'runtime',
    consumers: ['config/models.config.ts#parseLlmProvidersConfig', 'gateway/api-gateway/router.ts#applyProviderEndpoint'],
  },
  {
    field: 'provider.supportsSystemRole',
    kind: 'runtime',
    consumers: [
      'config/models.config.ts#providerAcceptsSystemRole',
      'gateway/api-gateway/executor.ts#shouldFoldSystemPromptForRoute',
    ],
  },
  {
    field: 'provider.recommended',
    kind: 'display',
    consumers: ['services/model-registry.service.ts#recommended', 'routes/config.ts#recommended'],
  },
  { field: 'provider.name', kind: 'display', consumers: ['services/model-registry.service.ts#providerName'] },
  { field: 'provider.description', kind: 'display', consumers: ['routes/config.ts#description'] },
  { field: 'provider.models', kind: 'runtime', consumers: ['config/models.config.ts#parseLlmProvidersConfig'] },
];

const MODEL_ENTRIES: CapabilityConsumerEntry[] = [
  { field: 'model.tier', kind: 'runtime', consumers: ['config/models.config.ts#MODELS_BY_TIER'] },
  {
    field: 'model.supportsThinking',
    kind: 'runtime',
    consumers: ['gateway/api-gateway/thinking-policy.ts#supportsThinking'],
  },
  {
    field: 'model.supportsReasoningEffort',
    kind: 'runtime',
    consumers: ['gateway/api-gateway/thinking-policy.ts#supportsReasoningEffort'],
  },
  {
    field: 'model.vision',
    kind: 'runtime',
    consumers: ['gateway/api-gateway/executor.ts#supportsVision', 'composers/prompt-composer.ts#supportsVision'],
  },
  {
    field: 'model.maxOutputTokens',
    kind: 'runtime',
    consumers: ['gateway/api-gateway/thinking-policy.ts#maxOutputTokens', 'services/resolve-llm-call-params.ts#maxOutputTokens'],
  },
  {
    field: 'model.defaultMaxTokens',
    kind: 'runtime',
    consumers: ['services/resolve-llm-call-params.ts#defaultMaxTokens'],
  },
  {
    field: 'model.reasoningReserveTokens',
    kind: 'runtime',
    consumers: ['gateway/api-gateway/thinking-policy.ts#reasoningReserveTokens'],
  },
  {
    field: 'model.maxParallelRequests',
    kind: 'runtime',
    consumers: ['gateway/api-gateway/model-concurrency.ts#maxParallelRequests'],
  },
  {
    field: 'model.fallbacks',
    kind: 'runtime',
    consumers: ['gateway/api-gateway/executor.ts#getModelFallbacks', 'config/models.config.ts#getModelFallbacks'],
  },
  {
    field: 'model.pricing',
    kind: 'runtime',
    consumers: ['services/cost/model-cost.ts#pricing'],
  },
  {
    field: 'model.providerEndpoint',
    kind: 'runtime',
    consumers: ['gateway/api-gateway/router.ts#applyProviderEndpoint'],
    note: '由 provider 端点在加载时写入，不出现在文件里',
  },
  { field: 'model.label', kind: 'display', consumers: ['services/model-registry.service.ts#label'] },
  { field: 'model.description', kind: 'display', consumers: ['services/model-registry.service.ts#description'] },
  { field: 'model.provider', kind: 'display', consumers: ['services/model-registry.service.ts#provider'] },
  { field: 'model.providerName', kind: 'display', consumers: ['services/model-registry.service.ts#providerName'] },
];

const ROOT_ENTRIES: CapabilityConsumerEntry[] = [
  { field: 'root.providers', kind: 'runtime', consumers: ['config/models.config.ts#parseLlmProvidersConfig'] },
  { field: 'root.aliases', kind: 'runtime', consumers: ['config/models.config.ts#MODEL_ALIASES'] },
  {
    field: 'root.defaults',
    kind: 'display',
    consumers: ['services/model-registry.service.ts#getModelDefaults', 'routes/config.ts#defaults'],
    note: '仅状态投影；真实默认模型来自 platform DB 配置，不由这里驱动',
  },
  { field: 'root.$header', kind: 'display', consumers: [], note: '文件注释头，不参与解析' },
  { field: 'root.$rules', kind: 'display', consumers: [], note: '文件注释块，不参与解析' },
];

/**
 * 已知但零消费方的字段：一旦出现在真实文件里说明配置写错了地方，
 * 检查器会直接失败（避免「写了以为生效」）。
 */
export const UNSUPPORTED_FIELDS: string[] = [
  'provider.capabilities',
  'provider.contextWindow',
  'provider.supportsTools',
  'provider.supportsStream',
  'model.capabilities',
  'model.contextWindow',
  'model.supportsTools',
  'model.supportsStream',
];

export const CAPABILITY_CONSUMERS: CapabilityConsumerEntry[] = [
  ...PROVIDER_ENTRIES,
  ...MODEL_ENTRIES,
  ...ROOT_ENTRIES,
];

/** 按字段查账本；未登记返回 undefined。 */
export function findCapabilityConsumer(field: string): CapabilityConsumerEntry | undefined {
  return CAPABILITY_CONSUMERS.find((entry) => entry.field === field);
}

/** 需要运行时消费者的字段集合（检查器据此强制 consumers 非空且可解析）。 */
export function runtimeFields(): string[] {
  return CAPABILITY_CONSUMERS.filter((entry) => entry.kind === 'runtime').map((entry) => entry.field);
}
