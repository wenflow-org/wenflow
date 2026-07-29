// 状态评估服务
// AI 评估 + EMA 融合判断学生状态

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { executeSkill, auxSkillDefinitionMap } from '../../skills';
import { StudentState, Message, ZScores, AIAssessment, IntegratedAssessmentResult } from '../../types/state';
import { BaselineMetrics } from './student-baseline.service';
import { ExtractedMetrics } from '../../utils/metrics-extractor';

export interface StateAssessmentOptions {
  /**
   * 是否使用 AI 评估（默认 true）
   */
  useAI: boolean
  
  /**
   * 是否使用 EMA 融合（默认 true）
   */
  useEMA: boolean
  
  /**
   * AI 评估权重（0-1，默认 0.6）
   */
  aiWeight: number
}

const DEFAULT_OPTIONS: StateAssessmentOptions = {
  useAI: true,
  useEMA: true,
  aiWeight: 0.6
}

class StateAssessmentService {
  /**
   * AI 评估认知深度
   * 分析对话历史，评估学生的认知深度
   */
  async assessCognitiveDepth(messages: Message[]): Promise<{
    depth: number
    reasoning: string
  }> {
    try {
      const result = await executeSkill(auxSkillDefinitionMap['state-assessment'], {
        action: 'assessCognitiveDepth',
        conversationSummary: messages
          .slice(-10)
          .map(m => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content.substring(0, 200)}`)
          .join('\n'),
        __fallback: this.heuristicCognitiveDepth(messages),
        __prompt: {
          requestPath: '/services/learning/state-assessment/assess-cognitive-depth',
          callerAction: 'assessCognitiveDepth',
        },
      }) || {}

      return {
        depth: Math.min(1, Math.max(0, result.depth ?? 0.5)),
        reasoning: result.reasoning || ''
      }
    } catch (error) {
      logger.error('AI 认知深度评估失败:', error)
      // 降级：使用启发式方法
      return this.heuristicCognitiveDepth(messages)
    }
  }
  
  /**
   * AI 评估压力程度
   */
  async assessStressLevel(messages: Message[]): Promise<{
    stress: number
    reasoning: string
  }> {
    try {
      const result = await executeSkill(auxSkillDefinitionMap['state-assessment'], {
        action: 'assessStressLevel',
        conversationSummary: messages
          .slice(-10)
          .map(m => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content.substring(0, 200)}`)
          .join('\n'),
        __fallback: this.heuristicStressLevel(messages),
        __prompt: {
          requestPath: '/services/learning/state-assessment/assess-stress-level',
          callerAction: 'assessStressLevel',
        },
      }) || {}

      return {
        stress: Math.min(1, Math.max(0, result.stress ?? 0.5)),
        reasoning: result.reasoning || ''
      }
    } catch (error) {
      logger.error('AI 压力评估失败:', error)
      // 降级：使用启发式方法
      return this.heuristicStressLevel(messages)
    }
  }
  
  /**
   * AI 评估投入程度
   */
  async assessEngagement(messages: Message[]): Promise<{
    engagement: number
    reasoning: string
  }> {
    try {
      const result = await executeSkill(auxSkillDefinitionMap['state-assessment'], {
        action: 'assessEngagement',
        conversationSummary: messages
          .slice(-10)
          .map(m => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content.substring(0, 200)}`)
          .join('\n'),
        __fallback: this.heuristicEngagement(messages),
        __prompt: {
          requestPath: '/services/learning/state-assessment/assess-engagement',
          callerAction: 'assessEngagement',
        },
      }) || {}

      return {
        engagement: Math.min(1, Math.max(0, result.engagement ?? 0.5)),
        reasoning: result.reasoning || ''
      }
    } catch (error) {
      logger.error('AI 投入度评估失败:', error)
      // 降级：使用启发式方法
      return this.heuristicEngagement(messages)
    }
  }
  
  /**
   * 启发式认知深度评估（AI 失败时的降级方案）
   */
  private heuristicCognitiveDepth(messages: Message[]): {
    depth: number
    reasoning: string
  } {
    const userMessages = messages.filter(m => m.role === 'user')
    
    if (userMessages.length === 0) {
      return { depth: 0, reasoning: '无用户消息' }
    }
    
    let depth = 0.5 // 基础分
    
    // 规则 1：消息长度
    const avgLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length
    if (avgLength > 100) depth += 0.1
    if (avgLength > 300) depth += 0.1
    
    // 规则 2：是否包含问题
    const hasQuestions = userMessages.some(m => m.content.includes('?') || m.content.includes('?'))
    if (hasQuestions) depth += 0.1
    
    // 规则 3：是否包含思考词汇
    const thinkingWords = ['我觉得', '我认为', '可能', '也许', '因为', '所以', '如果', '那么']
    const hasThinking = userMessages.some(m => 
      thinkingWords.some(word => m.content.includes(word))
    )
    if (hasThinking) depth += 0.1
    
    // 规则 4：是否有自我纠错
    const selfCorrection = userMessages.some(m => 
      m.content.includes('不对') || m.content.includes('错了') || m.content.includes('重新')
    )
    if (selfCorrection) depth += 0.1
    
    return {
      depth: Math.min(1, depth),
      reasoning: `基于 ${userMessages.length} 条消息的启发式评估`
    }
  }
  
  /**
   * 启发式压力评估
   */
  private heuristicStressLevel(messages: Message[]): {
    stress: number
    reasoning: string
  } {
    const userMessages = messages.filter(m => m.role === 'user')
    
    if (userMessages.length === 0) {
      return { stress: 0.5, reasoning: '无用户消息' }
    }
    
    let stress = 0.3 // 基础分（偏低）
    
    // 规则 1：负面情绪词汇
    const negativeWords = ['不会', '不懂', '太难', '好烦', '放弃', '完了', '糟糕']
    const negativeCount = userMessages.filter(m => 
      negativeWords.some(word => m.content.includes(word))
    ).length
    
    stress += negativeCount * 0.1
    
    // 规则 2：消息长度骤减
    if (userMessages.length >= 3) {
      const recent = userMessages.slice(-2)
      const avgRecent = recent.reduce((sum, m) => sum + m.content.length, 0) / recent.length
      const avgBefore = userMessages.slice(0, -2).reduce((sum, m) => sum + m.content.length, 0) / (userMessages.length - 2)
      
      if (avgRecent < avgBefore * 0.5) {
        stress += 0.2 // 突然变简短，可能沮丧
      }
    }
    
    // 规则 3：标点符号
    const hasExclamation = userMessages.some(m => m.content.includes('!') || m.content.includes('!'))
    if (hasExclamation) stress += 0.1
    
    return {
      stress: Math.min(1, stress),
      reasoning: `基于 ${userMessages.length} 条消息的启发式评估`
    }
  }
  
  /**
   * 启发式投入度评估
   */
  private heuristicEngagement(messages: Message[]): {
    engagement: number
    reasoning: string
  } {
    const userMessages = messages.filter(m => m.role === 'user')
    
    if (userMessages.length === 0) {
      return { engagement: 0, reasoning: '无用户消息' }
    }
    
    let engagement = 0.5 // 基础分
    
    // 规则 1：消息数量
    if (userMessages.length >= 5) engagement += 0.1
    if (userMessages.length >= 10) engagement += 0.1
    
    // 规则 2：平均长度
    const avgLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length
    if (avgLength > 50) engagement += 0.1
    if (avgLength > 150) engagement += 0.1
    
    // 规则 3：主动提问
    const questionCount = userMessages.filter(m => 
      m.content.includes('?') || m.content.includes('?')
    ).length
    
    if (questionCount >= 2) engagement += 0.1
    if (questionCount >= 5) engagement += 0.1
    
    return {
      engagement: Math.min(1, engagement),
      reasoning: `基于 ${userMessages.length} 条消息的启发式评估`
    }
  }
  
  /**
   * AI+EMA 融合判断
   * 结合 AI 评估和统计指标（Z-Score）进行综合判断
   */
  async integrateAIandEMA(
    aiAssessment: AIAssessment,
    zScores: ZScores,
    baseline: BaselineMetrics,
    options: StateAssessmentOptions = DEFAULT_OPTIONS
  ): Promise<IntegratedAssessmentResult> {
    const { aiWeight } = options
    
    // 1. 将 Z-Score 转换为 0-1 分数
    // Z-Score 通常在 -3 到 +3 之间，使用 sigmoid 函数转换
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
    
    const emaCognitive = 1 - sigmoid(zScores.responseTime) // 响应越快，认知可能越深
    const emaStress = sigmoid(zScores.messageLength) // 消息越短，压力可能越大（简化）
    const emaEngagement = 1 - sigmoid(zScores.interactionInterval) // 间隔越短，越投入
    
    // 2. 融合 AI 和 EMA 评分
    const cognitive = aiWeight * aiAssessment.cognitiveDepth + (1 - aiWeight) * emaCognitive
    const stress = aiWeight * aiAssessment.stressLevel + (1 - aiWeight) * emaStress
    const engagement = aiWeight * aiAssessment.engagement + (1 - aiWeight) * emaEngagement
    
    // 3. 异常检测
    const anomaly = this.detectAnomaly(zScores)
    
    // 4. 生成干预建议
    const intervention = this.generateIntervention(cognitive, stress, engagement, anomaly, zScores)
    
    return {
      cognitive: Math.min(1, Math.max(0, cognitive)),
      stress: Math.min(1, Math.max(0, stress)),
      engagement: Math.min(1, Math.max(0, engagement)),
      anomaly,
      anomalyReason: anomaly ? this.getAnomalyReason(zScores) : undefined,
      intervention
    }
  }
  
  /**
   * 异常检测
   */
  private detectAnomaly(zScores: ZScores): boolean {
    // 如果任何 Z-Score 绝对值超过 2.5，认为是异常
    return (
      Math.abs(zScores.responseTime) > 2.5 ||
      Math.abs(zScores.messageLength) > 2.5 ||
      Math.abs(zScores.interactionInterval) > 2.5
    )
  }
  
  /**
   * 获取异常原因
   */
  private getAnomalyReason(zScores: ZScores): string {
    const reasons: string[] = []
    
    if (Math.abs(zScores.responseTime) > 2.5) {
      reasons.push(`响应时间异常 (Z=${zScores.responseTime.toFixed(2)})`)
    }
    
    if (Math.abs(zScores.messageLength) > 2.5) {
      reasons.push(`消息长度异常 (Z=${zScores.messageLength.toFixed(2)})`)
    }
    
    if (Math.abs(zScores.interactionInterval) > 2.5) {
      reasons.push(`交互间隔异常 (Z=${zScores.interactionInterval.toFixed(2)})`)
    }
    
    return reasons.join('; ')
  }
  
  /**
   * 生成干预建议
   */
  private generateIntervention(
    cognitive: number,
    stress: number,
    engagement: number,
    anomaly: boolean,
    zScores: ZScores
  ): string | undefined {
    const suggestions: string[] = []
    
    // 高压力
    if (stress > 0.7) {
      suggestions.push('检测到较高压力，建议放慢节奏，分解任务')
    }
    
    // 低投入
    if (engagement < 0.3) {
      suggestions.push('投入度较低，建议调整学习方式或休息')
    }
    
    // 低认知深度
    if (cognitive < 0.3) {
      suggestions.push('尝试提出更深入的问题，或主动思考总结')
    }
    
    // 异常状态
    if (anomaly) {
      suggestions.push('检测到学习模式异常，建议暂停并反思当前状态')
    }
    
    return suggestions.length > 0 ? suggestions.join('.') + '。' : undefined
  }
  
  /**
   * 完整评估学生状态
   */
  async assessStudentState(
    messages: Message[],
    zScores: ZScores,
    baseline: BaselineMetrics,
    options: StateAssessmentOptions = DEFAULT_OPTIONS
  ): Promise<StudentState> {
    try {
      // 1. AI 评估
      const [cognitiveResult, stressResult, engagementResult] = await Promise.all([
        options.useAI ? this.assessCognitiveDepth(messages) : this.heuristicCognitiveDepth(messages),
        options.useAI ? this.assessStressLevel(messages) : this.heuristicStressLevel(messages),
        options.useAI ? this.assessEngagement(messages) : this.heuristicEngagement(messages)
      ])
      
      const aiAssessment: AIAssessment = {
        cognitiveDepth: cognitiveResult.depth,
        stressLevel: stressResult.stress,
        engagement: engagementResult.engagement
      }
      
      // 2. AI+EMA 融合
      const integrated = await this.integrateAIandEMA(
        aiAssessment,
        zScores,
        baseline,
        options
      )
      
      // 3. 构建状态对象
      const state: StudentState = {
        cognitive: integrated.cognitive,
        stress: integrated.stress,
        engagement: integrated.engagement,
        anomaly: integrated.anomaly,
        anomalyReason: integrated.anomalyReason,
        intervention: integrated.intervention,
        assessedAt: new Date()
      }
      
      logger.info('学生状态评估完成', {
        cognitive: state.cognitive,
        stress: state.stress,
        engagement: state.engagement,
        anomaly: state.anomaly
      })
      
      return state
    } catch (error) {
      logger.error('学生状态评估失败:', error)
      throw error
    }
  }
  
  /**
   * 保存状态到数据库
   */
  async saveState(
    conversationId: string,
    state: StudentState,
    messageId?: string,
    emaMetrics?: ExtractedMetrics,
    zScores?: ZScores,
    aiAssessment?: AIAssessment
  ): Promise<void> {
    // TODO: studentState 表尚未定义，暂时只记录日志
    // 需要在 schema.prisma 中添加 studentState 模型后启用
    logger.debug('学生状态评估结果（暂未持久化）', {
      conversationId,
      messageId,
      cognitive: state.cognitive,
      stress: state.stress,
      engagement: state.engagement,
      anomaly: state.anomaly
    })
  }
}

export default new StateAssessmentService()