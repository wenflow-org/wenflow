/**
 * 字段级运行时命中率聚合 —— **纯函数**，不触库、不读盘（Q9 后半程）
 *
 * 背景：`handoff-edge-usage.ts` 回答"哪条交接边真的在跑"；本模块回答
 * "**声明的字段**里，哪些真的在运行时被产出、哪些是死字段、哪些是契约漂移"。
 *
 * 数据口径（基于实际列，2026-09-19 核对 prisma/schema.prisma:87 `model prompt_call_logs`）：
 *   - 产出方 = `prompt_call_logs.agentId`（skill 调用形如 `skill:<skillId>`）
 *   - 产出字段 = `prompt_call_logs.extractedJson` 解析后的**顶层键**
 *     （写库点：backend/src/composers/prompt-composer.ts:548，为校验/归一化前的原始解析）
 *   - 声明字段 = `prompts/core/<skillId>.yaml` 的 `fields[].name`（由 CLI 读盘后注入）
 *
 * 重要口径与 caveat（消费方需知）：
 *   1) 媒体产物：`outputMedia: markdown/text` 时，`extractedJson` 复用为原始文本，
 *      无法解析成对象 → 该次调用计为"未产出"，命中率不可直接采信；
 *   2) `deltaOutput: true`：只输出变化字段，命中率系统性偏低（非字段不存在）；
 *   3) 校验归一化：extractedJson 为校验前原始解析，`coerceParsedForContract` /
 *      `normalizeOutput` 可能重命名或补齐字段（如 acceptanceHint → acceptanceCriteria、
 *      cognitiveDesign 兼容补齐）→ 死字段 / 契约漂移可能是误报；
 *   4) 分母是"该 skill 的全部调用"（含失败行与解析失败行），与
 *      "出现该键的调用 / 总调用"一致；小样本波动大。
 *
 * 本模块只做纯计算，DB / YAML 读取由 CLI（audit-field-hit-rates.ts）负责，便于单测与复用。
 */

/** 聚合输入行：只依赖这 2 个真实列；其余字段忽略 */
export interface FieldHitLogRow {
  /** prompt_call_logs.agentId（skill span 形如 `skill:<skillId>`；非 skill 行会被跳过并计数） */
  agentId?: string | null;
  /** prompt_call_logs.extractedJson（原始解析后的 JSON 字符串；媒体产物存原始文本） */
  extractedJson?: string | null;
}

/** 单字段命中条目 */
export interface FieldHitRateEntry {
  /** 字段名（extractedJson 顶层键，或 core 声明字段名） */
  field: string;
  /** 是否在 core.yaml 中声明 */
  declared: boolean;
  /** 窗口内出现该字段的调用数 */
  hits: number;
  /** hits / totalCalls（0..1，保留 4 位小数）；totalCalls=0 时为 0 */
  hitRate: number;
}

/** 单 skill 的字段命中率 */
export interface SkillFieldHitRates {
  /** 不含 `skill:` 前缀的 skillId */
  skillId: string;
  /** 原始 agentId 形态 `skill:<skillId>` */
  agentId: string;
  /** 窗口内该 skill 的调用总数（命中率分母） */
  totalCalls: number;
  /** extractedJson 解析为对象的调用数 */
  parsedCalls: number;
  /** extractedJson 为空 / 非法 / 非对象（含媒体产物）的调用数 */
  unparsedCalls: number;
  /** core.yaml 声明字段（保序去重） */
  declaredFields: string[];
  /** 声明 ∪ 观测 的全部字段，按字段名升序（确定性） */
  fields: FieldHitRateEntry[];
  /** 声明但窗口内从未产出（死字段），保持声明顺序 */
  deadFields: string[];
  /** 产出但 core 未声明（契约漂移），按字段名升序 */
  driftFields: FieldHitRateEntry[];
}

export interface FieldHitRatesOptions {
  /** skillId（不含 `skill:` 前缀）→ core.yaml 声明字段名列表 */
  declaredFieldsBySkill?: Readonly<Record<string, readonly string[]>>;
  /**
   * 最小调用数门槛：totalCalls < minCalls 的 skill 不进入结果（计入 skippedBelowMinCalls）。
   * 默认 0：声明了 core 字段但窗口内零调用的 skill 也会出现（其字段全部为死字段）。
   */
  minCalls?: number;
}

export interface FieldHitRatesResult {
  /** 按 skillId 升序 */
  skills: SkillFieldHitRates[];
  /** 输入总行数 */
  totalRows: number;
  /** 通过 agentId 归属到 skill 的行数（命中率分母合计） */
  consideredRows: number;
  /** agentId 为空 / 非字符串，无法归属 */
  skippedMissingAgent: number;
  /** agentId 非 `skill:*`（编排 agent / 网关行等），不在字段口径内 */
  skippedNonSkillAgent: number;
  /** totalCalls < minCalls 被过滤的 skill 数 */
  skippedBelowMinCalls: number;
}

const SKILL_PREFIX = 'skill:';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 安全解析 extractedJson，返回是否解析为对象 + 顶层键 */
function parseTopLevelKeys(extractedJson: string | null | undefined): {
  parsedObject: boolean;
  keys: string[];
} {
  if (typeof extractedJson !== 'string') return { parsedObject: false, keys: [] };
  const trimmed = extractedJson.trim();
  if (!trimmed) return { parsedObject: false, keys: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { parsedObject: false, keys: [] };
  }
  if (!isPlainObject(parsed)) return { parsedObject: false, keys: [] };
  return { parsedObject: true, keys: Object.keys(parsed) };
}

/**
 * 从 extractedJson 提取"产出字段"（顶层键）。安全解析：
 * null / 空串 / 非法 JSON / 非对象（数组、标量）一律返回 []。
 */
export function extractProducedFields(extractedJson: string | null): string[] {
  return parseTopLevelKeys(extractedJson).keys;
}

/**
 * 归一化 agentId → skillId：仅识别 `skill:<skillId>` 形态；其余（编排 agent、网关行、
 * 空值）返回 null。与 handoff-edge-usage 的 `skill:<skillId>` 口径一致。
 */
export function skillIdFromAgentId(agentId: string | null | undefined): string | null {
  if (typeof agentId !== 'string') return null;
  const trimmed = agentId.trim();
  if (!trimmed || !trimmed.startsWith(SKILL_PREFIX)) return null;
  const skillId = trimmed.slice(SKILL_PREFIX.length).trim();
  return skillId.length > 0 ? skillId : null;
}

/** 保序去重（跳过非字符串 / 空白 / 空串） */
function dedupePreserveOrder(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function ratio(hits: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((hits / total) * 10000) / 10000;
}

interface SkillBucket {
  totalCalls: number;
  parsedCalls: number;
  unparsedCalls: number;
  hits: Map<string, number>;
}

/**
 * 纯聚合：按 skill 归并产出字段，输出声明字段 / 观测字段（命中数 + 命中率）/
 * 死字段 / 契约漂移字段。排序确定：skills 按 skillId 升序，fields 按字段名升序，
 * deadFields 保持声明顺序。
 */
export function aggregateFieldHitRates(
  rows: readonly FieldHitLogRow[],
  options: FieldHitRatesOptions = {},
): FieldHitRatesResult {
  const declaredFieldsBySkill = options.declaredFieldsBySkill ?? {};
  const requestedMin = options.minCalls;
  const minCalls =
    typeof requestedMin === 'number' && Number.isFinite(requestedMin)
      ? Math.max(0, Math.trunc(requestedMin))
      : 0;

  const buckets = new Map<string, SkillBucket>();
  const result: FieldHitRatesResult = {
    skills: [],
    totalRows: 0,
    consideredRows: 0,
    skippedMissingAgent: 0,
    skippedNonSkillAgent: 0,
    skippedBelowMinCalls: 0,
  };

  for (const row of rows) {
    result.totalRows += 1;
    const rawAgent = typeof row.agentId === 'string' ? row.agentId.trim() : '';
    if (!rawAgent) {
      result.skippedMissingAgent += 1;
      continue;
    }
    const skillId = skillIdFromAgentId(rawAgent);
    if (!skillId) {
      result.skippedNonSkillAgent += 1;
      continue;
    }
    result.consideredRows += 1;

    let bucket = buckets.get(skillId);
    if (!bucket) {
      bucket = { totalCalls: 0, parsedCalls: 0, unparsedCalls: 0, hits: new Map() };
      buckets.set(skillId, bucket);
    }
    bucket.totalCalls += 1;
    const parsed = parseTopLevelKeys(row.extractedJson ?? null);
    if (parsed.parsedObject) bucket.parsedCalls += 1;
    else bucket.unparsedCalls += 1;
    for (const key of parsed.keys) {
      bucket.hits.set(key, (bucket.hits.get(key) ?? 0) + 1);
    }
  }

  const allSkillIds = new Set<string>([...Object.keys(declaredFieldsBySkill), ...buckets.keys()]);

  for (const skillId of [...allSkillIds].sort((a, b) => a.localeCompare(b))) {
    const bucket = buckets.get(skillId);
    const totalCalls = bucket?.totalCalls ?? 0;
    if (totalCalls < minCalls) {
      result.skippedBelowMinCalls += 1;
      continue;
    }

    const declaredFields = dedupePreserveOrder(declaredFieldsBySkill[skillId]);
    const observedFields = bucket ? [...bucket.hits.keys()] : [];
    const union = new Map<string, boolean>();
    for (const field of declaredFields) union.set(field, true);
    for (const field of observedFields) {
      if (!union.has(field)) union.set(field, false);
    }

    const fields: FieldHitRateEntry[] = [...union.entries()]
      .map(([field, declared]) => {
        const hits = bucket?.hits.get(field) ?? 0;
        return { field, declared, hits, hitRate: ratio(hits, totalCalls) };
      })
      .sort((a, b) => a.field.localeCompare(b.field));

    const driftFields = fields.filter((entry) => !entry.declared);
    const deadFields = declaredFields.filter((field) => !(bucket?.hits.has(field)));

    result.skills.push({
      skillId,
      agentId: `${SKILL_PREFIX}${skillId}`,
      totalCalls,
      parsedCalls: bucket?.parsedCalls ?? 0,
      unparsedCalls: bucket?.unparsedCalls ?? 0,
      declaredFields,
      fields,
      deadFields,
      driftFields,
    });
  }

  return result;
}
