/**
 * 学习者模型类型定义
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
  lsb: number;
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

export interface LearnerNarrativeInsights {
  goalNarrative: string;
  backgroundContextNote: string;
  motivationNarrative: string;
  timeConstraintNote: string;
  selfAssessmentNote: string;
  contentReceptionPattern: string;
  practicePreferenceNote: string;
  frictionPatternNote: string;
  effectiveTeachingPattern: string;
  supportStyleNote: string;
  taskGranularityNote: string;
}

export interface LearnerCurriculumControls {
  taskGranularityLevel: 'small' | 'medium' | 'large';
  conceptDensityLevel: 'low' | 'medium' | 'high';
  reviewFrequencyLevel: 'low' | 'medium' | 'high';
  progressionStrategyNote: string;
}

export interface LearnerModelProfile {
  userId: string;
  lastUpdated: string;
  
  cognitive: CognitiveProfile;
  behavioral: BehavioralBaseline;
  learning: LearningState;
  preferences: LearningPreferences;
  emotional: EmotionalProfile;
  history: InteractionHistory;
  narrativeInsights: LearnerNarrativeInsights;
  curriculumControls: LearnerCurriculumControls;
  
  derivedInsights: {
    learningVelocity: number;
    optimalSessionLength: number;
    recommendedDifficulty: 'easy' | 'medium' | 'hard';
    suggestedApproach: string;
    riskFactors: string[];
    strengths: string[];
  };
}

export interface LearnerDynamicState {
  metrics: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  };
  recentTrend: 'improving' | 'stable' | 'declining';
  fatigueRisk: 'low' | 'medium' | 'high';
  confidenceTrend: 'rising' | 'stable' | 'falling';
  recentSessionQuality: 'strong' | 'mixed' | 'weak';
  recommendedPacing: 'slow' | 'moderate' | 'fast';
  recommendedInteraction: {
    hintTiming: 'immediate' | 'delayed' | 'on-request';
    encouragement: 'low' | 'medium' | 'high';
    challenge: 'low' | 'medium' | 'high';
  };
}

export interface LearnerRecentEvidence {
  type: 'task-completed' | 'teaching-session' | 'summary' | 'evaluation';
  taskId?: string;
  sessionId?: string;
  conceptKeys: string[];
  signal: 'mastery' | 'struggle' | 'fatigue' | 'incomplete';
  score?: number;
  happenedAt: string;
}

export interface LearnerConceptState {
  conceptKey: string;
  label: string;
  sourceType: 'task-label' | 'session-knowledge' | 'derived';
  masteryScore: number;
  stability: 'unknown' | 'fragile' | 'developing' | 'stable';
  status: 'pending' | 'learning' | 'mastered' | 'review';
  relatedTaskIds: string[];
  relatedMilestoneIds: string[];
  lastSeenAt?: string;
}

export interface LearnerTaskMastery {
  taskId: string;
  milestoneId: string;
  title: string;
  status: 'todo' | 'in_progress' | 'completed';
  masteryState: 'unknown' | 'learning' | 'developing' | 'stable' | 'fragile';
  confidence: number;
  lastEvidenceAt?: string;
}

export interface LearnerMilestoneProgress {
  milestoneId: string;
  stageNumber: number;
  title: string;
  goal?: string | null;
  totalTasks: number;
  completedTasks: number;
  masteryState: 'unknown' | 'partial' | 'stable' | 'at-risk';
}

export interface LearnerPrerequisiteGap {
  conceptKey: string;
  label: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface LearnerBackgroundConceptLedgerItem {
  conceptKey: string;
  label: string;
  familiarity: 'seen' | 'practiced' | 'understood' | 'stable';
  transferReadiness: 'low' | 'medium' | 'high';
  misconceptionRisk: 'low' | 'medium' | 'high';
  firstSeenAt?: string;
  lastSeenAt?: string;
  sourcePaths: string[];
  sourceTasks: string[];
  evidenceCount: number;
}

export interface LearnerRecurringConfusion {
  conceptKey: string;
  label: string;
  pattern: string;
  confidence: number;
  count: number;
  lastSeenAt?: string;
}

export interface LearnerTransferSignal {
  conceptKey: string;
  label: string;
  readiness: 'low' | 'medium' | 'high';
  confidence: number;
  lastSeenAt?: string;
}

export interface LearnerGlobalBackgroundKnowledge {
  conceptLedger: LearnerBackgroundConceptLedgerItem[];
  recurringConfusions: LearnerRecurringConfusion[];
  reusableFoundations: string[];
  blockedFoundations: string[];
  transferSignals: LearnerTransferSignal[];
}

export interface LearnerPathKnowledgeMemory {
  learningPathId: string;
  pathTitle: string;
  pathSummary?: string | null;
  progress: {
    totalMilestones: number;
    completedMilestones: number;
    totalTasks: number;
    completedTasks: number;
  };
  currentPosition: {
    milestoneId: string;
    stageNumber: number;
    milestoneTitle: string;
    milestoneGoal?: string | null;
    taskId?: string;
    taskTitle?: string;
    taskOrder?: number;
    totalTasksInMilestone?: number;
    completedTasksInMilestone?: number;
  };
  milestoneProgress: LearnerMilestoneProgress[];
  taskMastery: LearnerTaskMastery[];
  conceptStates: LearnerConceptState[];
  prerequisiteGaps: LearnerPrerequisiteGap[];
  recentEvidence: LearnerRecentEvidence[];
}

export interface LearnerKnowledgeMemory {
  currentPath?: LearnerPathKnowledgeMemory;
  globalSignals: {
    masteredConcepts: string[];
    fragileConcepts: string[];
    strugglingConcepts: string[];
  };
  globalBackground: LearnerGlobalBackgroundKnowledge;
}

export interface LearnerLearningControlState {
  paceMode: 'recover' | 'steady' | 'push';
  conceptLoad: 'low' | 'medium' | 'high';
  reviewPriority: 'high' | 'medium' | 'low';
  challengeLevelCap: 'low' | 'medium' | 'high';
  checkpointNeed: 'high' | 'medium' | 'low';
  shouldAvoidNewConcepts: boolean;
  shouldPreferConsolidation: boolean;
  shouldOfferBreak: boolean;
}

export interface LearnerReplanSignal {
  shouldSuggest: boolean;
  priority: 'none' | 'low' | 'medium' | 'high';
  recommendation: 'keep' | 'reinforce' | 'slow_down' | 'resequence' | 'accelerate';
  scope: 'none' | 'next_milestone' | 'downstream_path';
  rationale: string;
  reasonCodes: string[];
}

export interface LearnerTeachingHints {
  promptEnhancement: string;
  recommendedApproach: string;
  emphasize: string[];
  avoid: string[];
  riskFactors: string[];
}

export interface LearnerSnapshot {
  snapshotVersion: 'learner-snapshot-v1';
  scope: {
    userId: string;
    learningPathId?: string;
    milestoneId?: string;
    taskId?: string;
    mode: 'global' | 'path' | 'teaching';
  };
  freshness: {
    generatedAt: string;
    confidence: number;
    basedOn: {
      latestGoalConversationAt?: string;
      latestMetricAt?: string;
      latestTeachingSessionAt?: string;
      latestTaskCompletionAt?: string;
      latestPathUpdateAt?: string;
    };
  };
  profile: LearnerModelProfile;
  dynamicState: LearnerDynamicState;
  learningControlState: LearnerLearningControlState;
  replanSignal: LearnerReplanSignal;
  knowledgeMemory: LearnerKnowledgeMemory;
  teachingHints: LearnerTeachingHints;
}

export interface TeachingLearnerProjection {
  stableProfile: {
    thinkingStyle: string;
    preferredStyle: string;
    theoryVsPractice: string;
    sessionLength: string;
    confidenceLevel: string;
  };
  liveState: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
    recentTrend: string;
    recommendedPacing: string;
  };
  pathContext: {
    pathTitle: string;
    pathSummary?: string | null;
    currentMilestoneTitle: string;
    currentStageNumber: number;
    currentTaskOrder: number;
    totalTasksInMilestone: number;
    completedPrerequisiteTasks: string[];
  };
  relevantKnowledge: {
    mastered: string[];
    fragile: string[];
    struggling: string[];
  };
  backgroundKnowledge: {
    reusableFoundations: string[];
    blockedFoundations: string[];
    recentConceptLedger: LearnerBackgroundConceptLedgerItem[];
    recurringConfusions: LearnerRecurringConfusion[];
  };
  learningControlState: LearnerLearningControlState;
  teachingHints: {
    promptEnhancement: string;
    recommendedApproach: string;
    emphasize: string[];
    avoid: string[];
  };
}

export interface LearnerReplanProjection {
  path: {
    learningPathId: string;
    pathTitle: string;
    progress: {
      totalMilestones: number;
      completedMilestones: number;
      totalTasks: number;
      completedTasks: number;
    };
    currentPosition: {
      milestoneId: string;
      stageNumber: number;
      milestoneTitle: string;
      taskId?: string;
      taskTitle?: string;
    };
  };
  mastery: {
    stableTaskIds: string[];
    fragileTaskIds: string[];
    stableConcepts: string[];
    fragileConcepts: string[];
    strugglingConcepts: string[];
  };
  risk: {
    fatigueRisk: 'low' | 'medium' | 'high';
    recentTrend: 'improving' | 'stable' | 'declining';
    prerequisiteGaps: Array<{
      conceptKey: string;
      label: string;
      severity: 'low' | 'medium' | 'high';
    }>;
  };
  evidence: {
    recentEvidence: LearnerRecentEvidence[];
    milestoneStates: LearnerMilestoneProgress[];
    taskMastery: LearnerTaskMastery[];
  };
  signal: LearnerReplanSignal;
}

export interface LearnerPersonalizationConfig {
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
  dataType: 'cognitive' | 'behavioral' | 'learning' | 'preferences' | 'emotional' | 'interaction' | 'knowledge-background';
  data: Partial<
    CognitiveProfile & 
    BehavioralBaseline & 
    LearningState & 
    LearningPreferences & 
    EmotionalProfile &
    InteractionHistory
  > & {
    learnerBackground?: Partial<LearnerGlobalBackgroundKnowledge>;
  };
  confidence: number;
}

export interface ProfileAggregationResult {
  profile: LearnerModelProfile;
  changes: string[];
  confidence: number;
}
