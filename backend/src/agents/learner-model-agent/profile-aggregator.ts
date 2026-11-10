/**
 * 学习者模型聚合器
 * 
 * 从多个数据源整合学习者画像与学习状态信息
 */

import prisma from '../../config/database';
import learningStateService from '../../services/learning/learning-state.service';
import { computeCalibrationBias } from '../../services/learner/calibration.service';
import {
  LearnerModelProfile,
  CognitiveProfile,
  BehavioralBaseline,
  LearningState,
  LearningPreferences,
  EmotionalProfile,
  InteractionHistory,
  LearnerNarrativeInsights,
  LearnerCurriculumControls,
  LearnerGoalNarratives,
  ProfileUpdateSource,
  ProfileAggregationResult,
  ProfileFieldSources,
  MetacognitionLevel,
  ThinkingStyle,
  ConfusionPattern,
  PreferredStyle,
  TheoryVsPractice,
  SessionLength,
  MotivationTrigger,
  UrgencyLevel,
  ConfidenceLevel
} from './types';
import { logger } from '../../utils/logger';
import { classifyLoad } from '../../services/learning/learning-load-verdict';

/** 入参里「真的有值」的字段名：null/undefined/空串不算（画像 merge 也按这个判空回落默认常量）。
 *  behavioral 走的是 `data.x || DEFAULT.x`，0 同样会落默认，故单独开 truthyOnly。 */
function observedFieldKeys(obj: unknown, truthyOnly = false): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const record = obj as Record<string, unknown>;
  return Object.keys(record).filter((key) => {
    const value = record[key];
    return truthyOnly ? !!value : value !== undefined && value !== null && value !== '';
  });
}

/**
 * 互动历史里主题/概念列表的服务端上限（前端再截 8 条展示）。
 */
const MAX_HISTORY_LABELS = 8;
/** 「已掌握概念」判定阈值（memory_traces.masteryScore 0-1；实测 >=0.8 与 stability=stable 数量相当）。 */
const MASTERED_SCORE_THRESHOLD = 0.8;

type LooseJson = Record<string, unknown>;

/** 目标对话 understanding 载荷中本聚合器实际读取的字段。 */
interface GoalUnderstandingPayload {
  cognitive_profile?: {
    metacognition_level?: string;
    thinking_style?: string;
    confusion_pattern?: string;
    prior_knowledge_structure?: string;
    self_assessment_accuracy?: string;
  };
  learning_style?: { preferred_format?: string; theory_vs_practice?: string };
  emotional_profile?: { motivation_trigger?: string; urgency_level?: string; confidence_level?: string };
  available_resources?: { time_budget?: string; time_horizon?: string };
  background?: { current_level?: string; available_time?: string };
  current_baseline?: { level?: string };
  real_problem?: string;
  surface_goal?: string;
  motivation?: string;
  background_experience?: string | string[];
  pain_points?: string[];
  learning_signal?: unknown;
}

/** JSON 字符串安全解析（凭证/脏数据不抛）。 */
function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 旧列 messages 的数组长度（非数组/解析失败按 0，口径同会话列表侧表回退）。 */
function legacyMessageCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

const DEFAULT_COGNITIVE: CognitiveProfile = {
  metacognitionLevel: 'medium',
  thinkingStyle: 'mixed',
  confusionPattern: 'none',
  priorKnowledgeStructure: 'blank',
  selfAssessmentAccuracy: 'accurate'
};

const DEFAULT_BEHAVIORAL: BehavioralBaseline = {
  avgResponseTime: 10,
  avgMessageLength: 50,
  avgInteractionInterval: 5,
  engagementLevel: 0.5,
  consistencyScore: 0.5
};

const DEFAULT_LEARNING_STATE: LearningState = {
  ktl: 0,
  lf: 0,
  lss: 0,
  lsb: 0,
  masteryByTopic: {},
  recentProgress: 'stable',
  streak: 0
};

const DEFAULT_PREFERENCES: LearningPreferences = {
  preferredStyle: 'mixed',
  theoryVsPractice: 'balanced',
  sessionLength: 'medium',
  preferredDifficulty: 'medium',
  prefersHints: true
};

const DEFAULT_EMOTIONAL: EmotionalProfile = {
  motivationTrigger: 'interest',
  urgencyLevel: 'medium',
  confidenceLevel: 'moderate',
  frustrationTolerance: 0.5,
  rewardSensitivity: 'medium'
};

const DEFAULT_HISTORY: InteractionHistory = {
  totalSessions: 0,
  totalMessages: 0,
  avgSessionDuration: 0,
  topicsExplored: [],
  conceptsStruggled: [],
  conceptsMastered: []
};

const DEFAULT_NARRATIVE_INSIGHTS: LearnerNarrativeInsights = {
  goalNarrative: '',
  backgroundContextNote: '',
  motivationNarrative: '',
  timeConstraintNote: '',
  selfAssessmentNote: '',
  contentReceptionPattern: '',
  practicePreferenceNote: '',
  frictionPatternNote: '',
  effectiveTeachingPattern: '',
  supportStyleNote: '',
  taskGranularityNote: ''
};

const DEFAULT_CURRICULUM_CONTROLS: LearnerCurriculumControls = {
  taskGranularityLevel: 'medium',
  conceptDensityLevel: 'medium',
  reviewFrequencyLevel: 'medium',
  progressionStrategyNote: '默认采用平衡推进：先建立理解，再用小任务验证，再逐步扩展。'
};

export class ProfileAggregator {
  
  async aggregateProfile(userId: string): Promise<ProfileAggregationResult> {
    const changes: string[] = [];
    
    const [goalConversation, baseline, metrics, sessions, calibrationBias] = await Promise.all([
      this.fetchGoalConversationData(userId),
      this.fetchBaselineData(userId),
      this.fetchMetricsData(userId),
      this.fetchSessionData(userId),
      computeCalibrationBias(userId),
    ]);
    
    const cognitive = this.mergeCognitive(goalConversation?.cognitive, changes);
    // 元认知校准闭环：数据驱动校准（来自 memory_traces FSRS 实际表现）覆盖 LLM 理解的自评
    if (calibrationBias !== 'accurate') {
      cognitive.selfAssessmentAccuracy = calibrationBias;
      changes.push(`认知校准：LLM 自评 → 数据驱动 ${calibrationBias}`);
    }
    const behavioral = this.mergeBehavioral(baseline, changes);
    const learning = this.mergeLearning(metrics, goalConversation?.background, changes);
    const preferences = this.mergePreferences(goalConversation?.preferences, changes);
    const emotional = this.mergeEmotional(goalConversation?.emotional, changes);
    const history = this.mergeHistory(sessions, changes);
    // 逐字段来源（2026-11-02 P1-8）：merge* 在没有数据时回落到 DEFAULT_*，这里按「入参里有没有这个字段」
    // 如实记录；派生读数按它的输入是否实测判定，规则文本类（建议方式/优势/风险因素）不是实测口径，不列。
    // 2026-11-09 真值核查：该计算上移到 narrative 之前——叙述洞察现在按「这一格的输入是否被观测」逐字段
    // 决定输出还是留空，不再用「有没有目标对话」这种粗代理。
    const cognitiveObserved = observedFieldKeys(goalConversation?.cognitive);
    // 校准偏差命中时 selfAssessmentAccuracy 由 memory_traces 实测覆盖，属于有数据支撑
    if (calibrationBias !== 'accurate' && !cognitiveObserved.includes('selfAssessmentAccuracy')) {
      cognitiveObserved.push('selfAssessmentAccuracy');
    }
    const behavioralObserved = observedFieldKeys(baseline, true);
    const learningObserved = observedFieldKeys(metrics);
    /* 单次时长是 inferSessionLength 推出来的：没有时间预算时它同样返回 'medium'（兜底值），
       不能当成实测——否则学员会看到「中（约 30 分钟）」后面没有默认值标注。 */
    const preferenceObserved = observedFieldKeys(goalConversation?.preferences)
      .filter((key) => key !== 'sessionLength' || !!goalConversation?.background?.availableTime);
    const emotionalObserved = observedFieldKeys(goalConversation?.emotional);

    // 画像叙述由 buildNarrativeInsights 确定性产出；原 goal-profile-inference / learning-pattern-distiller
    // LLM 增强已移除（输入与输出同字段、换措辞零增量，2026-08 去 LLM 化）
    const narrativeInsights = this.buildNarrativeInsights({
      goalConversation, cognitive, preferences, emotional, learning, history,
      observed: { cognitive: cognitiveObserved, preferences: preferenceObserved, emotional: emotionalObserved, learning: learningObserved },
    });
    const curriculumControls = this.buildCurriculumControls({ preferences, emotional, learning, narrativeInsights });
    
    const derivedInsights = this.calculateDerivedInsights({
      cognitive,
      behavioral,
      learning,
      preferences,
      emotional,
      history,
      narrativeInsights,
      curriculumControls
    });

  const profile: LearnerModelProfile = {
      userId,
      lastUpdated: new Date().toISOString(),
      cognitive,
      behavioral,
      learning,
      preferences,
      emotional,
      history,
      narrativeInsights,
      curriculumControls,
      // 目标对话原文留存：learningSignal 等字段的教学侧读取依赖 profile.narratives（此前只进
      // narrativeInsights 摘要，原文被丢弃，导致 TeachingContextBuilder 的 learningSignal 恒为 null）
      ...(goalConversation?.narratives ? { narratives: goalConversation.narratives } : {}),
      // 叙述出处：让「背景与现状」这类单对话观测在界面上可溯源，不被误读成该学习者的全部背景
      narrativeSource: goalConversation?.source ?? null,
      // 人设字段采集时点（认知/偏好/情绪/叙述同源）：界面据此标「来自哪次目标对话」，
      // 而不是把冻结的旧快照读成当前状态（2026-11-09 画像链路核查）。
      personaCapturedAt: goalConversation?.capturedAt ?? null,
      derivedInsights
    };
    
    const confidence = this.calculateConfidence(profile);

    /* 逐字段来源（2026-11-02 P1-8）：merge* 在没有数据时回落到 DEFAULT_*，这里按「入参里有没有这个字段」
       如实记录；派生读数按它的输入是否实测判定，规则文本类（建议方式/优势/风险因素）不是实测口径，不列。
       界面据此逐格标「初始默认值」，不再用一个全局的「证据为空」条件把两张卡一起标掉。 */
    const derivedObserved: string[] = [];
    if (learningObserved.includes('ktl') || learningObserved.includes('recentProgress')) derivedObserved.push('learningVelocity');
    if (preferenceObserved.includes('sessionLength') || behavioralObserved.includes('avgInteractionInterval')) {
      derivedObserved.push('optimalSessionLength');
    }
    if (learningObserved.length > 0 || cognitiveObserved.includes('metacognitionLevel')) {
      derivedObserved.push('recommendedDifficulty');
    }
    /* suggestedApproach 是规则拼装的文本，不是测量值——按本段契约不列入 sources（同 strengths/riskFactors）。
       界面改为在「输入有观测」时标「规则推导」，而不是硬塞进「实测」或一律标「初始默认值」。
       旧实现在任一画像输入有观测时就 push 它，导致通用兜底文案「采用平衡的学习方式」也带实测语义。 */
    /* 课程控制是规则产出：只有它读的那几个输入有实测值时才不算默认（buildCurriculumControls 的判据） */
    const curriculumObserved: string[] = [];
    if (preferenceObserved.includes('sessionLength') || learningObserved.includes('lf')) {
      curriculumObserved.push('taskGranularityLevel');
    }
    if (learningObserved.includes('lf') || emotionalObserved.includes('confidenceLevel')) {
      curriculumObserved.push('conceptDensityLevel');
    }
    if (learningObserved.includes('lf') || learningObserved.includes('ktl')
      || preferenceObserved.includes('theoryVsPractice')) {
      curriculumObserved.push('reviewFrequencyLevel');
    }
    if (curriculumObserved.length > 0) curriculumObserved.push('progressionStrategyNote');
    const sources: ProfileFieldSources = {
      cognitive: cognitiveObserved,
      behavioral: behavioralObserved,
      learning: learningObserved,
      preferences: preferenceObserved,
      emotional: emotionalObserved,
      history: observedFieldKeys(sessions),
      curriculumControls: curriculumObserved,
      derivedInsights: derivedObserved,
    };

    return { profile, changes, confidence, sources };
  }
  
  private async fetchGoalConversationData(userId: string): Promise<{
    cognitive?: Partial<CognitiveProfile>;
    preferences?: Partial<LearningPreferences>;
    emotional?: Partial<EmotionalProfile>;
    background?: {
      currentLevel?: string;
      availableTime?: string;
    };
    narratives?: LearnerGoalNarratives;
    source?: LearnerModelProfile['narrativeSource'];
    /** 这组人设字段的采集时点：优先取理解证据时间，其次取已完成对话的完成时间 */
    capturedAt?: string | null;
  } | null> {
    try {
      const [goalEvidence, conversation] = await Promise.all([
        prisma.learner_evidence.findFirst({
          where: { userId, evidenceType: 'goal:understanding:updated' },
          orderBy: { occurredAt: 'desc' }
        }),
        prisma.goal_conversations.findFirst({
          where: { userId, status: 'completed' },
          orderBy: { createdAt: 'desc' }
        })
      ]);
      if (!goalEvidence && !conversation) return null;

      const evidenceData = goalEvidence
        ? safeParseJson<LooseJson>(goalEvidence.payload, {})
        : null;
      const data = conversation ? safeParseJson<LooseJson>(conversation.collectedData, {}) : {};
      // 只取「最近一次已完成目标对话」——不做跨对话并集：同一学习者的不同目标背景互不相干
      // （实测同一账号并存「幼师考指南」「AI 教育平台」「和猫沟通」），并集只会串味。
      // 单对话的局限由 narrativeSource 透明化，见 LearnerModelProfile.narrativeSource。
      const understanding = (evidenceData?.understanding || data.understanding || {}) as GoalUnderstandingPayload;
      const source = conversation
        ? {
            conversationId: conversation.id,
            goalTitle: String(conversation.description || '').trim() || '（该次目标对话未填写描述）',
            completedAt: conversation.completedAt ? new Date(conversation.completedAt).toISOString() : null
          }
        : null;
      
      return {
        cognitive: {
          metacognitionLevel: understanding.cognitive_profile?.metacognition_level as MetacognitionLevel,
          thinkingStyle: understanding.cognitive_profile?.thinking_style as ThinkingStyle,
          confusionPattern: understanding.cognitive_profile?.confusion_pattern as ConfusionPattern,
          priorKnowledgeStructure: understanding.cognitive_profile?.prior_knowledge_structure as CognitiveProfile['priorKnowledgeStructure'],
          selfAssessmentAccuracy: understanding.cognitive_profile?.self_assessment_accuracy as CognitiveProfile['selfAssessmentAccuracy']
        },
        preferences: {
          preferredStyle: understanding.learning_style?.preferred_format as PreferredStyle,
          theoryVsPractice: understanding.learning_style?.theory_vs_practice as TheoryVsPractice,
          sessionLength: this.inferSessionLength(
            understanding.available_resources?.time_budget
              || understanding.available_resources?.time_horizon
              || understanding.background?.available_time
          )
        },
        emotional: {
          motivationTrigger: understanding.emotional_profile?.motivation_trigger as MotivationTrigger,
          urgencyLevel: understanding.emotional_profile?.urgency_level as UrgencyLevel,
          confidenceLevel: understanding.emotional_profile?.confidence_level as ConfidenceLevel
        },
        background: {
          currentLevel: understanding.current_baseline?.level || understanding.background?.current_level,
          availableTime: understanding.available_resources?.time_budget
            || understanding.available_resources?.time_horizon
            || understanding.background?.available_time
        },
        narratives: {
          realProblem: understanding.real_problem,
          surfaceGoal: understanding.surface_goal,
          motivation: understanding.motivation,
          backgroundExperience: Array.isArray(understanding.background_experience)
            ? understanding.background_experience.join('；')
            : understanding.background_experience,
          painPoints: Array.isArray(understanding.pain_points) ? understanding.pain_points : [],
          learningSignal: understanding.learning_signal,
          currentLevel: understanding.current_baseline?.level || understanding.background?.current_level,
          availableTime: understanding.available_resources?.time_budget
            || understanding.available_resources?.time_horizon
            || understanding.background?.available_time
        },
        source,
        capturedAt: goalEvidence?.occurredAt
          ? new Date(goalEvidence.occurredAt).toISOString()
          : conversation?.completedAt
            ? new Date(conversation.completedAt).toISOString()
            : null,
      };
    } catch (error) {
      logger.error('[profile-aggregator] failed to fetch goal conversation data', { userId, error });
      return null;
    }
  }
  
  private async fetchBaselineData(userId: string): Promise<BehavioralBaseline | null> {
    // EMA 统计基线已退役（2026-08 M1 认知负荷改造：交互特征 + LLM 语义判断承担）；
    // behavioral 画像回落到 DEFAULT_BEHAVIORAL，student_baselines 表随迁移删除。
    void userId;
    return null;
  }
  
  private async fetchMetricsData(userId: string): Promise<Partial<LearningState> | null> {
    try {
      // 学习者级状态 = 按路径保守聚合 + 当日课量疲劳加成（不再取"最近一条行"）
      const [aggregated, trends] = await Promise.all([
        learningStateService.getAggregatedState(userId),
        learningStateService.getTrends(userId, 7),
      ]);

      if (!aggregated) return null;

      logger.debug('[profile-aggregator] 学习者级状态聚合', {
        userId: userId.slice(0, 8),
        pathCount: aggregated.perPath.length,
        dayLoad: aggregated.dayLoad,
        metrics: aggregated.metrics,
      });

      // 2026-11-09 运营字段真值核查：masteryByTopic / streak 此前写死为 {} / 0。
      // 它们不在这里返回（由 mergeLearning 的 DEFAULT_LEARNING_STATE 补齐），
      // 否则 observedFieldKeys 会把 0 和 {} 判成「已观测」，界面把死值标成实测而非默认。
      return {
        ktl: aggregated.metrics.ktl,
        lf: aggregated.metrics.lf,
        lss: aggregated.metrics.lss,
        lsb: aggregated.metrics.lsb,
        recentProgress: this.inferProgress(trends),
      };
    } catch (error) {
      logger.error('[profile-aggregator] failed to fetch metrics data', { userId, error });
      return null;
    }
  }

  /**
   * 互动历史：会话数/消息数/时长按 teaching_sessions 聚合；主题取实际课程 topic；
   * 两个概念列表分别走误观念台账与记忆痕迹。旧实现 totalMessages 恒写 0、三个数组恒空
   * （前端 LearnerDetail.vue 的 historyRows 有渲染位，但永远因空而不显示）。
   */
  private async fetchSessionData(userId: string): Promise<InteractionHistory | null> {
    try {
      const sessions = await prisma.teaching_sessions.findMany({
        where: { userId },
        orderBy: { startTime: 'desc' },
        take: 50,
        select: { id: true, duration: true, topic: true }
      });

      if (sessions.length === 0) return null;

      const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
      const [totalSessions, totalMessages, conceptsStruggled, conceptsMastered] = await Promise.all([
        // 2026-11-09 画像链路核查：totalSessions 原先是 `sessions.length`，而 sessions 带 `take: 50`，
        // 于是「总课堂数」在 50 节以上会被截成 50。总数改用独立 count；消息数/时长仍是最近 50 节窗口
        // （它们要逐会话聚合，全量代价高，且标签已注明「近 50 节」）。
        prisma.teaching_sessions.count({ where: { userId } }),
        this.countSessionMessages(sessions.map((s) => s.id)),
        this.fetchStruggledConcepts(userId),
        this.fetchMasteredConcepts(userId)
      ]);

      return {
        totalSessions,
        totalMessages,
        avgSessionDuration: sessions.length > 0 ? totalDuration / sessions.length : 0,
        topicsExplored: Array.from(new Set(sessions.map((s) => (s.topic || '').trim()).filter(Boolean))).slice(0, MAX_HISTORY_LABELS),
        conceptsStruggled,
        conceptsMastered
      };
    } catch (error) {
      logger.error('[profile-aggregator] failed to fetch session data', { userId, error });
      return null;
    }
  }

  /**
   * 会话消息真实条数（全部角色）：侧表优先，无侧表行的历史会话回退 messages 旧列。
   * 口径与 platform-teaching-sessions.service 的按会话计数同源，区别仅在本处计全部角色而非仅 user。
   */
  private async countSessionMessages(sessionIds: string[]): Promise<number> {
    if (!sessionIds.length) return 0;
    const grouped = await prisma.teaching_session_messages.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessionIds } },
      _count: { _all: true }
    });
    const side = new Set<string>();
    let total = 0;
    for (const row of grouped) {
      side.add(row.sessionId);
      total += Number(row._count?._all ?? 0);
    }
    // 侧表无行 = 尚未迁移的历史会话，条数活在 messages 旧列
    const missing = sessionIds.filter((id) => !side.has(id));
    if (missing.length) {
      const legacyRows = await prisma.teaching_sessions.findMany({
        where: { id: { in: missing } },
        select: { messages: true }
      });
      for (const row of legacyRows) total += legacyMessageCount(row.messages);
    }
    return total;
  }

  /** 挣扎过概念：误观念台账里尚未消解（suspected/confirmed）的高频项。 */
  private async fetchStruggledConcepts(userId: string): Promise<string[]> {
    const rows = await prisma.misconception_ledger.findMany({
      where: { userId, status: { in: ['suspected', 'confirmed'] } },
      orderBy: { occurrenceCount: 'desc' },
      take: MAX_HISTORY_LABELS,
      select: { canonicalLabel: true }
    });
    return Array.from(new Set(rows.map((r) => (r.canonicalLabel || '').trim()).filter(Boolean)));
  }

  /** 已掌握概念：记忆痕迹中掌握度达阈值的项，按掌握度与最近接触排序。 */
  private async fetchMasteredConcepts(userId: string): Promise<string[]> {
    const rows = await prisma.memory_traces.findMany({
      // 只把真正提取过的痕迹当「已掌握」证据；KT 幽灵痕（extractionCount=0）
      // 是模型估计、不是学习证据，不能进入叙事画像的已掌握列表。
      where: {
        userId,
        masteryScore: { gte: MASTERED_SCORE_THRESHOLD },
        extractionCount: { gt: 0 },
      },
      orderBy: [{ masteryScore: 'desc' }, { lastSeenAt: 'desc' }],
      take: MAX_HISTORY_LABELS,
      select: { label: true }
    });
    return Array.from(new Set(rows.map((r) => (r.label || '').trim()).filter(Boolean)));
  }
  
  private mergeCognitive(
    data: Partial<CognitiveProfile> | undefined,
    changes: string[]
  ): CognitiveProfile {
    if (!data) return DEFAULT_COGNITIVE;
    
    const merged = { ...DEFAULT_COGNITIVE };
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        (merged as any)[key] = value;
        changes.push(`cognitive.${key}: ${value}`);
      }
    }
    return merged;
  }
  
  private mergeBehavioral(
    data: BehavioralBaseline | null,
    _changes: string[]
  ): BehavioralBaseline | null {
    // 2026-11-09 真值核查：没有观测就返回 null，不再用 DEFAULT_BEHAVIORAL 冒充读数。
    // 前端据此隐藏「学习行为基线」子卡；下游一律 `behavioral?.x`，null 时不参与判断。
    if (!data) return null;
    
    return {
      avgResponseTime: data.avgResponseTime || DEFAULT_BEHAVIORAL.avgResponseTime,
      avgMessageLength: data.avgMessageLength || DEFAULT_BEHAVIORAL.avgMessageLength,
      avgInteractionInterval: data.avgInteractionInterval || DEFAULT_BEHAVIORAL.avgInteractionInterval,
      engagementLevel: data.engagementLevel || DEFAULT_BEHAVIORAL.engagementLevel,
      consistencyScore: data.consistencyScore || DEFAULT_BEHAVIORAL.consistencyScore
    };
  }
  
  private mergeLearning(
    metrics: Partial<LearningState> | null,
    background: { currentLevel?: string; availableTime?: string } | undefined,
    changes: string[]
  ): LearningState {
    return {
      ...DEFAULT_LEARNING_STATE,
      ...(metrics || {})
    };
  }
  
  /* 2026-11-09 画像链路核查：这两个合并原先用对象 spread，而 fetchGoalConversationData 返回的对象
     **显式带有值为 undefined 的键**（例如目标对话没填 learning_style 时的 preferredStyle）。
     spread 会把 undefined 一起展开、覆盖 DEFAULT_*，于是类型承诺非空的字段实际变成 undefined，
     下游 `preferences.preferredStyle === 'visual'` 之类的判断会静默落到兜底分支。
     改为与 mergeCognitive 相同的逐键判空口径：undefined / null / '' 一律保留默认值。 */
  private mergePreferences(
    data: Partial<LearningPreferences> | undefined,
    _changes: string[]
  ): LearningPreferences {
    if (!data) return DEFAULT_PREFERENCES;
    return this.mergeDefined(DEFAULT_PREFERENCES, data);
  }
  
  private mergeEmotional(
    data: Partial<EmotionalProfile> | undefined,
    _changes: string[]
  ): EmotionalProfile {
    if (!data) return DEFAULT_EMOTIONAL;
    return this.mergeDefined(DEFAULT_EMOTIONAL, data);
  }

  /** 逐键合并：只有「确实给了值」的键才覆盖默认值。 */
  private mergeDefined<T extends object>(base: T, data: Partial<T>): T {
    const merged = { ...base };
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null && value !== '') {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  }
  
  private mergeHistory(
    data: InteractionHistory | null,
    changes: string[]
  ): InteractionHistory {
    if (!data) return DEFAULT_HISTORY;
    return data;
  }
  
  private calculateDerivedInsights(profile: Partial<LearnerModelProfile>): LearnerModelProfile['derivedInsights'] {
    const learningVelocity = this.calculateLearningVelocity(profile);
    const optimalSessionLength = this.calculateOptimalSessionLength(profile);
    const recommendedDifficulty = this.recommendDifficulty(profile);
    const suggestedApproach = this.suggestApproach(profile);
    const riskFactors = this.identifyRiskFactors(profile);
    const strengths = this.identifyStrengths(profile);
    
    return {
      learningVelocity,
      optimalSessionLength,
      recommendedDifficulty,
      suggestedApproach,
      riskFactors,
      strengths
    };
  }
  
  private calculateLearningVelocity(profile: Partial<LearnerModelProfile>): number {
    if (!profile.learning) return 0.5;
    
    const { ktl = 0, recentProgress = 'stable' } = profile.learning;
    const progressMultiplier = recentProgress === 'improving' ? 1.2 : 
                               recentProgress === 'declining' ? 0.8 : 1.0;
    
    return Math.min(1, (ktl / 10) * progressMultiplier);
  }
  
  private calculateOptimalSessionLength(profile: Partial<LearnerModelProfile>): number {
    if (profile.preferences?.sessionLength === 'short') return 20;
    if (profile.preferences?.sessionLength === 'long') return 60;
    // 2026-11-09 运营字段真值核查：avgInteractionInterval 来自已退役的 EMA 基线
    // （fetchBaselineData 恒 return null → 恒为常量 5），旧分支因此恒算出 25 分钟，
    // 是把死常量当个性化读数。没有真实交互间隔就退回通用默认 30。
    return 30;
  }
  
  /* 2026-11-09 口径统一：难度建议原先用绝对阈值 `lf > 6 / ktl > 6`，而课内真正的难度调整
     （TaskDifficultyAdjustmentService）与快照的疲劳/节奏都走 `classifyLoad` 的相对量 ACWR。
     同一份 metrics 因此会出现「画像说 easy、课内挑战上限是 high」的矛盾。改为共用同一判据：
     明显超载 → easy；有余力且元认知强 → hard；其余 medium。 */
  private recommendDifficulty(profile: Partial<LearnerModelProfile>): 'easy' | 'medium' | 'hard' {
    if (!profile.learning || !profile.cognitive) return 'medium';

    const { ktl = 0, lf = 0 } = profile.learning;
    const { metacognitionLevel } = profile.cognitive;
    const verdict = classifyLoad({ ktl, lf });

    if (verdict.pacing === 'slow' || metacognitionLevel === 'low') return 'easy';
    if (verdict.pacing === 'fast' && metacognitionLevel === 'high') return 'hard';
    return 'medium';
  }
  
  private suggestApproach(profile: Partial<LearnerModelProfile>): string {
    const parts: string[] = [];
    
    if (profile.cognitive?.thinkingStyle === 'visual') {
      parts.push('多使用图表和可视化示例');
    }
    if (profile.cognitive?.thinkingStyle === 'practical') {
      parts.push('优先动手实践，理论后置');
    }
    if (profile.preferences?.theoryVsPractice === 'practice-first') {
      parts.push('采用"先练后讲"模式');
    }
    if (profile.emotional?.confidenceLevel === 'anxious') {
      parts.push('增加正向反馈和小目标');
    }
    // 与 fatigueRisk 同口径（ACWR ≥ 1.5 才算高疲劳）；旧的 `lf > 5` 会把相对甜区误判成过载。
    if (profile.learning && classifyLoad(profile.learning).fatigueRisk !== 'low') {
      parts.push('注意休息，降低学习强度');
    }
    
    return parts.join('；') || '采用平衡的学习方式';
  }

  private buildNarrativeInsights(profile: {
    goalConversation?: {
      narratives?: {
        realProblem?: string;
        surfaceGoal?: string;
        motivation?: string;
        backgroundExperience?: string;
        painPoints?: string[];
        learningSignal?: any;
        currentLevel?: string;
        availableTime?: string;
      };
    } | null;
    cognitive: CognitiveProfile;
    preferences: LearningPreferences;
    emotional: EmotionalProfile;
    learning: LearningState;
    history: InteractionHistory;
    /** 逐字段实测来源（与 profileSources 同口径）：叙述句只在该格的输入真被观测时才输出。 */
    observed: {
      cognitive: readonly string[];
      preferences: readonly string[];
      emotional: readonly string[];
      learning: readonly string[];
    };
  }): LearnerNarrativeInsights {
    const goal = profile.goalConversation?.narratives;
    /* 2026-11-09 运营字段真值核查：这里的句子不是「空值兜底」，而是**无条件断言学习者特质**
       （「当前更多依赖兴趣或外部目标驱动」「当前没有特别突出的认知摩擦模式」）。它们会：
       ① 在运营后台「叙述洞察」卡上被当成真实洞察展示（该卡没有「初始默认值」徽标）；
       ② 经 personalization.ts / TeachingContextBuilder 作为 learnerPersona 注入教学提示词。
       零证据账号因此会以一句话人设进入教学。修法：只有该字段的**输入真的被观测到**才输出，
       否则返回空串——前端 narrativeSections 的 .filter((s) => s) 会自然不渲染。 */
    // 逐字段观测判定（2026-11-09 真值核查）：每一句只在它读的那几个输入真被观测时才输出，
    // 不再用「有没有目标对话」或「有没有会话」这种粗代理——那会让「有目标对话但没填偏好」
    // 的学员仍收到按默认偏好拼出的断言。
    const has = (list: readonly string[], key: string) => list.includes(key);
    const hasConfusionPattern = has(profile.observed.cognitive, 'confusionPattern');
    const hasThinkingStyle = has(profile.observed.cognitive, 'thinkingStyle');
    const hasPreferredStyle = has(profile.observed.preferences, 'preferredStyle');
    const hasTheoryVsPractice = has(profile.observed.preferences, 'theoryVsPractice');
    const hasSessionLength = has(profile.observed.preferences, 'sessionLength');
    const hasConfidenceLevel = has(profile.observed.emotional, 'confidenceLevel');
    const hasLf = has(profile.observed.learning, 'lf');

    const goalNarrative = goal?.realProblem || goal?.surfaceGoal || '';
    /* 2026-11-09 走查实测两条脏文案（叙述洞察「背景与现状」段）：
       ① 段间用「；」拼接，而各段自带句末「。」——实测产出「……精力已耗尽。；当前自述水平」，
          一个句号一个分号连排；拼之前先削掉段尾句读。
       ② currentLevel 是英文枚举（beginner/intermediate/advanced），整句直接透出，
          界面写着「当前自述水平：intermediate」——与全站等级词汇（入门/进阶/高级）不一致。
       合并注（2026-11-10）：只取 develop 的标点与等级中文化；它那两句兜底文案
       （「背景信息还不充分…」「当前更多依赖兴趣或外部目标驱动」）正是本次核查要去掉的
       无条件断言，不采纳。 */
    const LEVEL_ZH: Record<string, string> = { beginner: '入门', intermediate: '进阶', advanced: '高级' };
    const levelZh = (v?: string) => (v ? LEVEL_ZH[String(v).trim().toLowerCase()] || String(v) : '');
    const joinClauses = (parts: Array<string | undefined | false>): string =>
      parts
        .map((p) => (p ? String(p).trim().replace(/[。；;，,、\s]+$/, '') : ''))
        .filter(Boolean)
        .join('；');
    const backgroundContextNote = joinClauses([
      goal?.backgroundExperience,
      goal?.currentLevel ? `当前自述水平：${levelZh(goal.currentLevel)}` : '',
      Array.isArray(goal?.painPoints) && goal?.painPoints.length > 0 ? `主要卡点：${goal.painPoints.join('、')}` : ''
    ]);
    const motivationNarrative = goal?.motivation || '';
    const timeConstraintNote = goal?.availableTime
      ? `可投入时间大致为 ${goal.availableTime}，课程任务需要和这个节奏匹配。`
      : '';
    const selfAssessmentNote = goal?.currentLevel
      ? `学习者当前自述水平为 ${levelZh(goal.currentLevel)}，需要持续对比真实任务表现修正难度。`
      : '';

    const contentReceptionPattern = !(hasPreferredStyle || hasThinkingStyle)
      ? ''
      : profile.preferences.preferredStyle === 'practice'
        ? '边学边做更容易进入状态，纯讲解不宜过长。'
        : profile.cognitive.thinkingStyle === 'visual'
          ? '更容易通过可视化示例和结构图进入理解。'
          : '先建立概念，再配合例子验证，整体更稳。';
    const practicePreferenceNote = !hasTheoryVsPractice
      ? ''
      : profile.preferences.theoryVsPractice === 'practice-first'
        ? '更适合先做一个小任务，再回头解释原理。'
        : '更适合先把概念讲清，再安排验证性练习。';
    const frictionPatternNote = !(hasConfusionPattern || hasLf)
      ? ''
      : profile.cognitive.confusionPattern === 'application-difficulty'
        ? '概念本身未必难，但一到迁移应用就容易卡住，需要更多变式练习。'
        : profile.cognitive.confusionPattern === 'concept-confusion'
          ? '容易在相近概念之间混淆，需要先做概念边界辨析。'
          // 2026-11-09 口径统一（收尾）：这里原先是绝对阈值 `lf > 5`，与 fatigueRisk 的
          // ACWR 判据不同源，会出现「画像说高负荷、dynamicState.fatigueRisk 说 low」。
          : classifyLoad(profile.learning).fatigueRisk !== 'low'
            ? '高负荷时理解质量会下降，应避免单次引入过多新概念。'
            : '';
    const effectiveTeachingPattern = !hasTheoryVsPractice
      ? ''
      : profile.preferences.theoryVsPractice === 'practice-first'
        ? '先给一个具体任务切入口，再补原理说明，最后立刻做一个小验证。'
        : '先讲清当前核心概念，再用一个短练习确认是否真的理解。';
    const supportStyleNote = !hasConfidenceLevel
      ? ''
      : profile.emotional.confidenceLevel === 'anxious'
        ? '需要更温和的纠错和更高频的小反馈，避免连续追问带来额外压力。'
        : '可以接受正常强度的追问和挑战，但仍建议每次只聚焦一个关键问题。';
    const taskGranularityNote = !(hasSessionLength || hasLf)
      ? ''
      // 同口径（收尾）：原为绝对阈值 `lf > 4`，与 curriculumControls 的 ACWR 判据不一致。
      : profile.preferences.sessionLength === 'short' || classifyLoad(profile.learning).fatigueRisk !== 'low'
        ? '任务宜拆成 15-25 分钟的小闭环，优先保证完成感和理解稳定。'
        : '';

    return {
      ...DEFAULT_NARRATIVE_INSIGHTS,
      goalNarrative,
      backgroundContextNote,
      motivationNarrative,
      timeConstraintNote,
      selfAssessmentNote,
      contentReceptionPattern,
      practicePreferenceNote,
      frictionPatternNote,
      effectiveTeachingPattern,
      supportStyleNote,
      taskGranularityNote
    };
  }

  private buildCurriculumControls(profile: {
    preferences: LearningPreferences;
    emotional: EmotionalProfile;
    learning: LearningState;
    narrativeInsights: LearnerNarrativeInsights;
  }): LearnerCurriculumControls {
    /* 2026-11-09 口径统一：课程控制原先用一组绝对阈值（lf>4.5 / lf>5 / lf>4 / ktl>6），
       与快照 fatigueRisk/recommendedPacing 的相对量 ACWR 判据不同源。改为全部由 classifyLoad
       派生：超载→更小粒度/更低密度/更高复习频率；有余力且基座成熟→反向。 */
    const verdict = classifyLoad(profile.learning);
    const capacity = verdict.mature && verdict.fatigueRisk === 'low';

    const taskGranularityLevel: LearnerCurriculumControls['taskGranularityLevel'] =
      profile.preferences.sessionLength === 'short' || verdict.pacing === 'slow' ? 'small'
        : profile.preferences.sessionLength === 'long' && capacity ? 'large'
          : 'medium';

    const conceptDensityLevel: LearnerCurriculumControls['conceptDensityLevel'] =
      verdict.pacing === 'slow' || profile.emotional.confidenceLevel === 'anxious' ? 'low'
        : capacity ? 'high'
          : 'medium';

    const reviewFrequencyLevel: LearnerCurriculumControls['reviewFrequencyLevel'] =
      verdict.fatigueRisk !== 'low' || profile.preferences.theoryVsPractice === 'practice-first' ? 'high'
        : capacity ? 'low'
          : 'medium';

    const progressionStrategyNote = taskGranularityLevel === 'small'
      ? '先用小任务建立连续完成感，再逐步串成完整阶段。'
      : conceptDensityLevel === 'low'
        ? '控制单次新概念数量，确保每一步都能及时验证理解。'
        : `采用平衡推进：${profile.narrativeInsights.effectiveTeachingPattern}`;

    return {
      ...DEFAULT_CURRICULUM_CONTROLS,
      taskGranularityLevel,
      conceptDensityLevel,
      reviewFrequencyLevel,
      progressionStrategyNote
    };
  }

  private identifyRiskFactors(profile: Partial<LearnerModelProfile>): string[] {
    const risks: string[] = [];
    
    // 与 dynamicState.fatigueRisk 同口径（ACWR ≥ 1.5）；旧的 `lf > 7` 是绝对量、尺度相关。
    if (profile.learning && classifyLoad(profile.learning).fatigueRisk === 'high') {
      risks.push('疲劳度过高，可能影响学习效果');
    }
    if (profile.emotional?.confidenceLevel === 'anxious') {
      risks.push('自信心不足，需要更多鼓励');
    }
    if (profile.behavioral?.consistencyScore && profile.behavioral.consistencyScore < 0.3) {
      risks.push('学习习惯不稳定，建议固定学习时间');
    }
    if (profile.learning?.recentProgress === 'declining') {
      risks.push('学习进度下滑，可能需要调整方法');
    }
    
    return risks;
  }
  
  private identifyStrengths(profile: Partial<LearnerModelProfile>): string[] {
    const strengths: string[] = [];
    
    if (profile.cognitive?.metacognitionLevel === 'high') {
      strengths.push('元认知能力强，善于自我反思');
    }
    // 「积累扎实」= 适应基座已成熟且当前无高疲劳；旧的 `ktl > 6` 是绝对量，PMC 口径下会误判。
    if (profile.learning && classifyLoad(profile.learning).mature
      && classifyLoad(profile.learning).fatigueRisk === 'low'
      && profile.learning.recentProgress !== 'declining') {
      strengths.push('学习积累扎实');
    }
    if (profile.behavioral?.consistencyScore && profile.behavioral.consistencyScore > 0.7) {
      strengths.push('学习习惯稳定');
    }
    if (profile.emotional?.motivationTrigger === 'problem-solving') {
      strengths.push('问题导向，学习目标明确');
    }
    
    return strengths;
  }
  
  private inferProgress(metricsOrTrends: any): 'improving' | 'stable' | 'declining' {
    if (!metricsOrTrends) return 'stable';
    if (Array.isArray(metricsOrTrends)) {
      const valid = metricsOrTrends.filter((item) => item && typeof item.lsb === 'number');
      if (valid.length < 2) return 'stable';
      const recentWindow = valid.slice(-2);
      const previousWindow = valid.slice(Math.max(0, valid.length - 4), Math.max(0, valid.length - 2));
      if (previousWindow.length === 0) return 'stable';
      const recentAvg = recentWindow.reduce((sum, item) => sum + item.lsb, 0) / recentWindow.length;
      const previousAvg = previousWindow.reduce((sum, item) => sum + item.lsb, 0) / previousWindow.length;
      const delta = recentAvg - previousAvg;
      if (delta > 0.6) return 'improving';
      if (delta < -0.6) return 'declining';
      return 'stable';
    }
    if (metricsOrTrends.trend > 0.1) return 'improving';
    if (metricsOrTrends.trend < -0.1) return 'declining';
    return 'stable';
  }
  
  private inferSessionLength(availableTime?: string): SessionLength {
    if (!availableTime) return 'medium';
    const match = availableTime.match(/(\d+)/);
    if (!match) return 'medium';
    const minutes = parseInt(match[1]);
    if (minutes <= 20) return 'short';
    if (minutes >= 45) return 'long';
    return 'medium';
  }
  
  private calculateConfidence(profile: LearnerModelProfile): number {
    let score = 0;
    let count = 0;
    
    if (profile.history.totalSessions > 0) {
      score += Math.min(1, profile.history.totalSessions / 10);
      count++;
    }
    
    if (Object.keys(profile.learning.masteryByTopic).length > 0) {
      score += 0.5;
      count++;
    }
    
    if (profile.cognitive.metacognitionLevel !== 'medium' || 
        profile.cognitive.thinkingStyle !== 'mixed') {
      score += 0.5;
      count++;
    }
    
    return count > 0 ? score / count : 0.3;
  }
  
  async applyUpdate(
    userId: string,
    source: ProfileUpdateSource
  ): Promise<{ success: boolean; changes: string[] }> {
    const changes: string[] = [];
    
    try {
      const current = await prisma.goal_conversations.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' }
      });
      
      if (current) {
        const data = JSON.parse(current.collectedData || '{}');
        
        switch (source.dataType) {
          case 'cognitive':
            data.understanding = {
              ...data.understanding,
              cognitive_profile: {
                ...data.understanding?.cognitive_profile,
                ...source.data
              }
            };
            changes.push('认知画像已更新');
            break;
            
          case 'learning':
            data.collected = {
              ...data.collected,
              ...source.data
            };
            changes.push('学习状态已更新');
            break;
            
          case 'emotional':
            data.understanding = {
              ...data.understanding,
              emotional_profile: {
                ...data.understanding?.emotional_profile,
                ...source.data
              }
            };
            changes.push('情绪画像已更新');
            break;

          default:
            // dataType 已收窄为上面三种（types.ts ProfileUpdateSource，issue #196 复核），类型层不会再
            // 传入未声明值；本分支仅作运行期防御（agent 侧 metadata.source 是 as 断言）。不静默吞掉：
            // 此前未匹配的取值会写回未改动的 collectedData 并返回 success，缺失被静默化。
            logger.warn('[profile-aggregator] 收到未支持的 dataType，已忽略', {
              userId,
              dataType: source.dataType,
            });
            return { success: false, changes: [] };
        }
        
        await prisma.goal_conversations.update({
          where: { id: current.id },
          data: { collectedData: JSON.stringify(data) }
        });
      }
      
      return { success: true, changes };
    } catch (error) {
      logger.error('[profile-aggregator] failed to apply update', {
        userId,
        dataType: source.dataType,
        error,
      });
      return { success: false, changes: [] };
    }
  }
}

export const profileAggregator = new ProfileAggregator();
