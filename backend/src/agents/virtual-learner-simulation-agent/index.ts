/**
 * Virtual Learner Simulation Agent - 入口
 * 
 * 符合标准 Agent 协议
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import aiService from '../../services/ai/ai.service';
import { agentConfigService } from '../../services/agentConfig.service';
import { AgentDefinition, AgentContext, AgentInput, AgentOutput, ChatMessage } from '../protocol';
import { buildSimulationPrompt, buildProfileGenerationPrompt, buildReactionPrompt } from './prompt';
import type { SimulationAgentInput, SimulationAgentOutput, SimulationContext, PersonalityTraits, ReactionContext } from './types';

export const virtualLearnerSimulationAgentDefinition: AgentDefinition = {
  id: 'virtual-learner-simulation-agent',
  name: '虚拟学习者模拟 Agent',
  version: '1.0.0',
  type: 'custom',
  category: 'standard',
  description: '扮演虚拟用户，模拟真实学习者对话行为，用于测试和体验验证',
  capabilities: ['role-playing', 'persona-simulation', 'context-aware-reply'],
  subscribes: [],
  publishes: [],
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['standard', 'custom'] },
      goal: { type: 'string' },
      metadata: {
        type: 'object',
        properties: {
          simulationType: { type: 'string', enum: ['generate_profile', 'simulate_reply', 'simulate_reaction'] },
          generateProfileInput: { type: 'object' },
          simulationContext: { type: 'object' }
        }
      }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      userVisible: { type: 'string' },
      internal: { type: 'object' },
      generatedProfile: { type: 'object' }
    }
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export async function virtualLearnerSimulationAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const traceId = context.metadata?.traceId || uuidv4();
  
  try {
    const simulationType = input.metadata?.simulationType || 'generate_profile';
    logger.info('[virtual-learner-simulation-agent] 开始执行', {
      traceId,
      userId: context.userId,
      simulationType
    });
    
if (simulationType === 'generate_profile') {
      return await handleGenerateProfile(input, context, startTime, traceId);
    }
    
    if (simulationType === 'simulate_reaction') {
      return await handleSimulateReaction(input, context, startTime, traceId);
    }
    
    return await handleSimulateReply(input, context, startTime, traceId);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    logger.error('[virtual-learner-simulation-agent] 执行失败', {
      traceId,
      error: error.message,
      duration
    });
    
    await agentConfigService.recordAgentCall({
      agentId: 'virtual-learner-simulation-agent',
      userId: context.userId,
      promptVersion: 0,
      duration,
      tokensUsed: 0,
      success: false,
      error: error.message
    });
    
    return {
      success: false,
      error: { code: 'AGENT_ERROR', message: error.message },
      metadata: {
        agentId: 'virtual-learner-simulation-agent',
        agentName: '虚拟学习者模拟 Agent',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

async function handleGenerateProfile(
  input: AgentInput,
  context: AgentContext,
  startTime: number,
  traceId: string
): Promise<AgentOutput> {
  const profileInput = input.metadata?.generateProfileInput;
  
  if (!profileInput?.learningGoal || !profileInput?.knowledgeLevel) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: '缺少学习目标或知识水平' },
      metadata: {
        agentId: 'virtual-learner-simulation-agent',
        agentName: '虚拟学习者模拟 Agent',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
  
  const config = await agentConfigService.getActivePrompt('virtual-learner-simulation-agent');
  
  const systemPrompt = buildProfileGenerationPrompt(
    profileInput.learningGoal,
    profileInput.knowledgeLevel,
    profileInput.simulationMode,
    profileInput.personalityTraits
  );
  
  const model = config?.model || undefined;
  const temperature = 0.7;
  const maxTokens = 600;
  
  logger.debug('[virtual-learner-simulation-agent] Profile生成Prompt构建完成', {
    traceId,
    model,
    temperature,
    maxTokens,
    promptLength: systemPrompt.length
  });
  
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  const response = await aiService.chat(messages, {
    model,
    temperature,
    maxTokens
  });
  
  const rawContent = response.content || '';
  const parsed = parseProfileOutput(rawContent);
  
  if (!parsed.profile) {
    logger.warn('[virtual-learner-simulation-agent] Profile解析失败', {
      traceId,
      rawContent: rawContent.substring(0, 200)
    });
    return {
      success: false,
      error: { code: 'PARSE_ERROR', message: '无法解析生成的画像数据' },
      metadata: {
        agentId: 'virtual-learner-simulation-agent',
        agentName: '虚拟学习者模拟 Agent',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
  
  const duration = Date.now() - startTime;
  
  logger.info('[virtual-learner-simulation-agent] Profile生成完成', {
    traceId,
    duration,
    profile: parsed.profile
  });
  
  await agentConfigService.recordAgentCall({
    agentId: 'virtual-learner-simulation-agent',
    userId: context.userId,
    promptVersion: config?.version || 0,
    duration,
    tokensUsed: response.usage?.totalTokens || 0,
    success: true,
    input: { type: 'generate_profile', learningGoal: profileInput.learningGoal },
    output: { profileAge: parsed.profile.age }
  });
  
  return {
    success: true,
    userVisible: `已为学习目标"${profileInput.learningGoal}"生成虚拟用户画像`,
    internal: {
      core: {
        stage: 'completed',
        confidence: 0.9,
        isCompleted: true
      },
      generatedProfile: parsed.profile
    },
    generatedProfile: parsed.profile,
    metadata: {
      agentId: 'virtual-learner-simulation-agent',
      agentName: '虚拟学习者模拟 Agent',
      agentType: 'custom',
      confidence: 0.9,
      generatedAt: new Date().toISOString()
    }
  };
}

async function handleSimulateReply(
  input: AgentInput,
  context: AgentContext,
  startTime: number,
  traceId: string
): Promise<AgentOutput> {
  const simulationContext = input.metadata?.simulationContext;
  
  if (!simulationContext) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: '缺少模拟上下文' },
      metadata: {
        agentId: 'virtual-learner-simulation-agent',
        agentName: '虚拟学习者模拟 Agent',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
  
  const config = await agentConfigService.getActivePrompt('virtual-learner-simulation-agent');
  
  const systemPrompt = buildSimulationPrompt(simulationContext);
  
  const model = simulationContext.profile?.simulationModel || config?.model || undefined;
  const temperature = simulationContext.profile?.simulationTemperature || config?.temperature || 0.8;
  const maxTokens = config?.maxTokens || 500;
  
  logger.debug('[virtual-learner-simulation-agent] Prompt构建完成', {
    traceId,
    model,
    temperature,
    maxTokens,
    promptLength: systemPrompt.length
  });
  
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(simulationContext.conversationHistory || []).map((item: any) => ({
      role: item.role,
      content: item.content
    }))
  ];
  
  const response = await aiService.chat(messages, {
    model,
    temperature,
    maxTokens
  });
  
  const rawContent = response.content || '';
  const parsed = parseSimulationOutput(rawContent);
  
  if (!parsed.reply) {
    logger.warn('[virtual-learner-simulation-agent] 解析失败，使用原始回复', {
      traceId,
      rawContent: rawContent.substring(0, 200)
    });
    parsed.reply = rawContent;
  }
  
  const duration = Date.now() - startTime;
  
  logger.info('[virtual-learner-simulation-agent] 执行完成', {
    traceId,
    duration,
    replyLength: parsed.reply.length
  });
  
  await agentConfigService.recordAgentCall({
    agentId: 'virtual-learner-simulation-agent',
    userId: context.userId,
    promptVersion: config?.version || 0,
    duration,
    tokensUsed: response.usage?.totalTokens || 0,
    success: true,
    input: { type: 'simulate_reply' },
    output: { replyLength: parsed.reply.length }
  });
  
  return {
    success: true,
    userVisible: parsed.reply,
    internal: {
      core: {
        stage: 'turn-completed',
        confidence: 0.8,
        isCompleted: false
      },
      thoughtProcess: parsed.thoughtProcess
    },
    metadata: {
      agentId: 'virtual-learner-simulation-agent',
      agentName: '虚拟学习者模拟 Agent',
      agentType: 'custom',
      confidence: 0.8,
      generatedAt: new Date().toISOString()
    }
  };
}

function parseProfileOutput(rawContent: string): { profile?: any } {
  const trimmed = rawContent.trim();
  
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        profile: {
          age: parsed.age || 28,
          occupation: parsed.occupation || '',
          education: parsed.education || '',
          background: parsed.background || '',
          learningStyle: parsed.learningStyle || undefined,
          motivationType: parsed.motivationType || undefined,
          availableTime: parsed.availableTime || undefined,
          techComfort: parsed.techComfort || undefined,
          priorAttempts: parsed.priorAttempts || undefined,
          personalityTraits: parsed.personalityTraits || undefined
        }
      };
    } catch (e) {
      logger.warn('[virtual-learner-simulation-agent] Profile JSON解析失败');
    }
  }
  
  return { profile: undefined };
}

function parseSimulationOutput(rawContent: string): { reply: string; thoughtProcess?: string } {
  const trimmed = rawContent.trim();
  
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reply: parsed.reply || '',
        thoughtProcess: parsed.thoughtProcess
      };
    } catch (e) {
      logger.warn('[virtual-learner-simulation-agent] JSON解析失败，尝试其他方式');
    }
  }
  
  if (trimmed.includes('reply')) {
    const replyMatch = trimmed.match(/"reply"\s*:\s*"([^"]*)"/);
    if (replyMatch) {
      return { reply: replyMatch[1] };
    }
  }
  
  return { reply: trimmed };
}

async function handleSimulateReaction(
  input: AgentInput,
  context: AgentContext,
  startTime: number,
  traceId: string
): Promise<AgentOutput> {
  const reactionContext = input.metadata?.reactionContext as ReactionContext;
  
  if (!reactionContext?.reactionTarget || !reactionContext?.targetData || !reactionContext?.profile) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: '缺少反应上下文（reactionTarget、targetData 或 profile）' },
      metadata: {
        agentId: 'virtual-learner-simulation-agent',
        agentName: '虚拟学习者模拟 Agent',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
  
  const config = await agentConfigService.getActivePrompt('virtual-learner-simulation-agent');
  
  const systemPrompt = buildReactionPrompt(reactionContext);
  
  const model = reactionContext.profile?.simulationModel || config?.model || undefined;
  const temperature = reactionContext.profile?.simulationTemperature || config?.temperature || 0.7;
  const maxTokens = config?.maxTokens || 400;
  
  logger.debug('[virtual-learner-simulation-agent] Reaction Prompt构建完成', {
    traceId,
    model,
    temperature,
    maxTokens,
    reactionTarget: reactionContext.reactionTarget,
    promptLength: systemPrompt.length
  });
  
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  const response = await aiService.chat(messages, {
    model,
    temperature,
    maxTokens
  });
  
  const rawContent = response.content || '';
  const parsed = parseReactionOutput(rawContent);
  
  if (!parsed.reaction) {
    logger.warn('[virtual-learner-simulation-agent] Reaction解析失败', {
      traceId,
      rawContent: rawContent.substring(0, 200)
    });
    return {
      success: false,
      error: { code: 'PARSE_ERROR', message: '无法解析反应数据' },
      metadata: {
        agentId: 'virtual-learner-simulation-agent',
        agentName: '虚拟学习者模拟 Agent',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
  
  const duration = Date.now() - startTime;
  
  logger.info('[virtual-learner-simulation-agent] Reaction生成完成', {
    traceId,
    duration,
    decision: parsed.decision,
    confidence: parsed.confidence
  });
  
  await agentConfigService.recordAgentCall({
    agentId: 'virtual-learner-simulation-agent',
    userId: context.userId,
    promptVersion: config?.version || 0,
    duration,
    tokensUsed: response.usage?.totalTokens || 0,
    success: true,
    input: { type: 'simulate_reaction', reactionTarget: reactionContext.reactionTarget },
    output: { decision: parsed.decision, confidence: parsed.confidence }
  });
  
  return {
    success: true,
    userVisible: parsed.reaction,
    internal: {
      core: {
        stage: 'reaction-completed',
        confidence: parsed.confidence || 0.7,
        isCompleted: parsed.decision === 'accept'
      },
      reaction: parsed
    },
    reactionOutput: parsed,
    metadata: {
      agentId: 'virtual-learner-simulation-agent',
      agentName: '虚拟学习者模拟 Agent',
      agentType: 'custom',
      confidence: parsed.confidence || 0.7,
      generatedAt: new Date().toISOString()
    }
  };
}

function parseReactionOutput(rawContent: string): {
  reaction: string;
  decision: 'accept' | 'modify' | 'reject';
  modifyRequest?: string;
  confidence: number;
} {
  const trimmed = rawContent.trim();
  
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reaction: parsed.reaction || '',
        decision: parsed.decision || 'accept',
        modifyRequest: parsed.modifyRequest,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7
      };
    } catch (e) {
      logger.warn('[virtual-learner-simulation-agent] Reaction JSON解析失败');
    }
  }
  
  return {
    reaction: '',
    decision: 'accept',
    confidence: 0.5
  };
}

export { type SimulationAgentInput, type SimulationAgentOutput, type SimulationContext } from './types';