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
import { getOpenAIClient } from '../../gateway/openai-client';

/**
 * 基础质量评估插件
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
    systemPrompt: `你是学习质量评估专家。

【任务】
评估用户的学习成果、答案质量或任务完成情况，并提供建设性反馈。

【输入】
- 待评估的内容/答案/任务
- 评估标准（可选）
- 原始问题/任务要求

【输出格式 - 必须严格遵循】
{
  "score": 85,
  "grade": "A",
  "dimensions": {
    "accuracy": {
      "score": 90,
      "feedback": "评估维度反馈"
    },
    "completeness": {
      "score": 85,
      "feedback": "评估维度反馈"
    },
    "depth": {
      "score": 80,
      "feedback": "评估维度反馈"
    },
    "clarity": {
      "score": 85,
      "feedback": "评估维度反馈"
    }
  },
  "strengths": [
    "优点1",
    "优点2"
  ],
  "improvements": [
    "改进建议1",
    "改进建议2"
  ],
  "overallFeedback": "总体反馈（50-100字）",
  "nextSteps": [
    "下一步建议1",
    "下一步建议2"
  ]
}

【评估维度说明】
- accuracy（准确性）：内容是否正确
- completeness（完整性）：是否涵盖所有要点
- depth（深度）：是否有足够深入的分析
- clarity（清晰度）：表达是否清晰易懂

【评分标准】
- 分数范围：0-100
- 等级：S(90-100), A(80-89), B(70-79), C(60-69), D(<60)

【反馈原则】
1. 客观公正，以建设性为主
2. 肯定优点，指出不足
3. 提供具体的改进方向
4. 给出下一步学习建议`,
    model: 'deepseek-chat',
    timeout: 60000,
    retries: 2
  },

  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const client = getOpenAIClient();
    const startTime = Date.now();

    try {
      // 构建评估上下文
      const evalContext = this.buildEvalContext(input);

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        {
          role: 'system',
          content: this.config!.systemPrompt!
        },
        {
          role: 'user',
          content: evalContext
        }
      ];

      const response = await client.chatCompletion({
        messages,
        temperature: this.config!.temperature,
        max_tokens: this.config!.maxTokens,
        model: this.config!.model
      });

      const content = response.choices[0]?.message.content || '{}';

      // 解析 JSON
      let data: any;
      try {
        data = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        } else {
          // 如果不是 JSON，作为原始反馈返回
          data = {
            score: 0,
            grade: 'D',
            overallFeedback: content,
            improvements: [],
            nextSteps: []
          };
        }
      }

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
          tokensUsed: response.usage?.total_tokens
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
