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
 * 分两档：P1 观察（默认，只记录建议、一个字节都不动）；P2 执行（需要显式开关）。
 *
 * 词面闸门（P2-24 修复，2026-10-06 审计）：yaml rule 7 声明「字面高度接近才给 merges」——
 * 该闸门现在在 `validateConsolidation` 里**决定 merges 成员资格**（词面远距的猜测降级进
 * ambiguous，不再以 confidence>0.8 混进可执行建议）。因此进入 `proposals` 的都是词面已过的，
 * `autoApplicable` 恒为 true；需人工确认的语义远距项不再出现在 proposals，`applyProposals`
 * 也就无法对其执行。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * outlet（出口，2026-10-07 用户拍板）：「建议 → 人工确认 → 代码执行」的后半环接线。
 * 背景：851 次 LLM 调用、378 条建议（231 autoApplicable）、0 次执行——只建议不执行，
 * 碎片只进不出。本批补三件事：
 *
 * 1) **apply 引擎（事务化）**：`applyKeyMerge(userId, fromKey, toKey)` /
 *    `applyKeyDrop(userId, key)` 在**单个数据库事务**里完成全部 (userId, conceptKey)
 *    键控表面的迁移（盘点与每表语义见 `KEY_MERGE_SURFACE_DOC`），写
 *    `concept:merge:applied` / `concept:drop:applied` 按次凭据（evidenceKey 带目标键、
 *    eventId 为确定性哈希 → 重复 apply 同一对直接返回已执行，防重放），
 *    执行前整行快照同时入 `concept-merge-audits-v1` 审计（mode=apply）与凭据。
 *
 * 2) **双档**：`classifyProposals` 把建议分成 auto / review 两档——
 *    高置信自动档 = `autoApplicable` 且名称完全同形（`conceptFormKey` 归一后相等）→
 *    预闸门里**自动执行**，不等人工；其余（近形/语义近义）进人审队列，
 *    经 admin API（GET candidates / POST apply 确认名单 / POST reject）逐批执行。
 *
 * 3) **预闸门**：LLM observe 触发前先跑确定性归并（纯字形差异：空白/大小写/全半角/
 *    引号/冒号从句），归并后仍有同形残余（= 归并执行失败）→ 本轮**不调 LLM**。
 *    确定性残余不需要也不应该花 LLM 调用。
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
  /** outlet apply 引擎：key 级散键清理的执行记录（mode=apply 时追加；可选=兼容旧 payload） */
  appliedDrops?: AppliedKeyDrop[];
  /** 人审驳回留痕（R7）：驳回的建议/对/散键不再重复给出（观察轮由 validateConsolidation 抑制） */
  rejected?: RejectedConsolidationItem[];
  stats: {
    candidates: number;
    proposed: number;
    autoApplicable: number;
    applied: number;
    deleted: number;
    /** alias 策略：登记别名数 / 回填行数 */
    aliasesRegistered?: number;
    rowsRepointed?: number;
    /** outlet apply 引擎：key 级清理的散键数 / 人审驳回数（可选=兼容旧 payload） */
    dropped?: number;
    rejected?: number;
  };
}

/** 人审驳回的留痕条目（R7 reject）：kind 区分三组建议，主键各自携带 */
export interface RejectedConsolidationItem {
  kind: 'merge-proposal' | 'ambiguous-pair' | 'drop';
  /** merge-proposal：被驳回的规范键 */
  canonical?: string;
  aliases?: string[];
  /** ambiguous-pair：被驳回的对（a ← b） */
  a?: string;
  b?: string;
  /** drop：被驳回的散键 */
  conceptKey?: string;
  reason?: string;
  rejectedAt: string;
}

/** 一次 key 级散键清理（applyKeyDrop）的按次凭据：被删痕迹/误解行整行快照，可回滚重建 */
export interface AppliedKeyDrop {
  dropId: string;
  /** parseMergeRecord 兼容：canonical = 被清理的键（回滚按 canonical 匹配） */
  canonical: string;
  conceptKey: string;
  reason: string;
  /** 被删 memory_traces 行整行快照（与 merge 凭据同字段名，回滚路径统一） */
  deletedRows: Array<Record<string, unknown>>;
  deletedMisconceptions: Array<Record<string, unknown>>;
  /** 信念投影改写的还原点（整行快照） */
  beliefEdits?: Array<{ projectionKey: string; previousRow: Record<string, unknown> }>;
  appliedAt: string;
  rolledBackAt?: string | null;
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

/**
 * outlet apply 引擎的凭据类型：key 级归并（applyKeyMerge）与散键清理（applyKeyDrop）。
 * 凭据仍然落在 `learner_evidence`（与 legacy merge 凭据同表），但 **evidenceKey 带目标键**
 * （`concept-merge:<toKey>` / `concept-drop:<key>`），eventId 为确定性哈希——
 * @@unique([eventId, evidenceKey]) 就是防重放的幂等闸。
 */
export const KEY_MERGE_EVIDENCE_TYPE = 'concept:merge:applied';
export const KEY_DROP_EVIDENCE_TYPE = 'concept:drop:applied';

/**
 * ── 合并面盘点（A：每表合并语义，任务书拍板 2026-10-07）────────────────────────
 * 所有按 (userId, conceptKey)（或其等价形式）键控、需要在 apply 事务里迁移的表面：
 *
 * | 表 / 投影                          | 键                                        | 写入点 | 合并语义（fromKey → toKey） |
 * |------------------------------------|-------------------------------------------|--------|------------------------------|
 * | `memory_traces`                    | @@unique([userId, conceptKey])            | memory-trace.service.recordExtraction(upsert)、ReviewCompletedConsumer(upsert) | 双行并一行（目标=toKey 行）：**masteryScore 取证据更强一方**（extractionCount 多者→mastery 高者→lastSeenAt 新者，全序确定性）；**extractionCount 求和**（两键是同一概念被拆开计数，都是真实提取——与 legacy 破坏性 merge 的取 max 不同口径，legacy 仅用于回滚旧凭据）；lastSeenAt 取最新；**dueAt 重排取最早**（宁可早捞不可漏捞）；**FSRS 四元组（stability/difficulty/lapses/reps）取 stability 大者整组**（调度状态不可拆分携带）；ktMasteryEma 按观测数加权；label/source/pathId 保留目标行原文（**stability 随 masteryScore 取证据更强一方**，与 buildKeyMergeFields 注释同口径）。仅 fromKey 有行 → 原行改名 conceptKey=toKey；仅 toKey 有行 → 无事可迁移 |
 * | `learner_evidence`                 | evidenceKey=`review:result:<conceptKey>`（唯一含概念键的 family，ReviewCompletedConsumer 写入）；@@unique([eventId, evidenceKey]) | ReviewCompletedConsumer（复习观测） | **保留双方、不删任何证据行**：fromKey 行 evidenceKey 归到 `review:result:<toKey>`，payload.conceptKey 同步改写（证据行归属变更后自洽）；同 eventId 已有 toKey 行（唯一约束冲突）→ 该行跳过不改（toKey 行已代表该事件，信息不丢） |
 * | `misconception_ledger`             | @@unique([userId, conceptKey, hypothesisHash]) | misconception-ledger.service | 改指：conceptKey → toKey（conceptId 显式置为目标行 conceptId，没有则置 null 待重解析）；同 hypothesisHash 已有 toKey 行 → **并入目标行**（occurrenceCount 累加、firstSeenAt 取早、lastSeenAt 取新、status 取更重（suspected<confirmed<addressed）、confidence 取大）后删除 fromKey 行 |
 * | `learner_projections`(scope=beliefs) | projectionKey=`learner-concept-beliefs-v1:userId:pathId`，payload.beliefs 按概念键分条 | concept-belief.service | beliefs[fromKey] 并入 beliefs[toKey]：pKnowL 按观测数加权、observations 求和、lastObservedAt 取新、tier 取非空；fromKey 条目移除 |
 * | `learner_projections`（快照族）     | projectionKey=`learner-snapshot-v1:…` 等，payload 内嵌概念键字符串 | LearnerSnapshotRefreshService 等 | **不改写、不删除**——快照是从源事实派生的缓存，随既有重建节奏吸收合并结果（与其它 memory_traces 写入不失效快照同一口径）；测试钉住合并不触碰非 beliefs 投影 |
 * | `concepts` / `concept_aliases`     | @@unique([userId, canonicalLabel]) / @@unique([userId, aliasNorm]) | concept-registry.service | 事务提交后 best-effort 登记别名 fromKey→toKey 的 canonical 身份（防立即再碎片化）；失败仅告警不回滚（再碎片化会被预闸门兜住，不丢数据） |
 *
 * kcid 域负责读取侧（conceptId 优先、空则回落 conceptKey）；本域只动写路径与合并。
 */

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

export function parseMergeRecord(payload: string | null | undefined): (AppliedConceptMerge & { extras?: Record<string, unknown> }) | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || !parsed.mergeId || !parsed.canonical) return null;
    // outlet：凭据 payload 里的引擎扩展字段（evidence/misconception/beliefs 的回滚凭据、
    // drop 标记 kind）原样挂在 extras 上——回滚路径要还原这些表的迁移痕迹。
    const known = new Set([
      'mergeId', 'canonical', 'aliases', 'winnerId', 'mergedFields', 'winnerBefore',
      'deletedRows', 'appliedAt', 'rolledBackAt',
    ]);
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!known.has(key)) extras[key] = value;
    }
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
      extras: Object.keys(extras).length > 0 ? extras : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * outlet apply 引擎的事务面（B）：一次 apply 的全部表迁移 + 凭据 + 审计快照
 * 必须发生在**同一个数据库事务**里（要么全成、要么全不动）。
 * 缺省实现把交互式事务 client（prisma.$transaction 的回调参数）绑定成这套操作。
 */
export interface ConsolidationTx {
  findTraces: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  updateTrace: (args: Record<string, unknown>) => Promise<unknown>;
  deleteTraces: (args: Record<string, unknown>) => Promise<unknown>;
  findEvidence: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  updateEvidence: (args: Record<string, unknown>) => Promise<unknown>;
  findMisconceptionRows: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  updateMisconceptionMany: (args: Record<string, unknown>) => Promise<unknown>;
  deleteMisconceptionRows: (args: Record<string, unknown>) => Promise<unknown>;
  /** scope='beliefs' 的信念投影（payload.beliefs 按概念键分条） */
  findBeliefProjections: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  writeProjection: (args: Record<string, unknown>) => Promise<unknown>;
  readAudit: (projectionKey: string) => Promise<{ payload: string } | null>;
  writeAudit: (args: Record<string, unknown>) => Promise<unknown>;
  /** 幂等凭据：先查（重放检测）后 create（@@unique([eventId, evidenceKey]) 兜并发） */
  findEvidenceCredential: (args: Record<string, unknown>) => Promise<Record<string, any> | null>;
  createEvidence: (args: Record<string, unknown>) => Promise<unknown>;
}

export type RunTransaction = <T>(work: (tx: ConsolidationTx) => Promise<T>) => Promise<T>;

/** 把 prisma 交互式事务 client 绑定成 ConsolidationTx（缺省实现） */
function consolidationTxFrom(client: any): ConsolidationTx {
  return {
    findTraces: (args) => client.memory_traces.findMany(args),
    updateTrace: (args) => client.memory_traces.update(args),
    deleteTraces: (args) => client.memory_traces.deleteMany(args),
    findEvidence: (args) => client.learner_evidence.findMany(args),
    updateEvidence: (args) => client.learner_evidence.update(args),
    findMisconceptionRows: (args) => client.misconception_ledger.findMany(args),
    updateMisconceptionMany: (args) => client.misconception_ledger.updateMany(args),
    deleteMisconceptionRows: (args) => client.misconception_ledger.deleteMany(args),
    findBeliefProjections: (args) => client.learner_projections.findMany(args),
    writeProjection: (args) => client.learner_projections.upsert(args),
    readAudit: (projectionKey) => client.learner_projections.findUnique({ where: { projectionKey }, select: { payload: true } }),
    writeAudit: (args) => client.learner_projections.upsert(args),
    findEvidenceCredential: (args) => client.learner_evidence.findFirst(args),
    createEvidence: (args) => client.learner_evidence.create(args),
  };
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
  /** outlet(B)：apply 引擎的事务执行器；缺省 = prisma.$transaction 交互式事务 */
  runTransaction?: RunTransaction;
  /** outlet：回滚 key 级迁移时的补充还原点（证据改指还原 / 误解行重建 / 信念投影还原） */
  updateEvidence?: (args: Record<string, unknown>) => Promise<unknown>;
  createMisconceptionRows?: (args: Record<string, unknown>) => Promise<unknown>;
  writeProjection?: (args: Record<string, unknown>) => Promise<unknown>;
  /** outlet：evidence 凭据 upsert（散键清理凭据的 rolledBackAt 标记走独立 evidenceKey） */
  upsertEvidenceRecord?: (args: Record<string, unknown>) => Promise<unknown>;
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
  runTransaction: (<T>(work: (tx: ConsolidationTx) => Promise<T>) =>
    prisma.$transaction((client: any) => work(consolidationTxFrom(client))) as Promise<T>) as RunTransaction,
  updateEvidence: (args) => prisma.learner_evidence.update(args as any) as any,
  createMisconceptionRows: (args) => prisma.misconception_ledger.createMany(args as any) as any,
  writeProjection: (args) => prisma.learner_projections.upsert(args as any) as any,
  upsertEvidenceRecord: (args) => prisma.learner_evidence.upsert(args as any) as any,
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
 * 确定性同形键（outlet 双档/预闸门的「同形」判定，2026-10-07 拍板口径）：
 * `normalizeConceptKey`（写路径机械归一：空白压缩/去引号/去冒号从句/去尾标点）
 * 之后再吃掉**纯字形差异**——大小写、全半角、剩余空白。与 normalizeConceptKey 的分工：
 * 后者是写路径归一（保守，语义字符一个不动）；本函数只回答「这两行是不是同一个词的
 * 两种写法」，判定更宽但仍不碰语义字符（内部顿号/加减号等语义差异不归并，留给 LLM 建议与人审）。
 */
export function conceptFormKey(raw: unknown): string {
  return normalizeConceptKey(raw)
    .toLowerCase()
    // 全角 ASCII 区（！＂＃…ａｚ０９（）等）折回半角；全角空格由下方 \s 吸收
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '');
}

export interface SameFormGroup {
  /** 同形族键（conceptFormKey） */
  family: string;
  /** 族内互不相同的原始键（≥2 = 确定性残余） */
  variants: string[];
  /** 供确定性胜出者选择用的证据量（每变体：出现次数 + 最近出现） */
  members: Array<{ conceptKey: string; occurrences: number; lastSeenAt: string | null }>;
}

/**
 * 找出同形残余：conceptFormKey 相同、原始键却不同的候选组。
 * 预闸门（D）据此在 LLM observe 之前做确定性归并——残余清零才允许调 LLM。
 */
export function findSameFormGroups(candidates: Array<Pick<ConceptCandidate, 'conceptKey' | 'occurrences' | 'lastSeenAt'>>): SameFormGroup[] {
  const byFamily = new Map<string, SameFormGroup>();
  for (const item of candidates) {
    const key = String(item.conceptKey || '').trim();
    if (!key) continue;
    const family = conceptFormKey(key);
    if (!family) continue;
    const group = byFamily.get(family) ?? { family, variants: [], members: [] };
    if (!group.variants.includes(key)) {
      group.variants.push(key);
      group.members.push({ conceptKey: key, occurrences: Number(item.occurrences || 0), lastSeenAt: item.lastSeenAt ?? null });
    }
    byFamily.set(family, group);
  }
  return Array.from(byFamily.values()).filter((group) => group.variants.length > 1);
}

/**
 * 确定性胜出者（同形族里哪个原始键活下来）：提取次数多者 → 最近出现者 → 更短者
 * （更接近 normalizeConceptKey 的主干形式）→ 字典序。全序、可重放、不依赖 LLM。
 */
export function pickDeterministicWinner(group: SameFormGroup): string {
  return group.members.slice().sort((a, b) => {
    const byCount = b.occurrences - a.occurrences;
    if (byCount !== 0) return byCount;
    const byRecency = new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime();
    if (byRecency !== 0) return byRecency;
    if (a.conceptKey.length !== b.conceptKey.length) return a.conceptKey.length - b.conceptKey.length;
    return a.conceptKey.localeCompare(b.conceptKey);
  })[0].conceptKey;
}

export type ProposalTrack = 'auto' | 'review';

/**
 * 双档分类（C，任务书拍板）：高置信自动档 = proposal.autoApplicable 且名称完全同形
 * （conceptFormKey 归一后相等）→ 自动执行，不等人工；其余（近形/语义近义，需人判断）
 * 一律进人审队列。ambiguous/dropCandidates 恒为人审项（它们本来就是 LLM 拿不准的）。
 */
export function classifyProposals(proposals: ConceptMergeProposal[]): Array<ConceptMergeProposal & { track: ProposalTrack }> {
  return (proposals ?? []).map((proposal) => {
    const sameForm = (proposal.aliases ?? []).length > 0
      && (proposal.aliases ?? []).every((alias) =>
        conceptFormKey(alias) === conceptFormKey(proposal.canonical));
    return { ...proposal, track: (proposal.autoApplicable && sameForm ? 'auto' : 'review') as ProposalTrack };
  });
}

function strongerEvidenceRow(a: TraceRow, b: TraceRow): TraceRow {
  // 证据强度全序（确定性）：提取次数多者 → masteryScore 高者 → lastSeenAt 新者
  const countA = Number(a.extractionCount || 0);
  const countB = Number(b.extractionCount || 0);
  if (countA !== countB) return countA > countB ? a : b;
  const masteryA = Number(a.masteryScore || 0);
  const masteryB = Number(b.masteryScore || 0);
  if (masteryA !== masteryB) return masteryA > masteryB ? a : b;
  return new Date(a.lastSeenAt || 0).getTime() >= new Date(b.lastSeenAt || 0).getTime() ? a : b;
}

function fsrsQuadOwner(fromRow: TraceRow, toRow: TraceRow): TraceRow | null {
  // FSRS 四元组同生同灭（lapses/reps 是 stability 的判据，不能与 stability 分家——见 buildMergedFields）
  const fromS = Number(fromRow.fsrsStability);
  const toS = Number(toRow.fsrsStability);
  const fromOk = Number.isFinite(fromS);
  const toOk = Number.isFinite(toS);
  if (!fromOk && !toOk) return null;
  if (!fromOk) return toRow;
  if (!toOk) return fromRow;
  return fromS > toS ? fromRow : toRow;
}

/**
 * key 级归并的字段语义（A：memory_traces 双行并一行，任务书拍板 2026-10-07，见 KEY_MERGE_SURFACE_DOC）：
 * - masteryScore / stability 取**证据更强一方**（与 mastery 同侧，label 语义不倒退）；
 * - extractionCount **求和**（两键是同一概念被拆开计数，都是真实提取；
 *   注意与 legacy `buildMergedFields` 的取 max 不同——那条口径只服务旧破坏性 merge 的回滚）；
 * - lastSeenAt 取最新；**dueAt 重排取最早**（宁可早捞，不可漏捞）；
 * - FSRS 四元组取 **stability 大者整组**（stability/difficulty/lapses/reps 不可拆分携带）；
 * - ktMasteryEma 按观测数（extractionCount 作代理）加权；
 * - conceptKey 收敛到目标键；label/source/pathId 保留目标行原文。
 */
export function buildKeyMergeFields(fromRow: TraceRow, toRow: TraceRow, toKey: string): TraceRow {
  const stronger = strongerEvidenceRow(fromRow, toRow);
  const fields: TraceRow = {
    conceptKey: toKey,
    masteryScore: Number(stronger.masteryScore ?? toRow.masteryScore ?? 0),
    stability: stronger.stability ?? toRow.stability ?? 'developing',
    extractionCount: Number(fromRow.extractionCount || 0) + Number(toRow.extractionCount || 0),
    lastSeenAt: maxDateOf([fromRow.lastSeenAt, toRow.lastSeenAt]) ?? toRow.lastSeenAt ?? null,
    dueAt: minDateOf([fromRow.dueAt, toRow.dueAt]) ?? toRow.dueAt ?? null,
  };
  const fsrs = fsrsQuadOwner(fromRow, toRow);
  if (fsrs) {
    fields.fsrsStability = fsrs.fsrsStability;
    fields.fsrsDifficulty = fsrs.fsrsDifficulty ?? null;
    fields.fsrsLapses = fsrs.fsrsLapses ?? null;
    fields.fsrsReps = fsrs.fsrsReps ?? null;
  }
  let ktWeighted = 0;
  let ktWeights = 0;
  for (const member of [fromRow, toRow]) {
    const kt = Number(member.ktMasteryEma);
    if (!Number.isFinite(kt)) continue;
    const weight = Number(member.extractionCount) > 0 ? Number(member.extractionCount) : 1;
    ktWeighted += kt * weight;
    ktWeights += weight;
  }
  if (ktWeights > 0) fields.ktMasteryEma = Math.round((ktWeighted / ktWeights) * 1000) / 1000;
  return fields;
}

/** misconception_ledger.status 的严重度序（并入冲突行时取更重的一档） */
const MISCONCEPTION_STATUS_RANK: Record<string, number> = { suspected: 0, confirmed: 1, addressed: 2 };

/**
 * 信念条目并入（learner_projections scope='beliefs' 的 payload.beliefs）：
 * pKnowL 按观测数加权、observations 求和、lastObservedAt 取新（ISO 字符串序）、tier 取非空。
 */
function mergeBeliefEntries(from: any, to: any): Record<string, unknown> {
  const obsFrom = Number(from?.observations || 0);
  const obsTo = Number(to?.observations || 0);
  const observations = obsFrom + obsTo;
  const pFrom = Number(from?.pKnowL);
  const pTo = Number(to?.pKnowL);
  const pKnowL = observations > 0 && Number.isFinite(pFrom) && Number.isFinite(pTo)
    ? Math.round(((pTo * obsTo + pFrom * obsFrom) / observations) * 1000) / 1000
    : (Number.isFinite(pTo) ? pTo : pFrom);
  const lastFrom = String(from?.lastObservedAt || '');
  const lastTo = String(to?.lastObservedAt || '');
  const tier = to?.tier ?? from?.tier;
  return {
    pKnowL,
    observations,
    lastObservedAt: (lastTo >= lastFrom ? lastTo : lastFrom) || to?.lastObservedAt || from?.lastObservedAt,
    ...(tier ? { tier } : {}),
  };
}

/**
 * 校验模型建议：① canonical/aliases 必须来自候选 ② 把握度闸门 ③ 词面闸门（决定能否自动执行）
 * ④ 已执行 canonical 过滤（P1-17）。
 *
 * - 词面闸门（P2-24 修复）：yaml rule 7 声明「字面高度接近才给 merges」，此前只赋给 autoApplicable、
 *   不决定 merges 成员资格 → 语义远距的猜测凭 confidence>0.8 留在建议里（DB pcl_4f95acb2）。
 *   现在 lexicalSimilarity < MIN_LEXICAL_SIMILARITY 的建议**降级进 ambiguous**（与 confidence 闸门并列），
 *   merges 成员资格与 yaml 声明对齐。
 * - `appliedCanonicals`（P1-17）：上一次已执行（apply）的 canonical，本轮不再重复建议——
 *   服务注释原称「whitelist 已写入 payload 防重复建议」但代码里没有这层过滤，此处补上。
 */
export function validateConsolidation(input: {
  candidates: ConceptCandidate[];
  parsed: { merges?: any[]; ambiguous?: any[]; dropCandidates?: any[] } | null | undefined;
  /** 已执行的 canonical（不再重复建议） */
  appliedCanonicals?: Iterable<string>;
  /** outlet(R7)：人审驳回的 canonical（与已执行同样不再重复建议，理由文案区分） */
  rejectedCanonicals?: Iterable<string>;
  /** outlet(R7 复核)：人审驳回的 ambiguous 对（任一方向同形匹配都算同一对，不再重复给出） */
  rejectedPairs?: Array<{ a: string; b: string }>;
  /** outlet(R7 复核)：已在人审队列的 ambiguous 对——不再重复提出，也不得转正为 auto 建议 */
  pendingAmbiguousPairs?: Array<{ a: string; b: string }>;
  /** outlet(R7)：人审驳回的散键清理（dropCandidates 不再重复给出） */
  rejectedDrops?: Iterable<string>;
}): {
  proposals: ConceptMergeProposal[];
  ambiguous: Array<{ a: string; b: string; reason: string }>;
  dropCandidates: Array<{ conceptKey: string; reason: string }>;
} {
  const known = new Set(input.candidates.map((item) => item.conceptKey));
  const applied = new Set<string>(
    Array.from(input.appliedCanonicals ?? []).map((item) => String(item || '').trim()).filter(Boolean),
  );
  const rejectedKeys = new Set<string>(
    Array.from(input.rejectedCanonicals ?? []).map((item) => String(item || '').trim()).filter(Boolean),
  );
  const rejectedDropKeys = new Set<string>(
    Array.from(input.rejectedDrops ?? []).map((item) => String(item || '').trim()).filter(Boolean),
  );
  const pairKeyOf = (a: string, b: string): string => {
    const fa = conceptFormKey(a);
    const fb = conceptFormKey(b);
    return fa && fb ? (fa < fb ? `${fa}\u0001${fb}` : `${fb}\u0001${fa}`) : '';
  };
  const rejectedPairKeys = new Set<string>(
    (input.rejectedPairs ?? []).map((pair) => pairKeyOf(pair.a, pair.b)).filter(Boolean),
  );
  const queuedPairKeys = new Set<string>(
    (input.pendingAmbiguousPairs ?? []).map((pair) => pairKeyOf(pair.a, pair.b)).filter(Boolean),
  );
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
    // P1-17：已执行的 canonical 不再重复建议（whitelist 过滤的代码落点）
    if (applied.has(canonical)) {
      ambiguous.push({ a: canonical, b: aliases[0], reason: '该规范键已执行过归并，本轮不重复建议' });
      continue;
    }
    // outlet(R7)：人审驳回的 canonical 同样不再重复建议（留痕见 audit.rejected）
    if (rejectedKeys.has(canonical)) {
      ambiguous.push({ a: canonical, b: aliases[0], reason: '该规范键已被人审驳回，本轮不重复建议' });
      continue;
    }
    // outlet(R7 复核)：已在人审队列的对（任一方向同形匹配）不再提出——队列里已有，等人工
    // apply/reject；不滤掉会以 auto 档重新出现并被误当可自动执行项。
    const notQueuedAliases = aliases.filter((alias) => !queuedPairKeys.has(pairKeyOf(canonical, alias)));
    if (notQueuedAliases.length === 0) continue;
    const confidence = typeof raw?.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0;
    const rationale = String(raw?.rationale || '').trim();
    const lexical = notQueuedAliases.reduce((max, alias) => Math.max(max, lexicalSimilarity(canonical, alias)), 0);

    if (confidence < MIN_CONFIDENCE) {
      ambiguous.push({ a: canonical, b: notQueuedAliases[0], reason: `把握度 ${confidence} 低于阈值（${rationale || '未说明'}）` });
      continue;
    }
    // P2-24：词面闸门决定 merges 成员资格（与 yaml rule 7 对齐），不再只影响 autoApplicable
    if (lexical < MIN_LEXICAL_SIMILARITY) {
      ambiguous.push({ a: canonical, b: notQueuedAliases[0], reason: `词面相似度 ${lexical} 低于阈值（语义远距，需人工确认；${rationale || '未说明'}）` });
      continue;
    }
    proposals.push({
      canonical,
      aliases: notQueuedAliases,
      confidence,
      rationale,
      lexicalSimilarity: lexical,
      autoApplicable: true,
    });
  }

  for (const raw of Array.isArray(input.parsed?.ambiguous) ? input.parsed!.ambiguous! : []) {
    const a = String(raw?.a || '').trim();
    const b = String(raw?.b || '').trim();
    if (!a || !b || !known.has(a) || !known.has(b)) continue;
    // outlet(R7 复核)：人审驳回过的对（任一方向同形匹配）不再重复给出——否则 LLM 下轮
    // 再提出同一对会重新进队列，reject 的「不再重复给出」承诺不成立。
    const pairKey = pairKeyOf(a, b);
    if (rejectedPairKeys.has(pairKey)) continue;
    // 已在人审队列的对不再直通映射（previous.ambiguous 已随审计滚动携带，重复入队会膨胀）
    if (queuedPairKeys.has(pairKey)) continue;
    ambiguous.push({ a, b, reason: String(raw?.reason || '').trim() });
  }

  const dropCandidates = (Array.isArray(input.parsed?.dropCandidates) ? input.parsed!.dropCandidates! : [])
    .map((raw: any) => ({ conceptKey: String(raw?.conceptKey || '').trim(), reason: String(raw?.reason || '').trim() }))
    .filter((item: { conceptKey: string }) => item.conceptKey && known.has(item.conceptKey))
    // outlet(R7)：人审驳回过的散键清理不再重复给出
    .filter((item: { conceptKey: string }) => !rejectedDropKeys.has(item.conceptKey));

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
    let candidates = await this.buildProjection(userId);
    if (candidates.length < 2) return null;

    // ── outlet(D) 预闸门：LLM observe 之前先跑确定性归并（2026-10-07 拍板）──
    // 同形残余（空白/大小写/全半角等纯字形差异）与自动档建议（autoApplicable + 完全同形）
    // 都不需要语义判断，也就不需要 LLM——先确定性吃掉，归并后重建候选。
    // 挂人审队列（ambiguous）的同形对被 runPreGate 明确跳过（恒为人审项）。
    const preGate = await this.runPreGate(userId, candidates);
    if (preGate.merged > 0) {
      candidates = await this.buildProjection(userId);
      if (candidates.length < 2) return await this.getAudit(userId);
    }
    // 闸门：归并后仍有**阻断性**同形残余 → 本轮不调 LLM（确定性残余不该花模型调用）。
    // 「阻断性」= 该组的同形对并非全部挂在人审队列——挂队对是「留人工的决定」而非失败残余，
    // 不阻断 observe（否则人工出队前该用户 observe 全部停摆）；预闸门也不会碰它们。
    const residualGroups = findSameFormGroups(candidates).filter((group) =>
      group.variants.some((variant, index) =>
        group.variants.slice(index + 1).some((other) => {
          const fv = conceptFormKey(variant);
          const fo = conceptFormKey(other);
          const pairKey = fv < fo ? `${fv}\u0001${fo}` : `${fo}\u0001${fv}`;
          return !preGate.queuedPairKeys.has(pairKey);
        })));
    if (residualGroups.length > 0) {
      logger.warn('[concept-consolidator] 预闸门：同形残余未清零，本轮不调 LLM', {
        userId,
        residualFamilies: residualGroups.map((group) => group.variants),
      });
      return await this.getAudit(userId);
    }

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

    // 人审驳回留痕（R7）：merge/对类按 canonical 抑制、散键清理按键抑制——不再重复给出。
    // 复核补全：merge-proposal 的别名一并抑制（反向建议——原别名作 canonical——同样不再出现）；
    // ambiguous-pair 的 (a,b) 对整对抑制（任一方向同形匹配）；已在人审队列的对不重复提出。
    const rejected = previous?.rejected ?? [];
    const validated = validateConsolidation({
      candidates,
      parsed,
      // P1-17：上一轮已执行的 canonical 不再重复建议（此前只在注释里声称「防重复」，无代码落点）
      appliedCanonicals: [
        ...(previous?.appliedMerges ?? []).map((item) => item.canonical),
        ...(previous?.appliedAliasMerges ?? []).map((item) => item.canonical),
      ],
      rejectedCanonicals: rejected.flatMap((item) => {
        if (item.kind === 'drop') return [];
        if (item.kind === 'merge-proposal') return [item.canonical ?? '', ...(item.aliases ?? [])];
        return [item.a ?? ''];
      }).filter(Boolean),
      rejectedPairs: rejected
        .filter((item) => item.kind === 'ambiguous-pair')
        .map((item) => ({ a: item.a ?? '', b: item.b ?? '' }))
        .filter((pair) => pair.a && pair.b),
      pendingAmbiguousPairs: (previous?.ambiguous ?? []).map((item) => ({ a: item.a, b: item.b })),
      rejectedDrops: rejected
        .filter((item) => item.kind === 'drop')
        .map((item) => item.conceptKey ?? '')
        .filter(Boolean),
    });
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
      appliedDrops: previous?.appliedDrops ?? [],
      rejected,
      stats: {
        candidates: candidates.length,
        proposed: validated.proposals.length,
        autoApplicable: validated.proposals.filter((item) => item.autoApplicable).length,
        applied: applied.length + appliedAlias.length,
        deleted: applied.reduce((sum, item) => sum + item.deletedRows.length, 0),
        aliasesRegistered: appliedAlias.reduce((sum, item) => sum + item.aliases.length, 0),
        rowsRepointed: appliedAlias.reduce((sum, item) => sum + item.touchedRows.length, 0),
        dropped: previous?.stats?.dropped ?? 0,
        rejected: rejected.length,
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

    // 执行过的规范键：后续建议里不再重复出现。
    // P1-17 修正（2026-10-06 审计）：此前的注释声称「whitelist 已写入 payload 防重复建议」，
    // 但代码里既没有 whitelist 过滤，payload 里的 canonicalWhitelist/aliasMap 也取自
    // previous.proposals（待办建议）而非已执行 canonical——注释与实现不符。实际过滤落在
    // validateConsolidation(appliedCanonicals) 里（见该函数注释与 consolidate 调用点）。
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

  // ───────────────────── outlet：apply 引擎（B，事务化 + 幂等）─────────────────────

  private txRunner(): RunTransaction {
    return this.deps.runTransaction ?? defaultDeps.runTransaction!;
  }

  /** 确定性幂等键：同一对 (userId, fromKey, toKey) 恒等 → 重放探测/唯一约束双保险 */
  private static keyMergeEventId(userId: string, fromKey: string, toKey: string): string {
    return `mgm_${createHash('sha1').update(`${userId}\u0001${fromKey}\u0001${toKey}`).digest('hex').slice(0, 16)}`;
  }

  private static keyDropEventId(userId: string, key: string): string {
    return `mgd_${createHash('sha1').update(`${userId}\u0001${key}`).digest('hex').slice(0, 16)}`;
  }

  private static isUniqueViolation(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /P2002|UNIQUE constraint failed|unique constraint/i.test(message);
  }

  /**
   * key 级归并执行器（outlet B）。事务内完成：
   * memory_traces 双行并一行（语义见 buildKeyMergeFields / KEY_MERGE_SURFACE_DOC）
   * → learner_evidence 证据改指（保留双方）→ misconception_ledger 改指/并入
   * → beliefs 投影条目并入 → 按次凭据（concept:merge:applied，evidenceKey 带目标键）
   * → 审计快照（concept-merge-audits-v1，mode=apply）。全部成功才提交，任一步失败整体回滚。
   *
   * 幂等：eventId 为 (userId, fromKey, toKey) 的确定性哈希，凭据先查后 create，
   * @@unique([eventId, evidenceKey]) 兜住并发重放——重复 apply 同一对直接返回 already_applied。
   */
  async applyKeyMerge(
    userId: string,
    fromKeyRaw: string,
    toKeyRaw: string,
    options: { source?: string } = {},
  ): Promise<{ status: 'applied' | 'already_applied' | 'no_rows' | 'from_key_absent' | 'invalid' | 'error'; applied: boolean; mergeId?: string; error?: string }> {
    const fromKey = String(fromKeyRaw || '').trim();
    const toKey = String(toKeyRaw || '').trim();
    if (!fromKey || !toKey || fromKey === toKey) {
      return { status: 'invalid', applied: false };
    }
    const eventId = ConceptConsolidatorService.keyMergeEventId(userId, fromKey, toKey);
    try {
      const result = await this.txRunner()(async (tx) => {
        // ① 执行前快照：memory_traces 双行整行（回滚凭据），随后迁移
        const rows = await tx.findTraces({ where: { userId, conceptKey: { in: [fromKey, toKey] } } });
        const fromRow = rows.find((row: TraceRow) => String(row.conceptKey) === fromKey);
        const toRow = rows.find((row: TraceRow) => String(row.conceptKey) === toKey);

        // ② 重放检测（幂等闸）：同一对已有**仍生效**（未 rolledBackAt）的凭据且 fromKey 行已不在
        //    → 直接返回已执行（忠实重放：合并后 fromKey 行必然已并掉）。
        //    两类例外**允许重走迁移并覆写凭据**（否则回滚后重新 apply 被永久阻断、残余永久挡 LLM）：
        //    a) 凭据已标记 rolledBackAt——回滚已把数据还原，残余真实存在，重新 apply 是正当出口；
        //    b) 凭据仍在但 fromKey 行复现——数据在凭据之外被还原的失配态，放行自愈
        //       （忠实重放绝不会带着 fromRow 走到迁移，幂等不受影响）。
        const evidenceKey = `${MERGE_RECORD_EVIDENCE_KEY}:${toKey}`;
        const existing = await tx.findEvidenceCredential({
          where: { eventId_evidenceKey: { eventId, evidenceKey } },
          select: { id: true, payload: true },
        });
        const existingRecord = existing?.payload ? parseMergeRecord(existing.payload) : null;
        const credentialLive = !!existingRecord && !existingRecord.rolledBackAt;
        if (existing && credentialLive && !fromRow) {
          return { status: 'already_applied' as const, applied: false, mergeId: existingRecord!.mergeId };
        }
        if (!fromRow && !toRow) return { status: 'no_rows' as const, applied: false };

        const appliedAt = new Date().toISOString();
        let winnerId = '';
        let winnerBefore: TraceRow | null = null;
        let deletedRows: TraceRow[] = [];
        let mergedFields: TraceRow = {};

        if (fromRow && toRow) {
          mergedFields = buildKeyMergeFields(fromRow, toRow, toKey);
          winnerId = String(toRow.id);
          winnerBefore = { ...toRow };
          deletedRows = [{ ...fromRow }];
          await tx.updateTrace({ where: { id: winnerId }, data: mergedFields });
          await tx.deleteTraces({ where: { id: { in: [String(fromRow.id)] } } });
        } else if (fromRow) {
          // 仅 fromKey 有行：原行改名（不删行，保留该行全部历史）
          mergedFields = { conceptKey: toKey };
          winnerId = String(fromRow.id);
          winnerBefore = { ...fromRow };
          await tx.updateTrace({ where: { id: winnerId }, data: mergedFields });
        } else {
          // 仅 toKey 有行：fromKey 行此前已被并掉，无事可迁移（不留凭据）
          return { status: 'from_key_absent' as const, applied: false };
        }

        // ③ 证据改指（learner_evidence 的 review:result: family——唯一含概念键的 evidenceKey 族）：
        //    保留双方、不删任何证据行；同 eventId 已有 toKey 行 → 该行跳过（唯一约束，toKey 行已代表该事件）
        const touchedEvidence: Array<{ id: string; previousEvidenceKey: string; previousPayload: string | null }> = [];
        const evidenceFrom = await tx.findEvidence({
          where: { userId, evidenceKey: `review:result:${fromKey}` },
          select: { id: true, eventId: true, evidenceKey: true, payload: true },
        });
        if (evidenceFrom.length > 0) {
          const targetRows = await tx.findEvidence({
            where: { userId, evidenceKey: `review:result:${toKey}` },
            select: { eventId: true },
          });
          const takenEvents = new Set(targetRows.map((row: Record<string, any>) => String(row.eventId)));
          for (const row of evidenceFrom) {
            if (takenEvents.has(String(row.eventId))) continue;
            // 先快照后写入：回滚凭据必须记录改指**前**的 evidenceKey/payload
            const previousEvidenceKey = String(row.evidenceKey);
            const previousPayload: string | null = (row.payload as string | null) ?? null;
            let nextPayload: string | null = previousPayload;
            try {
              const parsedPayload = JSON.parse(String(row.payload ?? '{}'));
              if (parsedPayload && typeof parsedPayload === 'object' && parsedPayload.conceptKey === fromKey) {
                parsedPayload.conceptKey = toKey;
                nextPayload = JSON.stringify(parsedPayload);
              }
            } catch {
              // payload 不可解析：只归 evidenceKey，payload 原样保留
            }
            touchedEvidence.push({ id: String(row.id), previousEvidenceKey, previousPayload });
            await tx.updateEvidence({
              where: { id: String(row.id) },
              data: { evidenceKey: `review:result:${toKey}`, ...(nextPayload !== null ? { payload: nextPayload } : {}) },
            });
          }
        }

        // ④ 误解台账：无冲突行改指（conceptId 显式落到目标行的 canonical，缺则置 null 待重解析）；
        //    同 hypothesisHash 冲突行并入目标行（次数累加/边界时间/更重状态/更高置信）后删除
        const toConceptId = ((toRow?.conceptId ?? fromRow?.conceptId) as string | null | undefined) ?? null;
        const fromMisconceptions = await tx.findMisconceptionRows({ where: { userId, conceptKey: fromKey } });
        const toMisconceptions = await tx.findMisconceptionRows({ where: { userId, conceptKey: toKey } });
        const toByHash = new Map(toMisconceptions.map((row: Record<string, any>) => [String(row.hypothesisHash), row]));
        const misconceptionMerges: Array<{ targetId: string; fromRowId: string; previous: Record<string, unknown>; deletedRow: TraceRow }> = [];
        const directRepointIds: string[] = [];
        for (const row of fromMisconceptions) {
          const target = toByHash.get(String(row.hypothesisHash));
          if (!target) {
            directRepointIds.push(String(row.id));
            continue;
          }
          // 先快照后写入：回滚凭据必须记录并入**前**的目标行字段与被删行整行
          const previous = {
            occurrenceCount: target.occurrenceCount,
            firstSeenAt: target.firstSeenAt,
            lastSeenAt: target.lastSeenAt,
            status: target.status,
            confidence: target.confidence,
          };
          const deletedRow: TraceRow = { ...row };
          await tx.updateMisconceptionMany({
            where: { id: String(target.id) },
            data: {
              occurrenceCount: { increment: Number(row.occurrenceCount || 0) },
              firstSeenAt: minDateOf([row.firstSeenAt, target.firstSeenAt]) ?? target.firstSeenAt,
              lastSeenAt: maxDateOf([row.lastSeenAt, target.lastSeenAt]) ?? target.lastSeenAt,
              status: (MISCONCEPTION_STATUS_RANK[String(row.status)] ?? 0) > (MISCONCEPTION_STATUS_RANK[String(target.status)] ?? 0)
                ? row.status
                : target.status,
              confidence: Math.max(Number(row.confidence || 0), Number(target.confidence || 0)),
            },
          });
          await tx.deleteMisconceptionRows({ where: { id: String(row.id) } });
          misconceptionMerges.push({
            targetId: String(target.id),
            fromRowId: String(row.id),
            previous,
            deletedRow,
          });
        }
        if (directRepointIds.length > 0) {
          await tx.updateMisconceptionMany({
            where: { id: { in: directRepointIds } },
            data: { conceptKey: toKey, conceptId: toConceptId },
          });
        }

        // ⑤ 信念投影（scope='beliefs'）：beliefs[fromKey] 并入 beliefs[toKey]（观测数加权）后移除 fromKey 条目
        const beliefEdits: Array<{ projectionKey: string; previousRow: Record<string, unknown> }> = [];
        const beliefRows = await tx.findBeliefProjections({ where: { userId, scope: 'beliefs' } });
        for (const row of beliefRows) {
          let payload: any;
          try { payload = JSON.parse(String(row.payload || '{}')); } catch { continue; }
          const beliefs = payload?.beliefs;
          if (!beliefs || typeof beliefs !== 'object' || !beliefs[fromKey]) continue;
          beliefEdits.push({ projectionKey: String(row.projectionKey), previousRow: { ...row } });
          const fromEntry = beliefs[fromKey];
          beliefs[toKey] = beliefs[toKey] ? mergeBeliefEntries(fromEntry, beliefs[toKey]) : fromEntry;
          delete beliefs[fromKey];
          payload.beliefs = beliefs;
          await tx.writeProjection({
            where: { projectionKey: String(row.projectionKey) },
            create: {
              id: String(row.id),
              projectionKey: String(row.projectionKey),
              userId,
              scope: String(row.scope ?? 'beliefs'),
              pathId: (row.pathId as string | null) ?? null,
              version: Number(row.version || 1),
              payload: JSON.stringify(payload),
              generatedAt: new Date(),
            },
            update: { payload: JSON.stringify(payload), version: { increment: 1 }, generatedAt: new Date() },
          });
        }

        // ⑥ 按次凭据（防重放闸）+ 审计快照（mode=apply）——与迁移同事务，要么全成要么全不动。
        //    重执行场景（回滚后重 apply / 失配自愈）：凭据行保留（eventId/evidenceKey/id 不变），覆写 payload
        //    （rolledBackAt 随新凭据归零，重新可回滚）。
        const credential = {
          mergeId: eventId,
          kind: 'key-merge',
          canonical: toKey,
          aliases: [fromKey],
          winnerId,
          mergedFields,
          winnerBefore,
          deletedRows,
          // 回滚凭据（引擎扩展，parseMergeRecord 挂 extras）：证据改指 / 误解并入 / 信念投影改写的还原点
          touchedEvidence,
          misconceptionMerges,
          beliefEdits,
          userId,
          source: options.source ?? 'apply-engine',
          appliedAt,
          rolledBackAt: null,
        };
        if (existing) {
          await tx.updateEvidence({
            where: { id: String(existing.id) },
            data: { payload: JSON.stringify(credential), occurredAt: new Date(appliedAt) },
          });
        } else {
          await tx.createEvidence({
            data: {
              id: `ev_${eventId}`,
              eventId,
              evidenceKey,
              userId,
              pathId: null,
              taskId: null,
              evidenceType: KEY_MERGE_EVIDENCE_TYPE,
              payload: JSON.stringify(credential),
              confidence: 1,
              occurredAt: new Date(appliedAt),
            },
          });
        }
        await this.appendAppliedToAuditIn(tx, userId, (audit) => ({
          ...audit,
          mode: 'apply',
          generatedAt: appliedAt,
          appliedMerges: [{
            mergeId: eventId,
            canonical: toKey,
            aliases: [fromKey],
            winnerId,
            mergedFields,
            winnerBefore,
            deletedRows,
            appliedAt,
            rolledBackAt: null,
          }, ...audit.appliedMerges].slice(0, 100),
          stats: { ...audit.stats, applied: (audit.stats?.applied ?? 0) + 1 },
        }));
        return { status: 'applied' as const, applied: true, mergeId: eventId };
      });

      // ⑦ 事务提交后 best-effort：登记别名（fromKey → toKey 的 canonical 身份），防同名文本立即再碎片化。
      //    失败不回滚合并（数据已收敛）；即便再碎片化，预闸门会在下次 observe 时确定性兜住。
      if (result.status === 'applied') {
        try {
          const resolved = await this.deps.resolveConcept(userId, toKey, { createIfMissing: true });
          if (resolved) {
            await this.deps.registerAlias({ userId, conceptId: resolved.conceptId, aliasRaw: fromKey, source: 'consolidator' });
          }
        } catch (aliasError) {
          logger.warn('[concept-consolidator] 合并后别名登记失败（合并不回滚）', {
            userId, fromKey, toKey,
            error: aliasError instanceof Error ? aliasError.message : String(aliasError),
          });
        }
      }
      return result;
    } catch (error) {
      // 并发重放：凭据唯一约束冲突 → 事务整体回滚 → 按已执行返回
      if (ConceptConsolidatorService.isUniqueViolation(error)) {
        return { status: 'already_applied', applied: false, mergeId: eventId };
      }
      logger.warn('[concept-consolidator] key 级归并执行失败（事务回滚，未改动数据）', {
        userId, fromKey, toKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 'error', applied: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * key 级散键清理（outlet B）：该键不再该是独立概念（dropCandidates 被人审确认）。
   * 事务内：memory_traces 行删除（整行快照入凭据）→ misconception_ledger 行删除（整行快照）
   * → beliefs 条目移除 → concept:drop:applied 凭据（evidenceKey 带该键）→ 审计 appliedDrops。
   * **learner_evidence 证据行保留**——复习观测真实发生过，不因概念清理而灭失。
   * 幂等：eventId=(userId,key) 确定性哈希，重复 drop 直接返回 already_applied。
   */
  async applyKeyDrop(
    userId: string,
    keyRaw: string,
    options: { reason?: string } = {},
  ): Promise<{ status: 'applied' | 'already_applied' | 'no_rows' | 'invalid' | 'error'; applied: boolean; dropId?: string; error?: string }> {
    const key = String(keyRaw || '').trim();
    if (!key) return { status: 'invalid', applied: false };
    const eventId = ConceptConsolidatorService.keyDropEventId(userId, key);
    const evidenceKey = `concept-drop:${key}`;
    try {
      return await this.txRunner()(async (tx) => {
        const appliedAt = new Date().toISOString();
        const traceRows = await tx.findTraces({ where: { userId, conceptKey: key } });
        const misconRows = await tx.findMisconceptionRows({ where: { userId, conceptKey: key } });
        // 幂等闸：仍生效凭据且行已清空 → 已执行（忠实重放）。两类例外允许重走清理并覆写凭据：
        // a) 凭据已 rolledBackAt（回滚已把行重建，残余真实存在，重新 drop 是正当出口）；
        // b) 凭据仍在但行复现（失配态自愈；忠实重放行必然已清空）。
        const existing = await tx.findEvidenceCredential({
          where: { eventId_evidenceKey: { eventId, evidenceKey } },
          select: { id: true, payload: true },
        });
        const existingRecord = existing?.payload ? parseMergeRecord(existing.payload) : null;
        const credentialLive = !!existingRecord && !existingRecord.rolledBackAt;
        if (existing && credentialLive && traceRows.length === 0 && misconRows.length === 0) {
          return { status: 'already_applied' as const, applied: false, dropId: eventId };
        }
        if (traceRows.length === 0 && misconRows.length === 0) {
          return { status: 'no_rows' as const, applied: false };
        }

        const traceIds = traceRows.map((row: Record<string, any>) => String(row.id));
        if (traceIds.length > 0) await tx.deleteTraces({ where: { id: { in: traceIds } } });
        const misconIds = misconRows.map((row: Record<string, any>) => String(row.id));
        if (misconIds.length > 0) await tx.deleteMisconceptionRows({ where: { id: { in: misconIds } } });

        // 信念条目移除（整行快照入凭据，供回滚还原）
        const beliefEdits: Array<{ projectionKey: string; previousRow: Record<string, unknown> }> = [];
        const beliefRows = await tx.findBeliefProjections({ where: { userId, scope: 'beliefs' } });
        for (const row of beliefRows) {
          let payload: any;
          try { payload = JSON.parse(String(row.payload || '{}')); } catch { continue; }
          const beliefs = payload?.beliefs;
          if (!beliefs || typeof beliefs !== 'object' || !beliefs[key]) continue;
          beliefEdits.push({ projectionKey: String(row.projectionKey), previousRow: { ...row } });
          delete beliefs[key];
          payload.beliefs = beliefs;
          await tx.writeProjection({
            where: { projectionKey: String(row.projectionKey) },
            create: {
              id: String(row.id),
              projectionKey: String(row.projectionKey),
              userId,
              scope: String(row.scope ?? 'beliefs'),
              pathId: (row.pathId as string | null) ?? null,
              version: Number(row.version || 1),
              payload: JSON.stringify(payload),
              generatedAt: new Date(),
            },
            update: { payload: JSON.stringify(payload), version: { increment: 1 }, generatedAt: new Date() },
          });
        }

        // 凭据兼容 parseMergeRecord（mergeId+canonical+deletedRows）→ 回滚路径与 merge 凭据统一
        const credential = {
          mergeId: eventId,
          kind: 'drop',
          canonical: key,
          conceptKey: key,
          aliases: [] as string[],
          winnerId: '',
          mergedFields: {},
          winnerBefore: null,
          deletedRows: traceRows,
          deletedMisconceptions: misconRows,
          beliefEdits,
          reason: options.reason ?? '',
          userId,
          appliedAt,
          rolledBackAt: null,
        };
        if (existing) {
          // 重执行（回滚后重 drop / 失配自愈）：凭据行保留，覆写 payload（rolledBackAt 归零）
          await tx.updateEvidence({
            where: { id: String(existing.id) },
            data: { payload: JSON.stringify(credential), occurredAt: new Date(appliedAt) },
          });
        } else {
          await tx.createEvidence({
            data: {
              id: `evd_${eventId}`,
              eventId,
              evidenceKey,
              userId,
              pathId: null,
              taskId: null,
              evidenceType: KEY_DROP_EVIDENCE_TYPE,
              payload: JSON.stringify(credential),
              confidence: 1,
              occurredAt: new Date(appliedAt),
            },
          });
        }
        await this.appendAppliedToAuditIn(tx, userId, (audit) => ({
          ...audit,
          mode: 'apply',
          generatedAt: appliedAt,
          appliedDrops: [{
            dropId: eventId,
            canonical: key,
            conceptKey: key,
            reason: options.reason ?? '',
            deletedRows: traceRows as Array<Record<string, unknown>>,
            deletedMisconceptions: misconRows as Array<Record<string, unknown>>,
            beliefEdits,
            appliedAt,
            rolledBackAt: null,
          }, ...(audit.appliedDrops ?? [])].slice(0, 100),
          stats: { ...audit.stats, dropped: (audit.stats?.dropped ?? 0) + 1 },
        }));
        return { status: 'applied' as const, applied: true, dropId: eventId };
      });
    } catch (error) {
      if (ConceptConsolidatorService.isUniqueViolation(error)) {
        return { status: 'already_applied', applied: false, dropId: eventId };
      }
      logger.warn('[concept-consolidator] 散键清理执行失败（事务回滚，未改动数据）', {
        userId, conceptKey: key,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 'error', applied: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 人审确认执行（outlet C：POST apply 的服务端落点，批量）。
   * 纪律与 applyProposals 一致：只执行审计里真实存在的建议（名单由前端勾选，服务端再校验一次）——
   * proposals 按 canonical 匹配（逐别名成对归并）、ambiguous 按 (a,b) 同形匹配（b 并入 a）、
   * dropCandidates 按 conceptKey 匹配。名单之外的项一律 skipped，绝不顺手动其它数据。
   */
  async applyConfirmed(
    userId: string,
    items: { canonicals?: string[]; ambiguous?: Array<{ a: string; b: string }>; drops?: string[] } = {},
  ): Promise<{
    applied: number;
    skipped: string[];
    merges: Array<{ fromKey: string; toKey: string; status: string; applied: boolean }>;
    drops: Array<{ conceptKey: string; status: string; applied: boolean }>;
    audit: ConceptConsolidationAudit | null;
  }> {
    const audit = await this.getAudit(userId);
    const skipped: string[] = [];
    const pairs: Array<{ fromKey: string; toKey: string }> = [];
    const dropKeys: Array<{ conceptKey: string; reason: string }> = [];

    for (const canonical of (items.canonicals ?? []).map((item) => String(item || '').trim()).filter(Boolean)) {
      const proposal = (audit?.proposals ?? []).find((item) => item.canonical === canonical);
      if (!proposal) {
        skipped.push(canonical);
        continue;
      }
      for (const alias of proposal.aliases) pairs.push({ fromKey: alias, toKey: proposal.canonical });
    }
    for (const pair of (items.ambiguous ?? [])
      .map((item) => ({ a: String(item?.a || '').trim(), b: String(item?.b || '').trim() }))
      .filter((item) => item.a && item.b)) {
      const match = (audit?.ambiguous ?? []).find((item) =>
        conceptFormKey(item.a) === conceptFormKey(pair.a) && conceptFormKey(item.b) === conceptFormKey(pair.b));
      if (!match) {
        skipped.push(`${pair.b} → ${pair.a}`);
        continue;
      }
      // ambiguous 语义：a 是更规范的写法（目标键），b 并入 a
      pairs.push({ fromKey: pair.b, toKey: pair.a });
    }
    for (const key of (items.drops ?? []).map((item) => String(item || '').trim()).filter(Boolean)) {
      const match = (audit?.dropCandidates ?? []).find((item) => item.conceptKey === key);
      if (!match) {
        skipped.push(key);
        continue;
      }
      dropKeys.push({ conceptKey: key, reason: match.reason });
    }

    const merges: Array<{ fromKey: string; toKey: string; status: string; applied: boolean }> = [];
    const drops: Array<{ conceptKey: string; status: string; applied: boolean }> = [];
    const terminal = new Set(['applied', 'already_applied', 'from_key_absent', 'no_rows']);
    let applied = 0;
    for (const pair of pairs) {
      const result = await this.applyKeyMerge(userId, pair.fromKey, pair.toKey, { source: 'admin-confirm' });
      merges.push({ ...pair, status: result.status, applied: result.applied });
      if (result.applied) applied += 1;
    }
    for (const drop of dropKeys) {
      const result = await this.applyKeyDrop(userId, drop.conceptKey, { reason: drop.reason });
      drops.push({ conceptKey: drop.conceptKey, status: result.status, applied: result.applied });
      if (result.applied) applied += 1;
    }

    // 从待办清单移除已到终态的建议/对/散键（部分完成的建议只移除完成的别名）
    const latest = await this.getAudit(userId);
    if (latest && (merges.length > 0 || drops.length > 0)) {
      const donePairs = new Set(merges.filter((item) => terminal.has(item.status)).map((item) => `${item.fromKey}\u0001${item.toKey}`));
      const doneDrops = new Set(drops.filter((item) => terminal.has(item.status)).map((item) => item.conceptKey));
      const proposals = latest.proposals
        .map((proposal) => ({
          ...proposal,
          aliases: proposal.aliases.filter((alias) => !donePairs.has(`${alias}\u0001${proposal.canonical}`)),
        }))
        .filter((proposal) => proposal.aliases.length > 0);
      const ambiguous = latest.ambiguous.filter((item) =>
        !donePairs.has(`${item.b}\u0001${item.a}`));
      const dropCandidates = latest.dropCandidates.filter((item) => !doneDrops.has(item.conceptKey));
      const next: ConceptConsolidationAudit = { ...latest, generatedAt: new Date().toISOString(), proposals, ambiguous, dropCandidates };
      await this.writeAudit(userId, next);
      return { applied, skipped, merges, drops, audit: next };
    }
    return { applied, skipped, merges, drops, audit: latest };
  }

  /**
   * 人审驳回（outlet C：POST reject 的服务端落点）。
   * 驳回 = 留痕（audit.rejected）+ 移出待办 + 下轮 observe 不再重复建议
   * （validateConsolidation 的 rejectedCanonicals / rejectedDrops 抑制）。
   */
  async rejectProposals(
    userId: string,
    items: { canonicals?: string[]; ambiguous?: Array<{ a: string; b: string }>; drops?: string[] } = {},
  ): Promise<{ rejected: number; skipped: string[]; audit: ConceptConsolidationAudit | null }> {
    const audit = await this.getAudit(userId);
    const skipped: string[] = [];
    if (!audit) {
      return { rejected: 0, skipped: [
        ...(items.canonicals ?? []), ...(items.drops ?? []),
        ...(items.ambiguous ?? []).map((item) => `${item?.b} → ${item?.a}`),
      ].filter(Boolean), audit: null };
    }
    const rejectedAt = new Date().toISOString();
    const records: RejectedConsolidationItem[] = [];
    for (const canonical of (items.canonicals ?? []).map((item) => String(item || '').trim()).filter(Boolean)) {
      const proposal = audit.proposals.find((item) => item.canonical === canonical);
      if (!proposal) {
        skipped.push(canonical);
        continue;
      }
      records.push({ kind: 'merge-proposal', canonical, aliases: proposal.aliases, rejectedAt });
    }
    for (const pair of (items.ambiguous ?? [])
      .map((item) => ({ a: String(item?.a || '').trim(), b: String(item?.b || '').trim() }))
      .filter((item) => item.a && item.b)) {
      const match = audit.ambiguous.find((item) =>
        conceptFormKey(item.a) === conceptFormKey(pair.a) && conceptFormKey(item.b) === conceptFormKey(pair.b));
      if (!match) {
        skipped.push(`${pair.b} → ${pair.a}`);
        continue;
      }
      records.push({ kind: 'ambiguous-pair', a: match.a, b: match.b, rejectedAt });
    }
    for (const key of (items.drops ?? []).map((item) => String(item || '').trim()).filter(Boolean)) {
      const match = audit.dropCandidates.find((item) => item.conceptKey === key);
      if (!match) {
        skipped.push(key);
        continue;
      }
      records.push({ kind: 'drop', conceptKey: key, reason: match.reason, rejectedAt });
    }
    if (records.length === 0) return { rejected: 0, skipped, audit };

    const next: ConceptConsolidationAudit = {
      ...audit,
      generatedAt: new Date().toISOString(),
      proposals: audit.proposals.filter((proposal) =>
        !records.some((record) => record.kind === 'merge-proposal' && record.canonical === proposal.canonical)),
      ambiguous: audit.ambiguous.filter((item) =>
        !records.some((record) =>
          record.kind === 'ambiguous-pair'
          && conceptFormKey(record.a ?? '') === conceptFormKey(item.a)
          && conceptFormKey(record.b ?? '') === conceptFormKey(item.b))),
      dropCandidates: audit.dropCandidates.filter((item) =>
        !records.some((record) => record.kind === 'drop' && record.conceptKey === item.conceptKey)),
      rejected: [...records, ...(audit.rejected ?? [])].slice(0, 200),
      stats: { ...audit.stats, rejected: (audit.stats?.rejected ?? 0) + records.length },
    };
    await this.writeAudit(userId, next);
    logger.info('[concept-consolidator] 建议已驳回（留痕 + 移出待办）', { userId, rejected: records.length, skipped: skipped.length });
    return { rejected: records.length, skipped, audit: next };
  }

  /** 候选读取（outlet C：GET candidates 的服务端落点；复用现有 proposal 读取，附双档分类） */
  async listCandidates(userId: string): Promise<{
    generatedAt: string;
    mode: string;
    proposals: Array<ConceptMergeProposal & { track: ProposalTrack }>;
    ambiguous: Array<{ a: string; b: string; reason: string }>;
    dropCandidates: Array<{ conceptKey: string; reason: string }>;
    rejected: RejectedConsolidationItem[];
    stats: ConceptConsolidationAudit['stats'];
  } | null> {
    const audit = await this.getAudit(userId);
    if (!audit) return null;
    return {
      generatedAt: audit.generatedAt,
      mode: audit.mode,
      proposals: classifyProposals(audit.proposals),
      ambiguous: audit.ambiguous,
      dropCandidates: audit.dropCandidates,
      rejected: audit.rejected ?? [],
      stats: audit.stats,
    };
  }

  /** 散键清理凭据视图（与 listAppliedMerges 对称；供 admin 明细与回滚） */
  async listAppliedDrops(
    userId: string,
    options: { includeRolledBack?: boolean } = {},
  ): Promise<AppliedKeyDrop[]> {
    const rows = await this.deps.findMerges({
      where: { userId, evidenceType: KEY_DROP_EVIDENCE_TYPE },
      orderBy: { occurredAt: 'asc' },
      select: { payload: true },
    });
    const drops = rows.flatMap((row: Record<string, any>) => {
      try {
        const parsed = JSON.parse(String(row.payload)) as AppliedKeyDrop;
        return parsed?.dropId ? [parsed] : [];
      } catch { return []; }
    });
    return options.includeRolledBack ? drops : drops.filter((item) => !item.rolledBackAt);
  }

  /**
   * 预闸门（D）：LLM observe 之前的确定性出口。
   * ① 同形残余归并（纯字形差异）：组内收敛到单一键——自动档建议拍板的 canonical 优先，
   *    否则确定性胜出者（pickDeterministicWinner，按证据量定名）；
   * ② 上一轮审计里 autoApplicable + 完全同形的建议自动执行（双档的自动档，不等人工——
   *    与 ① 同一批组，仅胜出者选择不同）。
   * **人审边界（复核修正）**：正挂在人审队列（audit.ambiguous）里的同形对**不进预闸门**——
   * ambiguous 恒为人审项（:499 声明），人工 apply/reject 才出队（applyConfirmed 移出终态对），
   * 预闸门绝不绕过人工确认自动归并挂队中的对。
   * 单条失败只告警不中断：失败留下的同形残余会在 consolidate 里挡住本轮 LLM（见闸门判断；
   * 挂队中的对不算失败残余，不阻断 observe）。只把 `applied` 计入 merged——already_applied
   * 意味着残余未真正清理（复核修正：不得假成功）。
   */
  private async runPreGate(
    userId: string,
    candidates: ConceptCandidate[],
  ): Promise<{ merged: number; autoExecuted: number; queuedPairKeys: Set<string> }> {
    const audit = await this.getAudit(userId).catch(() => null);
    const autoTargets = new Map<string, string>();
    for (const proposal of classifyProposals(audit?.proposals ?? [])) {
      if (proposal.track !== 'auto') continue;
      for (const alias of proposal.aliases) autoTargets.set(alias, proposal.canonical);
    }
    const pairKeyOf = (a: string, b: string): string => {
      const fa = conceptFormKey(a);
      const fb = conceptFormKey(b);
      return fa && fb ? (fa < fb ? `${fa}\u0001${fb}` : `${fb}\u0001${fa}`) : '';
    };
    const queuedPairKeys = new Set<string>(
      (audit?.ambiguous ?? [])
        .map((item) => pairKeyOf(item.a, item.b))
        .filter(Boolean),
    );
    let merged = 0;
    let autoExecuted = 0;
    for (const group of findSameFormGroups(candidates)) {
      const autoCanonical = group.variants
        .map((variant) => autoTargets.get(variant))
        .find((target) => target && group.variants.includes(target));
      const winner = autoCanonical ?? pickDeterministicWinner(group);
      for (const variant of group.variants) {
        if (variant === winner) continue;
        // 该对正挂在人审队列（任一方向同形匹配）→ 跳过，留人工
        if (queuedPairKeys.has(pairKeyOf(variant, winner))) {
          logger.info('[concept-consolidator] 预闸门：同形对在人审队列中，跳过自动归并（留人工）', {
            userId, fromKey: variant, toKey: winner,
          });
          continue;
        }
        const result = await this.applyKeyMerge(userId, variant, winner, { source: autoCanonical ? 'auto-track' : 'pre-gate' });
        if (result.applied) {
          merged += 1;
          if (autoCanonical) autoExecuted += 1;
        } else {
          logger.warn('[concept-consolidator] 预闸门：同形归并未落地（残余将挡住本轮 LLM）', {
            userId, fromKey: variant, toKey: winner, status: result.status, error: result.error,
          });
        }
      }
    }
    return { merged, autoExecuted, queuedPairKeys };
  }

  /** 事务内读审计（apply 引擎用：执行前快照的基准） */
  private async readAuditIn(tx: ConsolidationTx, userId: string): Promise<ConceptConsolidationAudit | null> {
    const raw = await tx.readAudit(consolidationAuditKey(userId));
    if (!raw?.payload) return null;
    try { return JSON.parse(raw.payload) as ConceptConsolidationAudit; } catch { return null; }
  }

  /** 事务内追加执行记录到审计（无审计则建空底稿；mode=apply） */
  private async appendAppliedToAuditIn(
    tx: ConsolidationTx,
    userId: string,
    mutate: (audit: ConceptConsolidationAudit) => ConceptConsolidationAudit,
  ): Promise<void> {
    const current = await this.readAuditIn(tx, userId);
    const base: ConceptConsolidationAudit = current ?? {
      schemaVersion: 'concept-merge-audits-v1',
      generatedAt: new Date().toISOString(),
      mode: 'apply',
      projectionFingerprint: '',
      candidateCount: 0,
      proposals: [],
      ambiguous: [],
      dropCandidates: [],
      appliedMerges: [],
      appliedAliasMerges: [],
      appliedDrops: [],
      rejected: [],
      stats: { candidates: 0, proposed: 0, autoApplicable: 0, applied: 0, deleted: 0 },
    };
    const next = mutate(base);
    const now = new Date();
    await tx.writeAudit({
      where: { projectionKey: consolidationAuditKey(userId) },
      create: {
        id: `ccs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        projectionKey: consolidationAuditKey(userId),
        userId,
        scope: CONSOLIDATION_AUDIT_PROJECTION_SCOPE,
        version: 1,
        payload: JSON.stringify(next),
        generatedAt: now,
      },
      update: {
        version: { increment: 1 },
        payload: JSON.stringify(next),
        generatedAt: now,
      },
    });
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
    // outlet：key 级散键清理凭据（concept:drop:applied）与 merge 凭据同构
    //（deletedRows=被删痕迹行、extras 带误解/信念还原点）→ 并入同一回滚路径
    const durableDropRows = await this.deps.findMerges({
      where: { userId, evidenceType: KEY_DROP_EVIDENCE_TYPE },
      orderBy: { occurredAt: 'asc' },
      select: { payload: true },
    }).catch((error: unknown) => {
      logger.warn('[concept-consolidator] 读取散键清理凭据失败', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [] as Array<Record<string, any>>;
    });
    const durableDropTargets = durableDropRows
      .map((row) => parseMergeRecord(row.payload))
      .filter((item): item is NonNullable<ReturnType<typeof parseMergeRecord>> =>
        !!item && item.extras?.kind === 'drop' && !item.rolledBackAt && wanted.has(item.canonical));
    const dropCoveredIds = new Set(durableDropTargets.map((item) => item.mergeId));
    const blobDropTargets = (audit?.appliedDrops ?? [])
      .filter((item) => wanted.has(item.conceptKey) && !item.rolledBackAt && (!item.dropId || !dropCoveredIds.has(item.dropId)))
      .map((item) => ({
        mergeId: item.dropId,
        canonical: item.conceptKey,
        aliases: [] as string[],
        winnerId: '',
        mergedFields: {},
        winnerBefore: null,
        deletedRows: item.deletedRows,
        appliedAt: item.appliedAt,
        rolledBackAt: item.rolledBackAt ?? null,
        extras: { kind: 'drop', deletedMisconceptions: item.deletedMisconceptions, beliefEdits: item.beliefEdits },
      }));
    const targets: Array<AppliedConceptMerge & { extras?: Record<string, unknown> }> = [
      ...durableTargets, ...durableDropTargets, ...blobTargets,
      ...blobDropTargets as Array<AppliedConceptMerge & { extras?: Record<string, unknown> }>,
    ];

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
        // outlet：还原 key 级迁移的扩展痕迹（证据改指 / 误解并入 / 信念投影改写 / 被删误解行）
        await this.revertKeyMergeExtras(target);
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
      const kind = target.extras?.kind as string | undefined;
      if (kind === 'drop' || kind === 'key-merge') {
        // outlet 引擎凭据：evidenceKey 带键（concept-merge:<toKey> / concept-drop:<key>），
        // 标记必须命中原凭据行（legacy recordMerge 的常量 evidenceKey 命不中，且 id 撞主键）
        const evidenceKey = kind === 'drop' ? `concept-drop:${target.canonical}` : `${MERGE_RECORD_EVIDENCE_KEY}:${target.canonical}`;
        const evidenceType = kind === 'drop' ? KEY_DROP_EVIDENCE_TYPE : KEY_MERGE_EVIDENCE_TYPE;
        const marked = { ...target, rolledBackAt };
        await (this.deps.upsertEvidenceRecord ?? defaultDeps.upsertEvidenceRecord!)({
          where: { eventId_evidenceKey: { eventId: target.mergeId, evidenceKey } },
          create: {
            id: kind === 'drop' ? `evd_${target.mergeId}` : `ev_${target.mergeId}`,
            eventId: target.mergeId,
            evidenceKey,
            userId,
            evidenceType,
            payload: JSON.stringify(marked),
            confidence: 1,
            occurredAt: new Date(target.appliedAt || Date.now()),
          },
          update: { payload: JSON.stringify(marked) },
        }).catch(() => undefined);
      } else {
        await this.recordMerge(userId, { ...target, rolledBackAt }).catch(() => undefined);
      }
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
    const rolledBackDrops = targets.filter((item) => item.extras?.kind === 'drop').length;
    const next: ConceptConsolidationAudit = {
      ...audit,
      generatedAt: new Date().toISOString(),
      appliedMerges: audit.appliedMerges.filter((merge) => !rolledBackCanonicals.has(merge.canonical)),
      appliedAliasMerges: (audit.appliedAliasMerges ?? []).filter((item) => !rolledBackAliasCanonicals.has(item.canonical)),
      appliedDrops: (audit.appliedDrops ?? []).filter((item) => !rolledBackCanonicals.has(item.conceptKey)),
      stats: {
        ...audit.stats,
        applied: Math.max(0, audit.stats.applied - (rolledBack - rolledBackDrops)),
        dropped: Math.max(0, (audit.stats.dropped ?? 0) - rolledBackDrops),
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

  /**
   * 还原 key 级迁移的扩展痕迹（outlet B 的回滚凭据，挂在 parseMergeRecord 的 extras 上）：
   * - 证据改指还原（evidenceKey/payload 回到 fromKey）；
   * - 误解并入还原（目标行回退到并入前字段 + 被删行重建）；
   * - 散键清理的被删误解行重建；
   * - 信念投影整行还原（payload 回到改写前）。
   * merge 凭据的 memory_traces 部分由 revertMerge 负责，本方法只管扩展面。
   */
  private async revertKeyMergeExtras(merge: AppliedConceptMerge & { extras?: Record<string, unknown> }): Promise<void> {
    const extras = merge.extras as {
      kind?: string;
      touchedEvidence?: Array<{ id: string; previousEvidenceKey: string; previousPayload: string | null }>;
      misconceptionMerges?: Array<{ targetId: string; deletedRow: Record<string, unknown>; previous: Record<string, unknown> }>;
      deletedMisconceptions?: Array<Record<string, unknown>>;
      beliefEdits?: Array<{ projectionKey: string; previousRow: Record<string, unknown> }>;
    } | undefined;
    if (!extras) return;
    for (const item of extras.touchedEvidence ?? []) {
      await (this.deps.updateEvidence ?? defaultDeps.updateEvidence!)({
        where: { id: item.id },
        data: { evidenceKey: item.previousEvidenceKey, ...(item.previousPayload !== null && item.previousPayload !== undefined ? { payload: item.previousPayload } : {}) },
      });
    }
    for (const item of extras.misconceptionMerges ?? []) {
      await this.deps.updateMisconceptionMany({ where: { id: item.targetId }, data: item.previous });
      if (item.deletedRow && (item.deletedRow as any).id) {
        await (this.deps.createMisconceptionRows ?? defaultDeps.createMisconceptionRows!)({ data: [item.deletedRow] });
      }
    }
    for (const row of extras.deletedMisconceptions ?? []) {
      if (row && (row as any).id) {
        await (this.deps.createMisconceptionRows ?? defaultDeps.createMisconceptionRows!)({ data: [row] });
      }
    }
    for (const item of extras.beliefEdits ?? []) {
      const previous = item.previousRow as Record<string, any>;
      await (this.deps.writeProjection ?? defaultDeps.writeProjection!)({
        where: { projectionKey: item.projectionKey },
        create: {
          id: String(previous.id ?? `lcb_rb_${Date.now()}`),
          projectionKey: item.projectionKey,
          userId: String(previous.userId ?? ''),
          scope: String(previous.scope ?? 'beliefs'),
          pathId: previous.pathId ?? null,
          version: Number(previous.version || 1),
          payload: String(previous.payload ?? '{}'),
          generatedAt: previous.generatedAt ? new Date(previous.generatedAt as any) : new Date(),
        },
        update: { payload: String(previous.payload ?? '{}'), version: { increment: 1 } },
      });
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
  ): Promise<Array<AppliedConceptMerge & { extras?: Record<string, unknown> }>> {
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
