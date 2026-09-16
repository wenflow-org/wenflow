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
import { decideTaskDifficulty, resolveBaselineLevel } from '../services/learner/TaskDifficultyAdjustmentService';
import {
  measureTaskDifficultyEffects,
  recordTaskDifficultyAdjustment,
} from '../services/learner/TaskDifficultyAdjustmentLedger';
// 日期模拟的"第 dayIndex 天"用平台规范助手（virtual-lab/simulated-day.service）：
// 不 mock 时钟，而是把第 N 天映射为 baseDate + N，日界与 getAggregatedState.dayLoad / ReviewQuotaService 同口径。
import { resolveDayWindow, toDateOnly } from '../services/virtual-lab/simulated-day.service';

/** EWMA 系数（与 LearningMetricService 的派生公式一致，断言里用来算两种预测值）
 * 注意：lf 的新值系数是 0.15（不是 1-0.7），ktl 的是 0.05（= 1-0.95）—— 公式本身不是严格凸组合。 */
const KTL_LAMBDA = 0.95;
const KTL_NEW_TERM = 0.05;
const LF_LAMBDA = 0.7;
const LF_NEW_TERM = 0.15;

export interface SimLesson {
  /** 相对起始日的天数（0 = 起始日） */
  dayOffset: number;
  pathKey: 'A' | 'B' | 'C';
  /** 1-10 主观难度（作为任务基线） */
  difficulty: number;
  durationMinutes: number;
  /** 是否记录难度调整锚点（留痕，供效果度量对账） */
  recordAdjustment?: boolean;
  /** 是否**真的按调整后的难度执行**本节（false = 对照） */
  applyAdjustment?: boolean;
}

export interface SimPlan {
  days: number;
  lessons: SimLesson[];
}

/**
 * 默认剧本：
 * - 第 1 天：路径 A 连上两节难课（difficulty 9，**只判定不执行** = 对照）
 *            路径 C 连上两节难课（difficulty 9，**按调整执行** = 实验组）
 *   → 断言"路径隔离"与"难度调整的效果度量"（同类降档理由是否缓解）
 * - 第 2 天：路径 B 两节常规课（difficulty 5）→ B 应只接自己的第 1 节
 * - 第 3 天：一天三节、跨两条路径 → 用于断言"当日课量 → 全局疲劳"
 */
export function buildDefaultPlan(): SimPlan {
  return {
    days: 3,
    lessons: [
      { dayOffset: 0, pathKey: 'A', difficulty: 9, durationMinutes: 45, recordAdjustment: true },
      { dayOffset: 0, pathKey: 'A', difficulty: 9, durationMinutes: 45, recordAdjustment: true },
      { dayOffset: 0, pathKey: 'C', difficulty: 9, durationMinutes: 45, recordAdjustment: true },
      { dayOffset: 0, pathKey: 'C', difficulty: 9, durationMinutes: 45, recordAdjustment: true, applyAdjustment: true },
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
  // 起始日：30 天前的 UTC 日（过去 → 聚合读取天然排除学习者真实行）
  const baseDate = toDateOnly(new Date(Date.now() - 30 * 24 * 3600_000));
  const dayStart = (offset: number) => resolveDayWindow(baseDate, offset).dayStart;
  const simulatedDay = (offset: number) => resolveDayWindow(baseDate, offset).simulatedDay;
  // 课放在当天上午：UTC 09:00 起，一天多节按小时排
  const lessonTime = (offset: number, indexInDay: number) =>
    new Date(dayStart(offset).getTime() + (9 + indexInDay) * 3600_000);
  /**
   * 观察时刻 = 规范助手的 `asOf`（当天 23:59:59.999，UTC 日末）。
   * 之所以能直接用：自然衰减已统一到 **UTC 日界**（与日模拟/每日配额/当日课量同口径），
   * 当天写完的课在当天日末读到的日差是 0，不会再出现"白多衰减一天"。
   */
  const dayAsOf = (offset: number) => resolveDayWindow(baseDate, offset).asOf;

  const plan = buildDefaultPlan();
  const pathIds: Record<'A' | 'B' | 'C', string> = { A: `lp_${runId}_a`, B: `lp_${runId}_b`, C: `lp_${runId}_c` };

  console.log(`[sim] 学习者 ${user.name || userId}｜run=${runId}｜模拟天数 ${plan.days}｜起始日 ${baseDate}（第 1 天 = ${simulatedDay(0)}）`);
  console.log(`[sim] 模拟路径 A=${pathIds.A}(对照)  B=${pathIds.B}  C=${pathIds.C}(实验:按调整执行)`);
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

  const baseKnowledge = {
    globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: [] },
    globalBackground: { blockedFoundations: [] },
  } as any;

  /** 与课堂接线同口径：用"本节开始前"的路径级状态 + 全局聚合 → 难度决策 */
  const decideForLesson = async (input: { userId: string; pathId: string; at: Date; baselineLevel: number }) => {
    const [pathState, globalAggregate] = await Promise.all([
      learningStateService.getCurrentState(input.userId, { pathId: input.pathId, asOf: input.at }),
      learningStateService.getAggregatedState(input.userId, { asOf: input.at }),
    ]);
    const globalMetrics = globalAggregate?.metrics ?? { lss: 0, ktl: 0, lf: 0, lsb: 0, timestamp: input.at };
    const control = deriveLearningControlState({
      dynamicState: {
        metrics: globalMetrics, recentTrend: 'stable',
        fatigueRisk: globalMetrics.lf >= 6 ? 'high' : 'low',
        confidenceTrend: 'stable', recentSessionQuality: 'mixed',
        recommendedPacing: derivePacing(globalMetrics.lf, globalMetrics.ktl),
        recommendedInteraction: { hintTiming: 'delayed', encouragement: 'medium', challenge: 'medium' },
        srlPhase: 'performance',
      } as any,
      knowledgeMemory: baseKnowledge,
      ...(pathState ? { lessonMetrics: { lss: pathState.lss, ktl: pathState.ktl, lf: pathState.lf, lsb: pathState.lsb } } : {}),
    });
    const decision = decideTaskDifficulty({
      baselineLevel: input.baselineLevel,
      globalMetrics,
      lessonMetrics: pathState ? { lss: pathState.lss, ktl: pathState.ktl, lf: pathState.lf, lsb: pathState.lsb } : null,
      learningControlState: control,
      fatigueRisk: globalMetrics.lf >= 6 ? 'high' : 'low',
      recommendedPacing: derivePacing(globalMetrics.lf, globalMetrics.ktl),
      knowledgeSignals: { fragileCount: 0, strugglingCount: 0, prerequisiteGapCount: 0 },
    });
    return { decision, pathState, globalMetrics };
  };

  const createdSubtasks: string[] = [];
  const createdSessions: string[] = [];
  const assertions: Assertion[] = [];

  try {
    // 1) 建两条模拟路径（+里程碑，subtasks 需要 FK）
    for (const key of ['A', 'B', 'C'] as const) {
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

        // 难度调整：先按"本节开始前"的状态判定（与课堂接线同口径），再决定本节实际难度
        let effectiveDifficulty = lesson.difficulty;
        if (lesson.recordAdjustment || lesson.applyAdjustment) {
          const decided = await decideForLesson({
            userId, pathId: pathIds[lesson.pathKey], at, baselineLevel: lesson.difficulty,
          });
          if (decided.decision.reasons.length > 0) {
            await recordTaskDifficultyAdjustment({
              userId,
              taskId,
              pathId: pathIds[lesson.pathKey],
              sessionId,
              occurredAt: at,
              baseline: decided.decision.baseline,
              adjusted: decided.decision.adjusted,
              direction: decided.decision.direction,
              reasons: decided.decision.reasons,
              applied: lesson.applyAdjustment === true,
              evidence: decided.decision.evidence as unknown as Record<string, unknown>,
            });
          }
          if (lesson.applyAdjustment) effectiveDifficulty = decided.decision.adjusted;
        }

        await updateLearningMetrics({
          userId,
          taskId,
          pathId: pathIds[lesson.pathKey],
          durationMinutes: lesson.durationMinutes,
          subjectiveDifficulty: effectiveDifficulty,
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
      learningStateService.getCurrentState(userId, { pathId: pathIds[pathKey], asOf: dayAsOf(day) });

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
    const aggregateDay3 = await learningStateService.getAggregatedState(userId, { asOf: dayAsOf(2) });
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
    const aggregateDay1 = await learningStateService.getAggregatedState(userId, { asOf: dayAsOf(0) });
    const pathAState = await stateAt('A', 0);
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

    // ── 断言 4：任务级难度由学习者模型驱动，且路径之间隔离
    const baselineOfMediumTask = resolveBaselineLevel({ cognitiveLoad: 'medium' });
    const globalOnlyControl = deriveLearningControlState({
      dynamicState: {
        metrics: aggregateDay1?.metrics ?? tiredMetrics, recentTrend: 'stable', fatigueRisk: 'low',
        confidenceTrend: 'stable', recentSessionQuality: 'mixed', recommendedPacing: 'moderate',
        recommendedInteraction: { hintTiming: 'delayed', encouragement: 'medium', challenge: 'medium' },
        srlPhase: 'performance',
      } as any,
      knowledgeMemory: baseKnowledge,
    });
    const decisionForPathA = aggregateDay1 && pathAState && hardLessonControl
      ? decideTaskDifficulty({
          baselineLevel: baselineOfMediumTask,
          globalMetrics: aggregateDay1.metrics,
          lessonMetrics: { lss: pathAState.lss, ktl: pathAState.ktl, lf: pathAState.lf, lsb: pathAState.lsb },
          learningControlState: hardLessonControl,
          fatigueRisk: aggregateDay1.metrics.lf >= 6 ? 'high' : 'low',
          recommendedPacing: derivePacing(aggregateDay1.metrics.lf, aggregateDay1.metrics.ktl),
          knowledgeSignals: { fragileCount: 0, strugglingCount: 0, prerequisiteGapCount: 0 },
        })
      : null;
    const decisionForPathB = aggregateDay1
      ? decideTaskDifficulty({
          baselineLevel: baselineOfMediumTask,
          globalMetrics: aggregateDay1.metrics,
          lessonMetrics: null,                       // 路径 B 此刻还没有历史
          learningControlState: globalOnlyControl,
          fatigueRisk: aggregateDay1.metrics.lf >= 6 ? 'high' : 'low',
          recommendedPacing: derivePacing(aggregateDay1.metrics.lf, aggregateDay1.metrics.ktl),
          knowledgeSignals: { fragileCount: 0, strugglingCount: 0, prerequisiteGapCount: 0 },
        })
      : null;

    const pathLevelReasons = ['lesson_stress_high', 'path_load_unbalanced'];
    assertions.push({
      name: '任务级难度：路径级证据只作用于本路径（A 因本路径压力降档，B 不借用任何路径级证据）',
      pass: Boolean(decisionForPathA && decisionForPathB)
        && decisionForPathA!.direction === 'decrease'
        && decisionForPathA!.adjusted === baselineOfMediumTask - 1
        && decisionForPathA!.reasons.includes('lesson_stress_high')
        && decisionForPathB!.reasons.every((reason) => !pathLevelReasons.includes(reason)),
      detail: `基线 ${baselineOfMediumTask}（medium 任务）`
        + `｜路径A(有历史, lss ${pathAState?.lss}) → ${decisionForPathA?.direction} ${decisionForPathA?.adjusted}`
        + ` reasons=${JSON.stringify(decisionForPathA?.reasons ?? [])}`
        + `｜路径B(无历史) → ${decisionForPathB?.direction} ${decisionForPathB?.adjusted}`
        + ` reasons=${JSON.stringify(decisionForPathB?.reasons ?? [])}（不得含路径级理由）`,
    });

    // ── 断言 5：难度调整的效果度量（同类降档理由是否缓解；对照 vs 执行）
    const { effects, groups } = await measureTaskDifficultyEffects({
      userId,
      since: new Date(dayStart(0).getTime() - 3600_000),
    });
    const appliedGroup = groups.find((group) => group.reason === 'lesson_stress_high' && group.applied);
    const controlGroup = groups.find((group) => group.reason === 'lesson_stress_high' && !group.applied);
    assertions.push({
      name: '效果度量：按调整执行 → 同类降档理由缓解；只判定不执行（对照）→ 仍触发',
      pass: Boolean(appliedGroup && controlGroup)
        && appliedGroup!.relieved === appliedGroup!.total
        && controlGroup!.relieved === 0,
      detail: `锚点 ${effects.length} 条｜lesson_stress_high：执行组 缓解 ${appliedGroup?.relieved}/${appliedGroup?.total}`
        + `（Δlsb ${appliedGroup?.avgLsbDelta}）｜对照组 缓解 ${controlGroup?.relieved}/${controlGroup?.total}`
        + `（Δlsb ${controlGroup?.avgLsbDelta}）`,
    });

    // ── 断言 6：跨天恢复 —— 状态按日因子衰减；超过活跃窗口的路径不再参与全局投票
    const decayDayMs = 24 * 3600_000;
    const pathAAtDay2 = await learningStateService.getCurrentState(userId, { pathId: pathIds.A, asOf: dayAsOf(2) });
    const pathAAtPlus3 = await learningStateService.getCurrentState(userId, {
      pathId: pathIds.A,
      asOf: new Date(dayAsOf(2).getTime() + 3 * decayDayMs),
    });
    const pathAAtPlus20Agg = await learningStateService.getAggregatedState(userId, {
      asOf: new Date(dayAsOf(2).getTime() + 20 * decayDayMs),
    });
    const simPaths = [pathIds.A, pathIds.B, pathIds.C];
    const stillVotingAt20 = (pathAAtPlus20Agg?.activePathIds ?? []).filter((id) => simPaths.includes(id));

    const decayDays = 3;
    const decayExpectedLss = Number(pathAAtDay2?.lss) * 0.82 ** decayDays;
    const decayExpectedKtl = Number(pathAAtDay2?.ktl) * 0.99 ** decayDays;
    const decayExpectedLf = 1.2 + (Number(pathAAtDay2?.lf) - 1.2) * 0.74 ** decayDays;
    const decayOk = Boolean(pathAAtDay2 && pathAAtPlus3)
      && Math.abs(Number(pathAAtPlus3!.lss) - decayExpectedLss) < 1e-6
      && Math.abs(Number(pathAAtPlus3!.ktl) - decayExpectedKtl) < 1e-6
      && Math.abs(Number(pathAAtPlus3!.lf) - decayExpectedLf) < 1e-6;

    assertions.push({
      name: '跨天恢复：状态按日因子衰减（LSS×0.82^d / KTL×0.99^d / LF→基线1.2 的0.74^d），超窗口不再投票',
      pass: decayOk && stillVotingAt20.length === 0,
      detail: `+3 天：lss ${pathAAtPlus3?.lss}（期望 ${decayExpectedLss.toFixed(4)}）`
        + ` ktl ${pathAAtPlus3?.ktl}（期望 ${decayExpectedKtl.toFixed(4)}）`
        + ` lf ${pathAAtPlus3?.lf}（期望 ${decayExpectedLf.toFixed(4)}）→ ${decayOk ? '吻合' : '不符'}`
        + `｜+20 天仍在投票的模拟路径：${stillVotingAt20.length} 条（期望 0，活跃窗口 14 天）`,
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
      console.log(`[sim] --keep：保留模拟数据（run=${runId}，路径前缀 lp_${runId}）`);
    } else {
      await prisma.learning_metrics.deleteMany({ where: { userId, taskId: { startsWith: `sim-${runId}` } } });
      await prisma.learner_evidence.deleteMany({ where: { userId, taskId: { startsWith: `sim-${runId}` } } });
      await prisma.teaching_sessions.deleteMany({ where: { id: { in: createdSessions } } });
      await prisma.subtasks.deleteMany({ where: { id: { in: createdSubtasks } } });
      await prisma.milestones.deleteMany({ where: { id: { startsWith: `ms_${runId}` } } });
      // 按 run 前缀清理（曾用显式路径列表 → 漏掉后来新增的路径 C，留下残渣）
      await prisma.learning_paths.deleteMany({ where: { id: { startsWith: `lp_${runId}` } } });
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
