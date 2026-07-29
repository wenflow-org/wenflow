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
import { executeSkillWithResult, auxSkillDefinitionMap } from '../../skills';
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
    model: process.env.AI_MODEL || '',
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
          const { getGateway } = await import('../../gateway');
          const execution = await getGateway().executeSkill(this.id, {
            pluginInput: {
              annotation: event.data.annotation,
              confidence: event.data.confidence,
              skillName: event.data.skillName,
              skillContext: event.data.context || {},
            },
            pluginContext: { userId: event.userId },
          });
          const result = execution.output?.internal as ConfidenceHandlerResult;

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
    const deterministicFallback = this.fallbackHandle({ annotation, confidence, skillName, skillContext });

    const result = await executeSkillWithResult(auxSkillDefinitionMap['confidence-handler'], {
      annotation,
      confidence,
      skillName,
      skillContext,
      __fallback: deterministicFallback,
      __prompt: { requestPath: '/plugins/confidence-handler/handle-low-confidence' },
    });

    if (result.quality === 'fallback') {
      return deterministicFallback;
    }

    const parsed = result.output;
    if (parsed) {
      return {
        originalAnnotation: annotation,
        confidence,
        action: parsed.action || 'conservative-default',
        clarificationQuestion: parsed.clarificationQuestion,
        conservativeValue: parsed.conservativeValue,
        fallback: false
      };
    }

    return deterministicFallback;
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
    'text-structure-analyzer': {
      outline: [],
      keywords: [],
      summary: '无法分析结构',
      estimatedReadTime: 30,
      reason: '置信度过低，返回空结构'
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
