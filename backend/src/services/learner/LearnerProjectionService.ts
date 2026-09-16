import type {
  LearnerPlanningProjection,
  LearnerReplanProjection,
  LearnerSnapshot,
  TeachingLearnerProjection,
} from '../../agents/learner-model-agent/types';

/** dashboard / learning-state 呈现层（adaptive-guidance-copy）专用投影：裁剪掉与文案无关的大字段 */
export interface GuidanceCopyProjection {
  learnerSnapshot: LearnerSnapshot;
  path: Record<string, any> | null;
}

/** 状态评审诊断层（learner-state-review）专用投影：只带状态摘要与知识线索 */
export interface ReviewProjection {
  learnerDigest: {
    level: number | null;
    metrics: { lss: number; ktl: number; lf: number; lsb: number };
    trend?: string;
    fatigue?: string;
    pacing?: string;
    srlPhase?: string;
  };
  knowledgeDigest: {
    mastered: string[];
    fragile: string[];
    struggling: string[];
    prerequisiteGaps: Array<{ label: string; reason: string; severity: string }>;
    currentPath: {
      learningPathId?: string;
      pathTitle?: string;
      progress?: any;
      currentPosition?: any;
    } | null;
  };
}

const GUIDANCE_PATH_FIELDS = [
  'id', 'title', 'name', 'description', 'subject', 'status', 'difficulty',
  'estimatedHours', 'totalMilestones', 'completedMilestones', 'updatedAt',
  'deadlineText', 'replanMode', 'replanReason',
] as const;

export class LearnerProjectionService {
  /**
   * 呈现层投影：只保留生成引导文案所需字段。
   * 关键裁剪（修 10.9 万 token 上下文膨胀）：
   *  - path 丢掉整行 learning_paths（含 aiPromptTemplate，单字段可达 12 万字符）
   *  - learnerSnapshot.knowledgeMemory 丢掉 currentPath 的 taskMastery/conceptStates/recentEvidence/milestoneProgress
   *    与 globalBackground 全量台账，只保留 globalSignals + 顶部若干台账项
   * 语义不变：adaptive-guidance-copy 只需状态摘要与少量概念。
   */
  toGuidanceProjection(snapshot: LearnerSnapshot, path?: Record<string, any> | null): GuidanceCopyProjection {
    const anySnapshot = snapshot as any;
    const knowledgeMemory = anySnapshot?.knowledgeMemory ?? {};
    const currentPath = knowledgeMemory?.currentPath;
    const globalSignals = knowledgeMemory?.globalSignals ?? {
      masteredConcepts: [], fragileConcepts: [], strugglingConcepts: [],
    };
    const globalBackground = knowledgeMemory?.globalBackground ?? {};

    const trimmedSnapshot = {
      snapshotVersion: anySnapshot?.snapshotVersion,
      scope: anySnapshot?.scope,
      freshness: anySnapshot?.freshness,
      profile: anySnapshot?.profile,
      dynamicState: anySnapshot?.dynamicState,
      learningControlState: anySnapshot?.learningControlState,
      replanSignal: anySnapshot?.replanSignal,
      teachingHints: anySnapshot?.teachingHints,
      knowledgeMemory: {
        ...(currentPath
          ? {
              currentPath: {
                learningPathId: currentPath.learningPathId,
                pathTitle: currentPath.pathTitle,
                pathSummary: currentPath.pathSummary,
                progress: currentPath.progress,
                currentPosition: currentPath.currentPosition,
                prerequisiteGaps: currentPath.prerequisiteGaps,
                // 大字段置空：文案生成不需要逐任务/逐概念/逐证据明细
                milestoneProgress: [],
                taskMastery: [],
                conceptStates: [],
                recentEvidence: [],
              },
            }
          : {}),
        globalSignals: {
          masteredConcepts: (globalSignals.masteredConcepts ?? []).slice(0, 8),
          fragileConcepts: (globalSignals.fragileConcepts ?? []).slice(0, 8),
          strugglingConcepts: (globalSignals.strugglingConcepts ?? []).slice(0, 8),
        },
        globalBackground: {
          reusableFoundations: (globalBackground.reusableFoundations ?? []).slice(0, 5),
          blockedFoundations: (globalBackground.blockedFoundations ?? []).slice(0, 5),
          conceptLedger: Array.isArray(globalBackground.conceptLedger) ? globalBackground.conceptLedger.slice(0, 5) : [],
          recurringConfusions: Array.isArray(globalBackground.recurringConfusions) ? globalBackground.recurringConfusions.slice(0, 3) : [],
          transferSignals: [],
        },
      },
    } as LearnerSnapshot;

    const pathProjection = path
      ? {
          ...Object.fromEntries(GUIDANCE_PATH_FIELDS.map((field) => [field, (path as any)[field]])),
          milestones: Array.isArray(path.milestones)
            ? path.milestones.map((milestone: any) => ({
                id: milestone?.id,
                title: milestone?.title,
                stageNumber: milestone?.stageNumber,
                status: milestone?.status,
              }))
            : [],
        }
      : null;

    return { learnerSnapshot: trimmedSnapshot, path: pathProjection };
  }

  /**
   * 诊断层投影：给 learner-state-review 的最小状态摘要 + 知识线索。
   * 不含逐任务/逐证据明细；证据引用由调用方按 DB 事件 id 另附（见设计 §4.2）。
   */
  toReviewProjection(snapshot: LearnerSnapshot): ReviewProjection {
    const anySnapshot = snapshot as any;
    const metrics = anySnapshot?.dynamicState?.metrics ?? {};
    const knowledgeMemory = anySnapshot?.knowledgeMemory ?? {};
    const globalSignals = knowledgeMemory?.globalSignals ?? {};
    const currentPath = knowledgeMemory?.currentPath;

    return {
      learnerDigest: {
        level: anySnapshot?.profile?.learning?.level ?? null,
        metrics: {
          lss: Number(metrics.lss) || 0,
          ktl: Number(metrics.ktl) || 0,
          lf: Number(metrics.lf) || 0,
          lsb: Number(metrics.lsb) || 0,
        },
        trend: anySnapshot?.dynamicState?.recentTrend,
        fatigue: anySnapshot?.dynamicState?.fatigueRisk,
        pacing: anySnapshot?.dynamicState?.recommendedPacing,
        srlPhase: anySnapshot?.dynamicState?.srlPhase,
      },
      knowledgeDigest: {
        mastered: (globalSignals.masteredConcepts ?? []).slice(0, 12),
        fragile: (globalSignals.fragileConcepts ?? []).slice(0, 12),
        struggling: (globalSignals.strugglingConcepts ?? []).slice(0, 12),
        prerequisiteGaps: (currentPath?.prerequisiteGaps ?? []).slice(0, 8).map((gap: any) => ({
          label: gap?.label,
          reason: gap?.reason,
          severity: gap?.severity,
        })),
        currentPath: currentPath
          ? {
              learningPathId: currentPath.learningPathId,
              pathTitle: currentPath.pathTitle,
              progress: currentPath.progress,
              currentPosition: currentPath.currentPosition,
            }
          : null,
      },
    };
  }

  toTeachingProjection(snapshot: LearnerSnapshot): TeachingLearnerProjection {
    const currentPath = snapshot.knowledgeMemory.currentPath;

    return {
      stableProfile: {
        thinkingStyle: snapshot.profile.cognitive.thinkingStyle,
        preferredStyle: snapshot.profile.preferences.preferredStyle,
        theoryVsPractice: snapshot.profile.preferences.theoryVsPractice,
        sessionLength: snapshot.profile.preferences.sessionLength,
        confidenceLevel: snapshot.profile.emotional.confidenceLevel,
      },
      liveState: {
        lss: snapshot.dynamicState.metrics.lss,
        ktl: snapshot.dynamicState.metrics.ktl,
        lf: snapshot.dynamicState.metrics.lf,
        lsb: snapshot.dynamicState.metrics.lsb,
        recentTrend: snapshot.dynamicState.recentTrend,
        recommendedPacing: snapshot.dynamicState.recommendedPacing,
      },
      pathContext: {
        pathTitle: currentPath?.pathTitle || '当前学习路径',
        pathSummary: currentPath?.pathSummary,
        currentMilestoneTitle: currentPath?.currentPosition.milestoneTitle || '当前阶段',
        currentStageNumber: currentPath?.currentPosition.stageNumber || 1,
        currentTaskOrder: currentPath?.currentPosition.taskOrder || 1,
        totalTasksInMilestone: currentPath?.currentPosition.totalTasksInMilestone || 0,
        completedPrerequisiteTasks: currentPath?.taskMastery
          .filter((task) => task.status === 'completed')
          .map((task) => task.title)
          .slice(-5) || [],
      },
      relevantKnowledge: {
        mastered: snapshot.knowledgeMemory.globalSignals.masteredConcepts,
        fragile: snapshot.knowledgeMemory.globalSignals.fragileConcepts,
        struggling: snapshot.knowledgeMemory.globalSignals.strugglingConcepts,
      },
      backgroundKnowledge: {
        reusableFoundations: snapshot.knowledgeMemory.globalBackground.reusableFoundations,
        blockedFoundations: snapshot.knowledgeMemory.globalBackground.blockedFoundations,
        recentConceptLedger: snapshot.knowledgeMemory.globalBackground.conceptLedger.slice(0, 12),
        recurringConfusions: snapshot.knowledgeMemory.globalBackground.recurringConfusions.slice(0, 8),
      },
      learningControlState: snapshot.learningControlState,
      teachingHints: {
        promptEnhancement: snapshot.teachingHints.promptEnhancement,
        recommendedApproach: snapshot.teachingHints.recommendedApproach,
        emphasize: snapshot.teachingHints.emphasize,
        avoid: snapshot.teachingHints.avoid,
      },
    };
  }

  toReplanProjection(snapshot: LearnerSnapshot): LearnerReplanProjection | null {
    const currentPath = snapshot.knowledgeMemory.currentPath;
    if (!currentPath) return null;

    return {
      path: {
        learningPathId: currentPath.learningPathId,
        pathTitle: currentPath.pathTitle,
        progress: currentPath.progress,
        currentPosition: {
          milestoneId: currentPath.currentPosition.milestoneId,
          stageNumber: currentPath.currentPosition.stageNumber,
          milestoneTitle: currentPath.currentPosition.milestoneTitle,
          taskId: currentPath.currentPosition.taskId,
          taskTitle: currentPath.currentPosition.taskTitle,
        },
      },
      mastery: {
        stableTaskIds: currentPath.taskMastery.filter((task) => task.masteryState === 'stable').map((task) => task.taskId),
        fragileTaskIds: currentPath.taskMastery.filter((task) => task.masteryState === 'fragile').map((task) => task.taskId),
        stableConcepts: snapshot.knowledgeMemory.globalSignals.masteredConcepts,
        fragileConcepts: snapshot.knowledgeMemory.globalSignals.fragileConcepts,
        strugglingConcepts: snapshot.knowledgeMemory.globalSignals.strugglingConcepts,
      },
      risk: {
        fatigueRisk: snapshot.dynamicState.fatigueRisk,
        recentTrend: snapshot.dynamicState.recentTrend,
        prerequisiteGaps: currentPath.prerequisiteGaps.map((gap) => ({
          conceptKey: gap.conceptKey,
          label: gap.label,
          severity: gap.severity,
        })),
      },
      evidence: {
        recentEvidence: currentPath.recentEvidence,
        milestoneStates: currentPath.milestoneProgress,
        taskMastery: currentPath.taskMastery,
      },
      signal: snapshot.replanSignal,
    };
  }
  /**
   * 规划投影：给**新建路径**用（此刻还没有 currentPath，只有该学习者的学习历史）。
   *
   * 动机：初始规划此前只有用户在 goal 阶段的自述（baseline/背景），**学习证据一律不参与**——
   * 于是首版路径的难度是"盲排"，同一个学习者第二次建路径时，之前踩过的坑不会影响新路径。
   * 这里把已有的学习证据（已稳/脆弱/挣扎的概念、阻塞地基、反复误解、指标与节奏）裁成
   * 一份有界投影，交给 path-planning 做难度校准。
   *
   * 无学习历史（全空）→ 返回 null：冷启动行为与之前完全一致，不注入噪声。
   */
  toPlanningProjection(snapshot: LearnerSnapshot): LearnerPlanningProjection | null {
    const signals = snapshot.knowledgeMemory.globalSignals;
    const background = snapshot.knowledgeMemory.globalBackground;
    const mastered = signals.masteredConcepts ?? [];
    const fragile = signals.fragileConcepts ?? [];
    const struggling = signals.strugglingConcepts ?? [];
    const blocked = background?.blockedFoundations ?? [];
    const confusions = background?.recurringConfusions ?? [];
    const ledgerSize = background?.conceptLedger?.length ?? 0;

    const hasLearningHistory = mastered.length + fragile.length + struggling.length + blocked.length
      + confusions.length + ledgerSize > 0;
    if (!hasLearningHistory) return null;

    return {
      hasLearningHistory: true,
      metrics: snapshot.dynamicState?.metrics
        ? {
            lss: snapshot.dynamicState.metrics.lss,
            ktl: snapshot.dynamicState.metrics.ktl,
            lf: snapshot.dynamicState.metrics.lf,
            lsb: snapshot.dynamicState.metrics.lsb,
          }
        : null,
      recommendedPacing: snapshot.dynamicState?.recommendedPacing ?? 'moderate',
      recentTrend: snapshot.dynamicState?.recentTrend ?? 'stable',
      fatigueRisk: snapshot.dynamicState?.fatigueRisk ?? 'low',
      paceMode: snapshot.learningControlState?.paceMode ?? 'steady',
      challengeLevelCap: snapshot.learningControlState?.challengeLevelCap ?? 'medium',
      masteredConcepts: mastered.slice(0, 8),
      fragileConcepts: fragile.slice(0, 8),
      strugglingConcepts: struggling.slice(0, 8),
      blockedFoundations: blocked.slice(0, 5),
      recurringConfusions: confusions.slice(0, 5).map((item) => ({
        concept: String(item.label || item.conceptKey || '').slice(0, 40),
        note: String(item.pattern || '').slice(0, 60),
        count: Number(item.count) || 0,
      })).filter((item) => item.concept),
      conceptLedgerSize: ledgerSize,
    };
  }
}

export const learnerProjectionService = new LearnerProjectionService();
