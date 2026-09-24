/**
 * Agent 审计修复的确定性验证（只读，无 LLM 依赖）：
 *  A) 修复 1：画像聚合器现在持久化 goal narratives → profile.narratives.learningSignal 可读
 *  B) 修复 2：学习状态的衰减读取（getPreviousMetrics/getAggregatedState）在模拟时钟内按**模拟日**折算
 *  C) 修复 3 的语义：active 续课先验经 restoreMetrics 衰减（同日零衰减 / 隔日按日因子）
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/verify-agent-audit-fixes.ts [--user=<ID>] [--simday=2026-09-23]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { profileAggregator } from '../agents/learner-model-agent/profile-aggregator';
import learningStateService from '../services/learning/learning-state.service';
import { learnerSnapshotRefreshService } from '../services/learner/LearnerSnapshotRefreshService';
import { runWithSimulatedClock } from '../services/virtual-lab/simulation-clock-context';
import { getAppTimeZone, dayKeyOf, dayDiffInDays, parseDayKeyStart } from '../services/time/day-boundary';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const explicitUser = arg('user');
  const simDay = arg('simday') || '2026-09-23';

  // 选一个 goal 数据里有 learning_signal 的用户
  const candidate = explicitUser
    ? { userId: explicitUser }
    : await prisma.goal_conversations.findFirst({
        where: { status: 'completed', collectedData: { contains: 'learning_signal' } },
        orderBy: { createdAt: 'desc' },
        select: { userId: true },
      });
  if (!candidate) { console.log('找不到候选用户'); return; }
  const userId = candidate.userId;

  // 原始 goal 数据里的 learning_signal（真源）
  const conv = await prisma.goal_conversations.findFirst({
    where: { userId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
    select: { collectedData: true },
  });
  const raw = (conv?.collectedData || '').match(/"learning_signal"\s*:\s*"([^"]{1,200})"/);
  console.log('=== A) learningSignal 断链修复 ===');
  console.log(`user=${userId}`);
  console.log(`goal 侧 learning_signal（真源）= ${raw ? JSON.stringify(raw[1].slice(0, 80)) : '(空)'}`);

  const { profile } = await profileAggregator.aggregateProfile(userId);
  const viaProfile = (profile as any)?.narratives?.learningSignal;
  console.log(`profile.narratives.learningSignal（修复后应可读）= ${JSON.stringify(viaProfile ?? null)}`);
  console.log(`判定：${raw && viaProfile ? 'PASS（断链已通）' : raw ? 'FAIL（goal 有值但 profile 读不到）' : 'N/A（该用户 goal 侧本就为空）'}`);

  // === B) 模拟时钟下的衰减读取 ===
  console.log('\n=== B) 学习状态衰减的时钟域 ===');
  const metric = await prisma.learning_metrics.findFirst({
    where: { userId, metricType: 'learning_state', lss: { not: null } },
    orderBy: { calculatedAt: 'desc' },
    select: { calculatedAt: true, lss: true, lf: true, lsb: true },
  });
  if (!metric) { console.log('该用户无 committed 状态行，跳过 B'); return; }
  const stored = { lss: metric.lss!, lf: metric.lf! };
  console.log(`最新 committed 行：calculatedAt=${metric.calculatedAt.toISOString()} lss=${stored.lss} lf=${stored.lf}`);

  const realRead = await learningStateService.getPreviousMetrics(userId);
  console.log(`真实墙钟读取（无模拟上下文）：lss=${realRead?.lss.toFixed(3)} lf=${realRead?.lf.toFixed(3)}`);

  const simAsOf = new Date(`${simDay}T23:59:59.999Z`);
  await runWithSimulatedClock(simAsOf, async () => {
    const simRead = await learningStateService.getPreviousMetrics(userId);
    const dayDiff = Math.round(
      (Date.UTC(simAsOf.getUTCFullYear(), simAsOf.getUTCMonth(), simAsOf.getUTCDate())
        - Date.UTC(metric.calculatedAt.getUTCFullYear(), metric.calculatedAt.getUTCMonth(), metric.calculatedAt.getUTCDate())) / 86400000,
    );
    const expectedLf = 1.2 + (stored.lf - 1.2) * 0.74 ** Math.max(0, dayDiff);
    const expectedLss = stored.lss * 0.82 ** Math.max(0, dayDiff);
    console.log(`模拟日 ${simDay} 读取（日差 ${dayDiff} 天）：lss=${simRead?.lss.toFixed(3)} lf=${simRead?.lf.toFixed(3)}`);
    console.log(`按模拟日的期望值：lss=${expectedLss.toFixed(3)} lf=${expectedLf.toFixed(3)}`);
    const okLf = simRead ? Math.abs(simRead.lf - expectedLf) < 1e-6 : false;
    const okLss = simRead ? Math.abs(simRead.lss - expectedLss) < 1e-6 : false;
    console.log(`判定：${okLf && okLss ? 'PASS（衰减按模拟日折算）' : 'FAIL'}`);

    const agg = await learningStateService.getAggregatedState(userId);
    console.log(`模拟时钟内 getAggregatedState：lf=${agg?.metrics.lf.toFixed(3)} dayLoad=${JSON.stringify(agg?.dayLoad)}`);
  });

  // === C) 续课先验的衰减语义（修复 3 的契约） ===
  console.log('\n=== C) active 续课先验衰减（同日/隔日，按应用时区本地日） ===');
  const localAt = (dayKey: string, hour: number) =>
    new Date(parseDayKeyStart(dayKey, getAppTimeZone()).getTime() + hour * 3600 * 1000);
  const resumed = learningStateService.coerceMetrics({ lss: 6.4, ktl: 3.2, lf: 6.2, lsb: -3.0, timestamp: localAt('2026-08-01', 10).toISOString() });
  const sameDay = learningStateService.restoreMetrics(resumed!, localAt('2026-08-01', 20));
  const nextDay = learningStateService.restoreMetrics(resumed!, localAt('2026-08-02', 10));
  console.log(`同日续课 lf=${sameDay.lf.toFixed(3)}（应=6.200，课内连续）| 隔日 lf=${nextDay.lf.toFixed(3)}（应=${(1.2 + (6.2 - 1.2) * 0.74).toFixed(3)}）`);
  console.log(`判定：${Math.abs(sameDay.lf - 6.2) < 1e-6 && Math.abs(nextDay.lf - (1.2 + 5 * 0.74)) < 1e-6 ? 'PASS' : 'FAIL'}`);

  // === D) 全链：聚合器 → 快照落库 → 教学侧读取点 ===
  console.log('\n=== D) learningSignal 全链（快照 → 教学读取点） ===');
  const path = await prisma.learning_paths.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!path) { console.log('该用户无学习路径，跳过 D'); return; }
  const refreshed = await learnerSnapshotRefreshService.refresh({ userId, pathId: path.id, scope: 'teaching' });
  const snapshotSignal = (refreshed as any)?.profile?.narratives?.learningSignal ?? null;
  console.log(`refresh(scope=teaching) 后 snapshot.profile.narratives.learningSignal = ${JSON.stringify(String(snapshotSignal ?? '').slice(0, 70))}`);
  const readBack = await learnerSnapshotRefreshService.getLatest({ userId, pathId: path.id, scope: 'teaching' });
  const readBackSignal = (readBack as any)?.profile?.narratives?.learningSignal ?? null;
  const persisted = await prisma.learner_projections.findFirst({
    where: { userId, scope: 'teaching' },
    orderBy: { generatedAt: 'desc' },
    select: { payload: true, generatedAt: true },
  });
  let persistedSignal: unknown = null;
  try { persistedSignal = JSON.parse(persisted?.payload || '{}')?.profile?.narratives?.learningSignal ?? null; } catch { /* ignore */ }
  console.log(`getLatest 读回（TeachingContextBuilder 用的同一入口）= ${JSON.stringify(String(readBackSignal ?? '').slice(0, 70))}`);
  console.log(`DB 落库（learner_projections.payload.profile.narratives.learningSignal）= ${JSON.stringify(String(persistedSignal ?? '').slice(0, 70))} @ ${persisted?.generatedAt.toISOString()}`);
  console.log(`判定：${snapshotSignal && readBackSignal && persistedSignal ? 'PASS（教学侧可读到 goal 学习信号）' : 'FAIL'}`);

  // === E) 日界统一：全部走应用时区本地日（day-boundary 单一真理源） ===
  console.log('\n=== E) 日界统一（应用时区本地日） ===');
  const window = await learningStateService.getStateTrendWindow(userId, { days: 7 });
  const last = window.trends[window.trends.length - 1];
  const tz = getAppTimeZone();
  const lastKey = last ? dayKeyOf(last.date, tz) : null;
  const todayKey = dayKeyOf(new Date(), tz);
  // 趋势锚点应为"本地正午"：其本地小时 = 12
  const localHour = last ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(last.date)) : null;
  console.log(`应用时区=${tz}`);
  console.log(`趋势点示例：${window.trends.slice(-3).map((p) => `${p.date.toISOString()}(key=${dayKeyOf(p.date, tz)}, lss=${p.lss ?? 'null'})`).join(' | ')}`);
  console.log(`最后一点 key=${lastKey}（今天 key=${todayKey}）本地小时=${localHour}`);
  console.log(`判定：${lastKey === todayKey && localHour === 12 ? 'PASS（趋势按本地日锚点，口径与前端 localDateKey 一致）' : 'FAIL'}`);

  // 衰减日差按本地日
  const metricRow = await prisma.learning_metrics.findFirst({
    where: { userId, metricType: 'learning_state', lss: { not: null } },
    orderBy: { calculatedAt: 'desc' },
    select: { calculatedAt: true },
  });
  if (metricRow) {
    const rowKey = dayKeyOf(metricRow.calculatedAt, tz);
    const diffLocal = dayDiffInDays(metricRow.calculatedAt, new Date(), tz);
    const diffUtc = dayDiffInDays(metricRow.calculatedAt, new Date(), 'UTC');
    // 期望：本地日差 = 两个**本地日期键**之间的日历天数（不依赖 UTC 切日）
    const expectedLocalDiff = Math.round(
      (parseDayKeyStart(todayKey, tz).getTime() - parseDayKeyStart(rowKey, tz).getTime()) / 86400000,
    );
    console.log(`最新 committed 行 ${metricRow.calculatedAt.toISOString()}（本地日 key=${rowKey}）→ 本地日差=${diffLocal} / UTC 日差=${diffUtc} / 期望=${expectedLocalDiff}`);
    console.log(`判定：${diffLocal === expectedLocalDiff ? 'PASS（衰减日差按本地日界）' : 'FAIL'}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
