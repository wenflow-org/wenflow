/**
 * 用户画像聚合器
 * 
 * 从多个数据源整合用户画像信息
 */

import prisma from '../../config/database';
import {
  UnifiedUserProfile,
  CognitiveProfile,
  BehavioralBaseline,
  LearningState,
  LearningPreferences,
  EmotionalProfile,
  InteractionHistory,
  ProfileUpdateSource,
  ProfileAggregationResult,
  MetacognitionLevel,
  ThinkingStyle,
  PreferredStyle,
  TheoryVsPractice,
  SessionLength
} from './types';
import { studentBaselineService } from '../../services/student-baseline.service';

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
    
    const derivedInsights = this.calculateDerivedInsights({
      cognitive,
      behavioral,
      learning,
      preferences,
      emotional,
      history
    });
    
    const profile: UnifiedUserProfile = {
      userId,
      lastUpdated: new Date().toISOString(),
      cognitive,
      behavioral,
      learning,
      preferences,
      emotional,
      history,
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
  } | null> {
    try {
      const conversation = await prisma.goal_conversations.findFirst({
        where: { userId, status: 'completed' },
        orderBy: { createdAt: 'desc' }
      });
      
      if (!conversation) return null;
      
      const data = JSON.parse(conversation.collectedData || '{}');
      const understanding = data.understanding || {};
      
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
        }
      };
    } catch (error) {
      console.error('[ProfileAggregator] Failed to fetch goal conversation data:', error);
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
      console.error('[ProfileAggregator] Failed to fetch baseline data:', error);
      return null;
    }
  }
  
  private async fetchMetricsData(userId: string): Promise<LearningState | null> {
    try {
      const latestMetrics = await prisma.learning_metrics.findFirst({
        where: { userId },
        orderBy: { calculatedAt: 'desc' }
      });
      
      if (!latestMetrics) return null;
      
      return {
        ktl: latestMetrics.ktl || 0,
        lf: latestMetrics.lf || 0,
        lss: latestMetrics.lss || 0,
        masteryByTopic: {},
        recentProgress: this.inferProgress(latestMetrics),
        streak: 0
      };
    } catch (error) {
      console.error('[ProfileAggregator] Failed to fetch metrics data:', error);
      return null;
    }
  }
  
  private async fetchSessionData(userId: string): Promise<InteractionHistory | null> {
    try {
      const sessions = await prisma.learning_sessions.findMany({
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
      console.error('[ProfileAggregator] Failed to fetch session data:', error);
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
  
  private calculateDerivedInsights(profile: Partial<UnifiedUserProfile>): UnifiedUserProfile['derivedInsights'] {
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
  
  private calculateLearningVelocity(profile: Partial<UnifiedUserProfile>): number {
    if (!profile.learning) return 0.5;
    
    const { ktl = 0, recentProgress = 'stable' } = profile.learning;
    const progressMultiplier = recentProgress === 'improving' ? 1.2 : 
                               recentProgress === 'declining' ? 0.8 : 1.0;
    
    return Math.min(1, (ktl / 50) * progressMultiplier);
  }
  
  private calculateOptimalSessionLength(profile: Partial<UnifiedUserProfile>): number {
    if (profile.preferences?.sessionLength === 'short') return 20;
    if (profile.preferences?.sessionLength === 'long') return 60;
    if (profile.behavioral?.avgInteractionInterval) {
      return Math.min(45, Math.max(15, profile.behavioral.avgInteractionInterval * 5));
    }
    return 30;
  }
  
  private recommendDifficulty(profile: Partial<UnifiedUserProfile>): 'easy' | 'medium' | 'hard' {
    if (!profile.learning || !profile.cognitive) return 'medium';
    
    const { ktl = 0, lf = 0 } = profile.learning;
    const { metacognitionLevel } = profile.cognitive;
    
    if (lf > 60 || metacognitionLevel === 'low') return 'easy';
    if (ktl > 60 && metacognitionLevel === 'high') return 'hard';
    return 'medium';
  }
  
  private suggestApproach(profile: Partial<UnifiedUserProfile>): string {
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
    if (profile.learning?.lf && profile.learning.lf > 50) {
      parts.push('注意休息，降低学习强度');
    }
    
    return parts.join('；') || '采用平衡的学习方式';
  }
  
  private identifyRiskFactors(profile: Partial<UnifiedUserProfile>): string[] {
    const risks: string[] = [];
    
    if (profile.learning?.lf && profile.learning.lf > 70) {
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
  
  private identifyStrengths(profile: Partial<UnifiedUserProfile>): string[] {
    const strengths: string[] = [];
    
    if (profile.cognitive?.metacognitionLevel === 'high') {
      strengths.push('元认知能力强，善于自我反思');
    }
    if (profile.learning?.ktl && profile.learning.ktl > 60) {
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
  
  private inferProgress(metrics: any): 'improving' | 'stable' | 'declining' {
    if (!metrics) return 'stable';
    if (metrics.trend > 0.1) return 'improving';
    if (metrics.trend < -0.1) return 'declining';
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
  
  private calculateConfidence(profile: UnifiedUserProfile): number {
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
        }
        
        await prisma.goal_conversations.update({
          where: { id: current.id },
          data: { collectedData: JSON.stringify(data) }
        });
      }
      
      return { success: true, changes };
    } catch (error) {
      console.error('[ProfileAggregator] Failed to apply update:', error);
      return { success: false, changes: [] };
    }
  }
}

export const profileAggregator = new ProfileAggregator();