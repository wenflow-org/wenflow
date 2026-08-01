/**
 * Basic Evaluator Plugin
 *
 * 质量评估插件 - 评估学习内容质量、用户答案、任务完成情况等
 */

import {
  AgentPlugin,
  AgentContext,
  AgentOutput
} from '../plugin-types';
import { executeSkillWithResult, auxSkillDefinitionMap } from '../../skills';

/**
 * 基础质量评估插件
 *
 * LLM 调用已迁入 v4 Skill `skill:basic-evaluator`（prompt 真相源：
 * prompts/core/basic-evaluator.yaml）；本插件仅保留输入组装与结果后处理。
 */
export const basicEvaluator: AgentPlugin = {
  id: 'basic-evaluator',
  name: '质量评估器',
  version: '1.0.0',
  description: '评估学习内容质量、用户答案、任务完成情况和学习效果',
  type: 'quality-evaluator',
  capabilities: [
    'content-quality',
    'answer-evaluation',
    'task-completion',
    'learning-progress',
    'feedback-generation'
  ],

  config: {
    temperature: 0.5,
    maxTokens: 3000,  // 详细评估反馈需要更多空间
    model: process.env.AI_MODEL || '',
    timeout: 60000,
    retries: 2
  },

  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const startTime = Date.now();

    try {
      // 构建评估上下文
      const evalContext = this.buildEvalContext(input);

      const result = await executeSkillWithResult(auxSkillDefinitionMap['basic-evaluator'], {
        input,
        evalContext,
        model: this.config?.model,
        temperature: this.config?.temperature,
        maxTokens: this.config?.maxTokens,
        __prompt: { requestPath: '/agents/plugins/basic-evaluator' },
      });
      const data = result.output;

      // 确保分数在有效范围内
      if (data.score !== undefined) {
        data.score = Math.max(0, Math.min(100, data.score));
        data.grade = this.calculateGrade!(data.score);
      }

      // 添加评估上下文信息
      data._evaluated = {
        type: input.type || 'unknown',
        criteria: input.criteria || 'default',
        timestamp: new Date().toISOString()
      };

      return {
        success: true,
        userVisible: `评估完成！得分：${data.score || 0}/100`,
        internal: data,
        metadata: {
          agentId: this.id,
          agentName: this.name,
          confidence: data.score ? data.score / 100 : undefined,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          tokensUsed: result.debug.tokenUsage?.total
        }
      };
    } catch (error: any) {
      return {
        success: false,
        userVisible: '评估失败，请稍后重试',
        error: error.message || 'Failed to evaluate',
        metadata: {
          agentId: this.id,
          agentName: this.name,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };
    }
  },

  /**
   * 构建评估上下文
   */
  buildEvalContext(input: any): string {
    const parts = [];

    // 评估类型
    if (input.type) {
      parts.push(`【评估类型】\n${input.type}\n`);
    }

    // 原始问题或任务要求
    if (input.question || input.task) {
      parts.push(`【原始问题/任务】\n${input.question || input.task}\n`);
    }

    // 评估标准
    if (input.criteria) {
      parts.push(`【评估标准】\n${input.criteria}\n`);
    }

    // 待评估的内容
    if (input.answer || input.content || input.submission) {
      parts.push(`【待评估内容】\n${input.answer || input.content || input.submission}\n`);
    }

    // 用户水平（可选，用于调整评估标准）
    if (input.userLevel) {
      parts.push(`【用户水平】\n${input.userLevel}\n`);
    }

    // 期望的答案要点（可选）
    if (input.keyPoints) {
      parts.push(`【期望要点】\n${input.keyPoints}\n`);
    }

    return parts.join('');
  },

  /**
   * 根据分数计算等级
   */
  calculateGrade(score: number): string {
    if (score >= 90) return 'S';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    return 'D';
  }
};

export default basicEvaluator;
