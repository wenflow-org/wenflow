import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { conceptRegistryService } from './concept-registry.service';
import { conceptGraphService } from './concept-graph.service';
// 注册表口径的归一化（比本文件的本地 normalizeConceptKey 更强：还去引号/冒号从句/尾部标点）。
// 查别名表必须用它，否则会 miss——本文件那个本地版只做 trim+空白压缩。
import { normalizeConceptKey as normalizeConceptKeyCanonical } from '../memory/concept-key';
import type {
  LearnerBackgroundConceptLedgerItem,
  LearnerGlobalBackgroundKnowledge,
  LearnerConceptState,
  LearnerKnowledgeMemory,
  LearnerPathKnowledgeMemory,
  LearnerRecentEvidence,
  LearnerRecurringConfusion,
  LearnerTaskMastery,
  LearnerTransferSignal,
} from '../../agents/learner-model-agent/types';

type BuildInput = {
  userId: string;
  learningPathId?: string;
  milestoneId?: string;
  taskId?: string;
};

type ConceptSignal = {
  score: number;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  stability: 'unknown' | 'fragile' | 'developing' | 'stable';
  sourceType: 'task-label' | 'session-knowledge' | 'derived' | 'memory-trace';
  taskId?: string;
  milestoneId?: string;
  seenAt?: string;
  label: string;
  /** 概念身份（canonical）。痕迹来源直接带；其它来源在聚合后统一解析（只读，不创建）。 */
  conceptId?: string;
};

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeConceptKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized : null;
}

/**
 * 前置缺口（L3 · S4b）：当前任务的**上游前置**里未掌握的那些。
 *
 * 链路：当前任务 canonical（优先用 subtask.conceptId，回落按名字只读解析）
 * → `upstreamClosure`（prerequisite 上游，maxDepth 2）→ 用 `conceptStates`（已带 conceptId）判掌握
 * → 未掌握者按深度定 severity（一跳 = 直接阻塞 → high；两跳 = medium）。
 *
 * 返回空数组 = 无图/无上游/全部已掌握，调用方回落旧口径（保证未回填路径零行为变化）。
 * 读侧纪律：只读解析（`createIfMissing:false`），不写库。
 */
async function buildUpstreamPrerequisiteGaps(params: {
  userId: string;
  pathId: string;
  currentTask: { conceptId?: string | null; linkedConceptName?: string | null; coreConcept?: string | null } | null;
  conceptStates: LearnerConceptState[];
}): Promise<Array<{ conceptKey: string; label: string; reason: string; severity: 'high' | 'medium'; source: 'graph' }>> {
  const { userId, pathId, currentTask, conceptStates } = params;
  if (!userId || !currentTask) return [];
  try {
    let conceptId = currentTask.conceptId ?? null;
    if (!conceptId) {
      const name = currentTask.linkedConceptName || currentTask.coreConcept;
      if (!name) return [];
      const resolved = await conceptRegistryService.resolveConcept(userId, name, { createIfMissing: false });
      conceptId = resolved?.conceptId ?? null;
    }
    if (!conceptId) return [];

    const upstream = await conceptGraphService.upstreamClosure(userId, conceptId, { maxDepth: 2, pathId });
    if (upstream.length === 0) return [];

    const stateByConceptId = new Map<string, LearnerConceptState>();
    for (const state of conceptStates) {
      if (state.conceptId && !stateByConceptId.has(state.conceptId)) stateByConceptId.set(state.conceptId, state);
    }
    return upstream
      .map((item) => {
        const state = stateByConceptId.get(item.conceptId);
        const weak = !state
          || state.stability === 'fragile'
          || state.status === 'review'
          || state.masteryScore < 0.45;
        if (!weak) return null;
        return {
          conceptKey: state?.conceptKey || item.conceptId,
          label: state?.label || item.label || item.conceptId,
          reason: item.depth === 1
            ? '当前任务直接依赖该前置知识点，但历史证据显示尚未掌握。'
            : '该知识点是当前任务的间接前置（上游两跳），掌握不稳定会影响后续推进。',
          severity: (item.depth === 1 ? 'high' : 'medium') as 'high' | 'medium',
          source: 'graph' as const,
        };
      })
      .filter((gap): gap is { conceptKey: string; label: string; reason: string; severity: 'high' | 'medium'; source: 'graph' } => !!gap)
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
      .slice(0, 4);
  } catch (error) {
    logger.warn('[learner-knowledge] 上游前置缺口计算失败（best-effort，回落旧口径）', {
      userId,
      pathId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function parseLearningObjectives(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parsed = parseJsonSafe<any>(raw, null);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof parsed === 'string') {
    return [parsed.trim()].filter(Boolean);
  }
  if (typeof raw === 'string') {
    return [raw.trim()].filter(Boolean);
  }
  return [];
}

function dedupe(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeConceptKey(value)).filter(Boolean) as string[]));
}

function signalFromProgress(progress: number, status: 'pending' | 'learning' | 'mastered' | 'review') {
  const score = clamp(progress / 100, 0, 1);
  const stability = status === 'mastered'
    ? 'stable'
    : status === 'review'
      ? 'fragile'
      : status === 'learning'
        ? 'developing'
        : 'unknown';

  return { score, stability } as const;
}


/**
 * 会话评估 → 记忆信号（2026-09-22 档位化修正）。
 *
 * LLM 现在只输出档位（low/mid/high），0-10 数值是**档位区间中点**（mid=6）。
 * 继续用 `>= 6` 会把整个 mid 档（锚点定义："有明显吃力/疲劳但引导下仍能推进"）
 * 误判成 fatigue/mastery/struggle —— 等于把"正常摩擦"升级成"异常信号"。
 * 因此改为**按档位判定**（只有 high = 8-10 才进这些桶）；legacy 数值（无档位）仍走 >= 6。
 * 判据来源：session-wrapup 的评分参考（三个阈值参数的唯一定义在 session-evaluation-scale）。
 */
function resolveEvaluationSignal(evaluation: {
  sessionLf?: number | null;
  sessionKtl?: number | null;
  sessionLss?: number | null;
  metricTiers?: { sessionLf?: string; sessionKtl?: string; sessionLss?: string } | null;
}): 'fatigue' | 'mastery' | 'struggle' | 'incomplete' {
  const tiers = evaluation?.metricTiers || null;
  const isHigh = (tier: string | undefined, value: number | null | undefined): boolean =>
    tier ? tier === 'high' : (typeof value === 'number' && Number.isFinite(value) && value >= 6);
  if (isHigh(tiers?.sessionLf, evaluation?.sessionLf)) return 'fatigue';
  if (isHigh(tiers?.sessionKtl, evaluation?.sessionKtl)) return 'mastery';
  if (isHigh(tiers?.sessionLss, evaluation?.sessionLss)) return 'struggle';
  return 'incomplete';
}

export class LearnerKnowledgeMemoryService {
  async build(input: BuildInput): Promise<LearnerKnowledgeMemory> {
    const path = input.learningPathId
      ? await prisma.learning_paths.findUnique({
          where: { id: input.learningPathId },
          include: {
            milestones: {
              orderBy: { stageNumber: 'asc' },
              include: {
                subtasks: {
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        })
      : // 无 pathId（如 admin 证据端点场景）时自动定位用户最新 active 路径，
        // 否则 currentPath 恒空、recentEvidence/conceptLedger 等画像数据前端永远看不到
        await prisma.learning_paths.findFirst({
          where: { userId: input.userId, status: 'active' },
          orderBy: { updatedAt: 'desc' },
          include: {
            milestones: {
              orderBy: { stageNumber: 'asc' },
              include: {
                subtasks: {
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        });

    if (!path || path.userId !== input.userId) {
      return {
        currentPath: undefined,
        globalSignals: {
          masteredConcepts: [],
          fragileConcepts: [],
          strugglingConcepts: [],
        },
        globalBackground: {
          conceptLedger: [],
          recurringConfusions: [],
          reusableFoundations: [],
          blockedFoundations: [],
          transferSignals: [],
        },
      };
    }

    const [sessions, persistedEvidence, memoryTraces] = await Promise.all([
      prisma.teaching_sessions.findMany({
        where: {
          userId: input.userId,
          learningPathId: path.id,
        },
        orderBy: { startTime: 'desc' },
        take: 30,
        select: {
          id: true,
          taskId: true,
          milestoneId: true,
          knowledgeState: true,
          wrapup: true,
          endTime: true,
          updatedAt: true,
        },
      }),
      prisma.learner_evidence.findMany({
        where: { userId: input.userId, pathId: path.id },
        orderBy: { occurredAt: 'desc' },
        take: 50
      }),
      // 记忆引擎 M2 读侧并轨：memory_traces（ACT-R 痕迹）并入概念信号，脆弱/到期概念显式标记
      prisma.memory_traces.findMany({
        where: { userId: input.userId },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      })
    ]);

    const conceptSignals = new Map<string, ConceptSignal[]>();
    const recentEvidence: LearnerRecentEvidence[] = [];
    const enrichedLedger: LearnerBackgroundConceptLedgerItem[] = [];
    const enrichedConfusions: LearnerRecurringConfusion[] = [];
    const enrichedReusableFoundations: string[] = [];
    const enrichedBlockedFoundations: string[] = [];
    const enrichedTransferSignals: LearnerTransferSignal[] = [];

    for (const evidence of persistedEvidence) {
      const payload = parseJsonSafe<any>(evidence.payload, {});
      if (evidence.evidenceType === 'session-knowledge-distilled') {
        if (Array.isArray(payload.conceptLedger)) enrichedLedger.push(...payload.conceptLedger);
        if (Array.isArray(payload.reusableFoundations)) enrichedReusableFoundations.push(...payload.reusableFoundations);
        if (Array.isArray(payload.blockedFoundations)) enrichedBlockedFoundations.push(...payload.blockedFoundations);
        if (Array.isArray(payload.transferSignals)) enrichedTransferSignals.push(...payload.transferSignals);
        continue;
      }
      if (evidence.evidenceType === 'dialogue-concepts-extracted') {
        if (Array.isArray(payload.recurringConfusions)) enrichedConfusions.push(...payload.recurringConfusions);
        if (Array.isArray(payload.transferSignals)) enrichedTransferSignals.push(...payload.transferSignals);
        continue;
      }
      if (evidence.evidenceType !== 'task:completed' && evidence.evidenceType !== 'lesson:completed') {
        continue;
      }
      const conceptKeys = dedupe([
        payload.linkedConceptName,
        ...(Array.isArray(payload.conceptKeys) ? payload.conceptKeys : []),
        ...(Array.isArray(payload.knowledgeState) ? payload.knowledgeState.map((item: any) => item?.name) : [])
      ]);
      const type: LearnerRecentEvidence['type'] = evidence.evidenceType === 'task:completed'
        ? 'task-completed'
        : 'teaching-session';
      const signal: LearnerRecentEvidence['signal'] = evidence.evidenceType === 'lesson:completed'
        ? Array.isArray(payload.knowledgeState) && payload.knowledgeState.some((item: any) => item?.status === 'review')
          ? 'struggle'
          : 'mastery'
        : 'mastery';
      recentEvidence.push({
        type,
        taskId: evidence.taskId || undefined,
        sessionId: evidence.sessionId || undefined,
        conceptKeys,
        signal,
        score: evidence.confidence,
        happenedAt: evidence.occurredAt.toISOString()
      });
    }

    const allTasks = path.milestones.flatMap((milestone) =>
      (milestone.subtasks || []).map((task) => ({ milestone, task }))
    );

    for (const { milestone, task } of allTasks) {
      const objectiveConcepts = parseLearningObjectives(task.learningObjectives);
      const conceptCandidates = dedupe([
        task.linkedConceptName || task.coreConcept,
        task.displayLabel,
        ...objectiveConcepts,
      ]);

      for (const conceptKey of conceptCandidates) {
        const current = conceptSignals.get(conceptKey) || [];
        current.push({
          score: task.status === 'completed' ? 0.45 : task.status === 'in_progress' ? 0.25 : 0.1,
          status: task.status === 'completed' ? 'learning' : task.status === 'in_progress' ? 'learning' : 'pending',
          stability: task.status === 'completed' ? 'developing' : 'unknown',
          sourceType: 'task-label',
          taskId: task.id,
          milestoneId: milestone.id,
          // 时钟域：只用业务写入的 completedAt（模拟链路经 simulatedNowOr/asOf 落模拟日）；
          // 绝不回退 Prisma @updatedAt（真墙钟基础设施列）——否则真/模拟时间混入 lastSeenAt，
          // 使延迟锚题跨域比较。无 completedAt = 无"接触"证据，宁可不记时间。
          seenAt: task.completedAt ? task.completedAt.toISOString() : undefined,
          label: conceptKey,
        });
        conceptSignals.set(conceptKey, current);
      }

      if (task.status === 'completed') {
        recentEvidence.push({
          type: 'task-completed',
          taskId: task.id,
          conceptKeys: conceptCandidates,
          signal: 'mastery',
          score: 0.5,
          happenedAt: (task.completedAt || task.updatedAt).toISOString(),
        });
      }
    }

    for (const session of sessions) {
      const knowledgeState = parseJsonSafe<Array<{ name: string; status: 'pending' | 'learning' | 'mastered' | 'review'; progress: number }>>(
        session.knowledgeState,
        []
      );
      const wrapup = parseJsonSafe<any>(session.wrapup, null);
      const summaryPayload = wrapup?.summary || null;
      const evaluationPayload = wrapup?.evaluation || null;
      const happenedAt = (session.endTime || session.updatedAt).toISOString();
      // 时钟域：概念"最近可见"只用会话业务结束时间 endTime（模拟链路经 simulatedNowOr 落模拟日）。
      // 会话未结束（endTime=null）时不回退 updatedAt（真墙钟）——无结束时间 = 不记 seenAt。
      const sessionSeenAt = session.endTime ? session.endTime.toISOString() : undefined;

      for (const point of knowledgeState) {
        const conceptKey = normalizeConceptKey(point.name);
        if (!conceptKey) continue;
        const { score, stability } = signalFromProgress(point.progress, point.status);
        const current = conceptSignals.get(conceptKey) || [];
        current.push({
          score,
          status: point.status,
          stability,
          sourceType: 'session-knowledge',
          taskId: session.taskId,
          milestoneId: session.milestoneId,
          seenAt: sessionSeenAt,
          label: point.name,
        });
        conceptSignals.set(conceptKey, current);
      }

      if (knowledgeState.length > 0) {
      recentEvidence.push({
        type: 'teaching-session',
        taskId: session.taskId,
        sessionId: session.id,
        conceptKeys: knowledgeState.map((item) => item.name).filter(Boolean),
        signal: knowledgeState.some((item) => item.status === 'review')
          ? 'struggle'
          : knowledgeState.some((item) => item.status === 'mastered')
            ? 'mastery'
            : 'incomplete',
        score: knowledgeState.reduce((sum, item) => sum + item.progress, 0) / Math.max(1, knowledgeState.length) / 100,
        happenedAt,
      });
    }

      if (Array.isArray(summaryPayload?.knowledgeItems)) {
        for (const item of summaryPayload.knowledgeItems) {
          const conceptKey = normalizeConceptKey(item?.name);
          if (!conceptKey) continue;
          const score = typeof item.progress === 'number' ? clamp(item.progress / 100, 0, 1) : 0.5;
          const status = item.status === 'mastered' || item.status === 'review' || item.status === 'learning'
            ? item.status
            : 'learning';
          const current = conceptSignals.get(conceptKey) || [];
          current.push({
            score,
            status,
            stability: status === 'mastered' ? 'stable' : status === 'review' ? 'fragile' : 'developing',
            sourceType: 'derived',
            taskId: session.taskId,
            milestoneId: session.milestoneId,
            // 与 session-knowledge 同源同口径：只认会话业务结束时间，不回退 updatedAt（真墙钟）
            seenAt: sessionSeenAt,
            label: item.name,
          });
          conceptSignals.set(conceptKey, current);
        }

        recentEvidence.push({
          type: 'summary',
          taskId: session.taskId,
          sessionId: session.id,
          conceptKeys: summaryPayload.knowledgeItems.map((item: any) => item?.name).filter(Boolean),
          signal: summaryPayload.knowledgeItems.some((item: any) => item?.status === 'mastered') ? 'mastery' : 'incomplete',
          happenedAt,
        });
      }

      if (evaluationPayload) {
        recentEvidence.push({
          type: 'evaluation',
          taskId: session.taskId,
          sessionId: session.id,
          conceptKeys: knowledgeState.map((item) => item.name).filter(Boolean),
          signal: resolveEvaluationSignal(evaluationPayload),
          score: typeof evaluationPayload.sessionKtl === 'number' ? clamp(evaluationPayload.sessionKtl / 10, 0, 1) : undefined,
          happenedAt,
        });
      }
    }

    // 记忆引擎 M2 读侧并轨：memory_traces 痕迹注入概念信号（sourceType: memory-trace）
    // 脆弱（stability=fragile）或低掌握（masteryScore<0.5）或高间隔因子（即将到期）→ review/fragile 信号
    //
    // ⚠️ 位置修正（2026-09-23）：本循环此前被写在上面 `for (const session of sessions)` 的**循环体内**
    // （brace 深度实测 337→409 均在会话循环里），导致两个后果：
    //   ① **门控错误**：该路径没有教学会话时，用户级痕迹信号**完全不参与**概念状态
    //      （痕迹是用户级、天然跨 path，不该被"这条路径有没有会话"门控）；
    //   ② **重复注入**：N 个会话就把同一条痕迹推 N 次。
    // 痕迹派生自 `memoryTraces`（与 session 无关），故移出到会话循环之后、与 tasks/sessions 平级。
    for (const trace of memoryTraces) {
      const conceptKey = normalizeConceptKey(trace.conceptKey);
      if (!conceptKey) continue;
      const fragile = trace.stability === 'fragile'
        || (trace.masteryScore ?? 0.5) < 0.5
        || (trace.intervalFactor ?? 1) > 4;
      const mastered = !fragile && (trace.stability === 'stable' || (trace.masteryScore ?? 0) >= 0.8);
      const current = conceptSignals.get(conceptKey) || [];
      current.push({
        score: trace.masteryScore ?? 0.5,
        status: mastered ? 'mastered' : fragile ? 'review' : 'learning',
        stability: mastered ? 'stable' : fragile ? 'fragile' : 'developing',
        sourceType: 'memory-trace',
        taskId: undefined,
        milestoneId: undefined,
        // 时钟域：只用记忆引擎写入的业务 lastSeenAt（simulatedNowOr 落模拟日）。
        // KT-only 痕迹（applyKtEstimate 创建）lastSeenAt=null 表示"从未提取/从未真正见过"，
        // 不回退 updatedAt（真墙钟），否则会给已掌握概念注入未来时间戳。无 lastSeenAt = 不记时间。
        seenAt: trace.lastSeenAt ? trace.lastSeenAt.toISOString() : undefined,
        label: trace.label || trace.conceptKey,
        // 概念身份（canonical）：memory_traces 写入侧已双写，直接带过来
        conceptId: trace.conceptId ?? undefined,
      });
      conceptSignals.set(conceptKey, current);
    }

    const conceptStates: LearnerConceptState[] = Array.from(conceptSignals.entries()).map(([conceptKey, signals]) => {
      const labels = signals.map((signal) => signal.label).filter(Boolean);
      const relatedTaskIds = Array.from(new Set(signals.map((signal) => signal.taskId).filter(Boolean) as string[]));
      const relatedMilestoneIds = Array.from(new Set(signals.map((signal) => signal.milestoneId).filter(Boolean) as string[]));
      const lastSeenAt = signals.map((signal) => signal.seenAt).filter(Boolean).sort().reverse()[0];
      const masteryScore = clamp(signals.reduce((sum, signal) => sum + signal.score, 0) / Math.max(1, signals.length), 0, 1);

      const hasReview = signals.some((signal) => signal.status === 'review' || signal.stability === 'fragile');
      const hasMastery = signals.some((signal) => signal.status === 'mastered' || signal.stability === 'stable');
      const hasLearning = signals.some((signal) => signal.status === 'learning' || signal.stability === 'developing');

      const status: 'pending' | 'learning' | 'mastered' | 'review' = hasReview
        ? 'review'
        : hasMastery
          ? 'mastered'
          : hasLearning
            ? 'learning'
            : 'pending';

      const stability: 'unknown' | 'fragile' | 'developing' | 'stable' = status === 'review'
        ? 'fragile'
        : status === 'mastered'
          ? 'stable'
          : status === 'learning'
            ? 'developing'
            : 'unknown';

      const sourceType = signals.some((signal) => signal.sourceType === 'session-knowledge')
        ? 'session-knowledge'
        : signals.some((signal) => signal.sourceType === 'memory-trace')
          ? 'memory-trace'
          : signals.some((signal) => signal.sourceType === 'derived')
            ? 'derived'
            : 'task-label';

      return {
        conceptKey,
        label: labels[0] || conceptKey,
        // 概念身份（canonical）：优先取信号自带的（痕迹来源），缺失时由聚合后的统一解析补齐
        conceptId: signals.map((signal) => signal.conceptId).find(Boolean),
        sourceType,
        masteryScore,
        stability,
        status,
        relatedTaskIds,
        relatedMilestoneIds,
        lastSeenAt,
      };
    });

    // 概念身份补齐（只读）：来源不含痕迹的信号（会话知识/摘要/任务标签）没有 conceptId，
    // 用注册表按归一化键解析一次（`createIfMissing:false` —— **读侧绝不创建概念**）。
    // 解析失败/未命中一律留 undefined，读侧各处「conceptId 优先，空则回落 conceptKey」。
    const missingIdentity = conceptStates.filter((state) => !state.conceptId).map((state) => state.label || state.conceptKey);
    if (missingIdentity.length > 0) {
      try {
        const resolved = await conceptRegistryService.resolveMany(input.userId, missingIdentity, { createIfMissing: false });
        if (resolved.size > 0) {
          for (const state of conceptStates) {
            if (state.conceptId) continue;
            state.conceptId = resolved.get(normalizeConceptKeyCanonical(state.label || state.conceptKey)) ?? undefined;
          }
        }
      } catch (error) {
        logger.warn('[learner-knowledge] 概念身份补齐失败（只读，best-effort）', {
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const taskMastery: LearnerTaskMastery[] = allTasks.map(({ milestone, task }) => {
      const objectiveConcepts = parseLearningObjectives(task.learningObjectives);
      const conceptCandidates = dedupe([
        task.linkedConceptName || task.coreConcept,
        task.displayLabel,
        ...objectiveConcepts,
      ]);

      const matchingConcepts = conceptStates.filter((concept) =>
        concept.relatedTaskIds.includes(task.id) || conceptCandidates.includes(concept.conceptKey)
      );

      const avgScore = matchingConcepts.length > 0
        ? clamp(matchingConcepts.reduce((sum, concept) => sum + concept.masteryScore, 0) / matchingConcepts.length, 0, 1)
        : task.status === 'completed'
          ? 0.5
          : task.status === 'in_progress'
            ? 0.3
            : 0.1;

      const hasFragile = matchingConcepts.some((concept) => concept.stability === 'fragile');
      const hasStable = matchingConcepts.some((concept) => concept.stability === 'stable');
      const hasDeveloping = matchingConcepts.some((concept) => concept.stability === 'developing');

      const masteryState: 'unknown' | 'learning' | 'developing' | 'stable' | 'fragile' = task.status === 'completed'
        ? hasFragile
          ? 'fragile'
          : hasStable
            ? 'stable'
            : hasDeveloping
              ? 'developing'
              : 'developing'
        : task.status === 'in_progress'
          ? 'learning'
          : 'unknown';

      return {
        taskId: task.id,
        milestoneId: milestone.id,
        title: task.title,
        status: task.status as 'todo' | 'in_progress' | 'completed',
        masteryState,
        confidence: avgScore,
        lastEvidenceAt: matchingConcepts.map((concept) => concept.lastSeenAt).filter(Boolean).sort().reverse()[0],
      };
    });

    const milestoneProgress = path.milestones.map((milestone) => {
      const tasks = taskMastery.filter((task) => task.milestoneId === milestone.id);
      const completedTasks = tasks.filter((task) => task.status === 'completed').length;
      const fragileCount = tasks.filter((task) => task.masteryState === 'fragile').length;
      const stableCount = tasks.filter((task) => task.masteryState === 'stable').length;

      const masteryState: 'unknown' | 'partial' | 'stable' | 'at-risk' = tasks.length === 0
        ? 'unknown'
        : fragileCount > 0
          ? 'at-risk'
          : stableCount >= Math.max(1, Math.ceil(tasks.length / 2))
            ? 'stable'
            : completedTasks > 0
              ? 'partial'
              : 'unknown';

      return {
        milestoneId: milestone.id,
        stageNumber: milestone.stageNumber,
        title: milestone.title,
        goal: milestone.goal,
        totalTasks: tasks.length,
        completedTasks,
        masteryState,
      };
    });

    const currentMilestone = path.milestones.find((milestone) => milestone.id === input.milestoneId)
      || path.milestones.find((milestone) => milestone.subtasks.some((task) => task.id === input.taskId))
      || path.milestones.find((milestone) => milestone.status === 'active')
      || path.milestones[0];

    const currentTask = currentMilestone?.subtasks.find((task) => task.id === input.taskId);
    const currentTaskOrder = currentTask ? currentMilestone.subtasks.findIndex((task) => task.id === currentTask.id) + 1 : undefined;

    const completedPrerequisiteTasks = allTasks
      .filter(({ milestone, task }) => {
        if (!input.taskId) return task.status === 'completed';
        if (!currentMilestone) return task.status === 'completed';
        if (milestone.stageNumber < currentMilestone.stageNumber) return task.status === 'completed';
        if (milestone.id === currentMilestone.id && currentTask && task.order < currentTask.order) return task.status === 'completed';
        return false;
      })
      .map(({ task }) => task.title)
      .slice(-5);

    const masteredConcepts = conceptStates
      .filter((concept) => concept.stability === 'stable' || concept.status === 'mastered')
      .map((concept) => concept.label);
    const fragileConcepts = conceptStates
      .filter((concept) => concept.stability === 'fragile' || concept.status === 'review')
      .map((concept) => concept.label);
    const strugglingConcepts = conceptStates
      .filter((concept) => concept.status === 'learning' && concept.masteryScore < 0.55)
      .map((concept) => concept.label);

    const currentTaskConcepts = currentTask
      ? dedupe([
          currentTask.linkedConceptName || currentTask.coreConcept,
          currentTask.displayLabel,
          ...parseLearningObjectives(currentTask.learningObjectives),
        ])
      : [];

    // 前置缺口（L3 接入，语义修正）：
    // 旧口径算的是"**当前概念自己**没掌握"，那不是缺口——缺口是"**当前任务依赖的上游前置**没掌握"。
    // 新口径：当前任务的 canonical → 沿 prerequisite 边向上游闭包 → 取其中未掌握者。
    // **图缺失/无上游时回落旧口径**，保证未回填路径行为与改造前逐字一致。
    const graphGaps = await buildUpstreamPrerequisiteGaps({
      userId: input.userId,
      pathId: path.id,
      currentTask: currentTask ?? null,
      conceptStates,
    });
    const prerequisiteGaps = graphGaps.length > 0
      ? graphGaps
      : currentTaskConcepts
        .map((conceptKey) => conceptStates.find((concept) => concept.conceptKey === conceptKey || concept.label === conceptKey))
        .filter((concept) => !concept || concept.stability === 'fragile' || concept.status === 'review' || concept.masteryScore < 0.45)
        .slice(0, 4)
        .map((concept) => ({
          conceptKey: concept?.conceptKey || 'unknown',
          label: concept?.label || '未识别知识点',
          reason: '当前任务依赖该知识点，但历史证据显示掌握仍不稳定或掌握度偏低。',
          severity: concept?.stability === 'fragile' ? 'high' as const : 'medium' as const,
          source: 'fallback' as const,
        }));

    const currentPath: LearnerPathKnowledgeMemory = {
      learningPathId: path.id,
      pathTitle: path.title || path.name || '未命名路径',
      pathSummary: null,
      progress: {
        totalMilestones: path.milestones.length,
        completedMilestones: milestoneProgress.filter((milestone) => milestone.completedTasks === milestone.totalTasks && milestone.totalTasks > 0).length,
        totalTasks: taskMastery.length,
        completedTasks: taskMastery.filter((task) => task.status === 'completed').length,
      },
      currentPosition: {
        milestoneId: currentMilestone?.id || '',
        stageNumber: currentMilestone?.stageNumber || 1,
        milestoneTitle: currentMilestone?.title || '当前阶段',
        milestoneGoal: currentMilestone?.goal,
        taskId: currentTask?.id,
        taskTitle: currentTask?.title,
        taskOrder: currentTaskOrder || 1,
        totalTasksInMilestone: currentMilestone?.subtasks.length || 0,
        completedTasksInMilestone: currentMilestone?.subtasks.filter((task) => task.status === 'completed').length || 0,
      },
      milestoneProgress,
      taskMastery,
      conceptStates,
      prerequisiteGaps,
      recentEvidence: Array.from(new Map(
        recentEvidence
          .sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime())
          .map((item) => [`${item.type}:${item.sessionId || item.taskId || item.happenedAt}`, item])
      ).values()).slice(0, 20),
    };

    const deterministicConceptLedger: LearnerBackgroundConceptLedgerItem[] = conceptStates
      .map((concept) => {
        const familiarity: LearnerBackgroundConceptLedgerItem['familiarity'] = concept.status === 'mastered'
          ? 'stable'
          : concept.status === 'review'
            ? 'understood'
            : concept.status === 'learning'
              ? 'practiced'
              : 'seen';
        const transferReadiness: LearnerBackgroundConceptLedgerItem['transferReadiness'] = concept.stability === 'stable'
          ? 'high'
          : concept.stability === 'developing'
            ? 'medium'
            : 'low';
        const misconceptionRisk: LearnerBackgroundConceptLedgerItem['misconceptionRisk'] = concept.stability === 'fragile'
          ? 'high'
          : concept.status === 'learning'
            ? 'medium'
            : 'low';
        const evidence = recentEvidence.filter((item) => item.conceptKeys.includes(concept.label) || item.conceptKeys.includes(concept.conceptKey));
        return {
          conceptKey: concept.conceptKey,
          label: concept.label,
          familiarity,
          transferReadiness,
          misconceptionRisk,
          firstSeenAt: concept.lastSeenAt,
          lastSeenAt: concept.lastSeenAt,
          sourcePaths: [path.id],
          sourceTasks: concept.relatedTaskIds,
          evidenceCount: evidence.length,
        };
      })
      .slice(0, 40);

    const deterministicConfusions: LearnerRecurringConfusion[] = fragileConcepts.slice(0, 12).map((label) => ({
      conceptKey: label,
      label,
      pattern: '近期多次出现 review / fragile 信号，后续新目标与新路径中应视为不稳定前置。',
      confidence: 0.7,
      count: recentEvidence.filter((item) => item.signal === 'struggle' && item.conceptKeys.includes(label)).length || 1,
      lastSeenAt: conceptStates.find((concept) => concept.label === label)?.lastSeenAt,
    }));

    const deterministicTransferSignals: LearnerTransferSignal[] = deterministicConceptLedger
      .filter((concept) => concept.transferReadiness !== 'low')
      .slice(0, 20)
      .map((concept) => ({
        conceptKey: concept.conceptKey,
        label: concept.label,
        readiness: concept.transferReadiness,
        confidence: concept.transferReadiness === 'high' ? 0.8 : 0.6,
        lastSeenAt: concept.lastSeenAt,
      }));

    const ledgerMap = new Map<string, LearnerBackgroundConceptLedgerItem>();
    for (const item of [...deterministicConceptLedger, ...enrichedLedger]) {
      if (!item?.conceptKey) continue;
      const existing = ledgerMap.get(item.conceptKey);
      ledgerMap.set(item.conceptKey, existing
        ? {
            ...existing,
            ...item,
            sourcePaths: dedupe([...(existing.sourcePaths || []), ...(item.sourcePaths || [])]),
            sourceTasks: dedupe([...(existing.sourceTasks || []), ...(item.sourceTasks || [])]),
            evidenceCount: Math.max(existing.evidenceCount || 0, item.evidenceCount || 0)
          }
        : item);
    }
    const conceptLedger = Array.from(ledgerMap.values()).slice(0, 60);

    const confusionMap = new Map<string, LearnerRecurringConfusion>();
    for (const item of [...deterministicConfusions, ...enrichedConfusions]) {
      if (!item?.conceptKey) continue;
      const existing = confusionMap.get(item.conceptKey);
      confusionMap.set(item.conceptKey, existing
        ? {
            ...existing,
            ...item,
            confidence: Math.max(existing.confidence || 0, item.confidence || 0),
            count: Math.max(existing.count || 0, item.count || 0)
          }
        : item);
    }
    const recurringConfusions = Array.from(confusionMap.values()).slice(0, 20);

    const readinessRank = { low: 0, medium: 1, high: 2 } as const;
    const transferMap = new Map<string, LearnerTransferSignal>();
    for (const item of [...deterministicTransferSignals, ...enrichedTransferSignals]) {
      if (!item?.conceptKey) continue;
      const existing = transferMap.get(item.conceptKey);
      if (!existing || (item.confidence || 0) > existing.confidence || readinessRank[item.readiness] > readinessRank[existing.readiness]) {
        transferMap.set(item.conceptKey, item);
      }
    }
    const transferSignals = Array.from(transferMap.values()).slice(0, 30);

    const globalBackground: LearnerGlobalBackgroundKnowledge = {
      conceptLedger,
      recurringConfusions,
      reusableFoundations: dedupe([
        ...conceptLedger.filter((concept) => concept.transferReadiness === 'high').map((concept) => concept.label),
        ...enrichedReusableFoundations
      ]).slice(0, 20),
      blockedFoundations: dedupe([
        ...conceptLedger.filter((concept) => concept.misconceptionRisk === 'high').map((concept) => concept.label),
        ...enrichedBlockedFoundations
      ]).slice(0, 20),
      transferSignals,
    };

    return {
      currentPath,
      globalSignals: {
        masteredConcepts,
        fragileConcepts,
        strugglingConcepts,
      },
      globalBackground,
    };
  }
}

export const learnerKnowledgeMemoryService = new LearnerKnowledgeMemoryService();
