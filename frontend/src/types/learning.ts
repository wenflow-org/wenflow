/**
 * 学生学习状态类型定义
 */

/**
 * 学生当前学习状态
 */
export interface StudentState {
  /** 认知深度 (0-1) */
  cognitive: number
  /** 压力程度 (0-1) */
  stress: number
  /** 投入程度 (0-1) */
  engagement: number
  /** 是否检测到异常状态 */
  anomaly: boolean
  /** 异常原因描述 */
  anomalyReason?: string
  /** 干预建议 */
  intervention?: string
  /** 评估时间 */
  assessedAt: Date
}

/**
 * 基线指标数据
 */
export interface BaselineMetric {
  /** 当前值 */
  current: number
  /** 指数移动平均值 */
  ema: number
  /** 指数移动方差 */
  emVar: number
  /** Z-Score 标准分数 */
  zScore: number
}

/**
 * 个人基线对比数据
 */
export interface BaselineData {
  /** 响应时间指标 */
  responseTime: BaselineMetric
  /** 消息长度指标 */
  messageLength: BaselineMetric
  /** 互动间隔指标 */
  interactionInterval: BaselineMetric
}

/**
 * 学习会话状态响应数据
 */
export interface LearningSessionResponse {
  /** 会话 ID */
  sessionId: string
  /** 当前学习状态 */
  state: StudentState
  /** 个人基线数据 */
  baseline: BaselineData
  /** 消息历史 */
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
  }>
}

/**
 * ContentAgent v3.0 对话式学习类型定义
 */

/**
 * UI 类型枚举
 */
export type QuestionUiType = 'choice' | 'input' | 'code' | 'reflection'

/**
 * 问题内容定义
 */
export interface QuestionContent {
  /** UI 类型 */
  uiType: QuestionUiType
  /** 问题文本 */
  question: string
  /** 选项（选择题用） */
  options?: string[]
  /** 输入提示（输入题/反思题用） */
  inputHint?: string
  /** 代码语言（代码题用） */
  codeLanguage?: string
  /** 参考答案（选择题用，后端知道正确答案） */
  correctAnswer?: string
}

/**
 * 对话消息
 */
export interface DialogueMessage {
  /** 角色 */
  role: 'user' | 'assistant'
  /** 内容 */
  content: string
  /** 时间戳 */
  timestamp: string
  /** 元数据（可选） */
  metadata?: {
    questionType?: QuestionUiType
    responseTime?: number
    wordCount?: number
  }
}

/**
 * ContentAgent 输出内容
 */
export interface ContentAgentOutput {
  /** 成功标志 */
  success: boolean
  /** 当前内容 */
  content: {
    /** UI 类型 */
    uiType: QuestionUiType
    /** 问题 */
    question: string
    /** 选项（选择题） */
    options?: string[]
    /** 输入提示 */
    inputHint?: string
    /** 代码语言 */
    codeLanguage?: string
    /** 提示 */
    hint?: string
    /** 反馈（AI 反馈） */
    feedback?: string
  }
  /** 对话是否完成 */
  dialogueComplete?: boolean
  /** 元数据 */
  metadata?: {
    roundNumber: number
    totalRounds?: number
    studentState?: StudentState
  }
}

/**
 * 对话式学习会话响应
 */
export interface DialogueLearningSession {
  /** 会话 ID */
  sessionId: string
  /** 任务标题 */
  taskTitle: string
  /** 任务 ID */
  taskId: string
  /** 初始内容（第一轮对话） */
  initialContent: ContentAgentOutput['content']
  /** 对话历史 */
  conversationHistory: DialogueMessage[]
  /** 学生状态 */
  studentState: StudentState
}

/**
 * 提交回答响应
 */
export interface SubmitResponseResult {
  /** 学生回答后的 AI 反馈 */
  feedback: string
  /** 下一轮对话内容 */
  nextContent: ContentAgentOutput['content'] | null
  /** 更新后的学生状态 */
  studentState: StudentState
  /** 对话是否完成 */
  dialogueComplete: boolean
  /** 对话历史 */
  conversationHistory: DialogueMessage[]
}
