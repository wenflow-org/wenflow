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

import { getOpenAISDKForCurrentUser } from '../../gateway/openai-client';
import { ZScoreResult, AnomalyDetectionResult } from '../student-baseline.service';

const AI_API_URL = process.env.AI_API_URL || 'http://localhost:3000';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';

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
    
    const prompt = `
分析学生当前的学习状态：

【对话历史】
${conversationHistory.map(m => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content}`).join('\n')}

【分析维度】

1. 认知深度 (0-1):
   - 0.0-0.3: 直接要答案、复制粘贴、无思考
   - 0.4-0.6: 有初步想法，但无论证
   - 0.7-1.0: 原创观点、逻辑推演、自我纠错

2. 压力程度 (0-1):
   - 0.0-0.3: 放松、自信
   - 0.4-0.6: 有点困惑，但还能应付
   - 0.7-1.0: 焦虑、挫败、情绪化

3. 投入程度 (0-1):
   - 0.0-0.3: 敷衍、回复简短、频繁点"继续"
   - 0.4-0.6: 正常参与
   - 0.7-1.0: 主动提问、深入追问、分享想法

【输出格式】
请返回 JSON 格式：
{
  "cognitiveDepth": 数字，
  "stressLevel": 数字，
  "engagement": 数字，
  "reasoning": "分析推理过程"
}
`;

    try {
      const aiClient = await getOpenAISDKForCurrentUser({
        baseUrl: AI_API_URL,
        apiKey: AI_API_KEY
      });

      const response = await aiClient.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的教育 AI 评估专家。你擅长通过分析学生的对话来判断其认知状态。请只返回 JSON 格式，不要其他内容。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      const content = response.choices[0].message.content || '{}';
      
      // 解析 JSON（处理 markdown 包裹的情况）
      const jsonContent = this.extractJsonFromMarkdown(content);
      const assessment = JSON.parse(jsonContent);
      
      return {
        cognitiveDepth: Math.max(0, Math.min(1, assessment.cognitiveDepth || 0.5)),
        stressLevel: Math.max(0, Math.min(1, assessment.stressLevel || 0.5)),
        engagement: Math.max(0, Math.min(1, assessment.engagement || 0.5)),
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
   * 从 markdown 中提取 JSON
   */
  private extractJsonFromMarkdown(content: string): string {
    // 如果内容被 ```json 包裹，提取 JSON 部分
    const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      return match[1].trim();
    }
    return content.trim();
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
    
    const prompt = `
综合评估学生状态：

【AI 语义分析】
- 认知深度：${aiAssessment.cognitiveDepth.toFixed(2)}
- 压力程度：${aiAssessment.stressLevel.toFixed(2)}
- 投入程度：${aiAssessment.engagement.toFixed(2)}
- 推理：${aiAssessment.reasoning}

【数值指标异常度】(Z-Score)
- 响应时间：${zScores.responseTime?.toFixed(2) || 'N/A'}（>2.5 表示异常慢）
- 消息长度：${zScores.messageLength?.toFixed(2) || 'N/A'}
- 互动间隔：${zScores.interactionInterval?.toFixed(2) || 'N/A'}
- AI 评分：${zScores.aiScore?.toFixed(2) || 'N/A'}

【异常检测】
- 是否异常：${anomaly.hasAnomaly ? '是' : '否'}
- 异常指标：${anomaly.anomalyMetrics.join(', ') || '无'}
- 异常原因：${anomaly.reasoning || '无'}

【对话历史摘要】
最近 3 轮对话:
${conversationHistory.slice(-6).map(m => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content.substring(0, 100)}`).join('\n')}...

【任务】
综合语义和数值，给出最终评估：
1. 如果 Z-Score > 2.5，说明学生行为异常（突然变慢/变短）
2. 结合 AI 的语义理解，判断学生是否遇到困难
3. 如果需要，给出干预建议

【输出格式】
请返回 JSON 格式：
{
  "cognitive": 数字 (0-1),
  "stress": 数字 (0-1),
  "engagement": 数字 (0-1),
  "anomaly": 布尔值，
  "anomalyReason": "字符串",
  "intervention": "干预建议（可选）",
  "assessedAt": "ISO 时间戳"
}
`;

    try {
      const aiClient = await getOpenAISDKForCurrentUser({
        baseUrl: AI_API_URL,
        apiKey: AI_API_KEY
      });

      const response = await aiClient.chat.completions.create({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的学习状态评估 AI。你综合 AI 语义理解和数值指标，给出最终的学生状态评估。请只返回 JSON 格式。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 600
      });

      const content = response.choices[0].message.content || '{}';
      
      // 解析 JSON（处理 markdown 包裹的情况）
      const jsonContent = this.extractJsonFromMarkdown(content);
      const assessment = JSON.parse(jsonContent);
      
      return {
        cognitive: Math.max(0, Math.min(1, assessment.cognitive || aiAssessment.cognitiveDepth)),
        stress: Math.max(0, Math.min(1, assessment.stress || aiAssessment.stressLevel)),
        engagement: Math.max(0, Math.min(1, assessment.engagement || aiAssessment.engagement)),
        anomaly: assessment.anomaly || false,
        anomalyReason: assessment.anomalyReason || '',
        intervention: assessment.intervention,
        assessedAt: new Date().toISOString()
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
