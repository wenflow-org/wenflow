/**
 * Agent 协议定义 - EduClaw Gateway
 * 
 * Agent 是智能体，负责业务逻辑和决策
 * 所有 Agent 必须遵循此协议
 */

// Agent 类型
export type AgentType = 'path' | 'content' | 'tutor' | 'progress' | 'profile' | 'custom' | 'teaching' | 'evaluation';

// Agent 分类
export type AgentCategory = 'standard' | 'custom';

// Agent 输入 Schema
export interface AgentInput {
  // 需求类型
  type: 'standard' | 'custom';
  
  // 学习目标
  goal: string;
  
  // 非标准化场景描述（可选）
  scenario?: string;
  
  // 标准化课程名称或 URL（可选）
  curriculum?: string;
  
  // 当前水平（可选）
  currentLevel?: 'beginner' | 'intermediate' | 'advanced';
  
  // 预期周数（可选）
  duration?: number;
  
  // 每日学习时间（可选）
  timePerDay?: string;
  
  // 元数据
  metadata?: {
    userId?: string;
    sessionId?: string;
    [key: string]: any;
  };
  
  // 新增：完整数据包（用于路径生成）
  structuredData?: any;
  confirmedProposal?: any;
  confidenceScores?: any;
  conversationHistory?: any[];
}

// Agent 输出 Schema
export interface AgentOutput {
  // 执行状态
  success: boolean;
  
  // 错误信息（可选）
  error?: string;
  
  // 学习路径输出（path-agent）
  path?: {
    id?: string;
    name: string;
    subject: string;
    totalMilestones: number;
    estimatedHours?: number;
    milestones: MilestoneOutput[];
  };
  
  // 内容输出（content-agent）
  content?: {
    taskId?: string;
    explanation: string;
    exercises?: Exercise[];
    resources?: Resource[];
  };
  
  // 辅导输出（tutor-agent）
  tutoring?: {
    response: string;
    hints?: string[];
    relatedTopics?: string[];
    suggestedActions?: string[];
  };
  
  // 进度输出（progress-agent）
  progress?: {
    signal: LearningSignal;
    metrics: ProgressMetrics;
    recommendations: string[];
  };
  
  // 元数据
  metadata: {
    agentId: string;
    agentName: string;
    agentType: AgentType;
    confidence: number; // 0-1
    generatedAt: string; // ISO 8601
  };
}

// 里程碑输出
export interface MilestoneOutput {
  stageNumber: number;
  title: string;
  description?: string;
  goal?: string;
  estimatedHours?: number;
  subtasks?: SubtaskOutput[];
}

// 子任务输出（新概念）
export interface SubtaskOutput {
  id?: string;
  title: string;
  type: 'reading' | 'practice' | 'project' | 'quiz';
  estimatedMinutes: number;
  description?: string;
  acceptanceCriteria?: string;
  status?: 'todo' | 'in_progress' | 'completed';
}

// 学习内容输出
export interface LearningContentOutput {
  id?: string;
  contentType: 'lesson' | 'exercise' | 'resource' | 'quiz';
  content: string;
  summary?: string;
  keyPoints?: string[];
  resources?: Resource[];
}

// 任务输出
export interface TaskOutput {
  id?: string;
  title: string;
  type: 'reading' | 'practice' | 'project' | 'quiz';
  estimatedMinutes: number;
  description?: string;
  resources?: Resource[];
}

// 练习
export interface Exercise {
  question: string;
  type: 'multiple-choice' | 'coding' | 'short-answer' | 'essay';
  options?: string[];
  hint?: string;
  answer?: string;
}

// 资源
export interface Resource {
  title: string;
  type: 'article' | 'video' | 'book' | 'documentation' | 'exercise';
  url?: string;
  description?: string;
}

// 学习信号
export type LearningSignalType = 
  | 'accelerating'    // 学习加速
  | 'decelerating'    // 学习减速
  | 'lane-change'     // 变道（改变重点）
  | 'fatigue-high'    // 疲劳度高
  | 'frustration'     // 挫败感
  | 'mastery'         // 掌握
  | 'struggling';     // 挣扎

export interface LearningSignal {
  type: LearningSignalType;
  intensity: number; // 0-1
  context?: string;
  timestamp: string;
}

// 进度指标
export interface ProgressMetrics {
  completionRate: number;
  averageScore?: number;
  timeSpent: number;
  ktl?: number; // Knowledge Training Load
  lf?: number;  // Learning Fatigue
  lss?: number; // Learning Stress Score
  ski?: number; // Surface Knowledge Interaction (表层参与度)
  mki?: number; // Medium Knowledge Interaction (中层参与度)
  dki?: number; // Deep Knowledge Interaction (深层参与度)
  reasoning?: string;    // AI 解释
  suggestion?: string;   // AI 建议
}

// Agent 定义
export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  type: AgentType;
  category: AgentCategory;
  description: string;
  
  // 能力描述
  capabilities: string[];
  
  // 订阅的事件类型
  subscribes: string[];
  
  // 发布的事件类型
  publishes: string[];
  
  // 输入 Schema
  inputSchema: Record<string, any>;
  
  // 输出 Schema
  outputSchema: Record<string, any>;
  
  // 端点（如果是远程 Agent）
  endpoint?: string;
  
  // 统计数据
  stats: {
    callCount: number;
    successRate: number;
    avgLatency: number;
  };
}

// Agent 执行上下文
export interface AgentContext {
  userId: string;
  sessionId?: string;
  conversationHistory?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  userProfile?: {
    level: number;
    xp: number;
    skillLevel?: string;
    learningStyle?: string;
  };
  currentState?: {
    activePathId?: string;
    activeTaskId?: string;
    progress?: ProgressMetrics;
  };
  metadata?: {
    [key: string]: any;
  };
}

// Agent 执行请求
export interface AgentExecutionRequest {
  agentId: string;
  input: AgentInput;
  context: AgentContext;
  options?: {
    timeout?: number;
    maxRetries?: number;
    priority?: 'high' | 'normal' | 'low';
  };
}

// Agent 执行结果
export interface AgentExecutionResult {
  success: boolean;
  output?: AgentOutput;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  duration: number; // ms
  tokensUsed?: number;
}

// ==================== Agent 协作扩展 ====================

// 课程完成数据
export interface LessonCompletedData {
  sessionId: string;
  lessonId: string;
  duration: number;
  performance: {
    engagement: number;
    understanding: number;
    questionsAsked: number;
    correctAnswers: number;
    frustrationLevel: number;
  };
  topics: string[];
  nextSuggested?: string;
}

// 信号检测结果
export interface SignalDetectionResult {
  signal: LearningSignal;
  shouldAdjustPath: boolean;
  shouldAdjustContent: boolean;
  adjustmentUrgency: 'low' | 'medium' | 'high';
  recommendedActions: string[];
}

// 路径调整请求
export interface PathAdjustmentRequest {
  pathId: string;
  reason: LearningSignalType;
  intensity: number;
  context: {
    currentWeek: number;
    currentTask?: string;
    recentPerformance: ProgressMetrics;
  };
  requestedBy: string;
}

// 内容调整请求
export interface ContentAdjustmentRequest {
  taskId: string;
  adjustment: 'easier' | 'harder' | 'different-style';
  reason: string;
  userProfile?: {
    preferredStyle: string;
    currentLevel: string;
  };
}

// 个性化请求
export interface PersonalizationRequest {
  userId: string;
  context: 'path-generation' | 'content-generation' | 'tutoring' | 'assessment';
  targetAgent: string;
}

// 个性化响应
export interface PersonalizationResponse {
  contentStyle: {
    useAnalogies: boolean;
    detailLevel: 'concise' | 'moderate' | 'detailed';
    exampleFrequency: 'minimal' | 'moderate' | 'frequent';
  };
  pacing: {
    difficulty: 'easy' | 'medium' | 'hard';
    progression: 'slow' | 'moderate' | 'fast';
  };
  interaction: {
    hintTiming: 'immediate' | 'delayed' | 'on-request';
    encouragement: 'low' | 'medium' | 'high';
  };
  promptEnhancement: string;
}

// Agent 协作消息
export interface AgentCollaborationMessage {
  from: string;
  to: string;
  type: 'request' | 'notify' | 'response';
  payload: any;
  correlationId?: string;
  timestamp: string;
}

// Agent 协作接口
export interface AgentCollaborator {
  agentId: string;
  
  onProfileUpdate(profile: any): Promise<void>;
  
  onSignalDetected(signal: LearningSignal, context: AgentContext): Promise<void>;
  
  onPathAdjusted(pathId: string, adjustments: any[]): Promise<void>;
  
  onContentAdjusted(taskId: string, adjustment: string): Promise<void>;
  
  onRequestPersonalization(request: PersonalizationRequest): Promise<PersonalizationResponse>;
}
