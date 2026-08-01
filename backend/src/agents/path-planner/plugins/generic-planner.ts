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
import { executeSkillWithResult, auxSkillDefinitionMap } from '../../../skills';

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
    model: process.env.AI_MODEL || '',
    timeout: 120000,
    retries: 2
  },

  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const startTime = Date.now();

    try {
      const result = await executeSkillWithResult(auxSkillDefinitionMap['generic-planner'], {
        input,
        model: this.config?.model,
        temperature: this.config?.temperature,
        maxTokens: this.config?.maxTokens,
        __prompt: { requestPath: '/agents/path-planner/generic-planner' },
      });
      const data = result.output;
      
      return {
        success: true,
        userVisible: `学习路径规划完成！共 ${data.stages?.length || 0} 个阶段`,
        internal: data,
        metadata: {
          agentId: this.id,
          agentName: this.name,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          tokensUsed: result.debug.tokenUsage?.total
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
  }
};

export default genericPlanner;
