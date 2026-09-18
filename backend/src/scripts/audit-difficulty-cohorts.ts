/**
 * 难度分配的分层公平审计（只读 CLI · Q13“简版”）
 *
 * 读 `learner_evidence: task:difficulty:adjustment`（难度台账），按**队列**聚合降档画像，
 * 并给出组间差异（disparity）摘要。队列标签来自 `virtual_learner_profiles`：
 * 真实用户没有分层标签，故**只纳入有虚拟画像的用户**，真实用户统计后剔除（见 coverage 注记）。
 *
 * 用的标签字段（已核对 schema 与真实库）：
 * - `tags`（JSON 字符串数组）：优先取 `preset:<key>` → `personaTag`，回退取来源标签
 *   `work` / `study` / `life` / `self_management` → `sourceType`（预制库 14/33 有之，自定义多为空）；
 * - `presetKey`（列）：预制库稳定键（builtin 才有，custom 为 null）；
 * - `profile`（JSON）：`storyPool[0].id` → `storyId`；`runtimePrefs.frictionBudget` → `frictionBudget`
 *   （实测当前库为 0 覆盖，留作策略位）。
 * `resolveCohortKey` 对缺标签的用户统一回退 `unknown`，CLI 会打印各策略的覆盖率。
 *
 * 纪律：只读（仅 findMany），不写库、不跑 prompts、不发 LLM；输出**观察性**结论，非因果。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-difficulty-cohorts.ts [--days=90] [--strategy=personaTag] [--json]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { ADJUSTMENT_EVIDENCE_TYPE, parseAdjustment } from '../services/learner/TaskDifficultyAdjustmentLedger';
import type { DifficultyAdjustmentEvent } from '../services/learner/difficulty-fairness-audit';
import {
  auditDifficultyByCohort,
  resolveCohortKey,
  isDifficultyCohortStrategy,
  DEFAULT_DIFFICULTY_COHORT_STRATEGY,
  DIFFICULTY_COHORT_STRATEGIES,
  UNKNOWN_COHORT_KEY,
  type DifficultyCohortLabels,
  type DifficultyCohortStrategy,
} from '../services/learner/difficulty-cohort-audit';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** `tags` 命中 `preset:<key>` 时返回 key（去掉前缀），否则空串。 */
function personaTagFromTags(tags: string[]): string {
  const hit = tags.find((tag) => tag.startsWith('preset:'));
  return hit ? hit.slice('preset:'.length).trim() : '';
}

const SOURCE_TYPES = ['work', 'study', 'life', 'self_management'];

/** 从 DB 行构造分层标签（所有字段都可能缺失，交由 resolveCohortKey 决定回退）。 */
function buildLabels(row: {
  presetKey: string | null;
  tags: string | null;
  profile: string;
}): DifficultyCohortLabels {
  const tags = parseJsonArray(row.tags).map((tag) => String(tag));
  const profile = parseJsonObject(row.profile);
  const storyPool = Array.isArray(profile.storyPool) ? profile.storyPool : [];
  const firstStory = storyPool[0] && typeof storyPool[0] === 'object' ? (storyPool[0] as Record<string, unknown>) : {};
  const runtimePrefs = profile.runtimePrefs && typeof profile.runtimePrefs === 'object'
    ? (profile.runtimePrefs as Record<string, unknown>)
    : {};
  return {
    personaTag: personaTagFromTags(tags),
    presetKey: row.presetKey ?? '',
    sourceType: tags.find((tag) => SOURCE_TYPES.includes(tag)) ?? '',
    storyId: firstStory.id !== undefined ? firstStory.id : '',
    frictionBudget: runtimePrefs.frictionBudget ?? '',
  };
}

function resolveStrategy(raw: string | null): DifficultyCohortStrategy {
  if (!raw) return DEFAULT_DIFFICULTY_COHORT_STRATEGY;
  if (isDifficultyCohortStrategy(raw)) return raw;
  throw new Error(
    `未知的 --strategy=${raw}；可选：${DIFFICULTY_COHORT_STRATEGIES.join(' / ')}`,
  );
}

async function main(): Promise<void> {
  const days = Number(arg('days')) || 90;
  const strategy = resolveStrategy(arg('strategy'));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 只读：难度台账事件
  const evidenceRows = await prisma.learner_evidence.findMany({
    where: { evidenceType: ADJUSTMENT_EVIDENCE_TYPE, occurredAt: { gte: since } },
    orderBy: { occurredAt: 'asc' },
    select: { userId: true, occurredAt: true, payload: true },
  });

  // 只读：虚拟学习者队列标签
  const profileRows = await prisma.virtual_learner_profiles.findMany({
    select: { userId: true, presetKey: true, tags: true, profile: true },
  });

  const cohortByUserId: Record<string, string> = {};
  const profileUserIds = new Set<string>();
  let profilesWithLabel = 0;
  for (const row of profileRows) {
    profileUserIds.add(row.userId);
    const key = resolveCohortKey(buildLabels(row), strategy);
    cohortByUserId[row.userId] = key;
    if (key !== UNKNOWN_COHORT_KEY) profilesWithLabel += 1;
  }

  const events: DifficultyAdjustmentEvent[] = [];
  let excludedNoProfile = 0;
  let unparsed = 0;
  for (const row of evidenceRows) {
    if (!profileUserIds.has(row.userId)) {
      excludedNoProfile += 1; // 真实用户 / 无虚拟画像：无队列标签，剔除
      continue;
    }
    const parsed = parseAdjustment(row.payload);
    if (!parsed) {
      unparsed += 1;
      continue;
    }
    const evidence = (parsed.evidence ?? {}) as Record<string, unknown>;
    events.push({
      userId: row.userId,
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
      baseline: parsed.baseline,
      adjusted: parsed.adjusted,
      direction: parsed.direction,
      reasons: parsed.reasons,
      floor: typeof evidence.floor === 'number' ? evidence.floor : null,
      floorApplied: evidence.floorApplied === true,
    });
  }

  const report = auditDifficultyByCohort(events, cohortByUserId);

  const eventUsers = new Set(events.map((event) => event.userId));
  let eventUsersWithLabel = 0;
  for (const userId of eventUsers) {
    if ((cohortByUserId[userId] ?? UNKNOWN_COHORT_KEY) !== UNKNOWN_COHORT_KEY) eventUsersWithLabel += 1;
  }

  const coverage = {
    windowDays: days,
    strategy,
    since: since.toISOString(),
    // 台账侧
    evidenceRows: evidenceRows.length,
    usedRows: events.length,
    excludedNoProfile, // 无虚拟画像（含真实用户）→ 无队列标签，剔除
    unparsed,
    // 标签侧
    virtualProfiles: profileRows.length,
    profilesWithLabel,
    profilesUnknownLabel: profileRows.length - profilesWithLabel,
    eventUsers: eventUsers.size,
    eventUsersWithLabel,
    eventUsersUnknownLabel: eventUsers.size - eventUsersWithLabel,
  };

  const caveat =
    '观察性数据，非因果结论：队列间差异可能来自样本量/任务分布/标签覆盖等混杂因素；' +
    '分层基于虚拟学习者（真实用户无队列标签已剔除），不代表真实用户人口学公平性；' +
    '台账只在“出现理由”时写入，“keep 且无理由”的任务不在样本内，覆盖率天然不完整。';

  if (hasFlag('json')) {
    console.log(JSON.stringify({ coverage, caveat, report }, null, 2));
    return;
  }

  console.log(`\n难度分配分层公平审计｜近 ${days} 天｜策略=${strategy}`);
  console.log(caveat);
  console.log(
    `台账：原始 ${evidenceRows.length} 条 → 采用 ${events.length} 条` +
      `（无虚拟画像剔除 ${excludedNoProfile}；解析失败 ${unparsed}）`,
  );
  console.log(
    `标签覆盖：虚拟画像 ${profileRows.length} 个，解析出队列键 ${profilesWithLabel} 个` +
      `（unknown ${profileRows.length - profilesWithLabel}）；` +
      `事件用户 ${eventUsers.size} 个，其中有队列键 ${eventUsersWithLabel} 个`,
  );

  if (report.cohorts.length === 0) {
    console.log('\n（无可用队列样本）\n');
    return;
  }

  const header = ['队列', '学习者', '任务', '降档', '升档', '均值Δ', '贴地板', '地板抬回', '标记'];
  const rows = report.cohorts.map((cohort) => [
    cohort.cohortKey,
    String(cohort.learners),
    String(cohort.tasks),
    pct(cohort.decreaseShare),
    pct(cohort.increaseShare),
    cohort.meanDelta.toFixed(2),
    pct(cohort.pinnedLowShare),
    pct(cohort.floorAppliedShare),
    pct(cohort.flaggedShare),
  ]);
  const widths = header.map((title, col) =>
    Math.max(title.length, ...rows.map((row) => row[col].length)),
  );
  const formatRow = (cells: string[]) =>
    cells.map((cell, col) => cell.padEnd(widths[col])).join('  ');

  console.log(`\n${formatRow(header)}`);
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(formatRow(row));

  console.log('\n组间差异（disparity = max - min，观测值，非因果）：');
  for (const metric of [report.disparity.increaseShare, report.disparity.meanDelta]) {
    const minKey = metric.minCohortKey ?? '—';
    const maxKey = metric.maxCohortKey ?? '—';
    const asPct = metric.metric === 'increaseShare';
    const show = (value: number) => (asPct ? pct(value) : value.toFixed(2));
    console.log(
      `  · ${metric.metric}: span=${asPct ? pct(metric.span) : metric.span.toFixed(2)}` +
        `（min ${show(metric.min)} @ ${minKey}｜max ${show(metric.max)} @ ${maxKey}）`,
    );
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
