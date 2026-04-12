// 状态评估系统类型定义

/**
 * 对话消息
 */
export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string  // ISO 字符串格式（JSON 序列化）
}

/**
 * 学生状态评估结果
 */
export interface StudentState {
  /**
   * 认知深度 (0-1)
   * - 0.0-0.3：直接要答案、无思考
   * - 0.4-0.6：有初步想法，但无论证
   * - 0.7-1.0：原创观点、逻辑推演、自我纠错
   */
  cognitive: number
  
  /**
   * 压力程度 (0-1)
   * - 0.0-0.3：放松、自信
   * - 0.4-0.6：有点困惑
   * - 0.7-1.0：焦虑、挫败、情绪化
   */
  stress: number
  
  /**
   * 投入程度 (0-1)
   * - 0.0-0.3：敷衍、回复简短
   * - 0.4-0.6：正常参与
   * - 0.7-1.0：主动提问、深入追问
   */
  engagement: number
  
  /**
   * 是否异常
   */
  anomaly: boolean
  
  /**
   * 异常原因
   */
  anomalyReason?: string
  
  /**
   * 干预建议
   */
  intervention?: string
  
  /**
   * 评估时间
   */
  assessedAt: Date
}

/**
 * 认知深度评估结果
 */
export interface CognitiveDepthResult {
  /**
   * 深度分数 (0-1)
   */
  depth: number
  
  /**
   * AI 推理过程
   */
  reasoning: string
}

/**
 * 压力程度评估结果
 */
export interface StressLevelResult {
  /**
   * 压力分数 (0-1)
   */
  stress: number
  
  /**
   * AI 推理过程
   */
  reasoning: string
}

/**
 * 投入程度评估结果
 */
export interface EngagementResult {
  /**
   * 投入分数 (0-1)
   */
  engagement: number
  
  /**
   * AI 推理过程
   */
  reasoning: string
}

/**
 * Z-Score 指标
 */
export interface ZScores {
  /**
   * 响应时间 Z-Score
   */
  responseTime: number
  
  /**
   * 消息长度 Z-Score
   */
  messageLength: number
  
  /**
   * 交互间隔 Z-Score
   */
  interactionInterval: number
}

/**
 * AI 评估原始结果
 */
export interface AIAssessment {
  /**
   * 认知深度
   */
  cognitiveDepth: number
  
  /**
   * 压力程度
   */
  stressLevel: number
  
  /**
   * 投入程度
   */
  engagement: number
}

/**
 * 融合评估结果
 */
export interface IntegratedAssessmentResult {
  /**
   * 融合后的认知深度 (0-1)
   */
  cognitive: number
  
  /**
   * 融合后的压力程度 (0-1)
   */
  stress: number
  
  /**
   * 融合后的投入程度 (0-1)
   */
  engagement: number
  
  /**
   * 是否异常
   */
  anomaly: boolean
  
  /**
   * 异常原因
   */
  anomalyReason?: string
  
  /**
   * 干预建议
   */
  intervention?: string
}
