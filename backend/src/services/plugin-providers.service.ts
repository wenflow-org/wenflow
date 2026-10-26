/**
 * 插件外部服务配置（联网 / 决策 / 生图）。
 *
 * 真源：`platform_settings.pluginProviders`（非密钥字段）+ `provider_secrets`（密钥密文）。
 * 运行时读取必须是同步的（各 provider 的 read*Config 在请求路径上），因此这里维护一份
 * 进程内快照：启动时水合，管理端保存后再水合一次；未水合时各 getter 直接回落环境变量。
 *
 * 为什么单独做：插件不是 LLM 路由。联网是「搜索 / 抓取 provider + 密钥」，
 * 决策是「判定模型端点」，生图是「生图端点 + 模型」，和 skill_model_configs 无关。
 */
import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';
import {
  PLUGIN_CONFIGS,
  getPluginConfigDef,
  getProviderDef,
  isPluginConfigId,
  pluginSecretId,
  type PluginConfigDef,
  type PluginConfigId,
  type PluginProviderDef,
  type PluginProviderField,
} from '../config/plugin-providers';
import {
  deleteProviderSecret,
  providerSecretSummary,
  resolveProviderApiKey,
  setProviderSecret,
} from './provider-secrets.service';

const SETTING_KEY = 'pluginProviders';
/**
 * 通道优先级（2026-10-26 用户「本身是三选一，然后用户可以自己配置优先级」）。
 *
 * 单独存一个键，而不是塞进 pluginProviders JSON：那边是按 provider 分组的字段表，
 * 混进一个非 provider 的键会让「未知 provider」校验把它当配置项。
 * 解析优先级：平台顺序 → 通道环境变量（SEARCH_PROVIDER 等）→ 目录默认。
 */
const ORDER_SETTING_KEY = 'pluginProviderOrders';

type StoredConfig = Record<string, Record<string, Record<string, string>>>;
/** pluginId → channelId → 已保存的 provider 顺序 */
type StoredOrders = Record<string, Record<string, string[]>>;

interface RuntimeProvider {
  /** 平台设置里保存的非密钥字段 */
  fields: Record<string, string>;
  apiKey: string;
  keySource: 'db' | 'env' | 'none';
  keyHint: string | null;
}

type RuntimeConfig = Record<string, Record<string, RuntimeProvider>>;

export interface PluginProviderFieldView {
  key: string;
  label: string;
  type: 'text' | 'password';
  /** 平台设置里的显式值（空 = 跟随环境变量 / 默认） */
  value: string;
  /** 当前生效值（密钥只给掩码提示） */
  placeholder: string;
  secret: boolean;
}

export interface PluginProviderView {
  id: string;
  label: string;
  configured: boolean;
  keySource: 'db' | 'env' | 'none';
  keyHint: string | null;
  fields: PluginProviderFieldView[];
}

export interface PluginChannelView {
  id: string;
  label: string;
  /** 当前生效的 provider 顺序（环境变量优先，缺省用目录默认） */
  order: string[];
}

export interface PluginConfigView {
  id: PluginConfigId;
  label: string;
  channels: PluginChannelView[];
  providers: PluginProviderView[];
}

export interface PluginProviderSaveInput {
  providers?: Record<string, Record<string, string | null> & { clearKey?: boolean }>;
  /** 通道优先级（channelId → providerId 顺序）；空数组 = 删掉覆盖，回落到环境变量/默认 */
  orders?: Record<string, string[]>;
}

export class PluginProviderConfigError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PluginProviderConfigError';
  }
}

let runtime: RuntimeConfig | null = null;
let hydration: Promise<RuntimeConfig> | null = null;
/** 平台里保存的通道顺序（未水合时为空对象 → 各读取处回落环境变量/默认，行为与旧版一致） */
let runtimeOrders: StoredOrders = {};

function envFirst(names: readonly string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function secretFieldOf(provider: PluginProviderDef): PluginProviderField | null {
  return provider.fields.find((field) => field.secret) ?? null;
}

function effectiveField(pluginId: string, provider: PluginProviderDef, field: PluginProviderField): string {
  const stored = runtime?.[pluginId]?.[provider.id]?.fields?.[field.key];
  if (stored) return stored;
  return envFirst(field.env) || field.fallback || '';
}

function isConfigured(pluginId: PluginConfigId, provider: PluginProviderDef): boolean {
  const key = readPluginProviderSecret(pluginId, provider.id);
  const field = (keyName: string) => readPluginProviderField(pluginId, provider.id, keyName);
  switch (pluginId) {
    case 'web':
      return Boolean(key);
    case 'decision':
      if (provider.id === 'custom') return Boolean(field('url'));
      if (provider.id === 'cloudflare') return Boolean(key && field('accountId'));
      return Boolean(key && field('url'));
    case 'image':
      return Boolean(key && field('endpoint'));
    default:
      return Boolean(key);
  }
}

async function resolveSecret(pluginId: PluginConfigId, provider: PluginProviderDef): Promise<{
  apiKey: string;
  keySource: 'db' | 'env' | 'none';
  keyHint: string | null;
}> {
  const secretField = secretFieldOf(provider);
  if (!secretField) return { apiKey: '', keySource: 'none', keyHint: null };
  const secretId = pluginSecretId(pluginId, provider.id);
  const resolved = await resolveProviderApiKey(secretId, secretField.env[0]);
  if (resolved?.apiKey) {
    const summary = await providerSecretSummary(secretId, secretField.env[0]);
    return { apiKey: resolved.apiKey, keySource: resolved.source, keyHint: summary.keyHint };
  }
  const envKey = envFirst(secretField.env);
  if (envKey) {
    return {
      apiKey: envKey,
      keySource: 'env',
      keyHint: envKey.length >= 8 ? `····${envKey.slice(-4)}` : null,
    };
  }
  // opencode 这类无需密钥的 provider 用目录默认值（public）也算可用
  return { apiKey: secretField.fallback || '', keySource: 'none', keyHint: null };
}

async function readStored(): Promise<StoredConfig> {
  try {
    const row = await systemPrisma.platform_settings.findUnique({ where: { key: SETTING_KEY } });
    if (!row?.value) return {};
    const parsed = JSON.parse(row.value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as StoredConfig;
  } catch (error) {
    logger.warn('[plugin-providers] 平台配置读取失败，按环境变量处理', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function readStoredOrders(): Promise<StoredOrders> {
  try {
    const row = await systemPrisma.platform_settings.findUnique({ where: { key: ORDER_SETTING_KEY } });
    if (!row?.value) return {};
    const parsed = JSON.parse(row.value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as StoredOrders;
  } catch (error) {
    logger.warn('[plugin-providers] 通道优先级读取失败，按环境变量处理', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/** 把任意输入收敛成「本插件已知 provider 的去重顺序」；未知 id 直接丢弃（保存处另有严格校验） */
function normalizeOrder(plugin: PluginConfigDef, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(plugin.providers.map((p) => p.id));
  const out: string[] = [];
  for (const value of raw) {
    const id = String(value ?? '').trim();
    if (!id || !known.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

async function hydrate(): Promise<RuntimeConfig> {
  const stored = await readStored();
  const storedOrders = await readStoredOrders();
  const next: RuntimeConfig = {};
  const nextOrders: StoredOrders = {};
  for (const plugin of PLUGIN_CONFIGS) {
    next[plugin.id] = {};
    nextOrders[plugin.id] = {};
    for (const provider of plugin.providers) {
      next[plugin.id][provider.id] = {
        fields: { ...(stored[plugin.id]?.[provider.id] || {}) },
        ...(await resolveSecret(plugin.id, provider)),
      };
    }
    for (const channel of plugin.channels) {
      const order = normalizeOrder(plugin, storedOrders[plugin.id]?.[channel.id]);
      if (order.length) nextOrders[plugin.id][channel.id] = order;
    }
  }
  runtime = next;
  runtimeOrders = nextOrders;
  return next;
}

/** 启动水合 / 保存后刷新。失败不阻断：getter 会回落环境变量。 */
export async function loadPluginProviderConfig(): Promise<void> {
  hydration = hydrate();
  try {
    await hydration;
  } catch (error) {
    logger.warn('[plugin-providers] 配置水合失败，按环境变量处理', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    hydration = null;
  }
}

async function ensureHydrated(): Promise<RuntimeConfig> {
  if (runtime) return runtime;
  if (!hydration) hydration = hydrate();
  try {
    return await hydration;
  } finally {
    hydration = null;
  }
}

/** 运行时读非密钥字段：平台配置 → 环境变量 → 默认值 */
export function readPluginProviderField(
  pluginId: PluginConfigId,
  providerId: string,
  fieldKey: string
): string {
  const provider = getProviderDef(pluginId, providerId);
  const field = provider?.fields.find((f) => f.key === fieldKey);
  if (!provider || !field) return '';
  return effectiveField(pluginId, provider, field);
}

/** 运行时读密钥：平台密文 → 环境变量 → provider 默认（如 opencode 的 public） */
export function readPluginProviderSecret(
  pluginId: PluginConfigId,
  providerId: string,
  envOverride?: readonly string[]
): string {
  const cached = runtime?.[pluginId]?.[providerId];
  if (cached?.apiKey && cached.keySource === 'db') return cached.apiKey;
  const provider = getProviderDef(pluginId, providerId);
  const secretField = provider ? secretFieldOf(provider) : null;
  if (!secretField) return '';
  // 同一 provider 的不同通道可能各有偏好的环境变量（如 TinyFish 的搜索 / 抓取 key）
  if (envOverride?.length) {
    const preferred = envFirst(envOverride);
    if (preferred) return preferred;
  }
  return cached?.apiKey || envFirst(secretField.env) || secretField.fallback || '';
}

function resolveOrder(
  plugin: PluginConfigDef,
  channel: PluginConfigDef['channels'][number],
): string[] {
  const stored = runtimeOrders[plugin.id]?.[channel.id];
  if (stored?.length) return [...stored];
  const known = new Set(plugin.providers.map((p) => p.id));
  const raw = String(process.env[channel.orderEnv] || '').trim();
  if (!raw) return [...channel.defaultOrder];
  const order = raw
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter((id) => known.has(id));
  return order.length ? order : [...channel.defaultOrder];
}

/**
 * 运行时读取某通道的 provider 顺序（同步：搜索/抓取/决策/生图的请求路径上直接调）。
 * 优先级：平台保存的顺序 → 通道环境变量 → 目录默认。
 */
export function readPluginChannelOrder(pluginId: PluginConfigId, channelId: string): string[] {
  const plugin = getPluginConfigDef(pluginId);
  const channel = plugin.channels.find((c) => c.id === channelId);
  if (!channel) return [];
  return resolveOrder(plugin, channel);
}

async function viewOf(plugin: PluginConfigDef): Promise<PluginConfigView> {
  await ensureHydrated();
  return {
    id: plugin.id,
    label: plugin.label,
    channels: plugin.channels.map((channel) => ({
      id: channel.id,
      label: channel.label,
      order: resolveOrder(plugin, channel),
    })),
    providers: plugin.providers.map((provider) => {
      const cached = runtime?.[plugin.id]?.[provider.id];
      return {
        id: provider.id,
        label: provider.label,
        configured: isConfigured(plugin.id, provider),
        keySource: cached?.keySource ?? 'none',
        keyHint: cached?.keyHint ?? null,
        fields: provider.fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          value: cached?.fields?.[field.key] || '',
          placeholder: field.secret
            ? cached?.keyHint
              ? `已配置 ${cached.keyHint}`
              : field.fallback
                ? `默认 ${field.fallback}`
                : '未配置'
            : effectiveField(plugin.id, provider, field),
          secret: Boolean(field.secret),
        })),
      };
    }),
  };
}

export async function getPluginProviderConfigs(): Promise<PluginConfigView[]> {
  const views: PluginConfigView[] = [];
  for (const plugin of PLUGIN_CONFIGS) views.push(await viewOf(plugin));
  return views;
}

export async function getPluginProviderConfig(pluginId: PluginConfigId): Promise<PluginConfigView> {
  return viewOf(getPluginConfigDef(pluginId));
}

function isUrlField(field: PluginProviderField): boolean {
  return /url|endpoint/i.test(field.key);
}

function validateField(provider: PluginProviderDef, field: PluginProviderField, value: string): void {
  if (value.length > 2000) {
    throw new PluginProviderConfigError(`${provider.label} 的「${field.label}」过长`);
  }
  if (isUrlField(field) && value && !/^https?:\/\//i.test(value)) {
    throw new PluginProviderConfigError(`${provider.label} 的「${field.label}」必须以 http:// 或 https:// 开头`);
  }
}

/**
 * 保存某个插件的 provider 配置。
 * 非密钥字段传空串 = 删除覆盖（回落环境变量）；密钥只认 apiKey（非空写密文）、clearKey（删除密文）。
 */
export async function savePluginProviderConfig(
  pluginId: string,
  input: PluginProviderSaveInput
): Promise<PluginConfigView> {
  if (!isPluginConfigId(pluginId)) throw new PluginProviderConfigError(`未知插件：${pluginId}`);
  const plugin = getPluginConfigDef(pluginId);
  const stored = await readStored();
  const pluginStored = { ...(stored[pluginId] || {}) };
  const storedOrders = await readStoredOrders();
  const pluginOrders = { ...(storedOrders[pluginId] || {}) };

  for (const [providerId, patch] of Object.entries(input.providers || {})) {
    const provider = getProviderDef(pluginId, providerId);
    if (!provider) throw new PluginProviderConfigError(`未知 provider：${providerId}`);
    if (!patch || typeof patch !== 'object') throw new PluginProviderConfigError(`${provider.label} 的配置无效`);
    const nextFields = { ...(pluginStored[providerId] || {}) };

    for (const [key, raw] of Object.entries(patch)) {
      if (key === 'clearKey') continue;
      const field = provider.fields.find((f) => f.key === key);
      if (!field) throw new PluginProviderConfigError(`未知字段：${providerId}.${key}`);
      if (field.secret) {
        const apiKey = typeof raw === 'string' ? raw.trim() : '';
        if (apiKey) {
          validateField(provider, field, apiKey);
          await setProviderSecret(pluginSecretId(pluginId, providerId), apiKey, field.env[0] || null);
        }
        continue;
      }
      const value = raw == null ? '' : String(raw).trim();
      validateField(provider, field, value);
      if (value) nextFields[field.key] = value;
      else delete nextFields[field.key];
    }

    if (patch.clearKey) {
      const secretField = secretFieldOf(provider);
      if (secretField) await deleteProviderSecret(pluginSecretId(pluginId, providerId));
    }
    if (Object.keys(nextFields).length) pluginStored[providerId] = nextFields;
    else delete pluginStored[providerId];
  }

  if (Object.keys(pluginStored).length) stored[pluginId] = pluginStored;
  else delete stored[pluginId];

  for (const [channelId, raw] of Object.entries(input.orders || {})) {
    const channel = plugin.channels.find((c) => c.id === channelId);
    if (!channel) throw new PluginProviderConfigError(`未知通道：${pluginId}.${channelId}`);
    if (!Array.isArray(raw)) throw new PluginProviderConfigError(`${channel.label} 的优先级无效`);
    // 保存处比 hydrate 严格：未知 provider 直接拒绝，不静默丢弃（用户点选的一定要落库）
    const known = new Set(plugin.providers.map((p) => p.id));
    for (const value of raw) {
      const id = String(value ?? '').trim();
      if (id && !known.has(id)) {
        throw new PluginProviderConfigError(`未知 provider：${pluginId}.${id}`);
      }
    }
    const order = normalizeOrder(plugin, raw);
    if (order.length) pluginOrders[channelId] = order;
    else delete pluginOrders[channelId];
  }
  if (Object.keys(pluginOrders).length) storedOrders[pluginId] = pluginOrders;
  else delete storedOrders[pluginId];

  await systemPrisma.platform_settings.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(stored) },
    create: { key: SETTING_KEY, value: JSON.stringify(stored) },
  });
  await systemPrisma.platform_settings.upsert({
    where: { key: ORDER_SETTING_KEY },
    update: { value: JSON.stringify(storedOrders) },
    create: { key: ORDER_SETTING_KEY, value: JSON.stringify(storedOrders) },
  });
  await loadPluginProviderConfig();
  return viewOf(plugin);
}

/** 测试缝 */
export function resetPluginProviderConfigCache(): void {
  runtime = null;
  runtimeOrders = {};
}
