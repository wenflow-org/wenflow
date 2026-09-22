/**
 * ConceptConsolidatorService（概念身份归并 · 学习 agent 维护型任务）
 *
 * 问题：系统里**没有任何「概念身份」**——`memory_traces.conceptKey`、`conceptLedger`、
 * 概念信念的 key 全是模型写的自由文本，全靠字符串相等对齐。机械归一化
 * （`normalizeConceptKey`）只能吃掉标点/引号/冒号从句，剩下的语义近义
 * （「回来后的第一眼第一手交给已翻开的书」vs「回来后第一眼第一手交给书」）只有 LLM 能做。
 *
 * 分层边界（**path 隔离不冲突**）：
 * - 记忆层 `memory_traces` 是**用户级、天然跨 path**（遗忘不分路径）→ 身份归并属于这一层。
 * - 概念/结构层（`learner_concept_beliefs` 按 `userId:pathId` 分片、conceptLedger、KC）保持
 *   **path 内隔离**：本服务只改「这俩是不是同一个东西」，不动任何 path 的知识结构，
 *   也不改 `label` 展示（只收敛调度键）。
 *
 * 纪律（照抄 learner-state-review）：LLM 只出**可证伪建议**，合并由代码执行，全程审计可回滚。
 * 分两档：P1 观察（默认，只记录建议、一个字节都不动）；P2 执行（需要显式开关，且只执行
 * `autoApplicable`——词面高度接近的那些）。
 */
import { createHash } from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { runBackgroundTask } from '../background-task-tracker.service';
import { executeSkillWithResult, auxSkillDefinitionMap } from '../../skills';
import { normalizeConceptKey } from '../memory/memory-trace.service';
import { conceptRegistryService } from './concept-registry.service';

/** 参与归并的活跃概念上限（控 LLM 成本与投影规模） */
export const MAX_CANDIDATES = 60;
/** 低于该把握度的建议不进 merges（服务层再兜一层，模型侧也要求放 ambiguous） */
export const MIN_CONFIDENCE = 0.8;
/** 词面相似度闸门：达到才允许 P2 自动执行（否则只记录、需人工看） */
export const MIN_LEXICAL_SIMILARITY = 0.5;
/** 观察/执行节流：同一指纹在该小时内不重复调用 LLM */
export const THROTTLE_HOURS = 12;
/** 审计里最多保留多少条建议（滚动） */
export const MAX_AUDIT_PROPOSALS = 200;

export const CONSOLIDATION_AUDIT_PROJECTION_SCOPE = 'concept-consolidation';
export const CONSOLIDATION_AUDIT_KEY_PREFIX = 'concept-merge-audits-v1';

export interface ConceptCandidate {
  conceptKey: string;
  label: string;
  source: string;
  occurrences: number;
  lastSeenAt: string | null;
  /** 该概念已知的来源路径（跨 path 是「同词异义」风险信号） */
  pathTitles: string[];
}

export interface ConceptMergeProposal {
  canonical: string;
  aliases: string[];
  confidence: number;
  rationale: string;
  /** 代码侧算的词面相似度（最相似的 alias 对 canonical） */
  lexicalSimilarity: number;
  /** 是否允许 P2 自动执行（把握度 + 词面闸门都过） */
  autoApplicable: boolean;
}

export interface ConceptConsolidationAudit {
  schemaVersion: 'concept-merge-audits-v1';
  generatedAt: string;
  mode: 'observe' | 'apply';
  projectionFingerprint: string;
  candidateCount: number;
  proposals: ConceptMergeProposal[];
  ambiguous: Array<{ a: string; b: string; reason: string }>;
  dropCandidates: Array<{ conceptKey: string; reason: string }>;
  /**
   * 执行记录（observe 模式恒为空）。
   * 注意：这里的数组只是"审计 blob 里的近期视图"（滚动窗口），
   * **回滚凭据的权威来源是按次留档**（`learner_evidence`，见 `AppliedConceptMerge`）——
   * 否则跑到第 101 次归并，更早的凭据就会被窗口挤掉（回滚过期）。
   */
  appliedMerges: AppliedConceptMerge[];
  /** alias 式归并的执行记录（非破坏；与 appliedMerges 并列，回滚语义不同） */
  appliedAliasMerges: AppliedConceptAliasMerge[];
  stats: {
    candidates: number;
    proposed: number;
    autoApplicable: number;
    applied: number;
    deleted: number;
    /** alias 策略：登记别名数 / 回填行数 */
    aliasesRegistered?: number;
    rowsRepointed?: number;
  };
}

/** 一次归并执行的**按次凭据**：写入 learner_evidence，长期可回滚（不被审计窗口挤掉） */
export interface AppliedConceptMerge {
  /** 本次执行的唯一凭据 id（按次留档主键，幂等） */
  mergeId: string;
  canonical: string;
  aliases: string[];
  winnerId: string;
  /** 并合后写进胜出者的字段（dueAt 取最早、mastery 取最高、ktMasteryEma 按观测加权…） */
  mergedFields: Record<string, unknown>;
  /** 胜出者合并前整行（回滚用） */
  winnerBefore: Record<string, unknown> | null;
  /** 被删除行的整行快照（回滚用；不是只存 id） */
  deletedRows: Array<Record<string, unknown>>;
  appliedAt: string;
  /** 已回滚时间；有值 = 凭据仍在（审计痕迹）但不再作为可回滚目标（幂等） */
  rolledBackAt?: string | null;
}

export const MERGE_RECORD_EVIDENCE_TYPE = 'concept:merge:applied';
export const MERGE_RECORD_EVIDENCE_KEY = 'concept-merge';
/** alias 策略的按次凭据（与破坏性归并分开留档，回滚语义不同） */
export const ALIAS_RECORD_EVIDENCE_TYPE = 'concept:alias:registered';
export const ALIAS_RECORD_EVIDENCE_KEY = 'concept-alias';

/** alias 策略单次可回填的行数上限：超限则**不自动执行**（转人工），以保住"完全可回滚"的不变式 */
export const MAX_ALIAS_ROLLBACK_ROWS = 500;

/**
 * 一次 **alias 式归并**的按次凭据（非破坏：只登记别名 + 把既有行改指 canonical，**不删任何行**）。
 *
 * 与 `AppliedConceptMerge` 的区别：后者重写/删除 `memory_traces` 行（靠整行快照回滚）；
 * 本类型只改 `conceptId` 指向并登记别名，回滚 = 删别名 + 还原 `conceptId`。
 */
export interface AppliedConceptAliasMerge {
  aliasMergeId: string;
  canonical: string;
  canonicalConceptId: string;
  aliases: string[];
  /** 回填前的 conceptId（回滚凭据）；表名区分痕迹与误解台账 */
  touchedRows: Array<{ table: 'memory_traces' | 'misconception_ledger'; id: string; previousConceptId: string | null }>;
  appliedAt: string;
  /** 已回滚时间；有值 = 凭据仍在但不再作为可回滚目标（幂等） */
  rolledBackAt?: string | null;
}

/** 稳定 aliasMergeId：同一 (canonical, appliedAt) 恒等 → 重复写不产生重复凭据 */
export function buildAliasMergeId(canonical: string, appliedAt: string): string {
  return `alg_${createHash('sha1').update(`${canonical}|${appliedAt}`).digest('hex').slice(0, 16)}`;
}

/** 稳定 mergeId：同一 (canonical, winnerId, appliedAt) 恒等 → 重复写不会产生重复凭据 */
export function buildMergeId(canonical: string, winnerId: string, appliedAt: string): string {
  return `mrg_${createHash('sha1').update(`${canonical}|${winnerId}|${appliedAt}`).digest('hex').slice(0, 16)}`;
}

export function parseMergeRecord(payload: string | null | undefined): AppliedConceptMerge | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || !parsed.mergeId || !parsed.canonical) return null;
    return {
      mergeId: String(parsed.mergeId),
      canonical: String(parsed.canonical),
      aliases: Array.isArray(parsed.aliases) ? parsed.aliases.map(String) : [],
      winnerId: String(parsed.winnerId || ''),
      mergedFields: parsed.mergedFields && typeof parsed.mergedFields === 'object' ? parsed.mergedFields : {},
      winnerBefore: parsed.winnerBefore && typeof parsed.winnerBefore === 'object' ? parsed.winnerBefore : null,
      deletedRows: Array.isArray(parsed.deletedRows) ? parsed.deletedRows : [],
      appliedAt: String(parsed.appliedAt || ''),
      rolledBackAt: typeof parsed.rolledBackAt === 'string' ? parsed.rolledBackAt : null,
    };
  } catch {
    return null;
  }
}

export interface ConceptConsolidatorDeps {
  findTraces: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  updateTrace: (args: Record<string, unknown>) => Promise<unknown>;
  deleteTraces: (args: Record<string, unknown>) => Promise<unknown>;
  findEvidence: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  findPaths: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  readAudit: (projectionKey: string) => Promise<{ payload: string } | null>;
  writeAudit: (args: Record<string, unknown>) => Promise<unknown>;
  callSkill: (input: Record<string, unknown>) => Promise<{ success: boolean; output?: any; error?: any }>;
  /** 回滚用：按整行快照重建被删除的痕迹 */
  createTraces: (args: Record<string, unknown>) => Promise<unknown>;
  /** 按次留档：写/更新一条归并凭据（幂等） */
  recordMerge: (args: Record<string, unknown>) => Promise<unknown>;
  /** 按次留档：读归并凭据（回滚的权威来源） */
  findMerges: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  /** alias 策略：解析/创建 canonical 概念身份 */
  resolveConcept: (userId: string, text: string, opts?: { createIfMissing?: boolean }) => Promise<{ conceptId: string } | null>;
  /** alias 策略：登记别名（非破坏） */
  registerAlias: (args: { userId: string; conceptId: string; aliasRaw: string; source: string }) => Promise<{ conceptId: string; registered: boolean }>;
  /** alias 策略：批量改指 conceptId（回填/回滚） */
  updateTraceMany: (args: Record<string, unknown>) => Promise<unknown>;
  findMisconceptionRows: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  updateMisconceptionMany: (args: Record<string, unknown>) => Promise<unknown>;
  /** alias 策略：按次留档（写/读 alias 凭据） */
  recordAliasMerge: (args: Record<string, unknown>) => Promise<unknown>;
  findAliasMerges: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
}

const defaultDeps: ConceptConsolidatorDeps = {
  findTraces: (args) => prisma.memory_traces.findMany(args as any) as any,
  updateTrace: (args) => prisma.memory_traces.update(args as any) as any,
  deleteTraces: (args) => prisma.memory_traces.deleteMany(args as any) as any,
  createTraces: (args) => prisma.memory_traces.createMany(args as any) as any,
  findEvidence: (args) => prisma.learner_evidence.findMany(args as any) as any,
  findPaths: (args) => prisma.learning_paths.findMany(args as any) as any,
  readAudit: (projectionKey) => prisma.learner_projections.findUnique({
    where: { projectionKey },
    select: { payload: true },
  }) as any,
  writeAudit: (args) => prisma.learner_projections.upsert(args as any) as any,
  callSkill: (input) => executeSkillWithResult(auxSkillDefinitionMap['concept-consolidator'], input as any) as any,
  recordMerge: (args) => prisma.learner_evidence.upsert(args as any) as any,
  findMerges: (args) => prisma.learner_evidence.findMany(args as any) as any,
  resolveConcept: (userId, text, opts) =>
    conceptRegistryService.resolveConcept(userId, text, {
      createIfMissing: opts?.createIfMissing !== false,
      source: 'consolidator',
    }),
  registerAlias: (args) => conceptRegistryService.registerAlias({
    userId: args.userId, conceptId: args.conceptId, aliasRaw: args.aliasRaw, source: 'consolidator',
  }),
  updateTraceMany: (args) => prisma.memory_traces.updateMany(args as any) as any,
  findMisconceptionRows: (args) => prisma.misconception_ledger.findMany(args as any) as any,
  updateMisconceptionMany: (args) => prisma.misconception_ledger.updateMany(args as any) as any,
  recordAliasMerge: (args) => prisma.learner_evidence.upsert(args as any) as any,
  findAliasMerges: (args) => prisma.learner_evidence.findMany(args as any) as any,
};

export function consolidationAuditKey(userId: string): string {
  return `${CONSOLIDATION_AUDIT_KEY_PREFIX}:${userId}`;
}

/** 比较用归一：去空白/引号/标点，压低大小写与常见虚词差异 */
function normalizeForCompare(text: string): string {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[「」『』“”‘’"'（）()【】[\]]/g, '')
    .replace(/[。．.，,、；;：:！!？?~～\-—…=＝→]/g, '')
    .toLowerCase();
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i += 1) grams.add(text.slice(i, i + 2));
  if (text.length === 1) grams.add(text);
  return grams;
}

/**
 * 词面相似度（0-1）：包含关系 → 按长度比例给高分；否则用 bigram Dice 系数。
 * 只用于「能不能自动执行」的保守闸门，不用于替代语义判断。
 */
export function lexicalSimilarity(a: string, b: string): number {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) {
    const short = x.length <= y.length ? x : y;
    const long = x.length <= y.length ? y : x;
    return Math.round(Math.min(0.99, 0.6 + 0.4 * (short.length / long.length)) * 100) / 100;
  }
  const gx = bigrams(x);
  const gy = bigrams(y);
  let shared = 0;
  for (const gram of gx) if (gy.has(gram)) shared += 1;
  const dice = (2 * shared) / (gx.size + gy.size);
  return Math.round(dice * 100) / 100;
}

/** 候选指纹：用于节流（同指纹 + 窗口内不重复调 LLM） */
export function candidateFingerprint(candidates: ConceptCandidate[]): string {
  const basis = candidates.map((item) => item.conceptKey).sort().join('\u0001');
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

/**
 * 校验模型建议：① canonical/aliases 必须来自候选 ② 把握度闸门 ③ 词面闸门（决定能否自动执行）。
 * 未过闸门的建议不丢弃——降级记进 ambiguous（P1 观察期的正是这些）。
 */
export function validateConsolidation(input: {
  candidates: ConceptCandidate[];
  parsed: { merges?: any[]; ambiguous?: any[]; dropCandidates?: any[] } | null | undefined;
}): {
  proposals: ConceptMergeProposal[];
  ambiguous: Array<{ a: string; b: string; reason: string }>;
  dropCandidates: Array<{ conceptKey: string; reason: string }>;
} {
  const known = new Set(input.candidates.map((item) => item.conceptKey));
  const ambiguous: Array<{ a: string; b: string; reason: string }> = [];
  const proposals: ConceptMergeProposal[] = [];

  for (const raw of Array.isArray(input.parsed?.merges) ? input.parsed!.merges! : []) {
    const canonical = String(raw?.canonical || '').trim();
    const aliasValues: string[] = (Array.isArray(raw?.aliases) ? raw.aliases : [])
      .map((item: any) => String(item || '').trim())
      .filter((item: string) => !!item && item !== canonical);
    const aliases: string[] = Array.from(new Set<string>(aliasValues));
    if (!canonical || aliases.length === 0) continue;
    if (!known.has(canonical) || !aliases.every((alias) => known.has(alias))) {
      logger.warn('[concept-consolidator] 丢弃越界建议（概念名不在候选里）', { canonical, aliases });
      continue;
    }
    const confidence = typeof raw?.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0;
    const rationale = String(raw?.rationale || '').trim();
    const lexical = aliases.reduce((max, alias) => Math.max(max, lexicalSimilarity(canonical, alias)), 0);

    if (confidence < MIN_CONFIDENCE) {
      ambiguous.push({ a: canonical, b: aliases[0], reason: `把握度 ${confidence} 低于阈值（${rationale || '未说明'}）` });
      continue;
    }
    proposals.push({
      canonical,
      aliases,
      confidence,
      rationale,
      lexicalSimilarity: lexical,
      autoApplicable: lexical >= MIN_LEXICAL_SIMILARITY,
    });
  }

  for (const raw of Array.isArray(input.parsed?.ambiguous) ? input.parsed!.ambiguous! : []) {
    const a = String(raw?.a || '').trim();
    const b = String(raw?.b || '').trim();
    if (!a || !b || !known.has(a) || !known.has(b)) continue;
    ambiguous.push({ a, b, reason: String(raw?.reason || '').trim() });
  }

  const dropCandidates = (Array.isArray(input.parsed?.dropCandidates) ? input.parsed!.dropCandidates! : [])
    .map((raw: any) => ({ conceptKey: String(raw?.conceptKey || '').trim(), reason: String(raw?.reason || '').trim() }))
    .filter((item: { conceptKey: string }) => item.conceptKey && known.has(item.conceptKey));

  return { proposals, ambiguous, dropCandidates };
}

type TraceRow = Record<string, any>;

export interface MergeExecutionPlan {
  canonical: string;
  aliases: string[];
  winnerId: string;
  /** 并合后要写进胜出者的字段（保留信息，不制造倒退） */
  mergedFields: TraceRow;
  /** 胜出者合并前整行（回滚用） */
  winnerBefore: TraceRow | null;
  /** 被删除行的整行快照（回滚用） */
  deletedRows: TraceRow[];
}

function maxOf(values: number[], fallback: number): number {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0 ? Math.max(...finite) : fallback;
}

function minDateOf(values: Array<unknown>): Date | null {
  const times = values
    .map((value) => (value ? new Date(value as any).getTime() : NaN))
    .filter((time) => Number.isFinite(time));
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

function maxDateOf(values: Array<unknown>): Date | null {
  const times = values
    .map((value) => (value ? new Date(value as any).getTime() : NaN))
    .filter((time) => Number.isFinite(time));
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

/**
 * 并合字段：**不是删掉多余行就算了**——被删那条更早的排期、更高的掌握度、知识状态 EMA
 * 都必须并进胜出者，否则「合并」等于让记忆状态倒退。
 * - dueAt 取最早（宁可早捞，不可漏捞）
 * - masteryScore 取最高；extractionCount 取最大（该字段语义已脏，求和会放大噪声）
 * - ktMasteryEma 按观测数（extractionCount 作代理）加权
 * - FSRS 状态取最稳固的那条（无法定义"并合"两个调度状态，取信息量最大的）
 * - label 保留胜出者原文（不改用户看到的名字）；conceptKey 收敛到规范键
 */
export function buildMergedFields(members: TraceRow[], winner: TraceRow, canonical: string): TraceRow {
  let ktWeighted = 0;
  let ktWeights = 0;
  for (const member of members) {
    const kt = Number(member.ktMasteryEma);
    if (!Number.isFinite(kt)) continue;
    const weight = Number(member.extractionCount) > 0 ? Number(member.extractionCount) : 1;
    ktWeighted += kt * weight;
    ktWeights += weight;
  }
  const withFsrs = members.filter((member) => Number.isFinite(Number(member.fsrsStability)));
  const bestFsrs = withFsrs.length > 0
    ? withFsrs.reduce((best, current) => (Number(current.fsrsStability) > Number(best.fsrsStability) ? current : best))
    : null;

  const merged: TraceRow = {
    conceptKey: canonical,
    label: winner.label || canonical,
    masteryScore: maxOf(members.map((member) => Number(member.masteryScore)), Number(winner.masteryScore) || 0),
    extractionCount: maxOf(members.map((member) => Number(member.extractionCount)), Number(winner.extractionCount) || 0),
    lastSeenAt: maxDateOf(members.map((member) => member.lastSeenAt)) ?? winner.lastSeenAt ?? null,
    dueAt: minDateOf(members.map((member) => member.dueAt)) ?? winner.dueAt ?? null,
  };
  if (ktWeights > 0) merged.ktMasteryEma = Math.round((ktWeighted / ktWeights) * 1000) / 1000;
  if (bestFsrs) {
    merged.fsrsStability = bestFsrs.fsrsStability;
    merged.fsrsDifficulty = bestFsrs.fsrsDifficulty ?? null;
    // 失误次数随稳定性的同一成员一起带走（Relearning 判据，不能与 stability 分家）
    merged.fsrsLapses = bestFsrs.fsrsLapses ?? null;
    // 复习次数同理（口径是"FSRS 调度过的复习"，与 extractionCount 不同）
    merged.fsrsReps = bestFsrs.fsrsReps ?? null;
  }
  return merged;
}

/**
 * 合并执行计划：优先保留「名字已等于规范键」的那条（避免改键撞唯一约束），
 * 否则按 extractionCount → masteryScore → lastSeenAt 选胜出者；其余删除但留整行快照。
 */
export function planMerge(rows: TraceRow[], canonical: string, aliases: string[]): MergeExecutionPlan | null {
  const family = new Set([canonical, ...aliases].map((key) => normalizeConceptKey(key)));
  const members = rows.filter((row) => family.has(normalizeConceptKey(String(row.conceptKey || ''))));
  if (members.length < 2) return null;

  const exact = members.find((row) => row.conceptKey === canonical);
  const winner = exact ?? members.slice().sort((a, b) => {
    const byCount = Number(b.extractionCount || 0) - Number(a.extractionCount || 0);
    if (byCount !== 0) return byCount;
    const byMastery = Number(b.masteryScore || 0) - Number(a.masteryScore || 0);
    if (byMastery !== 0) return byMastery;
    return new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime();
  })[0];

  return {
    canonical,
    aliases,
    winnerId: winner.id,
    mergedFields: buildMergedFields(members, winner, canonical),
    winnerBefore: { ...winner },
    deletedRows: members.filter((row) => row.id !== winner.id).map((row) => ({ ...row })),
  };
}

class ConceptConsolidatorService {
  private inflight = new Map<string, Promise<ConceptConsolidationAudit | null>>();

  constructor(private readonly deps: ConceptConsolidatorDeps = defaultDeps) {}

  /** 读取最近一次审计（供后台看准确率） */
  async getAudit(userId: string): Promise<ConceptConsolidationAudit | null> {
    const row = await this.deps.readAudit(consolidationAuditKey(userId));
    if (!row?.payload) return null;
    try {
      return JSON.parse(row.payload) as ConceptConsolidationAudit;
    } catch {
      return null;
    }
  }

  /**
   * 构建候选投影（用户级、跨 path 的活跃概念）。
   * 只带名字与出现次数，**不带掌握度数值**（防 LLM 编数字）。
   */
  async buildProjection(userId: string): Promise<ConceptCandidate[]> {
    const traces = await this.deps.findTraces({
      where: { userId },
      orderBy: [{ lastSeenAt: 'desc' }],
      take: MAX_CANDIDATES * 2,
      select: { conceptKey: true, label: true, source: true, extractionCount: true, lastSeenAt: true },
    });
    const seen = new Set<string>();
    const candidates: ConceptCandidate[] = [];
    for (const trace of traces) {
      const key = String(trace.conceptKey || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        conceptKey: key,
        label: String(trace.label || key),
        source: String(trace.source || ''),
        occurrences: Number(trace.extractionCount || 0),
        lastSeenAt: trace.lastSeenAt ? new Date(trace.lastSeenAt).toISOString() : null,
        pathTitles: [],
      });
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    await this.attachOriginPaths(userId, candidates);
    return candidates;
  }

  /** 归属路径（跨 path 是「同词异义」的风险信号，也是有价值的上下文）：best-effort */
  private async attachOriginPaths(userId: string, candidates: ConceptCandidate[]): Promise<void> {
    if (candidates.length === 0) return;
    try {
      const evidence = await this.deps.findEvidence({
        where: { userId, evidenceKey: { in: candidates.map((item) => `review:result:${item.conceptKey}`) }, pathId: { not: null } },
        select: { evidenceKey: true, pathId: true },
        take: MAX_CANDIDATES * 4,
      });
      if (evidence.length === 0) return;
      const pathIds = Array.from(new Set(evidence.map((row) => row.pathId).filter(Boolean) as string[]));
      const paths = pathIds.length > 0
        ? await this.deps.findPaths({ where: { id: { in: pathIds } }, select: { id: true, title: true } })
        : [];
      const titleByPath = new Map(paths.map((row) => [row.id, String(row.title || '')]));
      const byKey = new Map<string, Set<string>>();
      for (const row of evidence) {
        const key = String(row.evidenceKey || '').replace(/^review:result:/, '');
        const title = titleByPath.get(String(row.pathId));
        if (!key || !title) continue;
        const bucket = byKey.get(key) ?? new Set<string>();
        bucket.add(title);
        byKey.set(key, bucket);
      }
      for (const candidate of candidates) {
        candidate.pathTitles = Array.from(byKey.get(candidate.conceptKey) ?? []).slice(0, 3);
      }
    } catch {
      // 归属解析失败不影响归并
    }
  }

  /**
   * 观察/执行一次归并（默认 observe：只记录建议，不动 memory_traces）。
   * `mode: 'apply'` 才会执行，且只执行 autoApplicable 的建议。
   */
  async consolidate(
    userId: string,
    options: {
      mode?: 'observe' | 'apply'; force?: boolean; includeNeedsReview?: boolean; now?: Date;
      /** 执行策略：alias（默认，非破坏）/ merge（历史破坏性归并，仅用于回滚旧凭据） */
      strategy?: 'alias' | 'merge';
    } = {},
  ): Promise<ConceptConsolidationAudit | null> {
    const mode = options.mode ?? 'observe';
    const now = options.now ?? new Date();
    const candidates = await this.buildProjection(userId);
    if (candidates.length < 2) return null;

    const fingerprint = candidateFingerprint(candidates);
    const previous = await this.getAudit(userId);
    if (!options.force && previous
      && previous.projectionFingerprint === fingerprint
      && now.getTime() - new Date(previous.generatedAt).getTime() < THROTTLE_HOURS * 3600_000) {
      return previous;
    }

    let parsed: any = null;
    try {
      const result = await this.deps.callSkill({
        candidates: candidates.map((item) => ({
          conceptKey: item.conceptKey,
          occurrences: item.occurrences,
          pathTitles: item.pathTitles,
        })),
        canonicalWhitelist: Array.from(new Set((previous?.proposals ?? []).map((item) => item.canonical))),
        aliasMap: Object.fromEntries(
          (previous?.proposals ?? []).flatMap((item) => item.aliases.map((alias) => [alias, item.canonical])),
        ),
      });
      if (!result?.success) throw new Error(String(result?.error?.message || 'concept-consolidator failed'));
      parsed = result.output;
    } catch (error) {
      logger.warn('[concept-consolidator] 归并建议生成失败（不改动任何数据）', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return previous ?? null;
    }

    const validated = validateConsolidation({ candidates, parsed });
    // 执行策略：alias（默认，非破坏：登记别名 + 改指 conceptId）/ merge（历史破坏性归并，仅用于回滚旧凭据）
    const strategy = options.strategy ?? 'alias';
    const appliedAlias = mode === 'apply' && strategy === 'alias'
      ? await this.executeAliasMerges(userId, validated.proposals, { includeNeedsReview: options.includeNeedsReview === true })
      : [];
    const applied = mode === 'apply' && strategy === 'merge'
      ? await this.executeMerges(userId, validated.proposals, { includeNeedsReview: options.includeNeedsReview === true })
      : [];

    const appliedKeys = new Set([
      ...applied.map((item) => item.canonical),
      ...appliedAlias.map((item) => item.canonical),
    ]);
    const audit: ConceptConsolidationAudit = {
      schemaVersion: 'concept-merge-audits-v1',
      generatedAt: now.toISOString(),
      mode,
      projectionFingerprint: fingerprint,
      candidateCount: candidates.length,
      proposals: validated.proposals.slice(0, MAX_AUDIT_PROPOSALS),
      ambiguous: [...validated.ambiguous, ...(previous?.ambiguous ?? [])].slice(0, 400),
      dropCandidates: [...validated.dropCandidates, ...(previous?.dropCandidates ?? [])].slice(0, 100),
      appliedMerges: [...applied, ...(previous?.appliedMerges ?? [])].slice(0, 100),
      appliedAliasMerges: [...appliedAlias, ...(previous?.appliedAliasMerges ?? [])].slice(0, 100),
      stats: {
        candidates: candidates.length,
        proposed: validated.proposals.length,
        autoApplicable: validated.proposals.filter((item) => item.autoApplicable).length,
        applied: applied.length + appliedAlias.length,
        deleted: applied.reduce((sum, item) => sum + item.deletedRows.length, 0),
        aliasesRegistered: appliedAlias.reduce((sum, item) => sum + item.aliases.length, 0),
        rowsRepointed: appliedAlias.reduce((sum, item) => sum + item.touchedRows.length, 0),
      },
    };

    await this.writeAudit(userId, audit);

    logger.info('[concept-consolidator] 归并审计已记录', {
      userId,
      mode,
      candidates: candidates.length,
      proposed: audit.stats.proposed,
      autoApplicable: audit.stats.autoApplicable,
      applied: audit.stats.applied,
      deleted: audit.stats.deleted,
    });

    // 执行过的规范键：后续建议里不再重复出现（whitelist 已写入 payload）
    if (appliedKeys.size > 0) {
      logger.info('[concept-consolidator] 已执行归并', { userId, canonicalKeys: Array.from(appliedKeys) });
    }

    return audit;
  }

  /**
   * 执行选中的归并建议（后台「一键 apply」的落点）。
   * - 只处理审计里真实存在的建议（名单由前端勾选，服务端再校验一次）；
   * - 默认只执行 `autoApplicable`，`includeNeedsReview` 才允许人工强行执行需确认项；
   * - 每条的胜出者合并前整行 + 被删行整行都写进审计，`rollbackMerge` 可还原。
   */
  async applyProposals(
    userId: string,
    canonicals: string[],
    options: { includeNeedsReview?: boolean; strategy?: 'alias' | 'merge' } = {},
  ): Promise<{ audit: ConceptConsolidationAudit | null; applied: number; skipped: string[] }> {
    const audit = await this.getAudit(userId);
    if (!audit) return { audit: null, applied: 0, skipped: [] };
    const wanted = new Set(canonicals.map((item) => String(item || '').trim()).filter(Boolean));
    const skipped: string[] = [];
    const executable = audit.proposals.filter((proposal) => {
      if (!wanted.has(proposal.canonical)) return false;
      if (!proposal.autoApplicable && !options.includeNeedsReview) {
        skipped.push(proposal.canonical);
        return false;
      }
      return true;
    });
    for (const canonical of wanted) {
      if (!audit.proposals.some((proposal) => proposal.canonical === canonical)) skipped.push(canonical);
    }
    if (executable.length === 0) return { audit, applied: 0, skipped };

    // 默认 alias（非破坏）；merge 仅用于回滚历史破坏性凭据的场景
    const strategy = options.strategy ?? 'alias';
    const appliedAlias = strategy === 'alias'
      ? await this.executeAliasMerges(userId, executable, { includeNeedsReview: options.includeNeedsReview === true })
      : [];
    const applied = strategy === 'merge'
      ? await this.executeMerges(userId, executable, { includeNeedsReview: options.includeNeedsReview === true })
      : [];
    const next: ConceptConsolidationAudit = {
      ...audit,
      mode: 'apply',
      generatedAt: new Date().toISOString(),
      appliedMerges: [...applied, ...audit.appliedMerges].slice(0, 100),
      appliedAliasMerges: [...appliedAlias, ...(audit.appliedAliasMerges ?? [])].slice(0, 100),
      proposals: audit.proposals.filter((proposal) => !executable.some((item) => item.canonical === proposal.canonical)),
      stats: {
        ...audit.stats,
        applied: audit.stats.applied + applied.length + appliedAlias.length,
        deleted: audit.stats.deleted + applied.reduce((sum, item) => sum + item.deletedRows.length, 0),
        aliasesRegistered: (audit.stats.aliasesRegistered ?? 0) + appliedAlias.reduce((sum, item) => sum + item.aliases.length, 0),
        rowsRepointed: (audit.stats.rowsRepointed ?? 0) + appliedAlias.reduce((sum, item) => sum + item.touchedRows.length, 0),
      },
    };
    await this.writeAudit(userId, next);
    logger.info('[concept-consolidator] 归并已执行', {
      userId,
      strategy,
      applied: applied.length + appliedAlias.length,
      skipped: skipped.length,
    });
    return { audit: next, applied: applied.length, skipped };
  }

  /**
   * 回滚指定归并：把胜出者还原成合并前整行，并按整行快照重建被删除的重复行。
   * 只回滚审计里仍记录的合并（留档即凭据）。
   */
  async rollbackMerge(
    userId: string,
    canonicals: string[],
  ): Promise<{ audit: ConceptConsolidationAudit | null; rolledBack: number; skipped: string[] }> {
    const audit = await this.getAudit(userId);
    const wanted = new Set(canonicals.map((item) => String(item || '').trim()).filter(Boolean));
    if (wanted.size === 0) return { audit, rolledBack: 0, skipped: [] };

    // 凭据来源：① 按次留档（权威，长期有效，不被审计滚动窗口挤掉）
    //           ② 审计 blob 里的近期视图（兼容本改动之前执行过的归并）
    const durable = await this.listAppliedMerges(userId).catch((error) => {
      logger.warn('[concept-consolidator] 读取归并凭据失败，回退到审计内视图', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as AppliedConceptMerge[];
    });
    const durableTargets = durable.filter((merge) => wanted.has(merge.canonical));
    const coveredIds = new Set(durableTargets.map((merge) => merge.mergeId));
    const blobTargets = (audit?.appliedMerges ?? []).filter((merge) =>
      wanted.has(merge.canonical) && (!merge.mergeId || !coveredIds.has(merge.mergeId))
    );
    const targets = [...durableTargets, ...blobTargets];

    // alias 凭据（非破坏策略）：同样按 canonical 匹配，回滚语义不同（还原 conceptId + 删别名）
    const durableAliases = await this.listAliasMerges(userId).catch((error) => {
      logger.warn('[concept-consolidator] 读取 alias 凭据失败', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as AppliedConceptAliasMerge[];
    });
    const aliasCovered = new Set(durableAliases.map((item) => item.aliasMergeId));
    const aliasTargets = [
      ...durableAliases.filter((item) => wanted.has(item.canonical) && !item.rolledBackAt),
      ...(audit?.appliedAliasMerges ?? []).filter((item) =>
        wanted.has(item.canonical) && !item.rolledBackAt && !aliasCovered.has(item.aliasMergeId)
      ),
    ];

    const skipped = Array.from(wanted).filter((canonical) =>
      !targets.some((merge) => merge.canonical === canonical)
      && !aliasTargets.some((item) => item.canonical === canonical)
    );
    if (targets.length === 0 && aliasTargets.length === 0) return { audit, rolledBack: 0, skipped };

    let rolledBack = 0;
    const rolledBackIds: string[] = [];
    const rolledBackAliasIds: string[] = [];
    for (const aliasTarget of aliasTargets) {
      try {
        await this.revertAliasMerge(userId, aliasTarget);
        rolledBack += 1;
        rolledBackAliasIds.push(aliasTarget.aliasMergeId);
      } catch (error) {
        logger.warn('[concept-consolidator] 单条 alias 回滚失败（跳过）', {
          userId,
          canonical: aliasTarget.canonical,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const target of targets) {
      try {
        await this.revertMerge(target);
        rolledBack += 1;
        if (target.mergeId) rolledBackIds.push(target.mergeId);
      } catch (error) {
        logger.warn('[concept-consolidator] 单条回滚失败（跳过）', {
          userId,
          canonical: target.canonical,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 标记凭据已回滚：既保证幂等（不会回滚两次），又保留审计痕迹（记录本身不删）
    const rolledBackAt = new Date().toISOString();
    for (const target of targets) {
      if (!target.mergeId || !rolledBackIds.includes(target.mergeId)) continue;
      await this.recordMerge(userId, { ...target, rolledBackAt }).catch(() => undefined);
    }
    for (const aliasTarget of aliasTargets) {
      if (!rolledBackAliasIds.includes(aliasTarget.aliasMergeId)) continue;
      await this.recordAliasMerge(userId, { ...aliasTarget, rolledBackAt }).catch(() => undefined);
    }

    if (!audit) {
      logger.info('[concept-consolidator] 归并已回滚（无审计视图，按留档凭据）', { userId, rolledBack });
      return { audit: null, rolledBack, skipped };
    }

    const rolledBackCanonicals = new Set(targets.map((merge) => merge.canonical));
    const rolledBackAliasCanonicals = new Set(aliasTargets.map((item) => item.canonical));
    const next: ConceptConsolidationAudit = {
      ...audit,
      generatedAt: new Date().toISOString(),
      appliedMerges: audit.appliedMerges.filter((merge) => !rolledBackCanonicals.has(merge.canonical)),
      appliedAliasMerges: (audit.appliedAliasMerges ?? []).filter((item) => !rolledBackAliasCanonicals.has(item.canonical)),
      stats: {
        ...audit.stats,
        applied: Math.max(0, audit.stats.applied - rolledBack),
        deleted: Math.max(0, audit.stats.deleted - targets.reduce((sum, item) => sum + (item.deletedRows?.length || 0), 0)),
        aliasesRegistered: Math.max(0, (audit.stats.aliasesRegistered ?? 0)
          - aliasTargets.reduce((sum, item) => sum + item.aliases.length, 0)),
        rowsRepointed: Math.max(0, (audit.stats.rowsRepointed ?? 0)
          - aliasTargets.reduce((sum, item) => sum + item.touchedRows.length, 0)),
      },
    };
    await this.writeAudit(userId, next);
    logger.info('[concept-consolidator] 归并已回滚', { userId, rolledBack });
    return { audit: next, rolledBack, skipped };
  }

  /** 按整行快照还原一次归并（回滚与"凭据落库失败时的当场撤销"共用） */
  private async revertMerge(merge: AppliedConceptMerge): Promise<void> {
    if (merge.winnerBefore && merge.winnerId) {
      const { id, ...restore } = merge.winnerBefore as Record<string, unknown>;
      await this.deps.updateTrace({ where: { id: merge.winnerId }, data: restore });
    }
    const rows = (merge.deletedRows || []).filter((row) => row && (row as any).id && (row as any).conceptKey);
    if (rows.length > 0) {
      await this.deps.createTraces({ data: rows });
    }
  }

  /** 按次留档：写/更新一条归并凭据（幂等，事件键 = mergeId） */
  private async recordMerge(userId: string, merge: AppliedConceptMerge): Promise<void> {
    await this.deps.recordMerge({
      where: { eventId_evidenceKey: { eventId: merge.mergeId, evidenceKey: MERGE_RECORD_EVIDENCE_KEY } },
      create: {
        id: `ev_${merge.mergeId}`,
        eventId: merge.mergeId,
        evidenceKey: MERGE_RECORD_EVIDENCE_KEY,
        userId,
        pathId: null,
        taskId: null,
        evidenceType: MERGE_RECORD_EVIDENCE_TYPE,
        payload: JSON.stringify(merge),
        confidence: 1,
        occurredAt: new Date(merge.appliedAt || Date.now()),
      },
      update: {
        payload: JSON.stringify(merge),
      },
    });
  }

  /**
   * 列出该用户的归并凭据（按次留档）。
   * 默认只看"仍可回滚"的（未被标记 rolledBackAt）；`includeRolledBack` 用于审计视图。
   */
  async listAppliedMerges(
    userId: string,
    options: { includeRolledBack?: boolean } = {}
  ): Promise<AppliedConceptMerge[]> {
    const rows = await this.deps.findMerges({
      where: { userId, evidenceType: MERGE_RECORD_EVIDENCE_TYPE },
      orderBy: { occurredAt: 'asc' },
      select: { payload: true },
    });
    const merges = rows.flatMap((row) => {
      const parsed = parseMergeRecord(row.payload);
      return parsed ? [parsed] : [];
    });
    return options.includeRolledBack ? merges : merges.filter((merge) => !merge.rolledBackAt);
  }

  /** 写审计（upsert 到 learner_projections） */
  private async writeAudit(userId: string, audit: ConceptConsolidationAudit): Promise<void> {
    const now = new Date();
    await this.deps.writeAudit({
      where: { projectionKey: consolidationAuditKey(userId) },
      create: {
        id: `ccs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        projectionKey: consolidationAuditKey(userId),
        userId,
        scope: CONSOLIDATION_AUDIT_PROJECTION_SCOPE,
        version: 1,
        payload: JSON.stringify(audit),
        generatedAt: now,
      },
      update: {
        version: { increment: 1 },
        payload: JSON.stringify(audit),
        generatedAt: now,
      },
    });
  }

  /**
   * alias 式归并（**非破坏**）：为 canonical 建立/取回身份 → 把每个 alias 登记进注册表
   * → 把既有行的 `conceptId` 改指 canonical（**只改指向，不删行**）。
   *
   * 与 `executeMerges` 的关键差别：本策略不改 `conceptKey`/不删行，故"同一概念的多个自由文本键"
   * 会各自保留自己的行，但都指向同一个 canonical —— 这正是让"计划↔痕迹"能 join 起来的手段
   * （实测该贯通率仅 ~6%，靠 alias 桥接提升）。
   *
   * 可回滚性：先算出将受影响的行（回滚凭据），**超过 `MAX_ALIAS_ROLLBACK_ROWS` 就整条不执行**
   * （转人工），以保住"凡执行必完全可回滚"的不变式，而不是静默降级成部分可回滚。
   */
  private async executeAliasMerges(
    userId: string,
    proposals: ConceptMergeProposal[],
    options: { includeNeedsReview?: boolean } = {},
  ): Promise<AppliedConceptAliasMerge[]> {
    const applied: AppliedConceptAliasMerge[] = [];
    const executable = proposals.filter((item) => options.includeNeedsReview || item.autoApplicable);
    if (executable.length === 0) return applied;

    for (const proposal of executable) {
      try {
        const canonicalResolved = await this.deps.resolveConcept(userId, proposal.canonical, { createIfMissing: true });
        if (!canonicalResolved) continue;
        const canonicalConceptId = canonicalResolved.conceptId;
        const aliases = Array.from(new Set(proposal.aliases.map((a) => String(a || '').trim()).filter(Boolean)))
          .filter((alias) => normalizeConceptKey(alias) !== normalizeConceptKey(proposal.canonical));
        if (aliases.length === 0) continue;

        // ① 先收集将受影响的行（回滚凭据）——超限则整条跳过，不执行
        const touchedRows: AppliedConceptAliasMerge['touchedRows'] = [];
        const aliasNorms = aliases.map((alias) => normalizeConceptKey(alias)).filter(Boolean);
        const traceRows = await this.deps.findTraces({
          where: { userId, conceptKey: { in: aliasNorms }, NOT: { conceptId: canonicalConceptId } },
          select: { id: true, conceptId: true },
        });
        for (const row of traceRows) {
          touchedRows.push({ table: 'memory_traces', id: String(row.id), previousConceptId: (row.conceptId as string | null) ?? null });
        }
        const misconceptionRows = await this.deps.findMisconceptionRows({
          where: { userId, conceptKey: { in: aliasNorms }, NOT: { conceptId: canonicalConceptId } },
          select: { id: true, conceptId: true },
        });
        for (const row of misconceptionRows) {
          touchedRows.push({ table: 'misconception_ledger', id: String(row.id), previousConceptId: (row.conceptId as string | null) ?? null });
        }
        if (touchedRows.length > MAX_ALIAS_ROLLBACK_ROWS) {
          logger.warn('[concept-consolidator] alias 归并影响行数超限，转人工（未执行）', {
            userId, canonical: proposal.canonical, rows: touchedRows.length, limit: MAX_ALIAS_ROLLBACK_ROWS,
          });
          continue;
        }

        // ② 登记别名（非破坏；幂等）
        for (const alias of aliases) {
          await this.deps.registerAlias({ userId, conceptId: canonicalConceptId, aliasRaw: alias, source: 'consolidator' });
        }

        // ③ 回填既有行的 conceptId（只改指向）
        const traceIds = touchedRows.filter((row) => row.table === 'memory_traces').map((row) => row.id);
        if (traceIds.length > 0) {
          await this.deps.updateTraceMany({ where: { userId, id: { in: traceIds } }, data: { conceptId: canonicalConceptId } });
        }
        const misconceptionIds = touchedRows.filter((row) => row.table === 'misconception_ledger').map((row) => row.id);
        if (misconceptionIds.length > 0) {
          await this.deps.updateMisconceptionMany({ where: { userId, id: { in: misconceptionIds } }, data: { conceptId: canonicalConceptId } });
        }

        const appliedAt = new Date().toISOString();
        const merge: AppliedConceptAliasMerge = {
          aliasMergeId: buildAliasMergeId(proposal.canonical, appliedAt),
          canonical: proposal.canonical,
          canonicalConceptId,
          aliases,
          touchedRows,
          appliedAt,
          rolledBackAt: null,
        };
        // 凭据与改动同生共死：落不进凭据就当场撤销，绝不留下"改了却没有回滚凭据"的状态
        try {
          await this.recordAliasMerge(userId, merge);
        } catch (recordError) {
          await this.revertAliasMerge(userId, merge).catch(() => undefined);
          throw recordError;
        }
        applied.push(merge);
      } catch (error) {
        logger.warn('[concept-consolidator] 单条 alias 归并失败（跳过，不影响其余）', {
          userId,
          canonical: proposal.canonical,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return applied;
  }

  /** alias 凭据落档（learner_evidence，按次留档、长期可回滚） */
  private async recordAliasMerge(userId: string, merge: AppliedConceptAliasMerge): Promise<void> {
    await this.deps.recordAliasMerge({
      where: { eventId_evidenceKey: { eventId: merge.aliasMergeId, evidenceKey: ALIAS_RECORD_EVIDENCE_KEY } },
      create: {
        id: `lev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        eventId: merge.aliasMergeId,
        evidenceKey: ALIAS_RECORD_EVIDENCE_KEY,
        userId,
        evidenceType: ALIAS_RECORD_EVIDENCE_TYPE,
        payload: JSON.stringify(merge),
        confidence: 1,
        occurredAt: new Date(merge.appliedAt),
      },
      update: { payload: JSON.stringify(merge), occurredAt: new Date(merge.appliedAt) },
    });
  }

  /** 读 alias 凭据（回滚的权威来源） */
  private async listAliasMerges(userId: string): Promise<AppliedConceptAliasMerge[]> {
    const rows = await this.deps.findAliasMerges({
      where: { userId, evidenceType: ALIAS_RECORD_EVIDENCE_TYPE },
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });
    return rows
      .map((row) => {
        try { return JSON.parse(String(row.payload)) as AppliedConceptAliasMerge; } catch { return null; }
      })
      .filter((item): item is AppliedConceptAliasMerge => Boolean(item));
  }

  /** alias 凭据的公开视图（管理端用；与 `listAppliedMerges` 对称） */
  async listAppliedAliasMerges(
    userId: string,
    options: { includeRolledBack?: boolean } = {},
  ): Promise<AppliedConceptAliasMerge[]> {
    const rows = await this.deps.findAliasMerges({
      where: { userId, evidenceType: ALIAS_RECORD_EVIDENCE_TYPE },
      orderBy: { occurredAt: 'asc' },
      select: { payload: true },
    });
    const merges = rows.flatMap((row) => {
      try {
        const parsed = JSON.parse(String(row.payload)) as AppliedConceptAliasMerge;
        return parsed?.aliasMergeId ? [parsed] : [];
      } catch { return []; }
    });
    return options.includeRolledBack ? merges : merges.filter((item) => !item.rolledBackAt);
  }

  /** 撤销一次 alias 归并：还原被改指的行 + 删掉本次登记的别名行 */
  private async revertAliasMerge(userId: string, merge: AppliedConceptAliasMerge): Promise<void> {
    const byTraceConcept = new Map<string, string[]>();
    for (const row of merge.touchedRows) {
      if (row.table !== 'memory_traces') continue;
      const key = row.previousConceptId ?? '\u0000null';
      if (!byTraceConcept.has(key)) byTraceConcept.set(key, []);
      byTraceConcept.get(key)!.push(row.id);
    }
    for (const [key, ids] of byTraceConcept) {
      await this.deps.updateTraceMany({
        where: { id: { in: ids } },
        data: { conceptId: key === '\u0000null' ? null : key },
      });
    }
    const byMisconceptionConcept = new Map<string, string[]>();
    for (const row of merge.touchedRows) {
      if (row.table !== 'misconception_ledger') continue;
      const key = row.previousConceptId ?? '\u0000null';
      if (!byMisconceptionConcept.has(key)) byMisconceptionConcept.set(key, []);
      byMisconceptionConcept.get(key)!.push(row.id);
    }
    for (const [key, ids] of byMisconceptionConcept) {
      await this.deps.updateMisconceptionMany({
        where: { id: { in: ids } },
        data: { conceptId: key === '\u0000null' ? null : key },
      });
    }
    await conceptRegistryService.removeAliases(userId, merge.aliases);
  }

  /**
   * 执行归并（只处理 autoApplicable，除非显式 includeNeedsReview）
   * @deprecated 历史破坏性策略；新执行走 `executeAliasMerges`，本方法仅保留用于回滚旧凭据。
   */
  private async executeMerges(
    userId: string,
    proposals: ConceptMergeProposal[],
    options: { includeNeedsReview?: boolean } = {},
  ): Promise<ConceptConsolidationAudit['appliedMerges']> {
    const applied: ConceptConsolidationAudit['appliedMerges'] = [];
    const executable = proposals.filter((item) => options.includeNeedsReview || item.autoApplicable);
    if (executable.length === 0) return applied;

    for (const proposal of executable) {
      try {
        // 整行抓取：回滚快照要完整（dueAt/FSRS 状态/知识状态 EMA 都要能还原）
        const rows = await this.deps.findTraces({ where: { userId } });
        const plan = planMerge(rows as TraceRow[], proposal.canonical, proposal.aliases);
        if (!plan) continue;

        await this.deps.updateTrace({ where: { id: plan.winnerId }, data: plan.mergedFields });
        if (plan.deletedRows.length > 0) {
          await this.deps.deleteTraces({ where: { id: { in: plan.deletedRows.map((row) => row.id) } } });
        }
        const appliedAt = new Date().toISOString();
        const merge: AppliedConceptMerge = {
          mergeId: buildMergeId(plan.canonical, plan.winnerId, appliedAt),
          canonical: plan.canonical,
          aliases: plan.aliases,
          winnerId: plan.winnerId,
          mergedFields: plan.mergedFields,
          winnerBefore: plan.winnerBefore,
          deletedRows: plan.deletedRows,
          appliedAt,
          rolledBackAt: null,
        };
        try {
          // 凭据与改动"同生共死"：落不进凭据就当场把这次改动撤销，
          // 绝不留下"改了数据却没有回滚凭据"的状态（那等于不可回滚）。
          await this.recordMerge(userId, merge);
        } catch (recordError) {
          await this.revertMerge(merge).catch(() => undefined);
          throw recordError;
        }
        applied.push(merge);
      } catch (error) {
        logger.warn('[concept-consolidator] 单条归并执行失败（跳过，不影响其余）', {
          userId,
          canonical: proposal.canonical,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return applied;
  }

  /** 后台触发（与 learner-state-review 同源：lesson/task/review 完成时） */
  refreshInBackground(userId: string): void {
    const pending = this.inflight.get(userId);
    if (pending) return;
    const task = this.consolidate(userId, { mode: 'observe' })
      .catch((error: any) => {
        logger.warn('[concept-consolidator] background run failed', { userId, error: error?.message || String(error) });
        return null;
      })
      .finally(() => {
        if (this.inflight.get(userId) === task) this.inflight.delete(userId);
      });
    this.inflight.set(userId, task);
    runBackgroundTask('concept-consolidator.observe', () => task, { userId });
  }
}

export const conceptConsolidatorService = new ConceptConsolidatorService();
export { ConceptConsolidatorService };
export default conceptConsolidatorService;
