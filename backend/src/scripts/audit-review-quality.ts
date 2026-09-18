/**
 * 复习选点质量回看（**只读**：不写库、不迁移、不调 LLM）
 *
 * 升级方向 Q1：先量化"复习选点"质量，再决定要不要引入排序模型。
 * 本脚本把 `review-quality-metrics` 的纯函数接到真实数据上，输出可复算的选点质量指标：
 *   - 可提取性后悔（是否在"还没忘"时过早复习）
 *   - 到期覆盖（到期积压被服务了多少）
 *   - 概念覆盖熵 / 重复复习（是否集中在少数概念）
 *   - 交错代理（相邻项是否同概念；无 embedding，仅为代理）
 *   - 复习结果分布（good/hard/again 口径）
 *   - 额度利用（附加，解释覆盖）
 *
 * 数据来源（全部只读）：
 *   - `teaching_sessions.teachingState.sessionArtifacts.memoryWarmup`：
 *     选点计划快照，含 `items[].{conceptKey,retention}`、`backlogCount`、`usedLoad`、`budget`。
 *   - `learner_evidence`（`review:completed` / `review:warmup`）：复习结果 `rating` 与概念键。
 *   - `memory_traces`（`extractionCount > 0`）：概念全集，用于饥饿检测。
 *   - `learner_projections`（`scope='review-quota'`）：按天额度账本。
 *
 * ⚠️ 口径与限制（结论必须带上）：
 *   - **观测性，非因果**：复习何时发生由调度器与当日配额共同决定，与难度/掌握度相关。
 *   - **到期覆盖是近似**：历史时点的"真实到期数"没有落库，工程上用
 *     `选中数 + memoryWarmup.backlogCount` 近似（backlogCount 已排除 leech/毕业点）。
 *   - **交错是代理**：无 embedding，只能判断概念键是否相同，无法度量语义干扰。
 *   - 选点时刻的 `retention` 来自计划快照；`review:completed` 证据里没有该字段，
 *     因此"可提取性后悔"只覆盖留下计划快照的会话（更早数据不可算）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-review-quality.ts [--days=30] [--userId=<id>] [--json]
 */

import 'dotenv/config';
import prisma from '../config/database';
import { normalizeConceptKey } from '../services/memory/memory-trace.service';
import {
  REVIEW_QUALITY_METRIC_DEFINITIONS,
  computeConceptCoverageEntropy,
  computeDueCoverage,
  computeInterleavingProxy,
  computeRepetitionSummary,
  computeRetrievabilityRegret,
  computeReviewOutcomeSummary,
  summarizeQuotaUtilization,
  type ConceptCoverageEntropySummary,
  type DueCoverageSummary,
  type InterleavingProxySummary,
  type QuotaDayObservation,
  type QuotaUtilizationSummary,
  type RepetitionSummary,
  type RetrievabilityRegretSummary,
  type ReviewOutcomeSummary,
} from '../services/memory/review-quality-metrics';

const REVIEW_EVIDENCE_TYPES = ['review:completed', 'review:warmup'];
const QUOTA_SCOPE = 'review-quota';

const OBSERVATIONAL_CAVEAT =
  '观测性数据，非随机实验：什么点在什么间隔被复习由调度器（FSRS 到期）与当日配额共同决定，' +
  '与概念难度/掌握度相关。本报告只描述现状，不能读成"选点策略导致 X"的因果结论。';

interface CliArgs {
  days: number;
  userId: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { days: 30, userId: null, json: false };
  for (const raw of argv) {
    const [key, value] = raw.split('=');
    if (key === '--days' && value) args.days = Math.max(1, Number(value) || 30);
    if ((key === '--userId' || key === '--user') && value) args.userId = value;
    if (raw === '--json') args.json = true;
  }
  return args;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toNonNegativeNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

interface SelectedItem {
  conceptKey: string;
  retention: number | null;
}

interface PersistedWarmupPlan {
  items: SelectedItem[];
  backlogCount: number;
  usedLoad: number;
  budget: number;
}

/** 解析 `teachingState.sessionArtifacts.memoryWarmup`（ReviewPlan 的持久化快照） */
function parseWarmupPlan(teachingState: unknown): PersistedWarmupPlan | null {
  const state = asRecord(parseJson(teachingState));
  const artifacts = asRecord(state?.sessionArtifacts);
  const plan = asRecord(artifacts?.memoryWarmup);
  if (!plan) return null;

  const rawItems: unknown[] = Array.isArray(plan.items) ? plan.items : [];
  const items: SelectedItem[] = [];
  for (const raw of rawItems) {
    const item = asRecord(raw);
    const conceptKey = normalizeConceptKey(item?.conceptKey);
    if (!conceptKey) continue;
    const retentionRaw = item?.retention;
    const retention = typeof retentionRaw === 'number' && Number.isFinite(retentionRaw) ? retentionRaw : null;
    items.push({ conceptKey, retention });
  }
  return {
    items,
    backlogCount: toNonNegativeNumber(plan.backlogCount),
    usedLoad: toNonNegativeNumber(plan.usedLoad),
    budget: toNonNegativeNumber(plan.budget),
  };
}

interface EvidenceItem {
  conceptKey: string;
  rating: string | null;
}

function parseEvidence(payload: unknown): EvidenceItem | null {
  const record = asRecord(parseJson(payload));
  if (!record) return null;
  const conceptKey = normalizeConceptKey(record.conceptKey);
  if (!conceptKey) return null;
  const rating = typeof record.rating === 'string' && record.rating ? record.rating : null;
  return { conceptKey, rating };
}

function parseQuotaDay(payload: unknown): QuotaDayObservation | null {
  const record = asRecord(parseJson(payload));
  if (!record) return null;
  const date = typeof record.date === 'string' ? record.date : '';
  if (!date) return null;
  return {
    date,
    usedLoad: toNonNegativeNumber(record.usedLoad),
    limitLoad: toNonNegativeNumber(record.limitLoad),
    usedCount: toNonNegativeNumber(record.usedCount),
  };
}

interface LearnerQualityReport {
  userId: string;
  name: string;
  sessions: number;
  sessionsWithPlan: number;
  selectedCount: number;
  evidenceCount: number;
  retrievabilityRegret: RetrievabilityRegretSummary;
  dueCoverage: DueCoverageSummary;
  meanSessionCoverage: number | null;
  conceptCoverageEntropy: ConceptCoverageEntropySummary;
  interleaving: InterleavingProxySummary;
  outcome: ReviewOutcomeSummary;
  repetition: RepetitionSummary;
  quotaUtilization: QuotaUtilizationSummary;
}

interface LearnerAnalysis {
  report: LearnerQualityReport;
  selectedItems: SelectedItem[];
  evidenceItems: EvidenceItem[];
  quotaDays: QuotaDayObservation[];
}

/** 跨学习者加权平均（权重=相邻对数），避免把不同人的序列首尾拼在一起产生假相邻 */
function weightedMean(pairs: ReadonlyArray<{ value: number | null; weight: number }>): number | null {
  let sum = 0;
  let weight = 0;
  for (const pair of pairs) {
    if (pair.value === null || pair.weight <= 0) continue;
    sum += pair.value * pair.weight;
    weight += pair.weight;
  }
  return weight > 0 ? round4(sum / weight) : null;
}

async function analyzeLearner(userId: string, name: string, since: Date, sinceKey: string): Promise<LearnerAnalysis> {
  const [sessions, evidenceRows, traceRows, projectionRows] = await Promise.all([
    prisma.teaching_sessions.findMany({
      where: { userId, startTime: { gte: since } },
      select: { id: true, startTime: true, teachingState: true },
      orderBy: { startTime: 'asc' },
    }),
    prisma.learner_evidence.findMany({
      where: { userId, evidenceType: { in: REVIEW_EVIDENCE_TYPES }, occurredAt: { gte: since } },
      select: { payload: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),
    prisma.memory_traces.findMany({
      where: { userId, extractionCount: { gt: 0 } },
      select: { conceptKey: true },
    }),
    prisma.learner_projections.findMany({
      where: { userId, scope: QUOTA_SCOPE },
      select: { payload: true },
    }),
  ]);

  // 选点序列：按会话开始时间升序 + 会话内计划顺序（= 模型看到的温故顺序）
  const selectedItems: SelectedItem[] = [];
  const sessionCoverages: number[] = [];
  let selectedCount = 0;
  let dueTotal = 0;
  let sessionsWithPlan = 0;
  for (const session of sessions) {
    const plan = parseWarmupPlan(session.teachingState);
    if (!plan) continue;
    sessionsWithPlan += 1;
    for (const item of plan.items) selectedItems.push(item);
    selectedCount += plan.items.length;
    const due = plan.items.length + plan.backlogCount;
    dueTotal += due;
    const coverage = computeDueCoverage({ selectedCount: plan.items.length, dueCount: due });
    if (coverage.coverage !== null) sessionCoverages.push(coverage.coverage);
  }

  const evidenceItems: EvidenceItem[] = [];
  for (const row of evidenceRows) {
    const item = parseEvidence(row.payload);
    if (item) evidenceItems.push(item);
  }

  const universeConceptKeys: string[] = [];
  const seenUniverse = new Set<string>();
  for (const trace of traceRows) {
    const key = normalizeConceptKey(trace.conceptKey);
    if (!key || seenUniverse.has(key)) continue;
    seenUniverse.add(key);
    universeConceptKeys.push(key);
  }

  const quotaDays: QuotaDayObservation[] = [];
  for (const row of projectionRows) {
    const day = parseQuotaDay(row.payload);
    if (day && day.date >= sinceKey) quotaDays.push(day);
  }

  // 交错：优先用"选点序列"；没有计划快照时回落到证据时间序
  const interleavingItems = selectedItems.length > 0 ? selectedItems : evidenceItems;

  return {
    report: {
      userId,
      name,
      sessions: sessions.length,
      sessionsWithPlan,
      selectedCount,
      evidenceCount: evidenceItems.length,
      retrievabilityRegret: computeRetrievabilityRegret(selectedItems),
      dueCoverage: computeDueCoverage({ selectedCount, dueCount: dueTotal }),
      meanSessionCoverage: sessionCoverages.length > 0
        ? round4(sessionCoverages.reduce((sum, value) => sum + value, 0) / sessionCoverages.length)
        : null,
      conceptCoverageEntropy: computeConceptCoverageEntropy(evidenceItems, { universeConceptKeys }),
      interleaving: computeInterleavingProxy(interleavingItems),
      outcome: computeReviewOutcomeSummary(evidenceItems),
      repetition: computeRepetitionSummary(evidenceItems),
      quotaUtilization: summarizeQuotaUtilization(quotaDays),
    },
    selectedItems,
    evidenceItems,
    quotaDays,
  };
}

interface GlobalReport {
  learners: number;
  selectedCount: number;
  evidenceCount: number;
  retrievabilityRegret: RetrievabilityRegretSummary;
  dueCoverage: DueCoverageSummary;
  conceptCoverageEntropy: ConceptCoverageEntropySummary;
  interleaving: InterleavingProxySummary;
  outcome: ReviewOutcomeSummary;
  repetition: RepetitionSummary;
  quotaUtilization: QuotaUtilizationSummary;
}

function buildGlobal(
  reports: LearnerQualityReport[],
  allSelected: SelectedItem[],
  allEvidence: EvidenceItem[],
  allQuotaDays: QuotaDayObservation[],
): GlobalReport {
  const dueSelected = reports.reduce((sum, r) => sum + r.dueCoverage.selectedCount, 0);
  const dueTotal = reports.reduce((sum, r) => sum + r.dueCoverage.dueCount, 0);
  const concatenatedInterleaving = computeInterleavingProxy(allSelected);
  const weightedRate = weightedMean(
    reports.map((r) => ({ value: r.interleaving.sameConceptAdjacencyRate, weight: r.interleaving.transitions })),
  );
  const longestRun = reports.reduce((max, r) => Math.max(max, r.interleaving.longestSameConceptRun), 0);
  return {
    learners: reports.length,
    selectedCount: allSelected.length,
    evidenceCount: allEvidence.length,
    retrievabilityRegret: computeRetrievabilityRegret(allSelected),
    dueCoverage: computeDueCoverage({ selectedCount: dueSelected, dueCount: dueTotal }),
    conceptCoverageEntropy: computeConceptCoverageEntropy(allEvidence),
    interleaving: {
      ...concatenatedInterleaving,
      // 跨学习者不拼接序列：比例按相邻对数加权；最长连续段取各学习者最大值（最差局部循环）
      sameConceptAdjacencyRate: weightedRate,
      longestSameConceptRun: longestRun,
    },
    outcome: computeReviewOutcomeSummary(allEvidence),
    repetition: computeRepetitionSummary(allEvidence),
    quotaUtilization: summarizeQuotaUtilization(allQuotaDays),
  };
}

const pct = (value: number | null): string => (value === null ? '-' : `${(value * 100).toFixed(1)}%`);
const num = (value: number | null, digits = 3): string => (value === null ? '-' : value.toFixed(digits));

function printLegend(): void {
  console.log('指标图例（定义 / 数据来源 / 已知限制）：');
  for (const definition of REVIEW_QUALITY_METRIC_DEFINITIONS) {
    console.log(`  · ${definition.key}｜${definition.label}`);
    console.log(`      定义：${definition.definition}`);
    console.log(`      来源：${definition.dataSource}`);
    console.log(`      限制：${definition.limitation}`);
  }
}

function printLearner(r: LearnerQualityReport): void {
  console.log(`\n## ${r.name || r.userId}（${r.userId.slice(0, 8)}…）`);
  console.log(
    `  会话 ${r.sessions}（含计划 ${r.sessionsWithPlan}）｜选中 ${r.selectedCount} 条｜复习证据 ${r.evidenceCount} 条`,
  );
  const regret = r.retrievabilityRegret;
  console.log(
    `  可提取性后悔：mean=${num(regret.meanRegret, 4)} max=${num(regret.maxRegret, 4)}` +
      ` 过早占比=${pct(regret.overTargetRate)}｜平均保留率=${num(regret.meanRetention)}` +
      `（有效 ${regret.validCount} / 缺失 ${regret.missingCount}，target=${regret.targetRetention}）`,
  );
  const due = r.dueCoverage;
  console.log(
    `  到期覆盖：${pct(due.coverage)}（${due.selectedCount}/${due.dueCount}）｜backlog=${due.backlog}` +
      `｜单课平均覆盖=${pct(r.meanSessionCoverage)}${due.overSelected > 0 ? `｜⚠️ overSelected=${due.overSelected}` : ''}`,
  );
  const entropy = r.conceptCoverageEntropy;
  console.log(
    `  概念覆盖熵：H=${num(entropy.entropyBits)} bit（归一化 ${num(entropy.normalizedEntropy)}）` +
      `｜最热占比=${pct(entropy.topShare)}（${entropy.topConceptKey ?? '-'}）` +
      `｜有效概念数=${num(entropy.effectiveConcepts)}` +
      `｜未覆盖全集=${entropy.unreviewedUniverseCount === null ? '-' : entropy.unreviewedUniverseCount}`,
  );
  const inter = r.interleaving;
  console.log(
    `  交错代理：相邻同概念=${pct(inter.sameConceptAdjacencyRate)}｜最长同概念连续段=${inter.longestSameConceptRun}` +
      `｜项数=${inter.totalItems} 概念数=${inter.distinctConcepts}`,
  );
  const outcome = r.outcome;
  console.log(
    `  复习结果：严口径成功=${pct(outcome.strictSuccessRate)} 宽口径=${pct(outcome.lenientSuccessRate)}` +
      `｜again=${outcome.counts.again} hard=${outcome.counts.hard} good=${outcome.counts.good} easy=${outcome.counts.easy}` +
      `${outcome.counts.unknown > 0 ? ` unknown=${outcome.counts.unknown}` : ''}`,
  );
  const repetition = r.repetition;
  console.log(
    `  重复复习：repeatShare=${pct(repetition.repeatShare)}（${repetition.repeatReviews}/${repetition.totalReviews}）` +
      `｜最常复习=${repetition.mostReviewedConceptKey ?? '-'}×${repetition.maxReviewsPerConcept}`,
  );
  const quota = r.quotaUtilization;
  console.log(
    `  额度利用：均值=${pct(quota.avgUtilization)} 最大=${pct(quota.maxUtilization)}` +
      `｜超额天=${quota.overLimitDays}/${quota.measurableDays}｜合计 load=${quota.totalUsedLoad}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const sinceKey = since.toISOString().slice(0, 10);

  const learners = args.userId
    ? [{ id: args.userId, name: '(指定)' }]
    : await prisma.users.findMany({ where: { isVirtualLearner: true }, select: { id: true, name: true } });

  const analyses: LearnerAnalysis[] = [];
  for (const learner of learners) {
    analyses.push(await analyzeLearner(learner.id, learner.name, since, sinceKey));
  }
  const reports = analyses.map((analysis) => analysis.report);
  const allSelected = analyses.flatMap((analysis) => analysis.selectedItems);
  const allEvidence = analyses.flatMap((analysis) => analysis.evidenceItems);
  const allQuotaDays = analyses.flatMap((analysis) => analysis.quotaDays);
  const global = buildGlobal(reports, allSelected, allEvidence, allQuotaDays);

  if (args.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      windowDays: args.days,
      since: since.toISOString(),
      scope: args.userId ? `userId=${args.userId}` : 'virtual-learners',
      caveat: OBSERVATIONAL_CAVEAT,
      legend: REVIEW_QUALITY_METRIC_DEFINITIONS,
      learners: reports,
      global,
    }, null, 2));
    return;
  }

  console.log('== 复习选点质量回看（只读）==');
  console.log(`窗口：近 ${args.days} 天（since ${sinceKey}）｜范围：${args.userId ? args.userId : '全部虚拟学习者'}`);
  console.log(`\n⚠️ ${OBSERVATIONAL_CAVEAT}`);
  console.log('⚠️ 到期覆盖用"选中数 + 计划内 backlogCount"近似历史到期量；交错为无 embedding 的代理。');
  printLegend();

  if (reports.length === 0) {
    console.log('\n没有匹配的学习者。');
    return;
  }
  for (const report of reports) printLearner(report);

  console.log('\n## 全局汇总');
  console.log(
    `  学习者 ${global.learners} 人｜选中 ${global.selectedCount} 条｜复习证据 ${global.evidenceCount} 条`,
  );
  console.log(
    `  可提取性后悔：mean=${num(global.retrievabilityRegret.meanRegret, 4)}` +
      ` 过早占比=${pct(global.retrievabilityRegret.overTargetRate)}`,
  );
  console.log(
    `  到期覆盖：${pct(global.dueCoverage.coverage)}（${global.dueCoverage.selectedCount}/${global.dueCoverage.dueCount}）` +
      `｜backlog=${global.dueCoverage.backlog}`,
  );
  console.log(
    `  概念覆盖熵：H=${num(global.conceptCoverageEntropy.entropyBits)} bit` +
      `（归一化 ${num(global.conceptCoverageEntropy.normalizedEntropy)}，最热占比 ${pct(global.conceptCoverageEntropy.topShare)}）`,
  );
  console.log(
    `  交错代理：相邻同概念=${pct(global.interleaving.sameConceptAdjacencyRate)}` +
      `（按相邻对数加权）｜最长同概念连续段=${global.interleaving.longestSameConceptRun}（各学习者最大值）`,
  );
  console.log(
    `  复习结果：严口径=${pct(global.outcome.strictSuccessRate)} 宽口径=${pct(global.outcome.lenientSuccessRate)}`,
  );
  console.log(`  重复复习：repeatShare=${pct(global.repetition.repeatShare)}`);
  console.log(
    `  额度利用：均值=${pct(global.quotaUtilization.avgUtilization)}` +
      ` 最大=${pct(global.quotaUtilization.maxUtilization)}` +
      `｜超额天=${global.quotaUtilization.overLimitDays}/${global.quotaUtilization.measurableDays}`,
  );
}

main()
  .catch((error) => {
    console.error('[audit-review-quality] 失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
