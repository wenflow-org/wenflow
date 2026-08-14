import prisma from '../../config/database';
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
          seenAt: (task.completedAt || task.updatedAt).toISOString(),
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
          seenAt: happenedAt,
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

    // 记忆引擎 M2 读侧并轨：memory_traces 痕迹注入概念信号（sourceType: memory-trace）
    // 脆弱（stability=fragile）或低掌握（masteryScore<0.5）或高间隔因子（即将到期）→ review/fragile 信号
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
        seenAt: (trace.lastSeenAt || trace.updatedAt).toISOString(),
        label: trace.label || trace.conceptKey,
      });
      conceptSignals.set(conceptKey, current);
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
            seenAt: happenedAt,
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
          signal: evaluationPayload.sessionLf >= 6 ? 'fatigue' : evaluationPayload.sessionKtl >= 6 ? 'mastery' : evaluationPayload.sessionLss >= 6 ? 'struggle' : 'incomplete',
          score: typeof evaluationPayload.sessionKtl === 'number' ? clamp(evaluationPayload.sessionKtl / 10, 0, 1) : undefined,
          happenedAt,
        });
      }
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
        sourceType,
        masteryScore,
        stability,
        status,
        relatedTaskIds,
        relatedMilestoneIds,
        lastSeenAt,
      };
    });

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

    const prerequisiteGaps = currentTaskConcepts
      .map((conceptKey) => conceptStates.find((concept) => concept.conceptKey === conceptKey || concept.label === conceptKey))
      .filter((concept) => !concept || concept.stability === 'fragile' || concept.status === 'review' || concept.masteryScore < 0.45)
      .slice(0, 4)
      .map((concept) => ({
        conceptKey: concept?.conceptKey || 'unknown',
        label: concept?.label || '未识别知识点',
        reason: '当前任务依赖该知识点，但历史证据显示掌握仍不稳定或掌握度偏低。',
        severity: concept?.stability === 'fragile' ? 'high' as const : 'medium' as const,
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
