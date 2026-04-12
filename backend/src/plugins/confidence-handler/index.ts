/**
 * Confidence Handler Plugin
 *
 * 处理低置信度的 Skill 注释结果
 * 钩子：在 `skill:annotated` 事件触发
 * 低置信度阈值：0.6
 */

import {
  AgentPlugin,
  AgentContext,
  AgentOutput
} from '../../agents/plugin-types';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { getEventBus, LearningEvent } from '../../gateway/event-bus';
import { logger } from '../../utils/logger';

const LOW_CONFIDENCE_THRESHOLD = 0.6;

interface ConfidenceHandlerResult {
  originalAnnotation: any;
  confidence: number;
  action: 'accepted' | 'clarification-requested' | 'conservative-default';
  clarificationQuestion?: string;
  conservativeValue?: any;
  fallback: boolean;
}

export const confidenceHandler: AgentPlugin = {
  id: 'confidence-handler',
  name: '置信度处理器',
  version: '1.0.0',
  description: '处理低置信度的 Skill 注释结果，请求澄清或使用保守默认值',
  type: 'quality-evaluator',
  capabilities: [
    'confidence-check',
    'clarification-generation',
    'conservative-default',
    'fallback-handling'
  ],

  config: {
    temperature: 0.4,
    maxTokens: 1000,
    systemPrompt: `你是学习路径规划助手，负责处理置信度不确定的情况。

【任务】
当 Skill 注释结果置信度低于阈值时，你需要决定：
1. 如果可以生成澄清问题，让用户补充信息
2. 如果无法澄清，使用保守的默认值

【输出格式】
{
  "action": "clarification-requested" | "conservative-default",
  "clarificationQuestion": "需要澄清的问题（如果选择 clarification-requested）",
  "conservativeValue": {
    "type": "保守的默认值（如果选择 conservative-default）",
    "reason": "使用保守值的原因"
  },
  "analysis": "简短分析为什么选择这个处理方式"
}

【决策原则】
- 如果缺少关键信息且可以通过提问获得 → 请求澄清
- 如果信息模糊但可以做出安全假设 → 使用保守默认值
- 保守默认值应该是最安全、最保守的选项`,
    model: 'deepseek-chat',
    timeout: 30000,
    retries: 2
  },

  async initialize(): Promise<void> {
    const eventBus = getEventBus();

    eventBus.on('skill:annotated', async (event: LearningEvent) => {
      try {
        logger.info('[ConfidenceHandler] Received skill:annotated event', {
          skillName: event.data?.skillName,
          confidence: event.data?.confidence
        });

        if (event.data?.annotation && event.data?.confidence < LOW_CONFIDENCE_THRESHOLD) {
          const result = await this.handleLowConfidence(
            event.data.annotation,
            event.data.confidence,
            event.data.skillName,
            event.data.context || {}
          );

          if (result.action === 'clarification-requested') {
            await eventBus.emit({
              type: 'clarification:request',
              source: 'confidence-handler',
              userId: event.userId,
              data: {
                question: result.clarificationQuestion,
                context: event.data.context,
                originalAnnotation: event.data.annotation,
                skillName: event.data.skillName
              }
            });
          } else if (result.action === 'conservative-default') {
            await eventBus.emit({
              type: 'annotation:corrected',
              source: 'confidence-handler',
              userId: event.userId,
              data: {
                correctedAnnotation: result.conservativeValue,
                originalAnnotation: event.data.annotation,
                reason: result.conservativeValue?.reason,
                skillName: event.data.skillName
              }
            });
          }
        }
      } catch (error) {
        logger.error('[ConfidenceHandler] Event handler error:', error);
      }
    });

    logger.info('[ConfidenceHandler] Plugin initialized and subscribed to skill:annotated');
  },

  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const startTime = Date.now();

    try {
      const { annotation, confidence, skillName, skillContext } = input;

      if (confidence >= LOW_CONFIDENCE_THRESHOLD) {
        return {
          success: true,
          userVisible: '置信度足够，无需处理',
          internal: {
            originalAnnotation: annotation,
            confidence,
            action: 'accepted',
            fallback: false
          },
          metadata: {
            agentId: this.id,
            agentName: this.name,
            generatedAt: new Date().toISOString(),
            duration: Date.now() - startTime
          }
        };
      }

      const result = await this.handleLowConfidence(
        annotation,
        confidence,
        skillName,
        skillContext || {}
      );

      return {
        success: true,
        userVisible: result.action === 'clarification-requested'
          ? `置信度不足，需要澄清：${result.clarificationQuestion}`
          : `置信度不足，使用保守默认值`,
        internal: result,
        metadata: {
          agentId: this.id,
          agentName: this.name,
          confidence: confidence,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };
    } catch (error: any) {
      logger.error('[ConfidenceHandler] Execute error:', error);

      const fallbackResult = this.fallbackHandle(input);

      return {
        success: true,
        userVisible: `降级处理：使用保守默认值`,
        internal: fallbackResult,
        error: error.message,
        metadata: {
          agentId: this.id,
          agentName: this.name,
          confidence: 0.5,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };
    }
  },

  async handleLowConfidence(
    annotation: any,
    confidence: number,
    skillName: string,
    skillContext: Record<string, any>
  ): Promise<ConfidenceHandlerResult> {
    const client = getOpenAIClient();

    const messages: ChatMessage[] = [
      {
        role: 'system' as const,
        content: this.config!.systemPrompt!
      },
      {
        role: 'user' as const,
        content: `Skill "${skillName}" 返回了低置信度的注释结果：

【原始注释】
${JSON.stringify(annotation, null, 2)}

【置信度】
${confidence}

【上下文】
${JSON.stringify(skillContext, null, 2)}

请决定如何处理这个低置信度结果。`
      }
    ];

    const response = await client.chatCompletion({
      messages,
      temperature: this.config!.temperature,
      max_tokens: this.config!.maxTokens,
      model: this.config!.model
    });

    const content = response.choices[0]?.message.content || '';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          originalAnnotation: annotation,
          confidence,
          action: parsed.action || 'conservative-default',
          clarificationQuestion: parsed.clarificationQuestion,
          conservativeValue: parsed.conservativeValue,
          fallback: false
        };
      }
    } catch (parseError) {
      logger.warn('[ConfidenceHandler] JSON parse failed, using fallback');
    }

    return this.fallbackHandle({ annotation, confidence, skillName, skillContext });
  },

  fallbackHandle(input: any): ConfidenceHandlerResult {
    const { annotation, confidence, skillName, skillContext } = input;

    const conservativeValue = generateConservativeValue(annotation, skillName);

    return {
      originalAnnotation: annotation,
      confidence: confidence || 0.5,
      action: 'conservative-default',
      conservativeValue,
      fallback: true
    };
  },

  destroy(): Promise<void> {
    logger.info('[ConfidenceHandler] Plugin destroyed');
    return Promise.resolve();
  }
};

function generateConservativeValue(annotation: any, skillName: string): any {
  const typeMap: Record<string, any> = {
    'time-estimator': {
      estimatedMinutes: 60,
      confidence: 0.5,
      factors: ['使用默认保守值'],
      reason: '无法准确估算时间，使用保守的60分钟默认值'
    },
    'text-structure-analyzer': {
      outline: [],
      keywords: [],
      summary: '无法分析结构',
      estimatedReadTime: 30,
      reason: '置信度过低，返回空结构'
    },
    'content-generation': {
      content: '',
      keyPoints: [],
      difficulty: 'medium',
      reason: '置信度过低，跳过生成'
    },
    'quiz-generation': {
      questions: [],
      totalScore: 0,
      estimatedTime: 15,
      reason: '置信度过低，不生成测验'
    }
  };

  if (typeMap[skillName]) {
    return {
      ...typeMap[skillName],
      fallback: true,
      originalAnnotation: annotation
    };
  }

  return {
    value: null,
    reason: `未知 Skill "${skillName}"，使用空值作为保守默认`,
    fallback: true,
    originalAnnotation: annotation
  };
}

export default confidenceHandler;