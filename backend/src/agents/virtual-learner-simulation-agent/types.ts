/**
 * Virtual Learner Simulation Agent - 类型定义
 * 
 * 兼容标准 AgentInput/AgentOutput 协议
 */

import type { AgentInput, AgentOutput, AgentContext } from '../protocol';

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
  knowledgeLevel: 'beginner' | 'intermediate' | 'advanced';
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

export interface ReactionContext {
  reactionTarget: 'path_proposal' | 'task_content' | 'quiz_result';
  targetData: any;
  profile: VirtualLearnerProfile;
  previousInteractions?: ConversationHistoryItem[];
  learnerState?: LearnerLatentState;
  knowledgeState?: KnowledgePointState[];
}

// AgentInput 扩展：通过 metadata 传递模拟相关数据
export interface SimulationAgentInput extends AgentInput {
  // 自定义操作类型
  simulationType?: 'generate_profile' | 'simulate_goal_reply' | 'simulate_learning_reply' | 'simulate_reaction' | 'simulate_reply';
  // 画像生成输入
  generateProfileInput?: {
    learningGoal: string;
    knowledgeLevel: 'beginner' | 'intermediate' | 'advanced';
    simulationMode?: 'manual' | 'ai';
    personalityTraits?: PersonalityTraits;
    existingProfile?: VirtualLearnerProfileData;
  };
  // 模拟对话上下文
  simulationContext?: SimulationContext;
}

// AgentOutput 扩展
export interface SimulationAgentOutput extends AgentOutput {
  // 模拟回复
  userReply?: string;
  // 生成的画像（增强版）
  generatedProfile?: {
    age: number;
    occupation: string;
    education: string;
    background: string;
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
    personalityTraits?: PersonalityTraits;
  };
  learnerState?: LearnerLatentState;
  // 模拟反应输出
  reactionOutput?: {
    reaction: string;
    decision: 'accept' | 'modify' | 'reject';
    modifyRequest?: string;
    confidence: number;
    reasons?: {
      goalAlignment?: number;
      difficultyFit?: number;
      timeFit?: number;
      prerequisiteFit?: number;
      motivationFit?: number;
    };
    biggestConcern?: string;
  };
}

export interface SimulationLogEntry {
  timestamp: string;
  phase: 'virtual-reply' | 'goal-response' | 'stage-transition' | 'learning-reply' | 'learning-response' | 'learning-start' | 'error';
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
