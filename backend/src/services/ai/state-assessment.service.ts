/**
 * AI 状态评估服务
 * 
 * 基于对话历史，AI 直接判断学生状态：
 * - 认知深度 (cognitiveDepth): 0-1
 * - 压力程度 (stressLevel): 0-1
 * - 投入程度 (engagement): 0-1
 * 
 * 并结合 EMA 数值指标进行综合判断
 */

import { executeSkill, auxSkillDefinitionMap } from '../../skills';
import { ZScoreResult, AnomalyDetectionResult } from '../student-baseline.service';

/**
 * 消息接口
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * AI 评估结果
 */
export interface AIAssessmentResult {
  cognitiveDepth: number;    // 0-1
  stressLevel: number;       // 0-1
  engagement: number;        // 0-1
  reasoning: string;
}

/**

 * 综合状态评估

 */

export interface StudentStateAssessment {

  cognitive: number;

  stress: number;

  engagement: number;

  anomaly: boolean;

  anomalyReason?: string;

  intervention?: string;

  assessedAt?: string;

}

/**
 * AI 状态评估服务
 */
export class AIStateAssessmentService {
  
  /**
   * AI 直接评估认知状态
   * 
   * @param conversationHistory 对话历史
   * @returns AI 评估结果
   */
  async assessCognitiveState(
    conversationHistory: Message[]
  ): Promise<AIAssessmentResult> {
    
    try {
      const assessment = await executeSkill(auxSkillDefinitionMap['state-assessment'], {
        action: 'assessCognitiveState',
        conversationHistory,
        __prompt: {
          requestPath: '/services/ai/state-assessment/assess-cognitive-state',
          callerAgentId: 'state-assessment-agent',
          callerAction: 'assessCognitiveState',
        },
      }) || {};

      return {
        cognitiveDepth: Math.max(0, Math.min(1, assessment.cognitiveDepth ?? 0.5)),
        stressLevel: Math.max(0, Math.min(1, assessment.stressLevel ?? 0.5)),
        engagement: Math.max(0, Math.min(1, assessment.engagement ?? 0.5)),
        reasoning: assessment.reasoning || 'AI 评估'
      };
    } catch (error: any) {
      console.error('AI 状态评估失败:', error.message);
      
      // 返回默认值
      return {
        cognitiveDepth: 0.5,
        stressLevel: 0.5,
        engagement: 0.5,
        reasoning: 'AI 评估失败，使用默认值'
      };
    }
  }
  
  /**
   * 综合 AI 和 EMA 数值进行最终判断
   * 
   * @param aiAssessment AI 语义评估结果
   * @param zScores EMA Z-Score 数值
   * @param anomaly 异常检测结果
   * @param conversationHistory 对话历史
   * @returns 综合状态评估
   */
  async integrateAIandEMA(
    aiAssessment: AIAssessmentResult,
    zScores: ZScoreResult,
    anomaly: AnomalyDetectionResult,
    conversationHistory: Message[]
  ): Promise<StudentStateAssessment> {
    
    try {
      const assessment = await executeSkill(auxSkillDefinitionMap['state-assessment'], {
        action: 'integrateAIandEMA',
        aiAssessment,
        zScores,
        anomaly,
        conversationHistory,
        __fallback: {
          cognitive: aiAssessment.cognitiveDepth,
          stress: aiAssessment.stressLevel,
          engagement: aiAssessment.engagement,
          anomaly: false,
          anomalyReason: '',
          intervention: undefined,
          assessedAt: new Date().toISOString(),
        },
        __prompt: {
          requestPath: '/services/ai/state-assessment/integrate-ai-and-ema',
          callerAgentId: 'state-assessment-agent',
          callerAction: 'integrateAIandEMA',
        },
      }) || {};

      return {
        cognitive: Math.max(0, Math.min(1, assessment.cognitive ?? aiAssessment.cognitiveDepth)),
        stress: Math.max(0, Math.min(1, assessment.stress ?? aiAssessment.stressLevel)),
        engagement: Math.max(0, Math.min(1, assessment.engagement ?? aiAssessment.engagement)),
        anomaly: assessment.anomaly || false,
        anomalyReason: assessment.anomalyReason || '',
        intervention: assessment.intervention,
        assessedAt: assessment.assessedAt || new Date().toISOString()
      };
    } catch (error: any) {
      console.error('AI 综合评估失败:', error.message);
      
      // 返回 AI 评估结果（不使用 EMA）
      return {
        cognitive: aiAssessment.cognitiveDepth,
        stress: aiAssessment.stressLevel,
        engagement: aiAssessment.engagement,
        anomaly: false,
        anomalyReason: '',
        intervention: undefined,
        assessedAt: new Date().toISOString()
      };
    }
  }
  
  /**
   * 根据状态生成干预策略
   */
  generateInterventionStrategy(state: StudentStateAssessment): string {
    const { stress, cognitive, engagement } = state;
    
    // 四象限干预策略
    if (stress > 0.7 && cognitive < 0.4) {
      return `
【当前状态】压力大，掌握度低
【策略】情绪安抚 + 支架降级
1. 先共情："看起来这个问题有点挑战性，很正常"
2. 降低难度："我们先不想复杂的部分，只看..."
3. 提供脚手架："这是第一步，你试试..."
4. 不要追问："不用急着回答，先理解"`;
    }
    
    if (stress > 0.7 && cognitive > 0.6) {
      return `
【当前状态】压力大，但掌握度高
【策略】静默追踪 + 适时肯定
1. 肯定能力："你的思路很清晰"
2. 给予时间："慢慢想，不用急"
3. 提供提示（不是答案）："关键点是 xxx"
4. 不要催促："想好了再回答"`;
    }
    
    if (stress < 0.4 && cognitive < 0.4) {
      return `
【当前状态】放松，但没用心
【策略】苏格拉底反问 + 认知冲突
1. 制造认知冲突："你确定吗？我有个反例..."
2. 强制作答："先说说你的想法"
3. 追问："为什么？证据是什么？"
4. 提高参与度："如果是你，会怎么设计？"`;
    }
    
    if (stress < 0.4 && cognitive > 0.6) {
      return `
【当前状态】放松且掌握得好
【策略】进阶拔高 + 角色互换
1. 提高难度："如果条件变成 xxx，怎么办？"
2. 角色互换："如果是你教别人，会怎么讲？"
3. 拓展延伸："这个和 xxx 有什么联系？"
4. 鼓励创造："你能设计一个类似的问题吗？"`;
    }
    
    // 默认策略
    return `
【当前状态】正常学习状态
【策略】正常引导
1. 继续当前节奏
2. 适时提供反馈
3. 鼓励学生思考`;
  }
}

// 导出单例
export const aiStateAssessmentService = new AIStateAssessmentService();
