/**
 * 学习者休眠 / 流失只读审计（Q19 · M0）
 *
 * 从**既有时间戳**推导每个真实用户的"上次活跃"，输出休眠分档分布与 at-risk 名单。
 * **只读，不写任何库、不发 LLM、不跑 prompts。**
 *
 * "上次活跃"口径（优先级从高到低，实际取学习活动两者中较新者）：
 *   1. `teaching_sessions.startTime`（真实教学会话，最可靠的学习活动）
 *   2. `learner_evidence.occurredAt`（学习证据事件，如温故/检查点）
 *   3. `users.lastLoginAt`（**兜底**：无任何学习活动时）
 * 设计依据：`doc/UPGRADE_DIRECTION_20Q.md` §2 Q19。
 * 与设计的细微差异：本脚本对 (1)(2) 取**较新者**而非严格按顺序取，
 * 以免"有会话但之后还有温故"时低估活跃；`lastLoginAt` 仅在没有学习活动时兜底。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-churn-signals.ts
 *   npx ts-node --transpile-only src/scripts/audit-churn-signals.ts --days=14 --top=30
 *   npx ts-node --transpile-only src/scripts/audit-churn-signals.ts --include-virtual --json
 *
 * 参数：
 *   --days=N            覆盖 dormant 分层阈值（默认 14 天），决定 at-risk 主分界
 *   --cooling=N         覆盖 cooling 阈值（默认 7）
 *   --lost=N            覆盖 lost 阈值（默认 30）
 *   --include-virtual   纳入虚拟学习者（默认只统计 isVirtualLearner=false）
 *   --top=N             at-risk 名单打印条数（默认 20）
 *   --json              机器可读输出（含 coverage / caveat / summary）
 */
import 'dotenv/config';
import prisma from '../config/database';
import {
  CHURN_SIGNAL_CAVEAT,
  DEFAULT_DORMANCY_THRESHOLDS,
  resolveDormancyThresholds,
  summarizeChurn,
  type ChurnUserSignal,
  type DormancyThresholds,
} from '../services/learner/churn-signals';

export interface Args {
  /** 覆盖 dormantDays */
  days: number | null;
  cooling: number | null;
  lost: number | null;
  json: boolean;
  includeVirtual: boolean;
  top: number;
}

function parseIntArg(value: string | undefined): number | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { days: null, cooling: null, lost: null, json: false, includeVirtual: false, top: 20 };
  for (const raw of argv) {
    if (raw === '--json') {
      args.json = true;
      continue;
    }
    if (raw === '--include-virtual') {
      args.includeVirtual = true;
      continue;
    }
    const [key, value] = raw.split('=');
    if (key === '--days') args.days = parseIntArg(value);
    else if (key === '--cooling') args.cooling = parseIntArg(value);
    else if (key === '--lost') args.lost = parseIntArg(value);
    else if (key === '--top') args.top = parseIntArg(value) ?? args.top;
    else if (key) throw new Error(`未知参数：${raw}`);
  }
  return args;
}

type LastActiveSource = 'teaching_session' | 'learner_evidence' | 'last_login' | 'none';

interface ResolvedUser {
  userId: string;
  lastActiveAt: Date | null;
  source: LastActiveSource;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

/** 取 `max` 中较新者（null 视为无）。 */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  const thresholds: DormancyThresholds = {
    coolingDays: args.cooling ?? DEFAULT_DORMANCY_THRESHOLDS.coolingDays,
    dormantDays: args.days ?? DEFAULT_DORMANCY_THRESHOLDS.dormantDays,
    lostDays: args.lost ?? DEFAULT_DORMANCY_THRESHOLDS.lostDays,
  };
  // `--days` 是 at-risk 主分界：若它挤掉了未显式指定的相邻档（如 --days=7 与默认 cooling=7 撞线），
  // 自动让位保证 cooling < dormant < lost；显式冲突的 --cooling/--lost 仍交给 resolve 抛错。
  if (args.days !== null) {
    if (args.cooling === null && thresholds.coolingDays >= thresholds.dormantDays) {
      thresholds.coolingDays = Math.max(1, thresholds.dormantDays - 1);
    }
    if (args.lost === null && thresholds.lostDays <= thresholds.dormantDays) {
      thresholds.lostDays = thresholds.dormantDays + 1;
    }
  }
  // 非法阈值在此抛出（cooling < dormant < lost）
  const resolved = resolveDormancyThresholds(thresholds);

  // 只读：真实用户（默认排除虚拟学习者）；删除的账号任何模式下都排除
  const users = await prisma.users.findMany({
    where: {
      deletedAt: null,
      ...(args.includeVirtual ? {} : { isVirtualLearner: false }),
    },
    select: { id: true, lastLoginAt: true },
  });
  const userIds = users.map((user) => user.id);

  const [sessionGroups, evidenceGroups] = await Promise.all([
    userIds.length
      ? prisma.teaching_sessions.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { startTime: true } })
      : Promise.resolve([]),
    userIds.length
      ? prisma.learner_evidence.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { occurredAt: true } })
      : Promise.resolve([]),
  ]);

  const sessionMax = new Map<string, Date>();
  for (const row of sessionGroups) {
    if (row._max.startTime) sessionMax.set(row.userId, row._max.startTime);
  }
  const evidenceMax = new Map<string, Date>();
  for (const row of evidenceGroups) {
    if (row._max.occurredAt) evidenceMax.set(row.userId, row._max.occurredAt);
  }

  const resolvedUsers: ResolvedUser[] = users.map((user) => {
    const session = sessionMax.get(user.id) ?? null;
    const evidence = evidenceMax.get(user.id) ?? null;
    const learning = laterOf(session, evidence);
    if (learning) {
      // 学习活动两者取较新；来源按胜出者归因
      const source: LastActiveSource =
        session && (!evidence || session.getTime() >= evidence.getTime())
          ? 'teaching_session'
          : 'learner_evidence';
      return { userId: user.id, lastActiveAt: learning, source };
    }
    if (user.lastLoginAt) {
      return { userId: user.id, lastActiveAt: user.lastLoginAt, source: 'last_login' };
    }
    return { userId: user.id, lastActiveAt: null, source: 'none' };
  });

  const signals: ChurnUserSignal[] = resolvedUsers.map((user) => ({
    userId: user.userId,
    lastActiveAt: user.lastActiveAt,
  }));
  const summary = summarizeChurn(signals, { now, thresholds: resolved });

  // coverage：说明"上次活跃"的来源与覆盖
  const sourceCounts: Record<LastActiveSource, number> = { teaching_session: 0, learner_evidence: 0, last_login: 0, none: 0 };
  for (const user of resolvedUsers) sourceCounts[user.source] += 1;
  const withLearningActivity = sourceCounts.teaching_session + sourceCounts.learner_evidence;
  const coverage = {
    now: now.toISOString(),
    thresholds: resolved,
    includeVirtual: args.includeVirtual,
    totalUsers: users.length,
    withTeachingSession: sessionMax.size,
    withLearnerEvidence: evidenceMax.size,
    withLearningActivity,
    lastLoginFallback: sourceCounts.last_login,
    neverActive: sourceCounts.none,
    sourceAttribution: sourceCounts,
    lastActiveSource:
      'teaching_sessions.startTime 与 learner_evidence.occurredAt 取较新者；两者皆无才兜底 users.lastLoginAt',
  };

  if (args.json) {
    console.log(JSON.stringify({ coverage, caveat: CHURN_SIGNAL_CAVEAT, summary }, null, 2));
    return;
  }

  console.log(`\n[churn] 学习者休眠只读审计｜now=${coverage.now}`);
  console.log(`[churn] 阈值：cooling>=${resolved.coolingDays}d｜dormant>=${resolved.dormantDays}d｜lost>=${resolved.lostDays}d`);
  console.log(`[churn] 口径：${coverage.lastActiveSource}`);
  console.log(
    `[churn] 用户：${users.length}（${args.includeVirtual ? '含虚拟学习者' : '仅真实用户 isVirtualLearner=false'}，已排除 deletedAt!=null）`,
  );
  console.log(
    `[churn] 覆盖：有学习活动 ${withLearningActivity}（${pct(users.length ? withLearningActivity / users.length : 0)}）` +
      `｜仅 lastLoginAt 兜底 ${sourceCounts.last_login}｜从无活跃 ${sourceCounts.none}`,
  );
  console.log(
    `[churn] 来源归因：teaching_sessions ${sourceCounts.teaching_session}｜learner_evidence ${sourceCounts.learner_evidence}` +
      `｜lastLoginAt 兜底 ${sourceCounts.last_login}｜无 ${sourceCounts.none}`,
  );
  console.log(
    `[churn] 分档：active=${summary.byBucket.active}｜cooling=${summary.byBucket.cooling}` +
      `｜dormant=${summary.byBucket.dormant}｜lost=${summary.byBucket.lost}｜neverActive=${summary.byBucket.neverActive}`,
  );
  console.log(
    `[churn] dormancyRate=${pct(summary.dormancyRate)}（dormant+lost+neverActive / total=${summary.total}）` +
      `｜中位距上次活跃=${summary.medianDaysSinceActive === null ? '—' : summary.medianDaysSinceActive.toFixed(1)} 天`,
  );

  if (summary.atRisk.length === 0) {
    console.log('\n[churn] 无 at-risk 用户。');
  } else {
    console.log(`\n[churn] at-risk（dormant/lost/neverActive，前 ${args.top} / 共 ${summary.atRisk.length}）：`);
    for (const entry of summary.atRisk.slice(0, args.top)) {
      const days = entry.daysSinceActive === null ? '从未活跃' : `${entry.daysSinceActive.toFixed(1)}d`;
      console.log(`  · ${entry.userId.padEnd(26)}  ${entry.bucket.padEnd(7)} risk=${entry.risk.toFixed(3)}  ${days}`);
    }
  }
  console.log(`\n[churn] 注：${CHURN_SIGNAL_CAVEAT}`);
  console.log('');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
