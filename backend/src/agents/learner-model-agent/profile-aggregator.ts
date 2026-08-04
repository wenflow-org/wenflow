/**
 * 学习者模型聚合器
 * 
 * 从多个数据源整合学习者画像与学习状态信息
 */

import prisma from '../../config/database';
import learningStateService from '../../services/learning/learning-state.service';
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
  ProfileUpdateSource,
  ProfileAggregationResult,
  MetacognitionLevel,
  ThinkingStyle,
  PreferredStyle,
  TheoryVsPractice,
  SessionLength
} from './types';
import { studentBaselineService } from '../../services/student-baseline.service';
import { executeSkill } from '../../skills';
import { goalProfileInferenceDefinition } from '../../skills/goal-profile-inference';
import { learningPatternDistillerDefinition } from '../../skills/learning-pattern-distiller';
import { logger } from '../../utils/logger';

function mergeStringArrays(...values: Array<Array<string> | undefined>): string[] {
  return Array.from(new Set(values.flatMap((items) => Array.isArray(items) ? items.filter(Boolean) : [])));
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
    
    const [goalConversation, baseline, metrics, sessions] = await Promise.all([
      this.fetchGoalConversationData(userId),
      this.fetchBaselineData(userId),
      this.fetchMetricsData(userId),
      this.fetchSessionData(userId)
    ]);
    
    const cognitive = this.mergeCognitive(goalConversation?.cognitive, changes);
    const behavioral = this.mergeBehavioral(baseline, changes);
    const learning = this.mergeLearning(metrics, goalConversation?.background, changes);
    const preferences = this.mergePreferences(goalConversation?.preferences, changes);
    const emotional = this.mergeEmotional(goalConversation?.emotional, changes);
    const history = this.mergeHistory(sessions, changes);
    const narrativeInsights = this.buildNarrativeInsights({ goalConversation, cognitive, preferences, emotional, learning, history });
    await this.enhanceNarrativeInsights({ userId, goalConversation, narrativeInsights, history });
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

    const learnerBackground = (goalConversation as any)?.learnerBackground;
    if (learnerBackground?.reusableFoundations?.length) {
      derivedInsights.strengths = mergeStringArrays(
        derivedInsights.strengths,
        learnerBackground.reusableFoundations.map((item: string) => `可复用基础：${item}`)
      );
    }
    if (learnerBackground?.blockedFoundations?.length) {
      derivedInsights.riskFactors = mergeStringArrays(
        derivedInsights.riskFactors,
        learnerBackground.blockedFoundations.map((item: string) => `不稳定前置：${item}`)
      );
    }
    
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
      derivedInsights
    };
    
    const confidence = this.calculateConfidence(profile);
    
    return { profile, changes, confidence };
  }
  
  private async fetchGoalConversationData(userId: string): Promise<{
    cognitive?: Partial<CognitiveProfile>;
    preferences?: Partial<LearningPreferences>;
    emotional?: Partial<EmotionalProfile>;
    background?: {
      currentLevel?: string;
      availableTime?: string;
    };
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
    learnerBackground?: any;
  } | null> {
    try {
      const goalEvidence = await prisma.learner_evidence.findFirst({
        where: { userId, evidenceType: 'goal:understanding:updated' },
        orderBy: { occurredAt: 'desc' }
      });
      const conversation = await prisma.goal_conversations.findFirst({
        where: { userId, status: 'completed' },
        orderBy: { createdAt: 'desc' }
      });
      if (!goalEvidence && !conversation) return null;

      const evidenceData = goalEvidence ? JSON.parse(goalEvidence.payload || '{}') : null;
      const data = conversation ? JSON.parse(conversation.collectedData || '{}') : {};
      const understanding = evidenceData?.understanding || data.understanding || {};
      const learnerBackground = data.learner_background && typeof data.learner_background === 'object'
        ? data.learner_background
        : null;
      
      return {
        cognitive: {
          metacognitionLevel: understanding.cognitive_profile?.metacognition_level as MetacognitionLevel,
          thinkingStyle: understanding.cognitive_profile?.thinking_style as ThinkingStyle,
          confusionPattern: understanding.cognitive_profile?.confusion_pattern,
          priorKnowledgeStructure: understanding.cognitive_profile?.prior_knowledge_structure,
          selfAssessmentAccuracy: understanding.cognitive_profile?.self_assessment_accuracy
        },
        preferences: {
          preferredStyle: understanding.learning_style?.preferred_format as PreferredStyle,
          theoryVsPractice: understanding.learning_style?.theory_vs_practice as TheoryVsPractice,
          sessionLength: this.inferSessionLength(understanding.background?.available_time)
        },
        emotional: {
          motivationTrigger: understanding.emotional_profile?.motivation_trigger,
          urgencyLevel: understanding.emotional_profile?.urgency_level,
          confidenceLevel: understanding.emotional_profile?.confidence_level
        },
        background: {
          currentLevel: understanding.background?.current_level,
          availableTime: understanding.background?.available_time
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
          currentLevel: understanding.background?.current_level,
          availableTime: understanding.background?.available_time
        },
        learnerBackground,
      };
    } catch (error) {
      logger.error('[profile-aggregator] failed to fetch goal conversation data', { userId, error });
      return null;
    }
  }
  
  private async fetchBaselineData(userId: string): Promise<BehavioralBaseline | null> {
    try {
      const baseline = await studentBaselineService.getOrCreateBaseline(userId);
      return {
        avgResponseTime: baseline.responseTime.ema,
        avgMessageLength: baseline.messageLength.ema,
        avgInteractionInterval: baseline.interactionInterval.ema,
        engagementLevel: this.calculateEngagement(baseline),
        consistencyScore: this.calculateConsistency(baseline)
      };
    } catch (error) {
      logger.error('[profile-aggregator] failed to fetch baseline data', { userId, error });
      return null;
    }
  }
  
  private async fetchMetricsData(userId: string): Promise<LearningState | null> {
    try {
      const [latestMetrics, trends] = await Promise.all([
        learningStateService.getCurrentState(userId),
        learningStateService.getTrends(userId, 7),
      ]);

      if (!latestMetrics) return null;

      return {
        ktl: latestMetrics.ktl,
        lf: latestMetrics.lf,
        lss: latestMetrics.lss,
        lsb: latestMetrics.lsb,
        masteryByTopic: {},
        recentProgress: this.inferProgress(trends),
        streak: 0
      };
    } catch (error) {
      logger.error('[profile-aggregator] failed to fetch metrics data', { userId, error });
      return null;
    }
  }

  private async fetchSessionData(userId: string): Promise<InteractionHistory | null> {
    try {
      const sessions = await prisma.teaching_sessions.findMany({
        where: { userId },
        orderBy: { startTime: 'desc' },
        take: 50
      });
      
      if (sessions.length === 0) return null;
      
      const totalDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
      
      return {
        totalSessions: sessions.length,
        totalMessages: 0,
        avgSessionDuration: sessions.length > 0 ? totalDuration / sessions.length : 0,
        topicsExplored: [],
        conceptsStruggled: [],
        conceptsMastered: []
      };
    } catch (error) {
      logger.error('[profile-aggregator] failed to fetch session data', { userId, error });
      return null;
    }
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
    changes: string[]
  ): BehavioralBaseline {
    if (!data) return DEFAULT_BEHAVIORAL;
    
    return {
      avgResponseTime: data.avgResponseTime || DEFAULT_BEHAVIORAL.avgResponseTime,
      avgMessageLength: data.avgMessageLength || DEFAULT_BEHAVIORAL.avgMessageLength,
      avgInteractionInterval: data.avgInteractionInterval || DEFAULT_BEHAVIORAL.avgInteractionInterval,
      engagementLevel: data.engagementLevel || DEFAULT_BEHAVIORAL.engagementLevel,
      consistencyScore: data.consistencyScore || DEFAULT_BEHAVIORAL.consistencyScore
    };
  }
  
  private mergeLearning(
    metrics: LearningState | null,
    background: { currentLevel?: string; availableTime?: string } | undefined,
    changes: string[]
  ): LearningState {
    return {
      ...DEFAULT_LEARNING_STATE,
      ...(metrics || {})
    };
  }
  
  private mergePreferences(
    data: Partial<LearningPreferences> | undefined,
    changes: string[]
  ): LearningPreferences {
    if (!data) return DEFAULT_PREFERENCES;
    
    return {
      ...DEFAULT_PREFERENCES,
      ...data
    };
  }
  
  private mergeEmotional(
    data: Partial<EmotionalProfile> | undefined,
    changes: string[]
  ): EmotionalProfile {
    if (!data) return DEFAULT_EMOTIONAL;
    
    return {
      ...DEFAULT_EMOTIONAL,
      ...data
    };
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
    if (profile.behavioral?.avgInteractionInterval) {
      return Math.min(45, Math.max(15, profile.behavioral.avgInteractionInterval * 5));
    }
    return 30;
  }
  
  private recommendDifficulty(profile: Partial<LearnerModelProfile>): 'easy' | 'medium' | 'hard' {
    if (!profile.learning || !profile.cognitive) return 'medium';
    
    const { ktl = 0, lf = 0 } = profile.learning;
    const { metacognitionLevel } = profile.cognitive;
    
    if (lf > 6 || metacognitionLevel === 'low') return 'easy';
    if (ktl > 6 && metacognitionLevel === 'high') return 'hard';
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
    if (profile.learning?.lf && profile.learning.lf > 5) {
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
  }): LearnerNarrativeInsights {
    const goal = profile.goalConversation?.narratives;
    const goalNarrative = goal?.realProblem || goal?.surfaceGoal || '当前目标还需要在真实问题层面继续收缩。';
    const backgroundContextNote = [
      goal?.backgroundExperience,
      goal?.currentLevel ? `当前自述水平：${goal.currentLevel}` : '',
      Array.isArray(goal?.painPoints) && goal?.painPoints.length > 0 ? `主要卡点：${goal.painPoints.join('、')}` : ''
    ].filter(Boolean).join('；') || '背景信息还不充分，后续需要结合学习表现继续补齐。';
    const motivationNarrative = goal?.motivation || (profile.emotional.motivationTrigger === 'problem-solving' ? '更偏问题驱动，适合围绕真实任务推进。' : '当前更多依赖兴趣或外部目标驱动。');
    const timeConstraintNote = goal?.availableTime
      ? `可投入时间大致为 ${goal.availableTime}，课程任务需要和这个节奏匹配。`
      : '时间约束还不够明确，建议优先按中等节奏安排。';
    const selfAssessmentNote = goal?.currentLevel
      ? `学习者当前自述水平为 ${goal.currentLevel}，需要持续对比真实任务表现修正难度。`
      : '当前还缺少稳定的自评基线，需要通过后续学习表现补足。';

    const contentReceptionPattern = profile.preferences.preferredStyle === 'practice'
      ? '边学边做更容易进入状态，纯讲解不宜过长。'
      : profile.cognitive.thinkingStyle === 'visual'
        ? '更容易通过可视化示例和结构图进入理解。'
        : '先建立概念，再配合例子验证，整体更稳。';
    const practicePreferenceNote = profile.preferences.theoryVsPractice === 'practice-first'
      ? '更适合先做一个小任务，再回头解释原理。'
      : '更适合先把概念讲清，再安排验证性练习。';
    const frictionPatternNote = profile.cognitive.confusionPattern === 'application-difficulty'
      ? '概念本身未必难，但一到迁移应用就容易卡住，需要更多变式练习。'
      : profile.cognitive.confusionPattern === 'concept-confusion'
        ? '容易在相近概念之间混淆，需要先做概念边界辨析。'
        : profile.learning.lf > 5
          ? '高负荷时理解质量会下降，应避免单次引入过多新概念。'
          : '当前没有特别突出的认知摩擦模式，但仍需持续观察真实学习证据。';
    const effectiveTeachingPattern = profile.preferences.theoryVsPractice === 'practice-first'
      ? '先给一个具体任务切入口，再补原理说明，最后立刻做一个小验证。'
      : '先讲清当前核心概念，再用一个短练习确认是否真的理解。';
    const supportStyleNote = profile.emotional.confidenceLevel === 'anxious'
      ? '需要更温和的纠错和更高频的小反馈，避免连续追问带来额外压力。'
      : '可以接受正常强度的追问和挑战，但仍建议每次只聚焦一个关键问题。';
    const taskGranularityNote = profile.preferences.sessionLength === 'short' || profile.learning.lf > 4
      ? '任务宜拆成 15-25 分钟的小闭环，优先保证完成感和理解稳定。'
      : '任务可以保持中等粒度，但仍建议每个任务只有一个主要认知目标。';

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
    const taskGranularityLevel: LearnerCurriculumControls['taskGranularityLevel'] =
      profile.preferences.sessionLength === 'short' || profile.learning.lf > 4.5 ? 'small'
        : profile.preferences.sessionLength === 'long' && profile.learning.ktl > 5 ? 'large'
          : 'medium';

    const conceptDensityLevel: LearnerCurriculumControls['conceptDensityLevel'] =
      profile.learning.lf > 5 || profile.emotional.confidenceLevel === 'anxious' ? 'low'
        : profile.learning.ktl > 6 ? 'high'
          : 'medium';

    const reviewFrequencyLevel: LearnerCurriculumControls['reviewFrequencyLevel'] =
      profile.learning.lf > 4 || profile.preferences.theoryVsPractice === 'practice-first' ? 'high'
        : profile.learning.ktl > 6 ? 'low'
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

  private async enhanceNarrativeInsights(input: {
    userId: string;
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
    narrativeInsights: LearnerNarrativeInsights;
    history: InteractionHistory;
  }): Promise<void> {
    try {
      const goalUnderstanding = input.goalConversation?.narratives
        ? {
            real_problem: input.goalConversation.narratives.realProblem,
            surface_goal: input.goalConversation.narratives.surfaceGoal,
            motivation: input.goalConversation.narratives.motivation,
            background_experience: input.goalConversation.narratives.backgroundExperience,
            pain_points: input.goalConversation.narratives.painPoints,
            learning_signal: input.goalConversation.narratives.learningSignal,
            background: {
              current_level: input.goalConversation.narratives.currentLevel,
              available_time: input.goalConversation.narratives.availableTime,
            }
          }
        : null;

      if (goalUnderstanding) {
        const goalResult = await executeSkill(goalProfileInferenceDefinition, {
          understanding: goalUnderstanding,
        }).catch(() => null);
        if (goalResult) {
          Object.assign(input.narrativeInsights, {
            goalNarrative: goalResult.goalNarrative || input.narrativeInsights.goalNarrative,
            backgroundContextNote: goalResult.backgroundContextNote || input.narrativeInsights.backgroundContextNote,
            motivationNarrative: goalResult.motivationNarrative || input.narrativeInsights.motivationNarrative,
            timeConstraintNote: goalResult.timeConstraintNote || input.narrativeInsights.timeConstraintNote,
            selfAssessmentNote: goalResult.selfAssessmentNote || input.narrativeInsights.selfAssessmentNote,
          });
        }
      }

      if (input.history.totalSessions <= 0) return;

      const learnerSnapshotLike = {
        profile: {
          preferences: {
            preferredStyle: input.narrativeInsights.contentReceptionPattern,
            theoryVsPractice: input.narrativeInsights.practicePreferenceNote,
          },
          emotional: {
            confidenceLevel: input.narrativeInsights.supportStyleNote,
          }
        },
        dynamicState: {
          recommendedPacing: input.narrativeInsights.taskGranularityNote,
        }
      };

      const learningPatternResult = await executeSkill(learningPatternDistillerDefinition, {
        learnerSnapshot: learnerSnapshotLike,
      }).catch(() => null);

      if (learningPatternResult) {
        Object.assign(input.narrativeInsights, {
          contentReceptionPattern: learningPatternResult.contentReceptionPattern || input.narrativeInsights.contentReceptionPattern,
          practicePreferenceNote: learningPatternResult.practicePreferenceNote || input.narrativeInsights.practicePreferenceNote,
          frictionPatternNote: learningPatternResult.frictionPatternNote || input.narrativeInsights.frictionPatternNote,
          effectiveTeachingPattern: learningPatternResult.effectiveTeachingPattern || input.narrativeInsights.effectiveTeachingPattern,
          supportStyleNote: learningPatternResult.supportStyleNote || input.narrativeInsights.supportStyleNote,
          taskGranularityNote: learningPatternResult.taskGranularityNote || input.narrativeInsights.taskGranularityNote,
        });
      }
    } catch {
      // Narrative enhancement is best-effort only.
    }
  }
  
  private identifyRiskFactors(profile: Partial<LearnerModelProfile>): string[] {
    const risks: string[] = [];
    
    if (profile.learning?.lf && profile.learning.lf > 7) {
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
    if (profile.learning?.ktl && profile.learning.ktl > 6) {
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
  
  private calculateEngagement(baseline: any): number {
    if (!baseline) return 0.5;
    const responseRate = 1 / (1 + Math.exp(-(baseline.responseTime.ema - 10) / 5));
    const lengthScore = Math.min(1, baseline.messageLength.ema / 100);
    return (responseRate + lengthScore) / 2;
  }
  
  private calculateConsistency(baseline: any): number {
    if (!baseline) return 0.5;
    const variance = (
      (baseline.responseTime.emVar || 1) +
      (baseline.messageLength.emVar || 100) / 100
    ) / 2;
    return Math.max(0, 1 - variance);
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

          case 'knowledge-background': {
            const existing = data.learner_background && typeof data.learner_background === 'object'
              ? data.learner_background
              : {};
            const incoming = source.data?.learnerBackground && typeof source.data.learnerBackground === 'object'
              ? source.data.learnerBackground
              : {};

            data.learner_background = {
              ...existing,
              ...incoming,
              conceptLedger: Array.isArray(incoming.conceptLedger)
                ? incoming.conceptLedger
                : existing.conceptLedger || [],
              recurringConfusions: Array.isArray(incoming.recurringConfusions)
                ? incoming.recurringConfusions
                : existing.recurringConfusions || [],
              reusableFoundations: mergeStringArrays(existing.reusableFoundations, incoming.reusableFoundations),
              blockedFoundations: mergeStringArrays(existing.blockedFoundations, incoming.blockedFoundations),
              transferSignals: Array.isArray(incoming.transferSignals)
                ? incoming.transferSignals
                : existing.transferSignals || [],
            };
            changes.push('知识背景已更新');
            break;
          }
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
