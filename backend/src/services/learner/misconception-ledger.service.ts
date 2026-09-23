/**
 * 误解台账服务（G-R-R Phase 2）：跨会话误解生命周期管理
 *
 * 生命周期：suspected（首次观察）→ confirmed（再次出现/佐证）→ addressed（学生后续表现正确）
 * `hypothesisHash` 作为去重锚点（见 `misconceptionDedupeAnchor`）：**同一用户 + 概念 + 归一后的
 * `canonicalLabel`** → upsert 而非重复插入；模型没给标签时才退回 hypothesis 归一哈希。
 *
 * 为什么锚点不能只用 hypothesis 文本（2026-09-23 实测）：teaching-turn 每轮会换一种说法表述
 * 同一个误解，实测同一概念下 12 条 hypothesis 文字各不相同，文本哈希永远不相等 → 行行新建、
 * `occurrenceCount` 恒为 1（某学习者 22 行里只有约 4 个真误解）。
 * 词面相似度也救不了：实测**同标签对**的 `lexicalSimilarity` 低到 0.13，而**异标签对**高到 0.26
 * ——两个分布重叠且反向，无法靠文本判定归并。可靠信号只有模型产出的 `canonicalLabel`。
 *
 * 写入口：teaching-turn 产出 analysis.misconceptions → processStudentMessage 异步记录
 * 读出口：buildTeachingScenarioContext → 注入 scenario.priorMisconceptions 供教学回合引用
 */
import prisma from '../../config/database';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';
import { recordDegradation, degradationCause } from '../../skills/degradation-telemetry';
import { conceptRegistryService } from './concept-registry.service';

/**
 * 解析概念身份（canonical conceptId），best-effort：注册表故障不得阻断误解记录。
 * 设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.4（写入点双写）
 */
async function resolveConceptIdSafe(userId: string, conceptKey: string): Promise<string | null> {
  try {
    const resolved = await conceptRegistryService.resolveConcept(userId, conceptKey, { source: 'write_time' });
    return resolved?.conceptId ?? null;
  } catch (error) {
    logger.warn('[misconception-ledger] 概念身份解析失败（best-effort，conceptId 留空）', {
      userId,
      conceptKey: conceptKey.slice(0, 40),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 读取选项（B1/Q3）：
 * - 默认 `rethrowOnError=false`：内部记结构化降级后返回 []，保持既有"查询失败不阻断"语义；
 * - `rethrowOnError=true`：把错误抛给调用方，让调用方用**自己的 source** 打降级标记并把
 *   "数据不全"带进下游（真实教学侧两处出口用这个，避免把降级计到共享读函数名下）。
 */
export interface ActiveMisconceptionLookupOptions {
  rethrowOnError?: boolean;
}

export interface MisconceptionInput {
  conceptKey: string;
  hypothesis: string;
  canonicalLabel?: string | null;
  confidence: number;  // 0|25|50|75|100
  evidence?: string;
  status?: string;     // 默认 "suspected"
}

export interface MisconceptionRow {
  id: string;
  userId: string;
  conceptKey: string;
  hypothesis: string;
  canonicalLabel: string | null;
  confidence: number;
  evidence: string | null;
  status: string;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSessionId: string | null;
}

function hashHypothesis(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase().slice(0, 300)).digest('hex').slice(0, 16);
}

/**
 * 标签归一（去空白/引号/标点，压低大小写）。与 `ConceptConsolidatorService.normalizeForCompare`
 * 同口径——两处归一如果漂移，"同一误解"在两个模块里就会得到不同结论。
 */
export function normalizeMisconceptionLabel(text: string): string {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[「」『』“”‘’"'（）()【】[\]]/g, '')
    .replace(/[。．.，,、；;：:！!？?~～\-—…=＝→*#]/g, '')
    .toLowerCase();
}

/**
 * 去重锚点（存进 `hypothesisHash` 列，该列语义就是"upsert 锚点"）。
 *
 * 优先用模型产出的规范标签；没有标签才退回归一后的 hypothesis 哈希（至少吃掉标点/空白差异）。
 * 前缀区分来源，既便于运维辨认，也避免两种来源意外撞哈希。
 */
export function misconceptionDedupeAnchor(hypothesis: string, canonicalLabel?: string | null): string {
  const label = normalizeMisconceptionLabel(canonicalLabel || '');
  if (label) return `lbl:${hashHypothesis(label)}`;
  return `hyp:${hashHypothesis(normalizeMisconceptionLabel(hypothesis))}`;
}

/** 再次观察到同一误解时要写回的字段（与"归并"的字段集不同，故单列） */
export interface MisconceptionReobservationWrite {
  id: string;
  conceptId: string | null;
  confidence: number;
  status: string;
  sessionId: string;
  now: Date;
  evidence?: string;
  /** 仅当历史行用的是 hypothesis 锚点时才改写 */
  reanchorTo?: string;
}

/** 新建一行时要写的字段（与归并行同构；单独起名是为了让调用点读起来是"插入"而不是"合并"） */
export type MisconceptionInsertWrite = MisconceptionMergeRow;

/**
 * 台账数据访问（可注入：单测用假实现，生产用 prisma）。
 *
 * 刻意按**用途**命名而不是透传 Prisma 的 `args` 对象：调用方不该知道表结构，
 * 也让"哪些查询是热路径"一眼可见（前两个：写路径；`findAllRows` 只在归并 CLI 里用）。
 */
export interface MisconceptionLedgerDeps {
  /** 按复合唯一键取一行（写路径热查询） */
  findByAnchor: (key: {
    userId: string; conceptKey: string; hypothesisHash: string;
  }) => Promise<{ id: string; status: string; occurrenceCount: number } | null>;
  /** 同概念的未处理行（标签回扫，用于合并历史 hypothesis 锚点行） */
  findActiveSiblings: (key: {
    userId: string; conceptKey: string;
  }) => Promise<Array<{
    id: string; status: string; occurrenceCount: number; hypothesisHash: string; canonicalLabel: string | null;
  }>>;
  /** 该用户全部行（归并输入） */
  findAllRows: (userId: string) => Promise<MisconceptionMergeRow[]>;
  applyReobservation: (write: MisconceptionReobservationWrite) => Promise<unknown>;
  insertRow: (write: MisconceptionInsertWrite) => Promise<unknown>;
  deleteRows: (ids: string[], userId: string) => Promise<unknown>;
  /** 归并执行：把合并后的字段写进 winner */
  updateRowFields: (id: string, userId: string, fields: MisconceptionMergedFields) => Promise<unknown>;
  readAudit: (projectionKey: string) => Promise<{ payload: string } | null>;
  /** `kind='applied'` 才写回滚凭据键；observe 写预览键，两者互不覆盖 */
  writeAudit: (userId: string, payload: string, generatedAt: Date, kind: 'applied' | 'preview') => Promise<unknown>;
  resolveConceptId: (userId: string, conceptKey: string) => Promise<string | null>;
}

export const defaultMisconceptionLedgerDeps: MisconceptionLedgerDeps = {
  findByAnchor: ({ userId, conceptKey, hypothesisHash }) =>
    prisma.misconception_ledger.findUnique({
      where: { userId_conceptKey_hypothesisHash: { userId, conceptKey, hypothesisHash } },
      select: { id: true, status: true, occurrenceCount: true },
    }),
  findActiveSiblings: ({ userId, conceptKey }) =>
    prisma.misconception_ledger.findMany({
      where: { userId, conceptKey, status: { not: 'addressed' } },
      select: { id: true, status: true, occurrenceCount: true, hypothesisHash: true, canonicalLabel: true },
    }),
  findAllRows: (userId) => prisma.misconception_ledger.findMany({
    where: { userId },
    select: {
      id: true, userId: true, conceptKey: true, conceptId: true, hypothesisHash: true, hypothesis: true,
      canonicalLabel: true, confidence: true, evidence: true, status: true, occurrenceCount: true,
      firstSeenAt: true, lastSeenAt: true, lastSessionId: true, resolvedAt: true,
    },
  }),
  applyReobservation: ({ id, conceptId, confidence, status, sessionId, now, evidence, reanchorTo }) =>
    prisma.misconception_ledger.update({
      where: { id },
      data: {
        confidence,
        evidence: evidence ?? undefined,
        status,
        occurrenceCount: { increment: 1 },
        lastSeenAt: now,
        lastSessionId: sessionId,
        ...(reanchorTo ? { hypothesisHash: reanchorTo } : {}),
        ...(conceptId !== null ? { conceptId } : {}),
      },
    }),
  insertRow: (write) => prisma.misconception_ledger.create({
    data: {
      id: write.id, userId: write.userId, conceptKey: write.conceptKey, conceptId: write.conceptId,
      hypothesisHash: write.hypothesisHash, hypothesis: write.hypothesis,
      canonicalLabel: write.canonicalLabel, confidence: write.confidence,
      evidence: write.evidence, status: write.status, lastSessionId: write.lastSessionId,
    },
  }),
  deleteRows: (ids, userId) => prisma.misconception_ledger.deleteMany({ where: { userId, id: { in: ids } } }),
  updateRowFields: (id, userId, fields) =>
    prisma.misconception_ledger.updateMany({ where: { id, userId }, data: fields }),
  readAudit: (projectionKey) => prisma.learner_projections.findUnique({
    where: { projectionKey },
    select: { payload: true },
  }),
  writeAudit: (userId, payload, generatedAt, kind) => {
    const projectionKey = kind === 'applied'
      ? misconceptionConsolidationAuditKey(userId)
      : misconceptionConsolidationPreviewKey(userId);
    return prisma.learner_projections.upsert({
      where: { projectionKey },
      create: {
        id: `mcs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        projectionKey,
        userId,
        scope: MISCONCEPTION_CONSOLIDATION_SCOPE,
        version: 1,
        payload,
        generatedAt,
      },
      update: { version: { increment: 1 }, payload, generatedAt },
    });
  },
  resolveConceptId: resolveConceptIdSafe,
};

/** 归并审计的 projectionKey 前缀（与 concept-consolidator 的 `ccs:` 并列，互不覆盖） */
export const MISCONCEPTION_CONSOLIDATION_SCOPE = 'misconception-consolidation';
/**
 * 归并**已执行**的审计键：含被删行完整快照 = 回滚凭据。
 * 只由 `mode: 'apply'` 写，dry-run 不得覆盖——否则"跑一次 dry-run 就把回滚凭据冲掉了"。
 */
export function misconceptionConsolidationAuditKey(userId: string): string {
  return `${MISCONCEPTION_CONSOLIDATION_SCOPE}:${userId}`;
}
/** dry-run（observe）最近一次的归并计划键：仅供查看，不是回滚凭据 */
export function misconceptionConsolidationPreviewKey(userId: string): string {
  return `${MISCONCEPTION_CONSOLIDATION_SCOPE}-preview:${userId}`;
}

/**
 * 找本轮要落账的那一行。
 * 先按锚点直查；未命中且本轮带标签时，回扫**同概念**未处理行按归一标签匹配——
 * 这样即便历史行是用 hypothesis 锚点写的（或者模型这次才第一次给标签），也能并进同一行，
 * 并在更新时把锚点改写为标签锚点（自愈，下次直查即命中）。
 */
async function findLedgerRow(
  deps: MisconceptionLedgerDeps,
  userId: string,
  item: MisconceptionInput,
  anchor: string,
): Promise<{ id: string; status: string; needsReanchor: boolean } | null> {
  const byAnchor = await deps.findByAnchor({ userId, conceptKey: item.conceptKey, hypothesisHash: anchor });
  if (byAnchor) return { id: byAnchor.id, status: byAnchor.status, needsReanchor: false };
  const label = normalizeMisconceptionLabel(item.canonicalLabel || '');
  if (!label) return null;
  const siblings = await deps.findActiveSiblings({ userId, conceptKey: item.conceptKey });
  const hit = siblings.find((row) => normalizeMisconceptionLabel(row.canonicalLabel || '') === label);
  if (!hit) return null;
  return {
    id: hit.id,
    status: hit.status,
    // 历史行是 hypothesis 锚点 → 改写为标签锚点，让后续轮次直查命中
    needsReanchor: hit.hypothesisHash !== anchor,
  };
}

/** 批量记录误解：upsert 按 (userId, conceptKey, 去重锚点) 去重；best-effort，失败不抛 */
export async function recordMisconceptions(
  userId: string,
  sessionId: string,
  items: MisconceptionInput[],
  deps: MisconceptionLedgerDeps = defaultMisconceptionLedgerDeps,
): Promise<void> {
  if (!items || items.length === 0) return;
  try {
    const now = new Date();
    for (const item of items) {
      const anchor = misconceptionDedupeAnchor(item.hypothesis, item.canonicalLabel);
      const conceptId = await deps.resolveConceptId(userId, item.conceptKey);
      const existing = await findLedgerRow(deps, userId, item, anchor);
      const confidence = [0, 25, 50, 75, 100].includes(item.confidence) ? item.confidence : 50;
      if (existing) {
        await deps.applyReobservation({
          id: existing.id,
          conceptId,
          confidence,
          // 再次出现 → 升为 confirmed（除非已 addressed）
          status: existing.status === 'suspected' ? 'confirmed' : existing.status,
          sessionId,
          now,
          evidence: item.evidence,
          reanchorTo: existing.needsReanchor ? anchor : undefined,
        });
      } else {
        await deps.insertRow({
          id: `ml_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          userId,
          conceptKey: item.conceptKey,
          conceptId,
          hypothesisHash: anchor,
          hypothesis: item.hypothesis.trim().slice(0, 300),
          canonicalLabel: item.canonicalLabel?.trim().slice(0, 200) ?? null,
          confidence,
          evidence: item.evidence?.trim().slice(0, 300) ?? null,
          status: item.status || 'suspected',
          occurrenceCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          lastSessionId: sessionId,
          resolvedAt: null,
        });
      }
    }
  } catch (error) {
    logger.warn('[misconception-ledger] 误解记录失败（best-effort，不阻断回合）', {
      userId,
      sessionId,
      count: items.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 获取指定概念的活跃误解（status != addressed），最近 N 条 */
export async function getActiveForConcepts(
  userId: string,
  conceptKeys: string[],
  limit = 5,
  options: ActiveMisconceptionLookupOptions = {},
): Promise<MisconceptionRow[]> {
  if (!conceptKeys || conceptKeys.length === 0) return [];
  try {
    return await prisma.misconception_ledger.findMany({
      where: {
        userId,
        conceptKey: { in: conceptKeys },
        status: { not: 'addressed' },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
    });
  } catch (error) {
    // 允许降级，不允许未打标的降级：默认路径记结构化遥测（保留既有 warn 供人读）
    if (options.rethrowOnError) throw error;
    recordDegradation({
      source: 'learner/misconception-ledger',
      faultCategory: 'DB_READ_FAILED',
      severity: 'P2_DEGRADED',
      impactedDimensions: ['misconception.active'],
      mitigationApplied: 'return-empty-active-misconceptions',
      rootCauseMessage: degradationCause(error),
    });
    logger.warn('[misconception-ledger] 查询误解失败', { userId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/* ────────────────────────── 存量归并（清理历史重复行） ────────────────────────── */

/** 参与归并的一行（只取归并需要的列） */
export interface MisconceptionMergeRow {
  id: string;
  userId: string;
  conceptKey: string;
  conceptId: string | null;
  hypothesisHash: string;
  hypothesis: string;
  canonicalLabel: string | null;
  confidence: number;
  evidence: string | null;
  status: string;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSessionId: string | null;
  resolvedAt: Date | null;
}

export interface MisconceptionMergeGroup {
  conceptKey: string;
  /** 归一后的分组键（`lbl:…` = 按标签；`hyp:…` = 无标签时按 hypothesis 归一文本） */
  groupKey: string;
  /** 该组是否靠模型标签分出来的。false = 无标签行，靠文本归一，置信度低 */
  byLabel: boolean;
  canonicalLabel: string | null;
  winnerId: string;
  /** 将要写进 winner 的字段（已算好，便于 dry-run 直接展示） */
  mergedFields: MisconceptionMergedFields;
  /** 将被删除的重复行（完整快照，写进审计 → 可回溯） */
  deletedRows: MisconceptionMergeRow[];
  occurrenceTotal: number;
}

/** 归并后写进 winner 的字段集 */
export interface MisconceptionMergedFields {
  /** 归一锚点：下次 teaching-turn 再报同一误解时直查即命中 */
  hypothesisHash: string;
  canonicalLabel: string | null;
  occurrenceCount: number;
  confidence: number;
  status: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSessionId: string | null;
  evidence: string | null;
  conceptId: string | null;
  resolvedAt: Date | null;
}

export interface MisconceptionConsolidationPlan {
  userId: string;
  generatedAt: string;
  mode: 'observe' | 'apply';
  scannedRows: number;
  groups: MisconceptionMergeGroup[];
  /** 归并后仍无法判定的行数（无标签且文本也不相同）——需要语义判断，本函数不做 */
  ungroupedRows: number;
  deletedCount: number;
}

/**
 * 纯函数：把同一用户的行**按 (conceptKey, 归一标签) 分组**，只对组内 >1 行的产出归并计划。
 *
 * 为什么分组键带上 conceptKey：台账是**按概念**读的（`getActiveForConcepts(conceptKeys)`），
 * 同一个误解标签出现在两个概念下是两条独立记录，合并会丢掉概念归属。
 *
 * 为什么无标签行只做文本归一、且有标签组优先：实测词面相似度在"同误解/不同误解"两个分布上
 * 重叠且反向（同标签对最低 0.13、异标签对最高 0.26），所以**绝不**用相似度阈值去猜语义归并。
 * 无标签行只有归一文本完全相同才算同一行；其余原样保留，计入 `ungroupedRows`。
 */
export function planMisconceptionConsolidation(
  userId: string,
  rows: MisconceptionMergeRow[],
  options: { mode?: 'observe' | 'apply'; now?: Date } = {},
): MisconceptionConsolidationPlan {
  const mode = options.mode ?? 'observe';
  const now = options.now ?? new Date();
  const buckets = new Map<string, MisconceptionMergeRow[]>();

  for (const row of rows) {
    const label = normalizeMisconceptionLabel(row.canonicalLabel || '');
    const groupKey = label
      ? `lbl:${hashHypothesis(label)}`
      : `hyp:${hashHypothesis(normalizeMisconceptionLabel(row.hypothesis))}`;
    const bucketKey = `${row.conceptKey}\u0001${groupKey}`;
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(row);
    buckets.set(bucketKey, bucket);
  }

  const groups: MisconceptionMergeGroup[] = [];
  let ungroupedRows = 0;
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      // 单行组：有标签算已归位；无标签的单行组计入"仍需语义判定"
      if (!normalizeMisconceptionLabel(bucket[0].canonicalLabel || '')) ungroupedRows += 1;
      continue;
    }
    // winner = 最早观察到的那一行（保留原始措辞）；同刻按 id 定序，保证结果稳定可复现
    const sorted = [...bucket].sort((a, b) => {
      const diff = a.firstSeenAt.getTime() - b.firstSeenAt.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);
    const latest = [...bucket].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())[0];
    const label = normalizeMisconceptionLabel(winner.canonicalLabel || '')
      ? winner.canonicalLabel
      : (bucket.map((r) => r.canonicalLabel).find((value) => !!value) ?? null);
    const groupKey = normalizeMisconceptionLabel(winner.canonicalLabel || '')
      ? `lbl:${hashHypothesis(normalizeMisconceptionLabel(winner.canonicalLabel || ''))}`
      : `hyp:${hashHypothesis(normalizeMisconceptionLabel(winner.hypothesis))}`;

    groups.push({
      conceptKey: winner.conceptKey,
      groupKey,
      byLabel: groupKey.startsWith('lbl:'),
      canonicalLabel: label,
      winnerId: winner.id,
      mergedFields: {
        // 锚点改写为标签锚点：下次 teaching-turn 再报同一误解时直查即命中
        hypothesisHash: groupKey,
        canonicalLabel: label,
        occurrenceCount: bucket.reduce((sum, r) => sum + r.occurrenceCount, 0),
        confidence: Math.max(...bucket.map((r) => r.confidence)),
        // status 只升不降：全 addressed 才算 addressed，任一 confirmed 即 confirmed
        status: bucket.every((r) => r.status === 'addressed')
          ? 'addressed'
          : (bucket.some((r) => r.status === 'confirmed') ? 'confirmed' : 'suspected'),
        firstSeenAt: new Date(Math.min(...bucket.map((r) => r.firstSeenAt.getTime()))),
        lastSeenAt: new Date(Math.max(...bucket.map((r) => r.lastSeenAt.getTime()))),
        lastSessionId: latest.lastSessionId,
        evidence: latest.evidence ?? winner.evidence,
        conceptId: bucket.map((r) => r.conceptId).find((value) => !!value) ?? null,
        resolvedAt: bucket.map((r) => r.resolvedAt).filter((value): value is Date => !!value)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      },
      deletedRows: losers,
      occurrenceTotal: bucket.reduce((sum, r) => sum + r.occurrenceCount, 0),
    });
  }

  groups.sort((a, b) => b.deletedRows.length - a.deletedRows.length || a.conceptKey.localeCompare(b.conceptKey));
  return {
    userId,
    generatedAt: now.toISOString(),
    mode,
    scannedRows: rows.length,
    groups,
    ungroupedRows,
    deletedCount: groups.reduce((sum, g) => sum + g.deletedRows.length, 0),
  };
}

/**
 * 归并某用户的重复误解行。
 *
 * - `mode: 'observe'`（默认）：只算计划并写**预览键**审计，**不动数据**；
 * - `mode: 'apply'`：先删被并掉的行、再把合并字段写进 winner（顺序见函数内注释）。
 * - 两种模式写**不同的键**：`misconception-consolidation:<userId>`（apply，含被删行完整快照 =
 *   回滚凭据）与 `misconception-consolidation-preview:<userId>`（observe）。
 *   早先两者共用一个键，结果"跑一次 dry-run 就把真正执行过的回滚凭据冲掉了"。
 */
export async function consolidateMisconceptions(
  userId: string,
  options: { mode?: 'observe' | 'apply'; deps?: MisconceptionLedgerDeps } = {},
): Promise<MisconceptionConsolidationPlan | null> {
  const deps = options.deps ?? defaultMisconceptionLedgerDeps;
  const mode = options.mode ?? 'observe';
  try {
    const rows = await deps.findAllRows(userId);
    if (rows.length === 0) return null;
    const plan = planMisconceptionConsolidation(userId, rows, { mode });

    if (mode === 'apply') {
      for (const group of plan.groups) {
        // 先删被并掉的行，再把合并字段写进 winner：winner 要拿的标签锚点可能正被某个 loser
        // 占着，唯一索引会拒绝先写后删。中途崩溃的最坏结果是"已合并但锚点未改写"——下次写入自愈。
        await deps.deleteRows(group.deletedRows.map((r) => r.id), userId);
        await deps.updateRowFields(group.winnerId, userId, group.mergedFields);
      }
    }

    await deps.writeAudit(userId, JSON.stringify(plan), new Date(plan.generatedAt), mode === 'apply' ? 'applied' : 'preview');

    if (mode === 'apply' && plan.groups.length > 0) {
      logger.info('[misconception-ledger] 误解归并已执行', {
        userId,
        scannedRows: plan.scannedRows,
        mergedGroups: plan.groups.length,
        deletedRows: plan.deletedCount,
        ungroupedRows: plan.ungroupedRows,
      });
    }
    return plan;
  } catch (error) {
    logger.warn('[misconception-ledger] 误解归并失败', {
      userId,
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 读取最近一次归并审计（供 CLI / 后台回溯） */
export async function getMisconceptionConsolidationAudit(
  userId: string,
  deps: MisconceptionLedgerDeps = defaultMisconceptionLedgerDeps,
): Promise<MisconceptionConsolidationPlan | null> {
  const row = await deps.readAudit(misconceptionConsolidationAuditKey(userId));
  if (!row?.payload) return null;
  try {
    return JSON.parse(row.payload) as MisconceptionConsolidationPlan;
  } catch {
    return null;
  }
}