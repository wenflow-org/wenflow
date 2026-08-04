export interface VirtualLearnerProfileData {
  age?: number;
  occupation?: string;
  education?: string;
  background?: string;
  learningStyle?: 'visual' | 'auditory' | 'reading' | 'kinesthetic';
  motivationType?: 'career' | 'interest' | 'necessity' | 'social';
  availableTime?: 'minimal' | 'moderate' | 'abundant';
  techComfort?: 'low' | 'medium' | 'high';
  priorAttempts?: string;
  corePersonality?: string;
  personalityDrivers?: string[];
  communicationStyle?: string;
  motivationOrientation?: string;
  emotionalBaseline?: string;
  emotionalTriggers?: string[];
  resiliencePattern?: string;
  metacognitiveProfile?: string;
  cognitiveLoadTolerance?: string;
  selfRegulationStyle?: string;
  digitalLiteracy?: string;
  helpSeekingPattern?: string;
  adversarialPattern?: string;
  memoryRepairPattern?: string;
  behaviorBoundaries?: string[];
  learningPreferences?: string[];
  failurePatterns?: string[];
  behavioralProfileSummary?: string;
}

export interface PersonalityTraits {
  verbosity?: 'terse' | 'normal' | 'verbose';
  enthusiasm?: 'low' | 'normal' | 'high';
  confusionStyle?: 'direct' | 'hinting';
  patience?: 'low' | 'normal' | 'high';
  questionStyle?: 'none' | 'clarifying' | 'challenging';
  emotionalRange?: 'flat' | 'moderate' | 'expressive';
}

export interface VirtualLearnerProfile {
  id: string;
  userId: string;
  profile: VirtualLearnerProfileData;
  learningGoal: string;
  knowledgeLevel?: 'beginner' | 'intermediate' | 'advanced';
  knownConcepts?: string[];
  struggleConcepts?: string[];
  personalityTraits?: PersonalityTraits;
  simulationPrompt?: string;
  simulationModel?: string;
  simulationTemperature?: number;
}

export interface ConversationHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface KnowledgePointState {
  key: string;
  mastery?: number;
  confidence?: number;
  memoryStrength?: number;
  selfPerceivedMastery?: number;
  lastActive?: string;
  errorPatterns?: string[];
  transferScore?: number;
}

export interface LearnerLatentState {
  understandingLevel?: number;
  perceivedDifficulty?: number;
  confusionLevel?: number;
  frustrationLevel?: number;
  motivationLevel?: number;
  goalReadiness?: number;
  selfPerceivedMastery?: number;
  actualMastery?: number;
  memoryStrength?: number;
  wantsClarification?: boolean;
  readyToAdvance?: boolean;
  attentionLevel?: number;
  persistenceLevel?: number;
  emotion?: 'neutral' | 'slightly_frustrated' | 'happy' | 'confident' | 'confused';
  remainingUnknowns?: string[];
  detectedMisconceptions?: string[];
  stableErrorStyle?: string[];
  taskUnderstanding?: number;
  conceptualMastery?: number;
  proceduralMastery?: number;
  transferConfidence?: number;
  misconceptionRisk?: number;
  helpSeekingReadiness?: number;
  cognitiveLoad?: number;
  wantsHint?: boolean;
  wantsWorkedExample?: boolean;
  readyForNextTask?: boolean;
  remainingBlockers?: string[];
  phaseFocus?: 'opening' | 'understanding' | 'proposal_evaluation' | 'trying' | 'blocked' | 'verifying' | 'ready_to_close' | string;
  feltUnderstood?: number;
  problemClarity?: number;
  proposalFit?: number;
  taskRelevance?: number;
  executionConcern?: number;
  willingToTry?: boolean;
  readyToProceed?: boolean;
}

export interface GoalConcernPool {
  primary: string[];
  secondary: string[];
  hidden: string[];
}

export interface SimulationContext {
  profile: VirtualLearnerProfile;
  conversationHistory: ConversationHistoryItem[];
  currentStage: 'goal' | 'path' | 'learning';
  lastAssistantMessage?: string;
  storyContext?: {
    storyId?: string | null;
    title?: string;
    sourceType?: string | null;
    outline?: string;
    triggerEvent?: string;
    visibleOpening?: string;
    hiddenDetails?: string[];
    misdiagnosis?: string;
    pressurePoints?: string[];
    behaviorHooks?: string[];
    problemKnowledge?: {
      domainFamiliarity?: 'low' | 'medium' | 'high';
      knownConcepts?: string[];
      struggleConcepts?: string[];
      selfAssessment?: string;
      hiddenGaps?: string[];
    };
    goalSeed?: any;
    disclosurePlan?: any;
  } | null;
  learnerState?: LearnerLatentState;
  knowledgeState?: KnowledgePointState[];
  goalState?: {
    stage?: string;
    collectedData?: any;
    understanding?: any;
    confidence?: number;
    missingFields?: string[];
    concernPool?: GoalConcernPool;
    disclosedConcerns?: string[];
  };
  learningState?: {
    currentMilestone?: string;
    currentTask?: any;
    currentContent?: any;
    milestoneProgress?: number;
    totalMilestones?: number;
  };
}

export interface SimulationLogEntry {
  timestamp: string;
  phase: 'virtual-reply' | 'goal-response' | 'stage-transition' | 'path-review' | 'path-replan' | 'learning-reply' | 'learning-response' | 'learning-start' | 'error';
  durationMs?: number;
  details: {
    input?: any;
    output?: any;
    error?: string;
  };
}

export interface SimulationStepResult {
  success: boolean;
  virtualUserReply: string;
  goalConversationResponse?: {
    userVisible: string;
    stage: string;
    confidence: number;
    quickReplies?: string[];
  };
  currentStage: 'goal' | 'path' | 'learning';
  goalReady: boolean;
  logs: SimulationLogEntry[];
  error?: string;
}
