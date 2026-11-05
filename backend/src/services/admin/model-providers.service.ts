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
  LEGACY_REASONING_EFFORTS,
  ModelPricing,
  REASONING_EFFORT_PATTERN,
  getLlmRegistryStatus,
  getProviderCatalog,
  parseLlmProvidersConfig,
  parseReasoningEfforts,
  reloadLlmProvidersIfChanged,
  resolveConfigPath,
  resolveModelRef
} from '../../config/models.config';
import systemPrisma from '../../config/system-database';
import apiConfigService from '../apiConfig.service';
import { selectModelForAlias } from '../../gateway/api-gateway/model-alias';
import {
  deleteProviderSecret,
  providerSecretSummary,
  setProviderSecret
} from '../provider-secrets.service';
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
  /**
   * 上游是否接受原生 `role:'system'`。null = 未显式声明，按 endpointSource 推导
   * （inherit 折叠、own 保留）。见 models.config.ts:providerAcceptsSystemRole。
   */
  supportsSystemRole: boolean | null;
  models: ModelViewModel[];
}

export interface ModelViewModel {
  id: string;
  label: string;
  tier: 'chat' | 'reasoning';
  supportsThinking: boolean;
  /** 这台模型接受哪几档 reasoning_effort；空数组 = 不支持该字段。
   *  数组里的每个词就是请求体里的取值（上游定义的词，平台不翻译），
   *  管理台据此渲染挡位列表，运行时据此裁剪请求（见 gateway/api-gateway/thinking-policy.ts）。 */
  reasoningEfforts: string[];
  /** 声明可接收图片输入（见 models.config.ts ModelDefinition.vision） */
  vision: boolean;
  /** 模型级生成默认；null = 跟随平台默认（2026-10-24） */
  defaultThinkingMode: 'enabled' | 'disabled' | null;
  defaultReasoningEffort: string | null;
  defaultResponseFormat: 'none' | 'json_object' | null;
  maxOutputTokens: number | null;
  defaultMaxTokens: number | null;
  reasoningReserveTokens: number | null;
  maxParallelRequests: number | null;
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
  /** true/false = 显式声明；null = 清除声明，回到按端点来源推导 */
  supportsSystemRole?: boolean | null;
}

export interface ModelInput {
  id?: string;
  label?: string;
  tier?: string;
  supportsThinking?: boolean;
  /** 挡位数组（每项就是请求体里的 reasoning_effort 取值）：传空数组 = 关掉这个能力；不传 = 不改动 */
  reasoningEfforts?: string[];
  /** 历史入参（布尔）：true 折算成 low/high/max，保留只为兼容旧调用方。 */
  supportsReasoningEffort?: boolean;
  vision?: boolean;
  /** 'default' / null = 清除模型覆盖，跟随平台默认 */
  defaultThinkingMode?: string | null;
  defaultReasoningEffort?: string | null;
  defaultResponseFormat?: string | null;
  maxOutputTokens?: number | null;
  defaultMaxTokens?: number | null;
  reasoningReserveTokens?: number | null;
  maxParallelRequests?: number | null;
  pricing?: ModelPricing | null;
  description?: string | null;
}

export interface EditOutcome {
  /** 写成功但需要运营知道的事（别名指向失效模型等），不阻断操作 */
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

/**
 * 短数组收成一行：`JSON.stringify(…, 2)` 会把 `"members": ["a", "b"]` 摊成三行，
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
    reasoningEfforts: parseReasoningEfforts(raw.reasoningEfforts, raw.supportsReasoningEffort, id),
    vision: raw.vision === true,
    defaultThinkingMode: raw.defaultThinkingMode === 'enabled' || raw.defaultThinkingMode === 'disabled'
      ? raw.defaultThinkingMode
      : null,
    // 回显不按平台词表卡：运营填的可能是上游自有词（xhigh 等），原样带回
    defaultReasoningEffort: typeof raw.defaultReasoningEffort === 'string'
      && REASONING_EFFORT_PATTERN.test(raw.defaultReasoningEffort.trim())
      && raw.defaultReasoningEffort.trim().toLowerCase() !== 'default'
      ? raw.defaultReasoningEffort.trim()
      : null,
    defaultResponseFormat: raw.defaultResponseFormat === 'none' || raw.defaultResponseFormat === 'json_object'
      ? raw.defaultResponseFormat
      : null,
    maxOutputTokens: typeof raw.maxOutputTokens === 'number' ? raw.maxOutputTokens : null,
    defaultMaxTokens: typeof raw.defaultMaxTokens === 'number' ? raw.defaultMaxTokens : null,
    reasoningReserveTokens: typeof raw.reasoningReserveTokens === 'number' ? raw.reasoningReserveTokens : null,
    maxParallelRequests: typeof raw.maxParallelRequests === 'number' ? raw.maxParallelRequests : null,
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
      supportsSystemRole: typeof raw.supportsSystemRole === 'boolean' ? raw.supportsSystemRole : null,
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

/**
 * 挡位入参归一：去空白、去重、保持上传顺序。
 *
 * **不按平台词表卡**（2026-11-05 用户「写死了五档，但是后面的请求能对上吗，应该放开允许填写挡位」）：
 * 数组里的每个词就是请求体里 `reasoning_effort` 的取值，原样发出。上游各家词表不一致
 * （minimal/low/medium/high、只认 low/high、自家 xhigh…），只有运营知道这台模型认什么。
 * 这里只拦形态明显不对的（带空格、超长、奇怪字符），因为那是必然发不出去的值。
 */
function validateEfforts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new RegistryEditError('推理强度挡位必须是一个数组。', 400, 'invalid');
  }
  const out: string[] = [];
  for (const item of value) {
    const token = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!token) continue;
    if (!REASONING_EFFORT_PATTERN.test(token)) {
      throw new RegistryEditError(
        `挡位填的是要发给上游的那个词，只能是不带空格的短词（如 low / high / max），实际 ${JSON.stringify(item)}。`,
        400,
        'invalid'
      );
    }
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

function positiveNumberOrNull(value: unknown, field: string): number | null {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new RegistryEditError(`${field}必须是正数。`, 400, 'invalid');
  }
  return num;
}

/** 模型条目的规范字段顺序（写回文件的可读性靠它，而不是靠碰巧的插入顺序） */
const MODEL_KEY_ORDER = [
  'label', 'tier', 'supportsThinking', 'reasoningEfforts', 'vision',
  'defaultThinkingMode', 'defaultReasoningEffort', 'defaultResponseFormat',
  'maxOutputTokens', 'defaultMaxTokens',
  'reasoningReserveTokens', 'maxParallelRequests', 'pricing', 'description'
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
  // 挡位：数组即支持集，先按词表归一（未知词拒），再和 supportsThinking 对账。
  // 旧的布尔键在这里就地删除——它是**读**兼容字段，写回只产出数组。
  if (input.reasoningEfforts !== undefined) {
    merged.reasoningEfforts = validateEfforts(input.reasoningEfforts);
  } else if (input.supportsReasoningEffort !== undefined) {
    merged.reasoningEfforts = input.supportsReasoningEffort === true ? [...LEGACY_REASONING_EFFORTS] : [];
  }
  delete merged.supportsReasoningEffort;
  if (Array.isArray(merged.reasoningEfforts) && merged.reasoningEfforts.length === 0) delete merged.reasoningEfforts;
  // 图片理解是独立能力：不勾就显式写 false（上游不支持时运行时会拒图，不是静默丢图）
  if (input.vision !== undefined) merged.vision = input.vision === true;
  if (Array.isArray(merged.reasoningEfforts) && merged.reasoningEfforts.length && merged.supportsThinking !== true) {
    throw new RegistryEditError('填了推理强度挡位就必须同时支持思考模式（上游字段依赖该能力）。', 400, 'invalid');
  }
  // 模型级生成默认（2026-10-24）：'default' / 空 = 删除覆盖，跟随平台默认
  const enumFields: Array<[keyof ModelInput, string, readonly string[]]> = [
    ['defaultThinkingMode', '思考模式', ['default', 'enabled', 'disabled']],
    ['defaultResponseFormat', '输出格式', ['default', 'none', 'json_object']]
  ];
  for (const [key, label, allowed] of enumFields) {
    if (input[key] === undefined) continue;
    const raw = typeof input[key] === 'string' ? String(input[key]).trim().toLowerCase() : '';
    if (!raw || raw === 'default') {
      delete merged[key as string];
      continue;
    }
    if (!allowed.includes(raw)) {
      throw new RegistryEditError(`${label}只能是 ${allowed.join(' / ')}。`, 400, 'invalid');
    }
    merged[key as string] = raw;
  }
  /* 默认挡位不走枚举：取值是上游定义的（与 reasoningEfforts 同一套词），
     只做形态校验；「必须在本模型声明的挡位里」由下面那条统一对账。 */
  if (input.defaultReasoningEffort !== undefined) {
    const raw = typeof input.defaultReasoningEffort === 'string' ? input.defaultReasoningEffort.trim().toLowerCase() : '';
    if (!raw || raw === 'default') delete merged.defaultReasoningEffort;
    else if (!REASONING_EFFORT_PATTERN.test(raw)) {
      throw new RegistryEditError(
        `思考强度只能是不带空格的短词（如 low / high / max），实际 ${JSON.stringify(input.defaultReasoningEffort)}。`,
        400,
        'invalid'
      );
    } else merged.defaultReasoningEffort = raw;
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
  // 默认档位必须落在本模型声明的挡位里（否则运行时那档会被 thinking-policy 裁掉，
  // 「默认值」看上去生效但请求里根本没这个字段）
  const declaredEfforts = Array.isArray(merged.reasoningEfforts) ? merged.reasoningEfforts as string[] : [];
  if (typeof merged.defaultReasoningEffort === 'string'
    && merged.defaultReasoningEffort !== 'default'
    && !declaredEfforts.includes(merged.defaultReasoningEffort)) {
    throw new RegistryEditError(
      `默认推理强度「${merged.defaultReasoningEffort}」不在本模型声明的挡位（${declaredEfforts.join(' / ') || '未声明'}）里。`,
      400,
      'invalid'
    );
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
    throw new RegistryEditError('没有独立端点的供应商必须填服务地址（要沿用平台地址，直接改「平台」这条通道下的模型）。', 400, 'invalid');
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
    ...(typeof input.supportsSystemRole === 'boolean' ? { supportsSystemRole: input.supportsSystemRole } : {}),
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
  // #177：判定与写入共用同一个开关，杜绝「判定看恰好 false、写入看非 true」的语义漂移——
  // `enabled` 任何非 true 的定义值都会停用（1/0/null/"false" 都是脚本常见写法，都会真的停用）。
  const disablesProvider = input.enabled !== undefined && input.enabled !== true;
  const wasEnabled = target.enabled !== false;
  if (wasEnabled && disablesProvider) {
    await assertProviderNotReferencedByRuntime(providerId);
  }
  if (input.enabled !== undefined) target.enabled = !disablesProvider;
  if (input.supportsSystemRole !== undefined) {
    if (typeof input.supportsSystemRole === 'boolean') target.supportsSystemRole = input.supportsSystemRole;
    else delete target.supportsSystemRole;
  }
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


/**
 * #177 目录收缩门禁：删模型 / 删停供应商前，除 saveRegistry 已挡的文件 `root.defaults` 外，
 * 还要挡两类**运行时仍然指向该模型的引用**——否则「默认值写对后再把目录删小」会让目录外值
 * 在运行期生效（与原故障同一通路：路由对解析不到的值原样透传 → 无可用渠道 transport 失败）：
 *  - platform_api_configs 的平台默认（按 DB 别名覆盖展开后选中该模型，或字面就是它）；
 *  - 启用的 skill_model_configs 显式绑定该模型、且该 skill 未自带 endpoint（即走继承通道）。
 * 自带独立 endpoint 的 skill 由自家通道提供模型，不受平台目录约束，不计。
 * 放在 service 层（而非路由）：routes 层禁止直接引数据库客户端（scripts/check-route-db-boundary.mjs）。
 */
export async function assertModelNotReferencedByRuntime(providerId: string, modelId: string): Promise<void> {
  const bare = modelId;
  const qualified = `${providerId}/${modelId}`;
  const matches = (value: string): boolean => value === bare || value === qualified;

  const config = await apiConfigService.getConfig();
  const overrides = {
    chat: config.chatModels ?? [],
    reasoning: config.reasoningModels ?? [],
    light: config.lightModels ?? [],
  };
  // 2026-11-04 起 defaultReasoningModel 退役（思考由 skill 的 thinkingMode / reasoningEffort 决定），
  // 平台默认只剩 默认模型 + 评估默认模型 两处。
  const platformDefaults: Array<[string, string]> = [
    ['默认模型', config.defaultModel],
    ['评估默认模型', config.defaultEvaluationModel],
  ];
  for (const [label, value] of platformDefaults) {
    const configured = String(value || '').trim();
    if (!configured) continue;
    const resolved = selectModelForAlias(configured, { overrides })?.model ?? configured;
    if (matches(configured) || matches(resolved)) {
      throw new RegistryEditError(
        `模型「${modelId}」仍是平台${label}的生效值（${configured}），删掉会让全平台默认路由落到目录外模型。`
          + '请先在「路由与调用」把该默认改到别的目录内模型再删。',
        400,
        'invalid'
      );
    }
  }

  const boundRows = await systemPrisma.skill_model_configs.findMany({
    where: { enabled: true, NOT: [{ model: null }, { model: '' }] },
    select: { skillId: true, model: true, endpoint: true },
  });
  const boundSkills = boundRows
    .filter((row) => !String(row.endpoint || '').trim())
    .filter((row) => {
      const value = String(row.model || '').trim();
      const ref = resolveModelRef(value);
      return ref ? ref.modelId === bare && ref.providerId === providerId : matches(value);
    })
    .map((row) => row.skillId);
  if (boundSkills.length) {
    throw new RegistryEditError(
      `模型「${modelId}」仍被 ${boundSkills.length} 个走平台通道的 skill 显式绑定（${boundSkills.join('、')}），`
        + '删掉后它们运行时会因无可用渠道失败。请先在「Skill 运行时」改到别的目录内模型再删。',
      400,
      'invalid'
    );
  }
}

/**
 * #177 供应商级门禁：删除 / 停用整条供应商会让它的**全部**模型同时从运行时注册目录消失——
 * 与单模型删除同一根因，却绕过了单模型门禁（默认值写对后，再把整条通道删/停）。
 * 逐个模型复用同一口径校验；本就没有模型在目录里的（未启用的条目）跳过，删它不改变运行时。
 */
export async function assertProviderNotReferencedByRuntime(providerId: string): Promise<void> {
  const provider = getProviderCatalog().find((p) => p.id === providerId);
  if (!provider || provider.enabled === false) return;
  const blocked: string[] = [];
  for (const model of provider.models) {
    try {
      await assertModelNotReferencedByRuntime(providerId, model.id);
    } catch (error) {
      if (error instanceof RegistryEditError) {
        blocked.push(error.message);
        continue;
      }
      throw error;
    }
  }
  if (blocked.length) {
    throw new RegistryEditError(
      `供应商「${providerId}」删掉/停用会让 ${blocked.length} 个仍在用的模型落到目录外：\n${blocked.join('\n')}`,
      400,
      'invalid'
    );
  }
}

export async function deleteProvider(providerId: string): Promise<EditOutcome> {
  if (providerId === PLATFORM_PROVIDER_ID) {
    throw new RegistryEditError(
      '「平台」是平台自带通道，不能删除；要让它不参与路由请停用它（需保证还有别的启用供应商提供模型）。',
      400,
      'invalid'
    );
  }
  // #177：删整条供应商 = 它的模型整体离开运行时目录；先挡仍被平台默认/skill 绑定引用的（未启用条目内部跳过）
  await assertProviderNotReferencedByRuntime(providerId);
  const { root } = readRegistryFile();
  const entry = requireProvider(root, providerId);
  const removed = new Set(Object.keys((entry.models ?? {}) as Record<string, unknown>));
  const next = cloneRoot(root);
  delete providersOf(next)[providerId];

  const finalWarnings = saveRegistry(next, []);
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
  models[modelId] = image;
  target.models = models;
  const finalWarnings = saveRegistry(next, []);
  return { modelId, warnings: finalWarnings };
}

/**
 * 批量登记（模型选择器「确认引入」）：一次读、一次写，避免 N 个模型触发 N 次文件保存。
 * 任意一个 id 非法/已存在则整批拒绝——半批成功会让运营分不清哪些已加。
 */
export async function addModels(
  providerId: string,
  inputs: ModelInput[],
): Promise<EditOutcome & { modelIds: string[] }> {
  const list = Array.isArray(inputs) ? inputs : [];
  if (!list.length) throw new RegistryEditError('至少选择一个模型。', 400, 'invalid');
  const { root } = readRegistryFile();
  const entry = requireProvider(root, providerId);
  const existing = (entry.models ?? {}) as Record<string, Record<string, unknown>>;
  const next = cloneRoot(root);
  const target = requireProvider(next, providerId);
  const models = (target.models ?? {}) as Record<string, Record<string, unknown>>;

  const ids: string[] = [];
  for (const input of list) {
    const modelId = String(input?.id ?? '').trim();
    assertModelId(modelId, `供应商「${providerId}」`);
    if (existing[modelId] || ids.includes(modelId)) {
      throw new RegistryEditError(`供应商「${providerId}」下已有模型「${modelId}」。`, 409, 'conflict');
    }
    ids.push(modelId);
  }

  const warnings: string[] = [];
  for (const input of list) {
    const modelId = String(input.id ?? '').trim();
    const image = buildModelEntry({ ...input, id: modelId }, null);
    if (image.label === undefined) image.label = modelId;
    if (image.tier === undefined) image.tier = 'chat';
    models[modelId] = image;
  }
  target.models = models;
  const finalWarnings = saveRegistry(next, warnings);
  return { modelIds: ids, warnings: finalWarnings };
}

export async function updateModel(providerId: string, modelId: string, input: ModelInput): Promise<EditOutcome> {  const { root } = readRegistryFile();
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
  models[modelId] = updated;
  target.models = models;
  const finalWarnings = saveRegistry(next, []);
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
  // #177：单模型删除同样要挡「运行时仍在引用」（平台默认 / 走平台通道的 skill 绑定）
  await assertModelNotReferencedByRuntime(providerId, modelId);
  const next = cloneRoot(root);
  const target = requireProvider(next, providerId);
  const models = (target.models ?? {}) as Record<string, Record<string, unknown>>;
  delete models[modelId];
  target.models = models;

  // 别名残留告警由 selfCheck 统一给（它按「保存后是否还解析得到」判定，一处口径就够了）
  const finalWarnings = saveRegistry(next, []);
  return { warnings: finalWarnings };
}
