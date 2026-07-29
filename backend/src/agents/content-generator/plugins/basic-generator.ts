/**
 * Basic Generator Plugin
 *
 * 基础内容生成插件 - 生成学习内容、练习、代码示例等
 */

import {
  AgentPlugin,
  AgentContext,
  AgentOutput
} from '../../plugin-types';
import { executeSkillWithResult, auxSkillDefinitionMap } from '../../../skills';

/**
 * 基础内容生成插件
 */
export const basicGenerator: AgentPlugin = {
  id: 'basic-generator',
  name: '基础内容生成器',
  version: '1.0.0',
  description: '为学习任务生成教学内容、代码示例、练习题和常见错误分析',
  type: 'content-generator',
  capabilities: [
    'content-creation',
    'exercise-generation',
    'code-example',
    'difficulty-adaptation'
  ],

  config: {
    temperature: 0.7,
    maxTokens: 6000,  // 生成详细教学内容、代码示例、练习和常见错误分析需要更多空间
    model: process.env.AI_MODEL || '',
    timeout: 120000,
    retries: 2
  },

  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const startTime = Date.now();

    try {
      // 构建学习上下文
      const learningContext = this.buildLearningContext(input);

      const result = await executeSkillWithResult(auxSkillDefinitionMap['basic-generator'], {
        input,
        learningContext,
        model: this.config?.model,
        temperature: this.config?.temperature,
        maxTokens: this.config?.maxTokens,
        __prompt: { requestPath: '/agents/content-generator/basic-generator' },
      });
      const data = result.output;

      return {
        success: true,
        userVisible: `学习内容生成完成！包含 ${data.exercises?.length || 0} 道练习题`,
        internal: data,
        metadata: {
          agentId: this.id,
          agentName: this.name,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          tokensUsed: result.debug?.tokenUsage?.total
        }
      };
    } catch (error: any) {
      return {
        success: false,
        userVisible: '内容生成失败，请稍后重试',
        error: error.message || 'Failed to generate content',
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
   * 构建学习上下文
   */
  buildLearningContext(input: any): string {
    const parts = [];

    if (input.topic || input.title) {
      parts.push(`主题：${input.topic || input.title}`);
    }

    if (input.taskType) {
      parts.push(`任务类型：${input.taskType}`);
    }

    if (input.userLevel) {
      parts.push(`用户水平：${input.userLevel}`);
    }

    if (input.pathName) {
      parts.push(`学习路径：${input.pathName}`);
    }

    if (input.weekObjectives) {
      parts.push(`本周目标：${input.weekObjectives}`);
    }

    if (input.taskGoal) {
      parts.push(`本课目标：${input.taskGoal}`);
    }

    if (input.description) {
      parts.push(`任务描述：${input.description}`);
    }

    if (input.subject) {
      parts.push(`学科领域：${input.subject}`);
    }

    parts.push('\n请生成完整的教学内容。');

    return parts.join('\n');
  }
};

export default basicGenerator;
