/**
 * 插件外部服务目录（2026-10-24）。
 *
 * 联网 / 决策 / 生图 不是 LLM 模型配置：它们各自是一组外部 provider（搜索、抓取、
 * 决策模型、文生图）＋密钥与入口。本文件把「界面要显示什么、运行时读哪个字段」
 * 收敛成一份声明，provider 适配器与插件配置页都从这里取，避免两处各写一套字段名。
 *
 * 运行时覆盖顺序：平台配置（platform_settings.pluginProviders + provider_secrets）
 * → 环境变量 → 目录里的默认值。密钥只存密文，不写进平台设置 JSON。
 */

export type PluginConfigId = 'web' | 'decision' | 'image';

export interface PluginProviderField {
  /** 存取键：平台设置 JSON / 保存入参 */
  key: string;
  label: string;
  type: 'text' | 'password';
  /** 回落用的环境变量（按顺序取第一个非空） */
  env: readonly string[];
  /** 环境变量也为空时的默认值（密钥字段不用默认密钥） */
  fallback?: string;
  placeholder?: string;
  hint?: string;
  /** true = 走 provider_secrets 密文表 */
  secret?: boolean;
}

export interface PluginProviderDef {
  id: string;
  label: string;
  description: string;
  fields: readonly PluginProviderField[];
}

export interface PluginChannelDef {
  id: string;
  label: string;
  description: string;
  /** 降级链环境变量名；顺序只读展示，本轮不在界面改 */
  orderEnv: string;
  defaultOrder: readonly string[];
}

export interface PluginConfigDef {
  id: PluginConfigId;
  label: string;
  description: string;
  channels: readonly PluginChannelDef[];
  providers: readonly PluginProviderDef[];
}

const apiKeyField = (env: readonly string[]): PluginProviderField => ({
  key: 'apiKey',
  label: '密钥',
  type: 'password',
  env,
  secret: true,
  hint: '留空表示不修改；密钥以密文保存，只显示尾号',
});

export const PLUGIN_CONFIGS: readonly PluginConfigDef[] = [
  {
    id: 'web',
    label: '联网',
    description: '搜索负责找到网页，抓取负责读回正文；两者各自按 provider 顺序降级。',
    channels: [
      {
        id: 'search',
        label: '搜索',
        description: '按顺序尝试已配置密钥的 provider',
        orderEnv: 'SEARCH_PROVIDER',
        defaultOrder: ['tinyfish', 'tavily', 'exa'],
      },
      {
        id: 'fetch',
        label: '抓取',
        description: '按顺序尝试能取回正文的 provider',
        orderEnv: 'FETCH_PROVIDER',
        defaultOrder: ['tinyfish', 'tavily', 'exa'],
      },
    ],
    providers: [
      {
        id: 'tinyfish',
        label: 'TinyFish',
        description: '搜索与抓取都有免费额度，默认排在首位。',
        fields: [
          { key: 'searchEndpoint', label: '搜索地址', type: 'text', env: ['SEARCH_API_URL'], fallback: 'https://api.search.tinyfish.ai' },
          { key: 'fetchEndpoint', label: '抓取地址', type: 'text', env: ['FETCH_API_URL'], fallback: 'https://api.fetch.tinyfish.ai' },
          apiKeyField(['SEARCH_API_KEY', 'FETCH_API_KEY']),
        ],
      },
      {
        id: 'tavily',
        label: 'Tavily',
        description: '同一把密钥同时用于搜索与抓取。',
        fields: [
          { key: 'searchEndpoint', label: '搜索地址', type: 'text', env: ['TAVILY_API_URL'], fallback: 'https://api.tavily.com/search' },
          { key: 'fetchEndpoint', label: '抓取地址', type: 'text', env: ['TAVILY_EXTRACT_URL'], fallback: 'https://api.tavily.com/extract' },
          apiKeyField(['TAVILY_API_KEY']),
        ],
      },
      {
        id: 'exa',
        label: 'Exa',
        description: '语义搜索为主，需要单独申请密钥。',
        fields: [
          { key: 'searchEndpoint', label: '搜索地址', type: 'text', env: ['EXA_API_URL'], fallback: 'https://api.exa.ai/search' },
          { key: 'fetchEndpoint', label: '抓取地址', type: 'text', env: ['EXA_CONTENTS_URL'], fallback: 'https://api.exa.ai/contents' },
          apiKeyField(['EXA_API_KEY']),
        ],
      },
    ],
  },
  {
    id: 'decision',
    label: '决策',
    description: '结构化判定（选择 / 概率 / 分级）由外部决策模型完成，按 provider 顺序降级。',
    channels: [
      {
        id: 'decision',
        label: '判定',
        description: '按顺序尝试已配置的 provider',
        orderEnv: 'DECISION_PROVIDER',
        defaultOrder: ['alibaba'],
      },
    ],
    providers: [
      {
        id: 'alibaba',
        label: '阿里云 MaaS',
        description: '默认 provider，已部署的决策模型端点。',
        fields: [
          { key: 'url', label: '服务地址', type: 'text', env: ['DASHSCOPE_DECISION_URL'], fallback: 'https://ws-j2djr3yj51rhlwmw.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone' },
          { key: 'model', label: '模型', type: 'text', env: ['DASHSCOPE_DECISION_MODEL'], fallback: 'decision-model-preview' },
          apiKeyField(['DASHSCOPE_API_KEY']),
        ],
      },
      {
        id: 'cloudflare',
        label: 'Cloudflare Workers AI',
        description: '需要账号 ID 与 API Token；额度受限，默认不进降级链。',
        fields: [
          { key: 'accountId', label: '账号 ID', type: 'text', env: ['CF_ACCOUNT_ID', 'CF_ACCT'] },
          { key: 'baseUrl', label: '服务地址', type: 'text', env: ['CF_AI_BASE_URL'], fallback: 'https://api.cloudflare.com/client/v4/accounts' },
          { key: 'model', label: '模型', type: 'text', env: ['CF_DECISION_MODEL'], fallback: '@cf/cloudflare/clef-omni' },
          apiKeyField(['CF_TOKEN']),
        ],
      },
      {
        id: 'venice',
        label: 'Venice',
        description: '按量计费，余额为零时返回 402。',
        fields: [
          { key: 'url', label: '服务地址', type: 'text', env: ['VENICE_DECISION_URL'], fallback: 'https://api.venice.ai/api/v1/decisions' },
          { key: 'model', label: '模型', type: 'text', env: ['VENICE_DECISION_MODEL'], fallback: 'jev-latest' },
          apiKeyField(['VENICE_API_KEY']),
        ],
      },
      {
        id: 'opencode',
        label: 'OpenCode Zen',
        description: '共享免费额度；密钥留空时沿用 public。',
        fields: [
          { key: 'url', label: '服务地址', type: 'text', env: ['SYSTEMONE_BASE_URL'], fallback: 'https://opencode.ai/zen/v1/systemone' },
          { key: 'model', label: '模型', type: 'text', env: ['SYSTEMONE_MODEL'], fallback: 'jev-1.13-free' },
          { key: 'apiKey', label: '密钥', type: 'password', env: ['SYSTEMONE_API_KEY'], secret: true, fallback: 'public', hint: '留空沿用 public' },
        ],
      },
      {
        id: 'custom',
        label: '自建端点',
        description: '兼容 { state, questions } → { answers } 的自有部署。',
        fields: [
          { key: 'url', label: '服务地址', type: 'text', env: ['DECISION_CUSTOM_URL'] },
          { key: 'model', label: '模型', type: 'text', env: ['DECISION_CUSTOM_MODEL'] },
          { key: 'authStyle', label: '鉴权方式', type: 'text', env: ['DECISION_CUSTOM_AUTH_STYLE'], fallback: 'bearer', placeholder: 'bearer / raw / header', hint: 'bearer、raw 或 header' },
          apiKeyField(['DECISION_CUSTOM_API_KEY']),
        ],
      },
    ],
  },
  {
    id: 'image',
    label: '生图',
    description: '文生图走单一 provider，失败不会换模型重试。',
    channels: [
      {
        id: 'image',
        label: '生成',
        description: '按顺序尝试已配置的 provider',
        orderEnv: 'IMAGE_PROVIDER',
        defaultOrder: ['agnes'],
      },
    ],
    providers: [
      {
        id: 'agnes',
        label: 'Agnes',
        description: 'OpenAI 兼容的生图端点。',
        fields: [
          { key: 'endpoint', label: '服务地址', type: 'text', env: ['IMAGE_API_URL'], placeholder: 'https://…/v1/images/generations' },
          { key: 'model', label: '模型', type: 'text', env: ['IMAGE_MODEL'], fallback: 'agnes-image-2.5-flash' },
          apiKeyField(['IMAGE_API_KEY']),
        ],
      },
    ],
  },
];

const BY_ID = new Map(PLUGIN_CONFIGS.map((plugin) => [plugin.id, plugin]));

export function isPluginConfigId(value: string): value is PluginConfigId {
  return BY_ID.has(value as PluginConfigId);
}

export function getPluginConfigDef(id: PluginConfigId): PluginConfigDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`未知插件配置：${id}`);
  return def;
}

export function getProviderDef(id: PluginConfigId, providerId: string): PluginProviderDef | null {
  return getPluginConfigDef(id).providers.find((p) => p.id === providerId) ?? null;
}

/** 密钥在 provider_secrets 里的稳定键（与 LLM 供应商 id 不冲突） */
export function pluginSecretId(id: PluginConfigId, providerId: string): string {
  return `plugin:${id}:${providerId}`;
}
