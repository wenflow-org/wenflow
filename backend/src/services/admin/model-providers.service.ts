/**
 * 模型供应商注册表写服务（管理台「模型与接入 → 接入与模型」编辑器的后端，2026-10-18）。
 *
 * 为什么写文件而不是写库：供应商与模型的唯一真源是 `backend/config/llm-providers.json`
 * （File-as-Truth），路由解析、总览、别名、成本核算全读它。管理台若另存一份 DB 副本，
 * 立刻就有第二个写源与第二种「谁生效」的解释。所以这里的动作是：
 * **读原始 JSON（$header/$rules 原文不动）→ 打补丁 → 过闸校验 → 备份 → 原子写 → 立即热重载**。
 * 密钥不落文件（文件规则明令禁止真实密钥），落 `provider_secrets` 密文表，见 provider-secrets.service.ts。
 *
 * 落盘前三道闸，任一道不过都不碰文件：
 * 1. `parseLlmProvidersConfig(新文本)` 复解析——报错文案就是运行时那条，编辑期就能看到；
 * 2. 自洽检查——defaults 必须能解析到**已启用**供应商提供的模型（否则全平台默认路由指向空气）；
 * 3. 备份同目录 `config/backups/llm-providers.<时间戳>.json`（留最近 10 份）+ 原子写（tmp + rename）；
 * 写完强制热重载，重载出错则把备份回滚回去。
 *
 * 不在这里做的事（避免第二个写源）：别名成员、档位默认（defaults）、按 agent/skill 的模型绑定。
 * 那些归「路由与调用」页；本服务只动 provider 与 model 自身的字段。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ModelPricing,
  getLlmRegistryStatus,
  parseLlmProvidersConfig,
  reloadLlmProvidersIfChanged,
  resolveConfigPath
} from '../../config/models.config';
import {
  deleteProviderSecret,
  providerSecretSummary,
  setProviderSecret
} from '../provider-secrets.service';
import { MAX_MODEL_CANDIDATES } from '../../gateway/api-gateway/executor';
import { logger } from '../../utils/logger';

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const BACKUP_KEEP = 10;
/** 平台通道（继承端点）保留 id：端点与密钥在 platform_api_configs，不在本文件的编辑范围 */
export const PLATFORM_PROVIDER_ID = 'platform';

/** 编辑失败（带 HTTP 语义）：路由层直接把它翻成响应，不再各写一套判断 */
export class RegistryEditError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'invalid' | 'not-found' | 'conflict' | 'read-only' | 'internal',
    readonly warnings: string[] = []
  ) {
    super(message);
    this.name = 'RegistryEditError';
  }
}

export interface ProviderViewModel {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  recommended: boolean;
  endpointSource: 'inherit' | 'own';
  baseUrl: string | null;
  apiKeyEnv: string | null;
  keySource: 'db' | 'env' | 'none';
  /** 尾部 4 位摘要（`····abcd`）；密钥短于 8 位或未配置为 null */
  keyHint: string | null;
  /** inherit = 端点与密钥在连接设置里；unconfigured = 自带端点但还没密钥 */
  status: 'ready' | 'unconfigured' | 'inherit' | 'disabled';
  models: ModelViewModel[];
}

export interface ModelViewModel {
  id: string;
  label: string;
  tier: 'chat' | 'reasoning';
  supportsThinking: boolean;
  supportsReasoningEffort: boolean;
  maxOutputTokens: number | null;
  defaultMaxTokens: number | null;
  reasoningReserveTokens: number | null;
  maxParallelRequests: number | null;
  fallbacks: string[];
  pricing: ModelPricing | null;
  description: string | null;
}

export interface ProviderRegistryView {
  registry: {
    path: string;
    source: 'file' | 'embedded-fallback';
    mtimeMs: number | null;
    lastError: string | null;
    /** 配置文件是否可写；false 时前端整体切只读（生产常见只读挂载） */
    readOnly: boolean;
  };
  providers: ProviderViewModel[];
}

export interface ProviderInput {
  id?: string;
  name?: string;
  description?: string | null;
  enabled?: boolean;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  /** 表单里填的明文密钥：落库密文；留空/不传 = 不改动已配置的密钥 */
  apiKey?: string | null;
}

export interface ModelInput {
  id?: string;
  label?: string;
  tier?: string;
  supportsThinking?: boolean;
  supportsReasoningEffort?: boolean;
  maxOutputTokens?: number | null;
  defaultMaxTokens?: number | null;
  reasoningReserveTokens?: number | null;
  maxParallelRequests?: number | null;
  fallbacks?: string[] | null;
  pricing?: ModelPricing | null;
  description?: string | null;
}

export interface EditOutcome {
  /** 写成功但需要运营知道的事（别名/备用链指向失效模型、备用链超出运行时上限等），不阻断操作 */
  warnings: string[];
}

type Root = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 文件层：读原始对象 / 校验 / 备份 / 原子写 / 热重载
// ---------------------------------------------------------------------------

interface RegistryFile {
  root: Root;
  providers: Record<string, Record<string, unknown>>;
}

function providersOf(root: Root): Record<string, Record<string, unknown>> {
  return root.providers as Record<string, Record<string, unknown>>;
}

/**
 * 读**原始 JSON 对象**（不经过注册表快照）：$header/$rules/未知字段原样留在对象里，
 * 写回时只动被编辑的叶子。文件缺失或非法一律拒绝编辑——那种状态下最该做的是先恢复文件，
 * 而不是让页面在一个空对象上长出配置。
 */
function readRegistryFile(): RegistryFile {
  const configPath = resolveConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    throw new RegistryEditError(
      `读不到注册表文件 ${configPath}，无法编辑。请先恢复该文件（可用 config/backups 下的备份）。`,
      409,
      'conflict'
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new RegistryEditError(
      `注册表文件不是合法 JSON（${e instanceof Error ? e.message : String(e)}），请先在服务器上修好再回到页面编辑。`,
      409,
      'conflict'
    );
  }
  const root = parsed as Root;
  const providers = root?.providers;
  if (!root || typeof root !== 'object' || !providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new RegistryEditError('注册表文件缺少 providers 对象，请先在服务器上修好再回到页面编辑。', 409, 'conflict');
  }
  return { root, providers: providers as Record<string, Record<string, unknown>> };
}

function backupDir(): string {
  return path.join(path.dirname(resolveConfigPath()), 'backups');
}

function listBackups(): string[] {
  try {
    return fs.readdirSync(backupDir()).filter((f) => /^llm-providers\..*\.json$/.test(f)).sort().reverse();
  } catch {
    return [];
  }
}

/** 写前备份：整份文件复制到 config/backups（时间戳扩展名），只留最近 BACKUP_KEEP 份 */
function writeBackup(): void {
  const dir = backupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(resolveConfigPath(), path.join(dir, `llm-providers.${stamp}.json`));
  for (const stale of listBackups().slice(BACKUP_KEEP)) {
    try {
      fs.unlinkSync(path.join(dir, stale));
    } catch {
      /* 清理失败不影响本次编辑 */
    }
  }
}

const READ_ONLY_MESSAGE = '注册表文件所在目录当前不可写，请由部署侧开放写权限后再从页面编辑。';

/** 只读降级：文件或目录不可写时整体拒绝编辑（生产镜像常见只读挂载） */
function assertWritable(): void {
  const configPath = resolveConfigPath();
  try {
    fs.accessSync(configPath, fs.constants.W_OK);
    fs.accessSync(path.dirname(configPath), fs.constants.W_OK);
  } catch {
    throw new RegistryEditError(READ_ONLY_MESSAGE, 409, 'read-only');
  }
}

function isReadOnly(): boolean {
  try {
    assertWritable();
    return false;
  } catch {
    return true;
  }
}

/** 模型 id → 声明它的供应商（跨供应商重名合法，所以是数组） */
function modelOwners(root: Root): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const [pid, entry] of Object.entries(providersOf(root))) {
    for (const mid of Object.keys((entry.models ?? {}) as Record<string, unknown>)) {
      owners.set(mid, [...(owners.get(mid) ?? []), pid]);
    }
  }
  return owners;
}

/**
 * 短数组收成一行：`JSON.stringify(…, 2)` 会把 `"fallbacks": ["x"]` 摊成三行，
 * 一次编辑就制造出满屏与本次改动无关的 diff（这文件在 git 里是要被 review 的）。
 * 只收「收成一行不超过 120 字符」的数组——$rules 那种长文本数组保持多行（作者本来就那么排）。
 */
function collapseShortArrays(text: string): string {
  return text.replace(/\[[^[\]{}]*\]/g, (match) => {
    const flat = match.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/\[ /, '[').replace(/ \]/, ']');
    return flat.length <= 120 ? flat : match;
  });
}

/** 沿用作息文件本身的换行风格：这次检出里它是 CRLF，写回 LF 会让整份文件逐行变红 */
function currentEol(filePath: string): '\n' | '\r\n' {
  try {
    return fs.readFileSync(filePath, 'utf-8').includes('\r\n') ? '\r\n' : '\n';
  } catch {
    return '\n';
  }
}

function textOf(root: Root, eol: '\n' | '\r\n'): string {
  const text = `${collapseShortArrays(JSON.stringify(root, null, 2))}\n`;
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

/**
 * 自洽检查：defaults 必须解析得到**已启用**供应商的模型；别名成员指向不存在的模型只给警告。
 * 拦的是「页面把某供应商停用/删掉，而全平台默认还指着它」这类静默失效——运行时会拿着一个
 * 没人服务的模型名继续发请求，报错要到真实对话里才看见。
 */
function selfCheck(parsedRoot: Root, snapshotText: string): string[] {
  const snapshot = parseLlmProvidersConfig(snapshotText);
  const enabledBare = new Set<string>();
  const enabledQualified = new Set<string>();
  for (const p of snapshot.providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      enabledBare.add(m.id);
      enabledQualified.add(`${m.providerId}/${m.id}`);
    }
  }
  const warnings: string[] = [];
  const rawDefaults = (parsedRoot.defaults ?? {}) as Record<string, unknown>;
  for (const tier of ['chat', 'reasoning'] as const) {
    const raw = rawDefaults[tier];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = raw.trim();
    if (!enabledBare.has(value) && !enabledQualified.has(value)) {
      throw new RegistryEditError(
        `默认${tier === 'chat' ? '对话' : '推理'}模型「${value}」解析不到已启用供应商提供的模型，保存会让全平台默认路由落空。`
          + '请先在「路由与调用」把默认模型改到别处，或恢复提供该模型的供应商。',
        400,
        'invalid'
      );
    }
  }
  const knownIds = new Set(snapshot.providers.flatMap((p) => p.models.map((m) => m.id)));
  for (const [alias, members] of Object.entries(snapshot.aliases)) {
    const unknown = members.filter((m) => !knownIds.has(m) && !m.includes('/'));
    if (unknown.length) warnings.push(`别名「${alias}」里的 ${unknown.join('、')} 已不在任何供应商目录中，运行时会被忽略。`);
  }
  return warnings;
}

/**
 * 保存：校验 → 备份 → 原子写 → 强制热重载（失败回滚）。
 * `root` 必须是**已改好的副本**——失败时磁盘上的文件一个字节都没动。
 */
function saveRegistry(root: Root, warnings: string[]): string[] {
  const configPath = resolveConfigPath();
  assertWritable();
  const text = textOf(root, currentEol(configPath));

  // 闸 1：结构校验（报错文案即运行时那条）
  try {
    parseLlmProvidersConfig(text);
  } catch (e) {
    throw new RegistryEditError(e instanceof Error ? e.message : String(e), 400, 'invalid', warnings);
  }
  // 闸 2：自洽
  warnings.push(...selfCheck(root, text));

  // 闸 3：备份 + 原子写
  const tmp = path.join(path.dirname(configPath), `.llm-providers.${process.pid}.${Date.now()}.tmp`);
  try {
    writeBackup();
    fs.writeFileSync(tmp, text, 'utf-8');
    fs.renameSync(tmp, configPath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 临时文件可能压根没建起来 */
    }
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new RegistryEditError(READ_ONLY_MESSAGE, 409, 'read-only');
    }
    throw new RegistryEditError(`写入注册表文件失败：${e instanceof Error ? e.message : String(e)}`, 500, 'internal', warnings);
  }

  // 立即生效：force 跳过 mtime 短路（同一毫秒内两次保存时 mtime 可能不变）
  const reload = reloadLlmProvidersIfChanged(true);
  if (reload.error) {
    logger.error('[model-providers] 写后热重载失败，回滚到写前内容', { errorMessage: reload.error });
    const [latest] = listBackups();
    if (latest) {
      try {
        fs.copyFileSync(path.join(backupDir(), latest), configPath);
        reloadLlmProvidersIfChanged(true);
      } catch (rollbackError) {
        logger.error('[model-providers] 回滚也失败，文件处于写后状态', {
          errorMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        });
      }
    }
    throw new RegistryEditError(`新配置无法生效（已回滚到写前内容）：${reload.error}`, 400, 'invalid', warnings);
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

function toModelView(raw: Record<string, unknown>, id: string): ModelViewModel {
  return {
    id,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id,
    tier: raw.tier === 'reasoning' ? 'reasoning' : 'chat',
    supportsThinking: raw.supportsThinking === true,
    supportsReasoningEffort: raw.supportsReasoningEffort === true,
    maxOutputTokens: typeof raw.maxOutputTokens === 'number' ? raw.maxOutputTokens : null,
    defaultMaxTokens: typeof raw.defaultMaxTokens === 'number' ? raw.defaultMaxTokens : null,
    reasoningReserveTokens: typeof raw.reasoningReserveTokens === 'number' ? raw.reasoningReserveTokens : null,
    maxParallelRequests: typeof raw.maxParallelRequests === 'number' ? raw.maxParallelRequests : null,
    fallbacks: Array.isArray(raw.fallbacks) ? raw.fallbacks.map((x) => String(x)) : [],
    pricing: raw.pricing && typeof raw.pricing === 'object' && !Array.isArray(raw.pricing) ? (raw.pricing as ModelPricing) : null,
    description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null
  };
}

/** 管理台视图：注册表**原始**条目 + 密钥摘要（不回显密钥）+ 文件可写状态 */
export async function buildProvidersView(): Promise<ProviderRegistryView> {
  const { providers } = readRegistryFile();
  const out: ProviderViewModel[] = [];
  for (const [id, raw] of Object.entries(providers)) {
    const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl.trim() : null;
    const apiKeyEnv = typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv.trim() ? raw.apiKeyEnv.trim() : null;
    const enabled = raw.enabled !== false;
    const summary = baseUrl ? await providerSecretSummary(id, apiKeyEnv) : { keySource: 'none' as const, keyHint: null };
    const modelsRaw = (raw.models && typeof raw.models === 'object' && !Array.isArray(raw.models)
      ? raw.models
      : {}) as Record<string, Record<string, unknown>>;
    out.push({
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
      description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null,
      enabled,
      recommended: raw.recommended === true,
      endpointSource: baseUrl ? 'own' : 'inherit',
      baseUrl,
      apiKeyEnv,
      keySource: summary.keySource,
      keyHint: summary.keyHint,
      status: !enabled ? 'disabled' : !baseUrl ? 'inherit' : summary.keySource === 'none' ? 'unconfigured' : 'ready',
      models: Object.entries(modelsRaw).map(([modelId, m]) => toModelView(m ?? {}, modelId))
    });
  }
  const status = getLlmRegistryStatus();
  return {
    registry: {
      path: status.path,
      source: status.source,
      mtimeMs: status.mtimeMs,
      lastError: status.lastError,
      readOnly: isReadOnly()
    },
    providers: out
  };
}

// ---------------------------------------------------------------------------
// 补丁工具
// ---------------------------------------------------------------------------

/** 变更副本：深拷原始对象，改完再走保存链 */
function cloneRoot(root: Root): Root {
  return JSON.parse(JSON.stringify(root)) as Root;
}

function requireProvider(root: Root, providerId: string): Record<string, unknown> {
  const entry = providersOf(root)[providerId];
  if (!entry) throw new RegistryEditError(`供应商「${providerId}」不在注册表里（可能刚被别处删除）。`, 404, 'not-found');
  return entry;
}

/** 环境变量名默认值：`PROVIDER_<ID>_API_KEY`（文件规则要求带 baseUrl 必须给 apiKeyEnv） */
function defaultApiKeyEnv(providerId: string): string {
  return `PROVIDER_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

function normalizeBaseUrl(value: unknown): string | null {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    throw new RegistryEditError('服务地址必须以 http:// 或 https:// 开头。', 400, 'invalid');
  }
  return url.replace(/\/+$/, '');
}

function assertModelId(modelId: string, where: string): void {
  if (!MODEL_ID_PATTERN.test(modelId)) {
    throw new RegistryEditError(`${where}的模型 ID 只能用字母、数字、点、下划线、连字符，且以字母或数字开头。`, 400, 'invalid');
  }
}

function positiveNumberOrNull(value: unknown, field: string): number | null {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new RegistryEditError(`${field}必须是正数。`, 400, 'invalid');
  }
  return num;
}

/**
 * 备用链检查：目标必须真实存在；跨供应商候选只在运行时不可达（降级只换模型名不换端点），
 * 故按告警处理而不是拒绝——文件本身允许这么写，运行时也会跳过。
 * 另：运行时最多用主模型 + 1 条备用（MAX_MODEL_CANDIDATES），多余条目只留在文件里。
 */
function checkFallbacks(providerId: string, fallbacks: string[], root: Root): string[] {
  const warnings: string[] = [];
  const owners = modelOwners(root);
  const pairs = new Set<string>();
  for (const [pid, entry] of Object.entries(providersOf(root))) {
    for (const mid of Object.keys((entry.models ?? {}) as Record<string, unknown>)) pairs.add(`${pid}/${mid}`);
  }
  for (const target of fallbacks) {
    const slash = target.indexOf('/');
    const qualified = slash > 0;
    const targetProvider = qualified ? target.slice(0, slash) : null;
    const targetModel = qualified ? target.slice(slash + 1) : target;
    if (qualified) {
      if (!pairs.has(target)) {
        throw new RegistryEditError(`备用模型「${target}」不在任何供应商目录中，请先添加该模型。`, 400, 'invalid');
      }
      if (targetProvider !== providerId) {
        warnings.push(`备用模型「${target}」属于别的供应商，运行时降级只换模型名不换端点，该候选不可达。`);
      }
      continue;
    }
    const owning = owners.get(targetModel) ?? [];
    if (!owning.length) {
      throw new RegistryEditError(`备用模型「${target}」不在任何供应商目录中，请先添加该模型。`, 400, 'invalid');
    }
    if (!owning.includes(providerId)) {
      warnings.push(`备用模型「${target}」由供应商「${owning[0]}」提供，运行时降级只换模型名不换端点，该候选不可达。`);
    }
  }
  if (fallbacks.length > MAX_MODEL_CANDIDATES - 1) {
    warnings.push(`备用链写了 ${fallbacks.length} 条，运行时最多用到第 ${MAX_MODEL_CANDIDATES - 1} 条（主模型 + ${MAX_MODEL_CANDIDATES - 1} 跳）。`);
  }
  return warnings;
}

/** 模型条目的规范字段顺序（写回文件的可读性靠它，而不是靠碰巧的插入顺序） */
const MODEL_KEY_ORDER = [
  'label', 'tier', 'supportsThinking', 'supportsReasoningEffort', 'maxOutputTokens', 'defaultMaxTokens',
  'reasoningReserveTokens', 'maxParallelRequests', 'fallbacks', 'pricing', 'description'
];

function buildModelEntry(input: ModelInput, existing: Record<string, unknown> | null): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  if (input.label !== undefined) {
    const label = String(input.label).trim();
    if (label) merged.label = label;
    else delete merged.label;
  }
  if (input.tier !== undefined) {
    if (input.tier !== 'chat' && input.tier !== 'reasoning') {
      throw new RegistryEditError('档位只能是 chat 或 reasoning。', 400, 'invalid');
    }
    merged.tier = input.tier;
  }
  if (input.supportsThinking !== undefined) merged.supportsThinking = input.supportsThinking === true;
  if (input.supportsReasoningEffort !== undefined) merged.supportsReasoningEffort = input.supportsReasoningEffort === true;
  if (merged.supportsReasoningEffort === true && merged.supportsThinking !== true) {
    throw new RegistryEditError('勾了「支持推理强度」就必须同时支持思考模式（上游字段依赖该能力）。', 400, 'invalid');
  }
  const numFields: Array<[keyof ModelInput, string]> = [
    ['maxOutputTokens', '输出上限'],
    ['defaultMaxTokens', '缺省输出'],
    ['reasoningReserveTokens', '推理预留'],
    ['maxParallelRequests', '并发上限']
  ];
  for (const [key, label] of numFields) {
    if (input[key] === undefined) continue;
    const value = positiveNumberOrNull(input[key], label);
    if (value === null) delete merged[key as string];
    else merged[key as string] = value;
  }
  if (input.fallbacks !== undefined) {
    merged.fallbacks = Array.isArray(input.fallbacks) ? input.fallbacks.map((x) => String(x).trim()).filter(Boolean) : [];
  }
  if (input.pricing !== undefined) {
    if (!input.pricing) delete merged.pricing;
    else {
      const pricing: Record<string, number> = {};
      for (const key of ['inputPer1M', 'cachedInputPer1M', 'outputPer1M'] as const) {
        const value = positiveNumberOrNull(input.pricing[key], `单价 ${key}`);
        if (value !== null) pricing[key] = value;
      }
      if (Object.keys(pricing).length) merged.pricing = pricing;
      else delete merged.pricing;
    }
  }
  if (input.description !== undefined) {
    const text = typeof input.description === 'string' ? input.description.trim() : '';
    if (text) merged.description = text;
    else delete merged.description;
  }
  // 已知键按规范顺序重排，未知键留尾部（不丢运维自己加的字段）
  const ordered: Record<string, unknown> = {};
  for (const key of MODEL_KEY_ORDER) if (key in merged) ordered[key] = merged[key];
  for (const [key, value] of Object.entries(merged)) if (!(key in ordered)) ordered[key] = value;
  return ordered;
}

// ---------------------------------------------------------------------------
// 供应商增删改
// ---------------------------------------------------------------------------

export async function createProvider(input: ProviderInput): Promise<EditOutcome & { id: string }> {
  const id = String(input.id ?? '').trim();
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new RegistryEditError('供应商 ID 只能用小写字母、数字、下划线和连字符，且以字母或数字开头。', 400, 'invalid');
  }
  if (id === PLATFORM_PROVIDER_ID) {
    throw new RegistryEditError('「platform」是平台通道保留 ID，换个名字再建。', 400, 'invalid');
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) {
    throw new RegistryEditError('自行接入的供应商必须填服务地址（要沿用平台地址，请直接改「平台提供」下的模型）。', 400, 'invalid');
  }
  const { root } = readRegistryFile();
  if (providersOf(root)[id]) {
    throw new RegistryEditError(`供应商 ID「${id}」已存在，换一个。`, 409, 'conflict');
  }
  const next = cloneRoot(root);
  const apiKeyEnv = (typeof input.apiKeyEnv === 'string' && input.apiKeyEnv.trim()) || defaultApiKeyEnv(id);
  providersOf(next)[id] = {
    name: (typeof input.name === 'string' && input.name.trim()) || id,
    ...(typeof input.description === 'string' && input.description.trim() ? { description: input.description.trim() } : {}),
    enabled: input.enabled !== false,
    baseUrl,
    apiKeyEnv,
    models: {}
  };
  const warnings = saveRegistry(next, []);
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey) await setProviderSecret(id, apiKey, apiKeyEnv);
  return { id, warnings };
}

export async function updateProvider(providerId: string, input: ProviderInput): Promise<EditOutcome> {
  const { root } = readRegistryFile();
  requireProvider(root, providerId);
  const next = cloneRoot(root);
  const target = requireProvider(next, providerId);

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new RegistryEditError('供应商名称不能为空。', 400, 'invalid');
    target.name = name;
  }
  if (input.description !== undefined) {
    const text = typeof input.description === 'string' ? input.description.trim() : '';
    if (text) target.description = text;
    else delete target.description;
  }
  if (input.enabled !== undefined) target.enabled = input.enabled === true;
  if (input.baseUrl !== undefined) {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) throw new RegistryEditError('服务地址不能清空（要停用请用「启用」开关）。', 400, 'invalid');
    target.baseUrl = baseUrl;
  }
  if (target.baseUrl) {
    target.apiKeyEnv = (typeof input.apiKeyEnv === 'string' && input.apiKeyEnv.trim())
      || (typeof target.apiKeyEnv === 'string' && target.apiKeyEnv.trim())
      || defaultApiKeyEnv(providerId);
  } else if (input.apiKeyEnv !== undefined && typeof input.apiKeyEnv === 'string' && input.apiKeyEnv.trim()) {
    throw new RegistryEditError('沿用平台地址的供应商不填密钥环境变量（密钥在「连接与安全」里配）。', 400, 'invalid');
  }

  const warnings = saveRegistry(next, []);

  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey) {
    const env = typeof target.apiKeyEnv === 'string' ? target.apiKeyEnv : null;
    await setProviderSecret(providerId, apiKey, env);
  }
  return { warnings };
}

export async function deleteProvider(providerId: string): Promise<EditOutcome> {
  if (providerId === PLATFORM_PROVIDER_ID) {
    throw new RegistryEditError(
      '「平台提供」是内置通道，不能删除；要让它不参与路由请停用它（需保证还有别的启用供应商提供模型）。',
      400,
      'invalid'
    );
  }
  const { root } = readRegistryFile();
  const entry = requireProvider(root, providerId);
  const removed = new Set(Object.keys((entry.models ?? {}) as Record<string, unknown>));
  const next = cloneRoot(root);
  delete providersOf(next)[providerId];

  const warnings: string[] = [];
  for (const [pid, p] of Object.entries(providersOf(next))) {
    const models = (p.models ?? {}) as Record<string, Record<string, unknown>>;
    for (const [mid, m] of Object.entries(models)) {
      if (Array.isArray(m.fallbacks) && m.fallbacks.map(String).some((f) => removed.has(f))) {
        warnings.push(`「${pid}/${mid}」的备用链里还留着已删除的模型，运行时会被忽略，建议一并清理。`);
      }
    }
  }
  const finalWarnings = saveRegistry(next, warnings);
  try {
    await deleteProviderSecret(providerId);
  } catch (e) {
    logger.warn('[model-providers] 删除供应商后清理密钥失败', {
      providerId,
      errorMessage: e instanceof Error ? e.message : String(e)
    });
  }
  return { warnings: finalWarnings };
}

/** 单独移除密钥（注册表里的 apiKeyEnv 名保留：它仍是环境变量的回落来源） */
export async function clearProviderKey(providerId: string): Promise<void> {
  const { root } = readRegistryFile();
  requireProvider(root, providerId);
  await deleteProviderSecret(providerId);
}

// ---------------------------------------------------------------------------
// 模型增删改
// ---------------------------------------------------------------------------

export async function addModel(providerId: string, input: ModelInput): Promise<EditOutcome & { modelId: string }> {
  const { root } = readRegistryFile();
  const entry = requireProvider(root, providerId);
  const modelId = String(input.id ?? '').trim();
  assertModelId(modelId, `供应商「${providerId}」`);
  if ((entry.models ?? {})[modelId]) {
    throw new RegistryEditError(`供应商「${providerId}」下已有模型「${modelId}」。`, 409, 'conflict');
  }
  const next = cloneRoot(root);
  const target = requireProvider(next, providerId);
  const models = (target.models ?? {}) as Record<string, Record<string, unknown>>;
  const image = buildModelEntry({ ...input, id: modelId }, null);
  if (image.label === undefined) image.label = modelId;
  if (image.tier === undefined) image.tier = 'chat';
  const warnings = Array.isArray(image.fallbacks) && image.fallbacks.length
    ? checkFallbacks(providerId, image.fallbacks as string[], next)
    : [];
  models[modelId] = image;
  target.models = models;
  const finalWarnings = saveRegistry(next, warnings);
  return { modelId, warnings: finalWarnings };
}

export async function updateModel(providerId: string, modelId: string, input: ModelInput): Promise<EditOutcome> {
  const { root } = readRegistryFile();
  const entry = requireProvider(root, providerId);
  const current = ((entry.models ?? {}) as Record<string, Record<string, unknown>>)[modelId];
  if (!current) throw new RegistryEditError(`供应商「${providerId}」下没有模型「${modelId}」。`, 404, 'not-found');
  if (input.id !== undefined && String(input.id).trim() && String(input.id).trim() !== modelId) {
    throw new RegistryEditError('模型 ID 是路由与引用配置的键，不支持改名；请新增一个再删掉旧的。', 400, 'invalid');
  }
  const next = cloneRoot(root);
  const target = requireProvider(next, providerId);
  const models = (target.models ?? {}) as Record<string, Record<string, unknown>>;
  const updated = buildModelEntry(input, models[modelId]);
  if (updated.label === undefined) updated.label = modelId;
  if (updated.tier === undefined) updated.tier = 'chat';
  const warnings = Array.isArray(updated.fallbacks) && updated.fallbacks.length
    ? checkFallbacks(providerId, updated.fallbacks as string[], next)
    : [];
  models[modelId] = updated;
  target.models = models;
  const finalWarnings = saveRegistry(next, warnings);
  return { warnings: finalWarnings };
}

export async function deleteModel(providerId: string, modelId: string): Promise<EditOutcome> {
  const { root } = readRegistryFile();
  const entry = requireProvider(root, providerId);
  if (!((entry.models ?? {}) as Record<string, unknown>)[modelId]) {
    throw new RegistryEditError(`供应商「${providerId}」下没有模型「${modelId}」。`, 404, 'not-found');
  }
  const rawDefaults = (root.defaults ?? {}) as Record<string, unknown>;
  for (const tier of ['chat', 'reasoning'] as const) {
    const value = typeof rawDefaults[tier] === 'string' ? String(rawDefaults[tier]).trim() : '';
    if (value === modelId || value === `${providerId}/${modelId}`) {
      throw new RegistryEditError(
        `模型「${modelId}」正被默认${tier === 'chat' ? '对话' : '推理'}模型引用，删掉会让全平台默认路由落空。`
          + '请先在「路由与调用」把默认模型改到别处。',
        400,
        'invalid'
      );
    }
  }
  const next = cloneRoot(root);
  const target = requireProvider(next, providerId);
  const models = (target.models ?? {}) as Record<string, Record<string, unknown>>;
  delete models[modelId];
  target.models = models;

  // 别名残留告警由 selfCheck 统一给（它按「保存后是否还解析得到」判定，一处口径就够了）
  const warnings: string[] = [];
  for (const [pid, p] of Object.entries(providersOf(next))) {
    const pModels = (p.models ?? {}) as Record<string, Record<string, unknown>>;
    for (const [mid, m] of Object.entries(pModels)) {
      if (Array.isArray(m.fallbacks) && m.fallbacks.map(String).includes(modelId)) {
        warnings.push(`「${pid}/${mid}」的备用链里还留着「${modelId}」，运行时会被忽略。`);
      }
    }
  }
  const finalWarnings = saveRegistry(next, warnings);
  return { warnings: finalWarnings };
}
