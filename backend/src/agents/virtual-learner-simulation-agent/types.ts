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

export interface SimulationContext {
  profile: VirtualLearnerProfile;
  conversationHistory: ConversationHistoryItem[];
  currentStage: 'goal' | 'path' | 'learning';
  lastAssistantMessage?: string;
  goalState?: {
    stage?: string;
    collectedData?: any;
    understanding?: any;
    confidence?: number;
  };
  learningState?: {
    currentTask?: any;
    currentContent?: any;
  };
}

export interface ReactionContext {
  reactionTarget: 'path_proposal' | 'task_content' | 'quiz_result';
  targetData: any;
  profile: VirtualLearnerProfile;
  previousInteractions?: ConversationHistoryItem[];
}

// AgentInput 扩展：通过 metadata 传递模拟相关数据
export interface SimulationAgentInput extends AgentInput {
  // 自定义操作类型
  simulationType?: 'generate_profile' | 'simulate_reply' | 'simulate_reaction';
  // 画像生成输入
  generateProfileInput?: {
    learningGoal: string;
    knowledgeLevel: 'beginner' | 'intermediate' | 'advanced';
    simulationMode?: 'manual' | 'ai';
    personalityTraits?: PersonalityTraits;
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
    personalityTraits?: PersonalityTraits;
  };
  // 模拟反应输出
  reactionOutput?: {
    reaction: string;
    decision: 'accept' | 'modify' | 'reject';
    modifyRequest?: string;
    confidence: number;
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