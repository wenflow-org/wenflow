/**
 * 用户画像类型定义
 */

export type MetacognitionLevel = 'high' | 'medium' | 'low';
export type ThinkingStyle = 'intuitive' | 'logical' | 'visual' | 'practical' | 'mixed';
export type ConfusionPattern = 'concept-confusion' | 'application-difficulty' | 'principle-misunderstanding' | 'none';
export type PreferredStyle = 'video' | 'reading' | 'practice' | 'mixed';
export type TheoryVsPractice = 'theory-first' | 'practice-first' | 'balanced';
export type SessionLength = 'short' | 'medium' | 'long';
export type MotivationTrigger = 'interest' | 'problem-solving' | 'external-pressure' | 'career';
export type UrgencyLevel = 'high' | 'medium' | 'low';
export type ConfidenceLevel = 'confident' | 'moderate' | 'anxious';

export interface CognitiveProfile {
  metacognitionLevel: MetacognitionLevel;
  thinkingStyle: ThinkingStyle;
  confusionPattern: ConfusionPattern;
  priorKnowledgeStructure: 'scattered' | 'systematic' | 'blank';
  selfAssessmentAccuracy: 'overconfident' | 'accurate' | 'underconfident';
}

export interface BehavioralBaseline {
  avgResponseTime: number;
  avgMessageLength: number;
  avgInteractionInterval: number;
  engagementLevel: number;
  consistencyScore: number;
}

export interface LearningState {
  ktl: number;
  lf: number;
  lss: number;
  masteryByTopic: Record<string, number>;
  recentProgress: 'improving' | 'stable' | 'declining';
  streak: number;
}

export interface LearningPreferences {
  preferredStyle: PreferredStyle;
  theoryVsPractice: TheoryVsPractice;
  sessionLength: SessionLength;
  preferredDifficulty: 'easy' | 'medium' | 'hard';
  prefersHints: boolean;
}

export interface EmotionalProfile {
  motivationTrigger: MotivationTrigger;
  urgencyLevel: UrgencyLevel;
  confidenceLevel: ConfidenceLevel;
  frustrationTolerance: number;
  rewardSensitivity: 'high' | 'medium' | 'low';
}

export interface InteractionHistory {
  totalSessions: number;
  totalMessages: number;
  avgSessionDuration: number;
  topicsExplored: string[];
  conceptsStruggled: string[];
  conceptsMastered: string[];
}

export interface UnifiedUserProfile {
  userId: string;
  lastUpdated: string;
  
  cognitive: CognitiveProfile;
  behavioral: BehavioralBaseline;
  learning: LearningState;
  preferences: LearningPreferences;
  emotional: EmotionalProfile;
  history: InteractionHistory;
  
  derivedInsights: {
    learningVelocity: number;
    optimalSessionLength: number;
    recommendedDifficulty: 'easy' | 'medium' | 'hard';
    suggestedApproach: string;
    riskFactors: string[];
    strengths: string[];
  };
}

export interface PersonalizationConfig {
  contentStyle: {
    useAnalogies: boolean;
    detailLevel: 'concise' | 'moderate' | 'detailed';
    exampleFrequency: 'minimal' | 'moderate' | 'frequent';
    codeCommentDetail: 'minimal' | 'moderate' | 'extensive';
  };
  
  pacing: {
    initialDifficulty: 'easy' | 'medium' | 'hard';
    difficultyProgression: 'slow' | 'moderate' | 'fast';
    breakFrequency: number;
    reviewFrequency: 'minimal' | 'moderate' | 'frequent';
  };
  
  interaction: {
    hintTiming: 'immediate' | 'delayed' | 'on-request';
    encouragementFrequency: 'low' | 'medium' | 'high';
    challengeFrequency: 'low' | 'medium' | 'high';
  };
  
  pathAdjustment: {
    compressionThreshold: number;
    extensionThreshold: number;
    skipMasteryLevel: number;
  };
}

export interface ProfileUpdateSource {
  agentId: string;
  timestamp: string;
  dataType: 'cognitive' | 'behavioral' | 'learning' | 'preferences' | 'emotional' | 'interaction';
  data: Partial<
    CognitiveProfile & 
    BehavioralBaseline & 
    LearningState & 
    LearningPreferences & 
    EmotionalProfile &
    InteractionHistory
  >;
  confidence: number;
}

export interface ProfileAggregationResult {
  profile: UnifiedUserProfile;
  changes: string[];
  confidence: number;
}