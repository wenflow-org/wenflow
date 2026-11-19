/**
 * 渐进式 stage 设计（活的 path 批次 D，2026-09-25）。
 *
 * 语义：骨架（core run）是唯一前置物；创建时只设计 stage 1，stage N 完成后
 * 才后台设计 stage N+1——设计输入带**学习者 agent 快照信号**（脆弱/挣扎概念、
 * 先修缺口、上一阶段 wrapup 里仍未掌握的点），让「上一阶段学得怎么样」
 * 机制化进入「下一阶段怎么设计」。
 *
 * 灰度：`PROGRESSIVE_STAGE_DESIGN=1|true` 开启；默认关——关闭时全部生成链路
 * 与改造前逐一等价（eager 全量设计）。
 *
 * 复用地基：append-only 子集设计（只设计空白阶段、不删既有任务）+ per-stage
 * kc 合并契约（kc-annotation.mergeKcStageAnnotation，v2 顶层与 v1 同形，读侧零改）。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { runBackgroundTask } from '../../background-task-tracker.service';
import { ownerContextOverride } from './owner-context';
import { learnerSnapshotRefreshService } from '../../learner/LearnerSnapshotRefreshService';
import { parseSessionArtifacts } from '../../ai-teaching/checkpoint-shared';

/**
 * 渐进式 stage 设计开关（2026-11-18 起默认开启）。
 * 语义：创建时只设计 stage 1，stage N 完成后后台设计 N+1（带上一阶段真实学习信号）。
 * 显式 `PROGRESSIVE_STAGE_DESIGN=0|false` 可回到一次性全量设计（保留回滚路径）。
 */
export function isProgressiveStageDesignEnabled(): boolean {
  const raw = String(process.env.PROGRESSIVE_STAGE_DESIGN ?? '').trim().toLowerCase();
  if (!raw) return true;
  return raw === '1' || raw === 'true';
}

/** 学习者信号（stage N+1 设计输入），条数按钳制上限裁剪。 */
export interface PreviousStageOutcome {
  source: 'learner-snapshot';
  previousStageNumber: number;
  /** 脆弱概念（≤5） */
  fragileConcepts: string[];
  /** 挣扎概念（≤5） */
  strugglingConcepts: string[];
  /** 先修缺口（≤5） */
  prerequisiteGaps: string[];
  /** 上一阶段 wrapup 里仍未掌握的知识点（≤5） */
  stillLearning: string[];
  /** 上一阶段结束时的重排建议（动态规划信号，来自 learner snapshot；keep/无信号时不出现） */
  recommendation?: 'keep' | 'reinforce' | 'slow_down' | 'resequence' | 'accelerate';
  /** 该建议的触发原因码（≤6） */
  reasonCodes?: string[];
  /** 当前疲劳档：high 时下一阶段不得加负荷（控制坡度与单任务时长） */
  fatigueRisk?: 'low' | 'medium' | 'high';
  /** 节奏模式：recover 时下一阶段只减不增 */
  paceMode?: 'recover' | 'steady' | 'push';
  /**
   * 课堂契约报告回流（2026-11-19）：上一阶段各课 lessonReport 的未达成事实。
   * 路径层据此把「课上没验过的点 / 学生想补的先修 / 停车区问题」排进下一阶段，
   * 而不是只在课后增强层留一条记录。
   */
  /** 契约明确缺证据的核心 KC（≤5） */
  contractGaps?: string[];
  /** 覆盖了但尚未取得独立证据的核心 KC（≤5） */
  weakKcs?: string[];
  /** 课末终检未通过的核心 KC（≤3） */
  exitTicketGaps?: string[];
  /** 停车区里学生提出、课内未展开的问题（≤5，只作拓展线索） */
  parkingLotTopics?: string[];
  /** 停车区里标记为先修缺口的条目（≤5，下一阶段先补） */
  prerequisitePatches?: string[];
}

const SIGNAL_CAP = 5;

function capList(values: unknown, cap = SIGNAL_CAP): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, cap);
}

/**
 * 从快照与 wrapup 提炼信号（纯函数，钳制 ≤5/类）：
 * fragile/struggling/gaps + wrapup 里未掌握知识点（mastered 除外）。
 */
export function extractLearnerSignals(
  knowledgeMemory: Record<string, unknown>,
  wrapup: { summary?: { knowledgeItems?: Array<{ name?: string; status?: string }> } } | null
): Omit<PreviousStageOutcome, 'source' | 'previousStageNumber'> {
  const currentPath = (knowledgeMemory?.currentPath || {}) as { prerequisiteGaps?: unknown[] };
  const globalSignals = (knowledgeMemory?.globalSignals || {}) as { fragileConcepts?: unknown[]; strugglingConcepts?: unknown[] };
  const items = Array.isArray(wrapup?.summary?.knowledgeItems) ? wrapup.summary.knowledgeItems : [];
  const stillLearning = items
    .filter((item) => item?.name && item?.status && String(item.status) !== 'mastered')
    .map((item) => String(item.name));
  return {
    fragileConcepts: capList(globalSignals.fragileConcepts),
    strugglingConcepts: capList(globalSignals.strugglingConcepts),
    prerequisiteGaps: capList(currentPath.prerequisiteGaps?.map((gap: unknown) => (gap as { conceptName?: string; name?: string })?.conceptName || (gap as { name?: string })?.name || gap)),
    stillLearning: capList(stillLearning),
  };
}

/**
 * 课堂契约报告回流（2026-11-19）：从上一阶段各课已落库的 `sessionArtifacts.lessonReport`
 * 聚合「下一阶段必须处理」的事实——未达成 KC、独立证据缺口、终检未过、停车区（先修补丁/拓展线索）。
 * 纯函数，便于单测；无 lessonReport 的旧课不产生任何键。
 */
export function extractLessonReportSignals(
  sessions: ReadonlyArray<{ teachingState?: unknown }>,
): Pick<PreviousStageOutcome, 'contractGaps' | 'weakKcs' | 'exitTicketGaps' | 'parkingLotTopics' | 'prerequisitePatches'> {
  const contractGapSet = new Set<string>();
  const weakKcSet = new Set<string>();
  const exitTicketGapSet = new Set<string>();
  const parkingLotSet = new Set<string>();
  const prerequisitePatchSet = new Set<string>();
  const pushUnique = (target: Set<string>, value: unknown) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) target.add(text);
  };
  const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
  for (const session of sessions) {
    let teachingState: Record<string, any> | null = null;
    try {
      const raw = session?.teachingState;
      teachingState = typeof raw === 'string'
        ? JSON.parse(raw)
        : (raw && typeof raw === 'object' ? raw as Record<string, any> : null);
    } catch {
      teachingState = null;
    }
    const artifacts = parseSessionArtifacts(teachingState) as Record<string, any>;
    const report = artifacts.lessonReport as Record<string, any> | undefined;
    if (!report) continue;
    for (const name of Array.isArray(report.missingKcs) ? report.missingKcs : []) {
      pushUnique(contractGapSet, name);
    }
    const independentNames = new Set(
      (Array.isArray(report.independentKcs) ? report.independentKcs : []).map(normalize),
    );
    const coreKcs = Array.isArray(artifacts.lessonContract?.coreKcs) ? artifacts.lessonContract.coreKcs : [];
    for (const kc of coreKcs) {
      const name = typeof kc?.name === 'string' ? kc.name.trim() : '';
      if (name && !independentNames.has(normalize(name))) pushUnique(weakKcSet, name);
    }
    const exitTicket = report.exitTicket as Record<string, any> | undefined;
    if (exitTicket?.asked === true && exitTicket?.passed !== true) {
      pushUnique(exitTicketGapSet, exitTicket.conceptName);
    }
    for (const item of Array.isArray(report.parkingLot) ? report.parkingLot : []) {
      const topic = typeof item?.topic === 'string' ? item.topic.trim() : '';
      if (!topic) continue;
      // 先修补丁只认系统写入的固定标记（prerequisite_gap 支线在补课额度用尽时写下
      // 「先修缺口（本课补课额度已用完）」；兼容旧数据的「先修：」前缀），
      // 不对学生原话做关键词分类——停车区里学生问题可能恰好含「先修」二字。
      if (topic.startsWith('先修缺口') || topic.startsWith('先修：')) pushUnique(prerequisitePatchSet, topic);
      else pushUnique(parkingLotSet, topic);
    }
  }
  return {
    ...(contractGapSet.size ? { contractGaps: Array.from(contractGapSet).slice(0, 5) } : {}),
    ...(weakKcSet.size ? { weakKcs: Array.from(weakKcSet).slice(0, 5) } : {}),
    ...(exitTicketGapSet.size ? { exitTicketGaps: Array.from(exitTicketGapSet).slice(0, 3) } : {}),
    ...(parkingLotSet.size ? { parkingLotTopics: Array.from(parkingLotSet).slice(0, 5) } : {}),
    ...(prerequisitePatchSet.size ? { prerequisitePatches: Array.from(prerequisitePatchSet).slice(0, 5) } : {}),
  };
}

/**
 * 从学习者 agent 账本提炼「上一阶段学得怎么样」：
 * 快照（fresh refresh，确保 task:completed 刚写完的证据已入账）的
 * fragile/struggling/gaps + 上一阶段最近一次 wrapup 的 stillLearning 知识点。
 * best-effort：任何失败返回 null（path-task-design 输入退化为骨架级 previousMilestone）。
 */
export async function buildPreviousStageOutcome(
  pathId: string,
  userId: string,
  previousStageNumber: number
): Promise<PreviousStageOutcome | null> {
  try {
    const snapshot = await learnerSnapshotRefreshService.refresh({
      userId,
      pathId,
      scope: 'path',
    });
    const knowledgeMemory = (snapshot?.knowledgeMemory || {}) as Record<string, unknown>;

    // 上一阶段最近一次完成的课堂 wrapup：stillLearning 知识点是「讲过但没掌握」的直接证据
    const previousMilestones = await prisma.milestones.findMany({
      where: { learningPathId: pathId, stageNumber: previousStageNumber },
      select: { id: true },
    });
    // 课堂契约回流（2026-11-19）：上一阶段每个任务取**最近一节正课**的 lessonReport，
    // 聚合未达成 KC / 独立证据缺口 / 终检未过 / 停车区（含先修补丁）。
    const previousSessions = previousMilestones.length > 0
      ? await prisma.teaching_sessions.findMany({
          where: {
            userId,
            learningPathId: pathId,
            milestoneId: { in: previousMilestones.map((milestone) => milestone.id) },
            status: 'completed',
            mode: 'tutor',
          },
          orderBy: { endTime: 'desc' },
          take: 20,
          select: { id: true, taskId: true, wrapup: true, teachingState: true },
        })
      : [];
    const latestSessionByTask = new Map<string, (typeof previousSessions)[number]>();
    for (const session of previousSessions) {
      const key = session.taskId || session.id;
      if (!latestSessionByTask.has(key)) latestSessionByTask.set(key, session);
    }
    const stageSessions = Array.from(latestSessionByTask.values());
    const lastSession = stageSessions[0] || null;
    let wrapup: { summary?: { knowledgeItems?: Array<{ name?: string; status?: string }> } } | null = null;
    try {
      wrapup = lastSession?.wrapup ? JSON.parse(lastSession.wrapup) : null;
    } catch {
      // wrapup 解析失败不影响其余信号
    }

    const lessonReportSignals = extractLessonReportSignals(stageSessions);

    const outcome: PreviousStageOutcome = {
      source: 'learner-snapshot',
      previousStageNumber,
      ...extractLearnerSignals(knowledgeMemory, wrapup),
      // 课堂契约回流（2026-11-19）：未达成 KC / 独立证据缺口 / 终检未过 / 停车区先修补丁
      // 都作为「已发生的学习事实」进入下一阶段设计输入；无 lessonReport 的旧课不产生这些键。
      ...lessonReportSignals,
      // 动态规划（2026-10-17）：不只传「哪几个概念没掌握」，还传系统对下一阶段的建议方向
      // 与当前负荷档——path-task-design 据此决定坡度、补强位置与任务可调整性，而不是只看到
      // 一份概念清单后自行猜测该加速还是减速。
      ...((): Partial<PreviousStageOutcome> => {
        // 快照是学习者 agent 的账本投影，这三块由不同写入方维护，这里只取需要的字段
        // （形状未知时按 unknown 收窄，避免 as any 把类型检查整段关掉）。
        const snapshotView = (snapshot || {}) as {
          replanSignal?: { recommendation?: unknown; reasonCodes?: unknown[] };
          dynamicState?: { fatigueRisk?: unknown };
          learningControlState?: { paceMode?: unknown };
        };
        const snapshotSignal = snapshotView.replanSignal;
        const dynamicState = snapshotView.dynamicState;
        const controlState = snapshotView.learningControlState;
        // 快照字段是字符串直传，这里按契约白名单收窄——非法值当作「无信号」，不把脏值塞进设计输入。
        const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
          typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
        const recommendation = pick(
          snapshotSignal?.recommendation,
          ['keep', 'reinforce', 'slow_down', 'resequence', 'accelerate'] as const
        );
        const fatigueRisk = pick(dynamicState?.fatigueRisk, ['low', 'medium', 'high'] as const);
        const paceMode = pick(controlState?.paceMode, ['recover', 'steady', 'push'] as const);
        const reasonCodes = Array.isArray(snapshotSignal?.reasonCodes)
          ? snapshotSignal.reasonCodes.map((code: unknown) => String(code || '').trim()).filter(Boolean).slice(0, 6)
          : [];
        return {
          ...(recommendation && recommendation !== 'keep' ? { recommendation } : {}),
          ...(reasonCodes.length ? { reasonCodes } : {}),
          ...(fatigueRisk ? { fatigueRisk } : {}),
          ...(paceMode ? { paceMode } : {}),
        };
      })(),
    };
    logger.info('[progressive-design] 上一阶段学习者信号已提炼', {
      pathId,
      userId,
      previousStageNumber,
      fragile: outcome.fragileConcepts.length,
      struggling: outcome.strugglingConcepts.length,
      gaps: outcome.prerequisiteGaps.length,
      stillLearning: outcome.stillLearning.length,
      contractGaps: outcome.contractGaps?.length || 0,
      weakKcs: outcome.weakKcs?.length || 0,
      exitTicketGaps: outcome.exitTicketGaps?.length || 0,
      parkingLot: outcome.parkingLotTopics?.length || 0,
      prerequisitePatches: outcome.prerequisitePatches?.length || 0,
    });
    return outcome;
  } catch (error) {
    logger.warn('[progressive-design] 学习者信号提炼失败（best-effort，设计输入退化为骨架级）', {
      pathId,
      userId,
      previousStageNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * stage N 完成 → 后台设计 stage N+1（append-only，restrict 到该 stage）。
 * fire-and-forget：失败只记 warn——学习者可等冷启动兜底（到达未设计 stage 时同步触发）
 * 或下次生成走库优先/重试链补齐。
 */
export async function triggerNextStageDesign(
  pathId: string,
  userId: string,
  nextMilestoneId: string,
  nextStageNumber: number,
  previousStageNumber: number
): Promise<void> {
  runBackgroundTask('learning.path.stage-design-next', async () => {    const previousStageOutcome = await buildPreviousStageOutcome(pathId, userId, previousStageNumber);
    const { createAndClaimGenerationRun } = await import('./run-lifecycle');
    const { enrichLearningPathWithAnderson } = await import('./stage-enrichment');
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { description: true, title: true, name: true, subject: true, userId: true, activeGenerationRunId: true },
    });
    if (!path) return;
    const run = await createAndClaimGenerationRun(
      pathId,
      'stageDesign',
      'stageDesign',
      1,
      'append-tasks',
      path.activeGenerationRunId,
      { milestoneIds: [nextMilestoneId] }
    );
    const { updatePathGenerationStatus } = await import('./run-lifecycle');
    await updatePathGenerationStatus(pathId, {
      stageDesign: 'processing',
      lastError: null,
      updatedAt: new Date().toISOString(),
    }, run.id);
    await enrichLearningPathWithAnderson(
      pathId,
      run.id,
      {
        userId,
        description: path.description || path.title || path.name || '个性化学习路径',
        subject: path.subject || undefined,
        generationRunId: run.id,
        userProfile: {},
      },
      null,
      {
        appendOnly: true,
        progressive: true,
        restrictMilestoneIds: [nextMilestoneId],
        previousStageOutcome,
      }
    );
    logger.info('[progressive-design] 下一阶段设计完成', { pathId, userId, nextStageNumber });
  }, { pathId, userId, nextStageNumber }, await ownerContextOverride(userId));
}
