/**
 * Generic Planner Plugin
 * 
 * 通用路径规划插件 - 适用于各类学习目标
 */

import {
  AgentPlugin,
  AgentContext,
  AgentOutput
} from '../../plugin-types';
import { getOpenAIClient } from '../../../gateway/openai-client';

/**
 * 通用路径规划插件
 */
export const genericPlanner: AgentPlugin = {
  id: 'generic-planner',
  name: '通用路径规划',
  version: '1.0.0',
  description: '适用于各类学习目标的通用路径规划，支持编程、语言、技能等多种学习类型',
  type: 'path-planner',
  capabilities: [
    'goal-analysis',
    'path-generation',
    'dynamic-replanning',
    'time-estimation',
    'curriculum-design'
  ],
  
  config: {
    temperature: 0.5,
    maxTokens: 4000,  // 阶段化路径规划需要更多token空间
    systemPrompt: `你是学习路径规划专家。

【核心理念】
平台提供内容框架，用户自主安排节奏。只划分学习阶段和任务，不规定时间进度。

【任务】
根据用户需求，生成逻辑清晰的学习路径方案。

【输出格式 - 必须严格遵循】
{
  "title": "方案标题",
  "description": "方案描述（100-150字，说明学完能做什么）",
  "totalStages": 4,
  "stages": [
    {
      "stageNumber": 1,
      "title": "阶段1：基础入门",
      "description": "阶段描述（学完能做什么）",
      "focus": "核心聚焦点",
      "tasks": [
        {
          "title": "任务名称",
          "description": "任务描述（完成后能做什么）",
          "type": "video",
          "required": true
        }
      ]
    }
  ]
}

【生成规则】
1. 阶段数 3-5 个，按逻辑递进划分（基础 → 进阶 → 应用）
2. 每个阶段 3-5 个必做任务 + 0-2 个选做任务
3. 任务类型分布：video 30% / practice 50% / read 20%
4. required=true 表示必做，required=false 表示选做
5. 【严禁】输出任何时间估算（周数、小时数、分钟数、duration字段）
6. 描述聚焦"学完能做什么"，不提"需要多久学完"

【严禁】
- 不要输出 proposal、learningPath、path 等嵌套结构
- 不要输出 duration、estimatedTime、time 等时间相关字段`,
    model: 'deepseek-chat',
    timeout: 120000,
    retries: 2
  },
  
  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const client = getOpenAIClient();
    const startTime = Date.now();
    
    try {
      // 构建用户提示
      const userPrompt = this.buildUserPrompt(input);
      
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { 
          role: 'system', 
          content: this.config!.systemPrompt! 
        },
        { 
          role: 'user', 
          content: userPrompt 
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
          throw new Error('Invalid JSON response');
        }
      }
      
      return {
        success: true,
        userVisible: `学习路径规划完成！共 ${data.stages?.length || 0} 个阶段`,
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
        userVisible: '学习路径规划失败，请稍后重试',
        error: error.message || 'Failed to generate learning path',
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
   * 构建用户提示
   */
  buildUserPrompt(input: any): string {
    const parts = [
      '请生成学习路径方案。'
    ];
    
    if (input.goal) {
      parts.push(`\n学习目标：${input.goal}`);
    }
    
    if (input.surfaceGoal) {
      parts.push(`\n表面目标：${input.surfaceGoal}`);
    }
    
    if (input.realProblem) {
      parts.push(`\n真实需求：${input.realProblem}`);
    }
    
    if (input.level) {
      parts.push(`\n当前水平：${input.level}`);
    }
    
    if (input.timePerDay) {
      parts.push(`\n可用时间：${input.timePerDay}（仅供参考，不用于强制规划）`);
    }
    
    if (input.stages) {
      parts.push(`\n建议阶段数：${input.stages}`);
    }
    
    if (input.motivation) {
      parts.push(`\n学习动机：${input.motivation}`);
    }
    
    if (input.subject) {
      parts.push(`\n学科领域：${input.subject}`);
    }
    
    parts.push('\n请严格按照输出格式生成方案。');
    
    return parts.join('');
  }
};

export default genericPlanner;
