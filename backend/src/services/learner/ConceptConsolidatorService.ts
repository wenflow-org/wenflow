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
  /** 执行记录（observe 模式恒为空；P2 执行后写入，含回滚所需的删除前快照） */
  appliedMerges: Array<{
    canonical: string;
    aliases: string[];
    winnerId: string;
    deletedIds: string[];
    deletedRows: Array<{ id: string; conceptKey: string; label: string | null; extractionCount: number; masteryScore: number }>;
    appliedAt: string;
  }>;
  stats: {
    candidates: number;
    proposed: number;
    autoApplicable: number;
    applied: number;
    deleted: number;
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
}

const defaultDeps: ConceptConsolidatorDeps = {
  findTraces: (args) => prisma.memory_traces.findMany(args as any) as any,
  updateTrace: (args) => prisma.memory_traces.update(args as any) as any,
  deleteTraces: (args) => prisma.memory_traces.deleteMany(args as any) as any,
  findEvidence: (args) => prisma.learner_evidence.findMany(args as any) as any,
  findPaths: (args) => prisma.learning_paths.findMany(args as any) as any,
  readAudit: (projectionKey) => prisma.learner_projections.findUnique({
    where: { projectionKey },
    select: { payload: true },
  }) as any,
  writeAudit: (args) => prisma.learner_projections.upsert(args as any) as any,
  callSkill: (input) => executeSkillWithResult(auxSkillDefinitionMap['concept-consolidator'], input as any) as any,
};

export function consolidationAuditKey(userId: string): string {
  return `${CONSOLIDATION_AUDIT_KEY_PREFIX}:${userId}`;
}

/** 比较用归一：去空白/引号/标点，压低大小写与常见虚词差异 */
function normalizeForCompare(text: string): string {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[「」『』“”‘’"'（）()【】\[\]]/g, '')
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

export interface MergeExecutionPlan {
  canonical: string;
  aliases: string[];
  winnerId: string;
  /** 被删除的重复行（合并前快照，供回滚） */
  deletedRows: Array<{ id: string; conceptKey: string; label: string | null; extractionCount: number; masteryScore: number }>;
  /** 需要改键的胜出者（其原 key 与规范键不同时） */
  winnerPatch: { conceptKey: string; label?: string } | null;
}

/**
 * 合并执行计划：优先保留「名字已等于规范键」的那条（避免改键撞唯一约束），
 * 否则取 extractionCount 最大 → masteryScore 最高 → lastSeenAt 最新，其余删除。
 */
export function planMerge(
  rows: Array<{ id: string; conceptKey: string; label?: string | null; extractionCount?: number; masteryScore?: number; lastSeenAt?: Date | string | null }>,
  canonical: string,
  aliases: string[],
): MergeExecutionPlan | null {
  const family = new Set([canonical, ...aliases].map((key) => normalizeConceptKey(key)));
  const members = rows.filter((row) => family.has(normalizeConceptKey(row.conceptKey)));
  if (members.length < 2) return null;

  const exact = members.find((row) => row.conceptKey === canonical);
  const winner = exact ?? members.slice().sort((a, b) => {
    const byCount = Number(b.extractionCount || 0) - Number(a.extractionCount || 0);
    if (byCount !== 0) return byCount;
    const byMastery = Number(b.masteryScore || 0) - Number(a.masteryScore || 0);
    if (byMastery !== 0) return byMastery;
    return new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime();
  })[0];

  const deletedRows = members
    .filter((row) => row.id !== winner.id)
    .map((row) => ({
      id: row.id,
      conceptKey: row.conceptKey,
      label: row.label ?? null,
      extractionCount: Number(row.extractionCount || 0),
      masteryScore: Number(row.masteryScore || 0),
    }));

  return {
    canonical,
    aliases,
    winnerId: winner.id,
    deletedRows,
    winnerPatch: winner.conceptKey === canonical
      ? null
      : { conceptKey: canonical, ...(winner.label ? {} : { label: winner.conceptKey }) },
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
    options: { mode?: 'observe' | 'apply'; force?: boolean; includeNeedsReview?: boolean; now?: Date } = {},
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
    const applied = mode === 'apply'
      ? await this.executeMerges(userId, validated.proposals, { includeNeedsReview: options.includeNeedsReview === true })
      : [];

    const appliedKeys = new Set(applied.map((item) => item.canonical));
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
      stats: {
        candidates: candidates.length,
        proposed: validated.proposals.length,
        autoApplicable: validated.proposals.filter((item) => item.autoApplicable).length,
        applied: applied.length,
        deleted: applied.reduce((sum, item) => sum + item.deletedRows.length, 0),
      },
    };

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

  /** 执行归并（只处理 autoApplicable，除非显式 includeNeedsReview） */
  private async executeMerges(
    userId: string,
    proposals: ConceptMergeProposal[],
    options: { includeNeedsReview: boolean },
  ): Promise<ConceptConsolidationAudit['appliedMerges']> {
    const applied: ConceptConsolidationAudit['appliedMerges'] = [];
    const executable = proposals.filter((item) => options.includeNeedsReview || item.autoApplicable);
    if (executable.length === 0) return applied;

    for (const proposal of executable) {
      try {
        const rows = await this.deps.findTraces({
          where: { userId },
          select: { id: true, conceptKey: true, label: true, extractionCount: true, masteryScore: true, lastSeenAt: true },
        });
        const plan = planMerge(rows as any, proposal.canonical, proposal.aliases);
        if (!plan) continue;

        if (plan.winnerPatch) {
          await this.deps.updateTrace({ where: { id: plan.winnerId }, data: plan.winnerPatch });
        }
        if (plan.deletedRows.length > 0) {
          await this.deps.deleteTraces({ where: { id: { in: plan.deletedRows.map((row) => row.id) } } });
        }
        applied.push({
          canonical: plan.canonical,
          aliases: plan.aliases,
          winnerId: plan.winnerId,
          deletedIds: plan.deletedRows.map((row) => row.id),
          deletedRows: plan.deletedRows,
          appliedAt: new Date().toISOString(),
        });
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
