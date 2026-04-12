/**
 * AI 授课 Agent（v5.0 架构）
 * 
 * 专注于授课学习内容，基于学生学习状态动态调整教学策略
 * 
 * 核心特性：
 * 1. 动态 Prompt 注入（状态快照）
 * 2. 认知深度分层（带时间衰减）
 * 3. 隐形干预策略
 * 4. 状态→策略映射
 */

import {
  AgentDefinition,
  AgentInput,
  AgentOutput,
  AgentContext
} from '../protocol';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { EventBus, getEventBus } from '../../gateway/event-bus';
import prisma from '../../config/database';
import {
  createInitialLearningState,
  generateStateSnapshot,
  updateCognitiveEngagement,
  updateEmotion,
  updateLearningPressure,
  updateBehavior,
  assembleStatePrompt,
  LearningState
} from './learning-state';
import {
  selectStrategy,
  generateStylePrompt,
  generateStrategyContent
} from './intervention-strategies';

// 缓存学习状态（按 sessionId）
const sessionStateCache = new Map<string, LearningState>();

/**
 * AI 授课 Agent 定义
 */
export const tutorAgentDefinition: AgentDefinition = {
  id: 'tutor-agent',
  name: 'AI授课Agent',
  version: '5.0.0',
  type: 'tutor',
  category: 'standard',
  description: '基于学习状态的智能授课系统，动态调整教学策略',
  
  capabilities: [
    'adaptive-teaching',
    'state-aware-instruction',
    'invisible-intervention',
    'cognitive-depth-tracking'
  ],
  
  subscribes: [
    'learning:start',
    'learning:progress',
    'learning:struggle',
    'learning:mastery'
  ],
  
  publishes: [
    'teaching:message',
    'teaching:adjusted',
    'state:updated'
  ],
  
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      topic: { type: 'string' },
      studentMessage: { type: 'string' },
      isCorrect: { type: 'boolean' },
      isNewSession: { type: 'boolean' }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      stateSnapshot: { type: 'object' },
      interventionUsed: { type: 'string' },
      nextStep: { type: 'string' }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// 系统基础 Prompt
const BASE_SYSTEM_PROMPT = `你是一位经验丰富、亲和力强的编程导师。

## 你的教学理念
- 每个学生都能学会编程，只是需要合适的方法
- 错误是学习的一部分，不是失败
- 理解比记忆更重要
- 让学生"恍然大悟"比直接给答案更有价值

## 教学风格
- 像朋友一样对话，不要像老师
- 用生活类比解释技术概念
- 鼓励思考，引导发现
- 适时幽默，让学习轻松愉快

## 回答原则
1. **简洁优先**：先给结论，再解释原因
2. **循序渐进**：从简单到复杂，逐步深入
3. **示例驱动**：用代码示例说明概念
4. **互动引导**：提问激发思考，而非单向灌输

## 禁忌
- 不要说"你应该"、"你必须"
- 不要忽视学生的情绪
- 不要一次性给太多信息
- 不要让回答超过 300 字（除非讲解复杂概念）`;

/**
 * AI 授课 Agent 处理函数
 */
export async function tutorAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const eventBus = getEventBus();
  
  const sessionId = input.metadata?.sessionId || `session_${Date.now()}`;
  const topic = input.metadata?.topic || input.goal || '编程基础';
  const studentMessage = input.metadata?.studentMessage || '';
  const isCorrect = input.metadata?.isCorrect;
  const isNewSession = input.metadata?.isNewSession || false;

  try {
    // Step 1: 获取或创建学习状态
    let state = sessionStateCache.get(sessionId);
    if (!state || isNewSession) {
      state = createInitialLearningState(topic);
      sessionStateCache.set(sessionId, state);
    }

    // Step 2: 更新状态
    if (studentMessage) {
      updateBehavior(state, studentMessage);
      updateEmotion(state, studentMessage, isCorrect);
      updateCognitiveEngagement(state, studentMessage);
    }
    updateLearningPressure(state);

    // Step 3: 生成状态快照
    const { snapshot, emergency } = generateStateSnapshot(state);

    // Step 4: 选择干预策略
    const strategy = selectStrategy(state);

    // Step 5: 组装 Prompt
    const statePrompt = assembleStatePrompt(snapshot, emergency, studentMessage);
    const stylePrompt = generateStylePrompt(strategy);
    
    const fullPrompt = `${BASE_SYSTEM_PROMPT}

${statePrompt}
${stylePrompt}
`;

    // Step 6: 调用 AI
    const client = getOpenAIClient();
    const messages: ChatMessage[] = [
      { role: 'system', content: fullPrompt }
    ];
    
    // 如果有学生消息，添加到对话
    if (studentMessage) {
      messages.push({ role: 'user', content: studentMessage });
    } else {
      // 新会话，请求开场白
      messages.push({ 
        role: 'user', 
        content: `开始讲解"${topic}"，先和学生打个招呼，然后用一句话引起兴趣。` 
      });
    }

    const response = await client.chatCompletion({ 
      messages,
      temperature: 0.7,
      max_tokens: 1000  // 教学解释和代码示例需要更多空间
    });

    const aiMessage = response.choices[0]?.message.content || '';

    // Step 7: 更新会话信息
    state.session.messageCount++;

    // Step 8: 发布事件
    await eventBus.emit({
      type: 'content:generated',
      source: 'tutor-agent',
      userId: context.userId,
      data: {
        sessionId,
        topic,
        interventionUsed: strategy?.name || null,
        stateSnapshot: snapshot
      }
    });

    // Step 9: 生成下一步建议
    const nextStep = generateNextStep(state, strategy);

    return {
      success: true,
      content: {
        explanation: aiMessage
      },
      metadata: {
        agentId: 'tutor-agent',
        agentName: 'AI授课Agent',
        agentType: 'tutor',
        confidence: 0.85,
        generatedAt: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('[TutorAgent] 错误:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        agentId: 'tutor-agent',
        agentName: 'AI授课Agent',
        agentType: 'tutor',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

/**
 * 生成下一步建议
 */
function generateNextStep(
  state: LearningState,
  strategy: ReturnType<typeof selectStrategy>
): string {
  // 根据当前状态建议下一步
  if (state.emotion.frustration > 0.5) {
    return '建议：放慢节奏，用更简单的类比重新讲解';
  }
  
  if (state.cognitiveEngagement.depthScore < 0.3) {
    return '建议：提出开放性问题，引导学生深入思考';
  }
  
  if (state.understanding.mastery > 0.7) {
    return '建议：学生已掌握，可以进入下一个知识点';
  }
  
  if (state.lf.value > 6) {
    return '建议：学生学习时间较长，考虑适当休息或切换主题';
  }
  
  return '建议：继续保持当前教学节奏';
}

/**
 * 清理会话状态
 */
export function clearSessionState(sessionId: string): void {
  sessionStateCache.delete(sessionId);
}

/**
 * 获取会话状态
 */
export function getSessionState(sessionId: string): LearningState | undefined {
  return sessionStateCache.get(sessionId);
}

export default tutorAgentHandler;
