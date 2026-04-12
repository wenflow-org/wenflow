/**
 * ContentAgent v3.0 注册文件
 * 
 * 将 ContentAgent v3.0 注册到 Agent 系统
 */

import { ContentAgentV3 } from './index';
import { AgentDefinition } from '../protocol';

/**
 * ContentAgent v3.0 定义
 */
export const contentAgentV3Definition: AgentDefinition = {
  id: 'content-agent-v3',
  name: 'Content Agent v3.0',
  version: '3.0.0',
  type: 'content',
  category: 'standard',
  description: '状态感知的对话内容生成 Agent（三层架构）',
  
  capabilities: [
    'dialogue-generation',
    'strategy-selection',
    'evaluation-params',
    'state-tracking',
    'adaptive-learning'
  ],
  
  // 订阅的事件
  subscribes: [
    'path:created',
    'learning:struggle',
    'learning:mastery',
    'task:started',
    'task:completed'
  ],
  
  // 发布的事件
  publishes: [
    'content:generated',
    'content:adjusted',
    'state:updated'
  ],
  
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: '任务 ID' },
      taskTitle: { type: 'string', description: '任务标题' },
      taskDescription: { type: 'string', description: '任务描述' },
      cognitiveObjective: { type: 'string', description: '认知目标' },
      studentState: {
        type: 'object',
        properties: {
          problemClarity: { type: 'number' },
          confidence: { type: 'number' },
          frustration: { type: 'number' },
          cognitiveDepth: { type: 'number' },
          learningStyle: { type: 'string' },
          currentLSS: { type: 'number' },
          currentKTL: { type: 'number' },
          currentLF: { type: 'number' },
          currentLSB: { type: 'number' },
          userId: { type: 'string', description: '用户 ID' }
        }
      },
      conversationHistory: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            content: { type: 'string' }
          }
        }
      },
      currentRound: { type: 'number' },
      sessionId: { type: 'string', description: '学习会话 ID' }
    },
    required: ['taskTitle', 'cognitiveObjective']
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'object',
        properties: {
          uiType: { type: 'string' },
          question: { type: 'string' },
          options: { type: 'array' },
          inputHint: { type: 'string' },
          hint: { type: 'string' }
        }
      },
      evaluationParams: { type: 'object' },
      stateChangeSuggestions: { type: 'object' },
      metadata: { type: 'object' }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * 注册 ContentAgent v3.0 到 Gateway
 * 
 * @param gateway - Gateway 实例
 */
export async function registerContentAgentV3(gateway: {
  registerAgent: (definition: AgentDefinition, handler: any) => Promise<string>
}): Promise<void> {
  const agent = new ContentAgentV3();
  
  // 创建一个公共包装函数来调用受保护的 execute 方法
  const handler = async (input: any, context: any) => {
    return await (agent as any).execute(input);
  };
  
  await gateway.registerAgent(contentAgentV3Definition, handler);
  
  console.log('[Agents] Registered: Content Agent v3.0');
}

export default registerContentAgentV3;
