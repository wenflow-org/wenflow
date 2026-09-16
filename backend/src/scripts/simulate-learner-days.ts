/**
 * 虚拟学习者 · **日期模拟验证**（把路径隔离 / 总负担 / 信号区分固化成可回归断言）
 *
 * 原理：不需要 mock 时间。`learning_metrics.calculatedAt` 取自写入时传入的 `timestamp`
 * （`SessionMetricsInput.timestamp → asOf → metrics.timestamp → calculatedAt`），
 * 读取侧又都按 `asOf` 过滤 —— 所以把"第 N 天的第 K 节课"用**过去的日期**写进去，
 * 再以那一天的 `asOf` 去读，就能在真实代码路径上重放历史。
 *
 * 为了让模拟是**封闭的**（不受学习者真实历史干扰）：
 * - 用独立的模拟路径 `lp_sim_<run>_A/B`（不碰真实路径）；
 * - 模拟日期选在过去，聚合的读取窗口（`calculatedAt <= asOf`）天然排除真实行；
 * - 当日课量（subtasks.completedAt / teaching_sessions.startTime）也只建模拟行的。
 *
 * 三条断言（对应"一天多课、多路径"）：
 *  1. 路径隔离：路径 A 的难课**不改变**路径 B 的演变（B 的第 2 节课接在 B 的第 1 节，而不是 A）；
 *  2. 总负担：一天 3 节课 → 全局疲劳按当日课量上升，而各节课自己的 LSS 互不污染；
 *  3. 信号区分：「这门课难」→ 课内降档但全局节奏不变；「最近太累」→ 全局节奏转 slow + fatigue_high。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/simulate-learner-days.ts --user=<虚拟学习者ID> --dry-run
 *   npx ts-node --transpile-only src/scripts/simulate-learner-days.ts --user=<虚拟学习者ID> --apply
 *   （加 --keep 保留模拟数据；默认跑完清理，不留痕迹）
 */
import 'dotenv/config';
import prisma from '../config/database';
import learningStateService, { computeDayLoadFatigueBonus } from '../services/learning/learning-state.service';
import { updateLearningMetrics } from '../services/metrics/LearningMetricService';
import {
  deriveLearningControlState,
  derivePacing,
  deriveReplanSignal,
} from '../services/learner/LearnerSnapshotService';

/** EWMA 系数（与 LearningMetricService 的派生公式一致，断言里用来算两种预测值）
 * 注意：lf 的新值系数是 0.15（不是 1-0.7），ktl 的是 0.05（= 1-0.95）—— 公式本身不是严格凸组合。 */
const KTL_LAMBDA = 0.95;
const KTL_NEW_TERM = 0.05;
const LF_LAMBDA = 0.7;
const LF_NEW_TERM = 0.15;

export interface SimLesson {
  /** 相对起始日的天数（0 = 起始日） */
  dayOffset: number;
  pathKey: 'A' | 'B';
  /** 1-10 主观难度 */
  difficulty: number;
  durationMinutes: number;
}

export interface SimPlan {
  days: number;
  lessons: SimLesson[];
}

/**
 * 默认剧本：
 * - 第 1 天：路径 A 连上两节难课（difficulty 9）→ 用于断言"路径隔离"
 * - 第 2 天：路径 B 两节常规课（difficulty 5）→ B 应只接自己的第 1 节
 * - 第 3 天：一天三节、跨两条路径 → 用于断言"当日课量 → 全局疲劳"
 */
export function buildDefaultPlan(): SimPlan {
  return {
    days: 3,
    lessons: [
      { dayOffset: 0, pathKey: 'A', difficulty: 9, durationMinutes: 45 },
      { dayOffset: 0, pathKey: 'A', difficulty: 9, durationMinutes: 45 },
      { dayOffset: 1, pathKey: 'B', difficulty: 5, durationMinutes: 30 },
      { dayOffset: 1, pathKey: 'B', difficulty: 5, durationMinutes: 30 },
      { dayOffset: 2, pathKey: 'A', difficulty: 5, durationMinutes: 30 },
      { dayOffset: 2, pathKey: 'B', difficulty: 5, durationMinutes: 30 },
      { dayOffset: 2, pathKey: 'A', difficulty: 6, durationMinutes: 30 },
    ],
  };
}

export function lessonsForDay(plan: SimPlan, dayOffset: number): SimLesson[] {
  return plan.lessons.filter((lesson) => lesson.dayOffset === dayOffset);
}

export function parseArgs(argv: string[]): { apply: boolean; keep: boolean; user: string | null } {
  const args = { apply: false, keep: false, user: null as string | null };
  for (const arg of argv) {
    if (arg === '--dry-run') args.apply = false;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--keep') args.keep = true;
    else if (arg.startsWith('--user=')) args.user = arg.slice('--user='.length).trim() || null;
    else if (arg) throw new Error(`未知参数：${arg}`);
  }
  return args;
}

interface Assertion {
  name: string;
  pass: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.user) {
    throw new Error('必须显式指定 --user=<虚拟学习者ID>（避免误污染真实账号）');
  }
  const userId = args.user;
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!user) throw new Error(`用户不存在：${userId}`);

  const runId = `sim${Date.now().toString(36)}`;
  // 时间模型与生产一致：自然衰减按**本地日历日**（getNaturalDayDiff），当日课量按 **UTC 日**（ReviewQuotaService 同口径）。
  // 因此把课放在上午（本地 09:00 起），并把"观察时刻"取在当天最后一节课后 1 小时 ——
  // 这样既不会跨本地日（不产生多余衰减），也不会跨 UTC 日（当日课量数得全）。
  const baseDay = new Date();
  baseDay.setDate(baseDay.getDate() - 30);
  const dayStart = (offset: number) => new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate() + offset);
  const lessonTime = (offset: number, indexInDay: number) => new Date(dayStart(offset).getTime() + (9 + indexInDay) * 3600_000);
  const dayAsOf = (plan: SimPlan, offset: number) =>
    new Date(dayStart(offset).getTime() + (9 + Math.max(1, lessonsForDay(plan, offset).length)) * 3600_000);

  const plan = buildDefaultPlan();
  const pathIds: Record<'A' | 'B', string> = { A: `lp_${runId}_a`, B: `lp_${runId}_b` };

  console.log(`[sim] 学习者 ${user.name || userId}｜run=${runId}｜模拟天数 ${plan.days}｜起始日 ${dayStart(0).toISOString().slice(0, 10)}`);
  console.log(`[sim] 模拟路径 A=${pathIds.A}  B=${pathIds.B}`);
  for (let day = 0; day < plan.days; day += 1) {
    const dayLessons = lessonsForDay(plan, day);
    console.log(`  day${day} (${dayStart(day).toISOString().slice(0, 10)}) : ${dayLessons.map((l) => `${l.pathKey} d${l.difficulty}/${l.durationMinutes}min`).join('  ')}`);
  }
  const day3Lessons = lessonsForDay(plan, 2);
  console.log(`[sim] 第 3 天课量= ${day3Lessons.length} 节 → 预期疲劳加成 ${computeDayLoadFatigueBonus({ lessons: day3Lessons.length, minutes: day3Lessons.reduce((s, l) => s + l.durationMinutes, 0) })}`);

  if (!args.apply) {
    console.log('\n[sim] dry-run 结束（未写库）。确认剧本后跑 --apply');
    return;
  }

  const createdSubtasks: string[] = [];
  const createdSessions: string[] = [];
  const assertions: Assertion[] = [];

  try {
    // 1) 建两条模拟路径（+里程碑，subtasks 需要 FK）
    for (const key of ['A', 'B'] as const) {
      await prisma.learning_paths.create({
        data: {
          id: pathIds[key], userId, title: `[sim ${runId}] 路径${key}`, status: 'active',
          createdAt: dayStart(0), updatedAt: dayStart(0),
        },
      });
      await prisma.milestones.create({
        data: {
          id: `ms_${runId}_${key}`, learningPathId: pathIds[key], stageNumber: 1,
          title: `[sim ${runId}] 阶段1`, status: 'in_progress', order: 1,
          createdAt: dayStart(0), updatedAt: dayStart(0),
        },
      });
    }

    // 2) 按天重放（真实写入路径：updateLearningMetrics + 回填日期）
    const rowByLesson = new Map<string, { lss: number; ktl: number; lf: number; lsb: number }>();
    for (let day = 0; day < plan.days; day += 1) {
      const dayLessons = lessonsForDay(plan, day);
      for (let index = 0; index < dayLessons.length; index += 1) {
        const lesson = dayLessons[index];
        const at = lessonTime(day, index);
        const taskId = `sim-${runId}-d${day}-${index}`;
        await prisma.subtasks.create({
          data: {
            id: taskId, milestoneId: `ms_${runId}_${lesson.pathKey}`, userId,
            title: `[sim] day${day}#${index}`, status: 'completed', completedAt: at,
            estimatedMinutes: lesson.durationMinutes, createdAt: at, updatedAt: at,
          },
        });
        createdSubtasks.push(taskId);
        const sessionId = `ts_${runId}_d${day}_${index}`;
        await prisma.teaching_sessions.create({
          data: {
            id: sessionId, userId, taskId, learningPathId: pathIds[lesson.pathKey],
            milestoneId: `ms_${runId}_${lesson.pathKey}`, subject: 'sim', topic: `[sim] day${day}#${index}`,
            status: 'completed', startTime: at, endTime: new Date(at.getTime() + lesson.durationMinutes * 60_000),
            duration: lesson.durationMinutes, createdAt: at, updatedAt: at,
          },
        });
        createdSessions.push(sessionId);

        await updateLearningMetrics({
          userId,
          taskId,
          pathId: pathIds[lesson.pathKey],
          durationMinutes: lesson.durationMinutes,
          subjectiveDifficulty: lesson.difficulty,
          completed: true,
          timestamp: at,
        });
        const row = await prisma.learning_metrics.findFirst({
          where: { userId, taskId },
          select: { lss: true, ktl: true, lf: true, lsb: true },
        });
        if (row) {
          rowByLesson.set(`${day}-${index}`, {
            lss: Number(row.lss), ktl: Number(row.ktl), lf: Number(row.lf), lsb: Number(row.lsb),
          });
        }
      }
    }

    const stateAt = async (pathKey: 'A' | 'B', day: number) =>
      learningStateService.getCurrentState(userId, { pathId: pathIds[pathKey], asOf: dayAsOf(plan, day) });

    // ── 断言 1：路径隔离（B 的第 2 节课接 B 的第 1 节，而不是 A 的最后那节）
    const b1 = rowByLesson.get('1-0');
    const b2 = rowByLesson.get('1-1');
    const aLast = rowByLesson.get('0-1');
    if (b1 && b2 && aLast) {
      const fromB = { ktl: b1.ktl * KTL_LAMBDA + b2.lss * KTL_NEW_TERM, lf: b1.lf * LF_LAMBDA + b2.lss * LF_NEW_TERM };
      const fromA = { ktl: aLast.ktl * KTL_LAMBDA + b2.lss * KTL_NEW_TERM, lf: aLast.lf * LF_LAMBDA + b2.lss * LF_NEW_TERM };
      const dFromB = Math.abs(b2.ktl - fromB.ktl) + Math.abs(b2.lf - fromB.lf);
      const dFromA = Math.abs(b2.ktl - fromA.ktl) + Math.abs(b2.lf - fromA.lf);
      assertions.push({
        name: '路径隔离：B 的第 2 节课接在 B 自己的第 1 节上（不是 A 的难课）',
        pass: dFromB < 1e-3 && dFromA > 0.5,
        detail: `B1 ktl ${b1.ktl} lf ${b1.lf}｜A末 ktl ${aLast.ktl} lf ${aLast.lf}｜B2 实际 ktl ${b2.ktl} lf ${b2.lf}`
          + `｜预测(本路径) ktl ${fromB.ktl.toFixed(4)} lf ${fromB.lf.toFixed(4)}`
          + `｜预测(跨路径) ktl ${fromA.ktl.toFixed(4)} lf ${fromA.lf.toFixed(4)}`
          + `｜偏差 本路径 ${dFromB.toFixed(4)} vs 跨路径 ${dFromA.toFixed(4)}`,
      });
    } else {
      assertions.push({ name: '路径隔离', pass: false, detail: '缺少样本行' });
    }

    // ── 断言 2：一天 3 节课 → 全局疲劳按课量上升；各节课 LSS 互不污染
    const day3 = lessonsForDay(plan, 2);
    const day3Minutes = day3.reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
    const expectedBonus = computeDayLoadFatigueBonus({ lessons: day3.length, minutes: day3Minutes });
    const aggregateDay3 = await learningStateService.getAggregatedState(userId, { asOf: dayAsOf(plan, 2) });
    const perLessonLssOk = day3.every((lesson, index) => {
      const row = rowByLesson.get(`2-${index}`);
      // 完成态 LSS：difficulty × 10 × 0.8 → 归一到 0-10 → 落库
      return row != null && Math.abs(row.lss - lesson.difficulty * 0.8) < 1e-6;
    });
    const maxLfDay3 = Math.max(...(aggregateDay3?.perPath.map((entry) => entry.metrics.lf) ?? [0]));
    const expectedLf = Math.min(10, maxLfDay3 + expectedBonus);
    assertions.push({
      name: '总负担：第 3 天课量进入全局疲劳加成，且各节课 LSS 各自独立',
      pass: Boolean(aggregateDay3)
        && aggregateDay3!.dayLoad.lessons === day3.length
        && Math.abs(aggregateDay3!.dayLoad.fatigueBonus - expectedBonus) < 1e-6
        && Math.abs(aggregateDay3!.metrics.lf - expectedLf) < 1e-3
        && perLessonLssOk,
      detail: `课量 ${aggregateDay3?.dayLoad.lessons}/${aggregateDay3?.dayLoad.minutes}min 加成 ${aggregateDay3?.dayLoad.fatigueBonus}`
        + `（期望 ${expectedBonus}）｜全局 lf ${aggregateDay3?.metrics.lf}（期望 max路径 ${maxLfDay3.toFixed(4)}+${expectedBonus}=${expectedLf.toFixed(4)}）`
        + `｜各课 LSS 独立 ${perLessonLssOk}（${day3.map((lesson, index) => `d${lesson.difficulty}→${rowByLesson.get(`2-${index}`)?.lss}`).join(', ')}）`,
    });

    // ── 断言 3：信号区分「这门课难」vs「最近太累」
    const aggregateDay1 = await learningStateService.getAggregatedState(userId, { asOf: dayAsOf(plan, 0) });
    const pathAState = await stateAt('A', 0);
    const baseKnowledge = {
      globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: [] },
      globalBackground: { blockedFoundations: [] },
    } as any;
    const hardLessonControl = aggregateDay1 && pathAState
      ? deriveLearningControlState({
          dynamicState: {
            metrics: aggregateDay1.metrics, recentTrend: 'stable', fatigueRisk: aggregateDay1.metrics.lf >= 6 ? 'high' : 'low',
            confidenceTrend: 'stable', recentSessionQuality: 'mixed', recommendedPacing: 'moderate',
            recommendedInteraction: { hintTiming: 'delayed', encouragement: 'medium', challenge: 'medium' },
            srlPhase: 'performance',
          } as any,
          knowledgeMemory: baseKnowledge,
          lessonMetrics: { lss: pathAState.lss, ktl: pathAState.ktl, lf: pathAState.lf, lsb: pathAState.lsb },
        })
      : null;
    const hardLessonReplan = aggregateDay1 && hardLessonControl
      ? deriveReplanSignal({
          dynamicState: { metrics: aggregateDay1.metrics, recentTrend: 'stable', fatigueRisk: aggregateDay1.metrics.lf >= 6 ? 'high' : 'low' } as any,
          learningControlState: hardLessonControl,
          knowledgeMemory: baseKnowledge,
        })
      : null;

    // "最近太累"：把全局疲劳直接推到 ≥6（等价于连续多日高负荷后的累积状态）
    const tiredMetrics = { lss: 3, ktl: 5, lf: 7, lsb: -2 };
    const tiredPacing = derivePacing(tiredMetrics.lf, tiredMetrics.ktl);
    const tiredReplan = deriveReplanSignal({
      dynamicState: { metrics: tiredMetrics, recentTrend: 'declining', fatigueRisk: 'high' } as any,
      learningControlState: { reviewPriority: 'medium' } as any,
      knowledgeMemory: baseKnowledge,
    });

    assertions.push({
      name: '信号区分：单课难 → 课内降档、全局节奏不变；最近太累 → 全局 slow + fatigue_high',
      pass: Boolean(aggregateDay1 && pathAState && hardLessonControl && hardLessonReplan)
        && hardLessonControl!.paceMode === 'recover'                       // 课内：这门课难 → 降档
        && hardLessonControl!.challengeLevelCap === 'low'
        && derivePacing(aggregateDay1!.metrics.lf, aggregateDay1!.metrics.ktl) === 'moderate'  // 全局：仍不减速
        && !hardLessonReplan!.reasonCodes.includes('fatigue_high')
        && tiredPacing === 'slow'
        && tiredReplan.reasonCodes.includes('fatigue_high'),
      detail: `课内状态(路径A) lss ${pathAState?.lss} ktl ${pathAState?.ktl} lf ${pathAState?.lf}`
        + `｜课内 ${hardLessonControl?.paceMode}/${hardLessonControl?.challengeLevelCap}`
        + ` 全局 pacing=${aggregateDay1 ? derivePacing(aggregateDay1.metrics.lf, aggregateDay1.metrics.ktl) : '-'}`
        + `（全局 lss ${aggregateDay1?.metrics.lss} lf ${aggregateDay1?.metrics.lf}）`
        + ` reasonCodes=${JSON.stringify(hardLessonReplan?.reasonCodes ?? [])}`
        + `｜疲劳态：pacing=${tiredPacing} reasonCodes=${JSON.stringify(tiredReplan.reasonCodes)}`,
    });

    console.log('\n[sim] 断言结果：');
    for (const assertion of assertions) {
      console.log(`  ${assertion.pass ? 'PASS' : 'FAIL'}  ${assertion.name}`);
      console.log(`        ${assertion.detail}`);
    }
    const failed = assertions.filter((assertion) => !assertion.pass).length;
    console.log(`[sim] ${assertions.length - failed}/${assertions.length} 通过`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    if (args.keep) {
      console.log(`[sim] --keep：保留模拟数据（run=${runId}，路径 ${pathIds.A} / ${pathIds.B}）`);
    } else {
      await prisma.learning_metrics.deleteMany({ where: { userId, taskId: { startsWith: `sim-${runId}` } } });
      await prisma.teaching_sessions.deleteMany({ where: { id: { in: createdSessions } } });
      await prisma.subtasks.deleteMany({ where: { id: { in: createdSubtasks } } });
      await prisma.milestones.deleteMany({ where: { id: { startsWith: `ms_${runId}` } } });
      await prisma.learning_paths.deleteMany({ where: { id: { in: [pathIds.A, pathIds.B] } } });
      console.log(`[sim] 已清理模拟数据（run=${runId}）`);
    }
  }
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
