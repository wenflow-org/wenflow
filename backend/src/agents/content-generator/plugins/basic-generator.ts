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
import { getOpenAIClient } from '../../../gateway/openai-client';

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
    'error-pattern',
    'difficulty-adaptation'
  ],

  config: {
    temperature: 0.7,
    maxTokens: 6000,  // 生成详细教学内容、代码示例、练习和常见错误分析需要更多空间
    systemPrompt: `你是学习内容生成专家。

【任务】
根据学习任务主题，生成完整的教学内容。

【输出格式 - 必须严格遵循】
{
  "explanation": "详细的教学讲解内容（Markdown格式）",
  "codeExamples": [
    "代码示例1",
    "代码示例2"
  ],
  "exercises": [
    {
      "question": "练习题问题",
      "hint": "提示信息",
      "type": "coding"
    }
  ],
  "commonErrors": [
    {
      "title": "错误标题",
      "description": "错误描述",
      "solution": "解决方案"
    }
  ]
}

【内容要求】
1. 讲解内容循序渐进，从基础概念到实践应用
2. 提供清晰、可运行的代码示例
3. 练习题多样化：选择题、填空题、编程题
4. 列出初学者常犯的错误及解决方案
5. 使用通俗易懂的语言，避免过多专业术语

【严禁】
- 不要输出 duration、estimatedTime 等时间相关字段
- 只输出教学内容，不要输出时间估算`,
    model: 'deepseek-chat',
    timeout: 120000,
    retries: 2
  },

  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const client = getOpenAIClient();
    const startTime = Date.now();

    try {
      // 构建学习上下文
      const learningContext = this.buildLearningContext(input);

            const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [

              {

                role: 'system',

                content: this.config!.systemPrompt!

              },

              {

                role: 'user',

                content: `请为以下主题生成学习内容： \n\n${learningContext}`

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

              // 尝试从文本中提取 JSON

              const jsonMatch = content.match(/\{[\s\S]*\}/);

              if (jsonMatch) {

                data = JSON.parse(jsonMatch[0]);

              } else {

                // 如果不是 JSON，作为原始内容返回

                data = {

                  explanation: content,

                  codeExamples: [],

                  exercises: [],

                  commonErrors: []

                };

              }

            }

      

            return {

              success: true,

              userVisible: `学习内容生成完成！包含 ${data.exercises?.length || 0} 道练习题`,

              internal: data,

              metadata: {

                agentId: this.id,

                agentName: this.name,

                generatedAt: new Date().toISOString(),

                duration: Date.now() - startTime,

                tokensUsed: response.usage?.total_tokens

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
