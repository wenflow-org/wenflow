/**
 * PeerReinforcementSkill - 伴学 Skill
 * 在教学主链判断学生需要强化时，提供同伴式讨论补强能力
 */

import { ExecutionContext } from '../../gateway/api-gateway';
import { callPrompt } from '../../composers/prompt-composer';
import { PromptCallSpec } from '../../composers/types';
import { logger } from '../../utils/logger';
import type { AgentDefinition } from '../../agents/protocol';

type MessageRole = 'user' | 'assistant' | 'system';
interface ChatMessage { role: MessageRole; content: string }

const AGENT_ID = 'skill:peer-reinforcement';





export const peerAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '伴学 Skill',
  version: '1.0.0',
  type: 'teaching',
  category: 'standard',
  description: '讨论式伴学能力，通过费曼技巧、辩论、反例等方式强化理解',
  capabilities: [
    'feynman-technique',
    'debate-facilitation',
    'counterexample-challenge',
    'analogy-migration',
    'error-analysis'
  ],
  subscribes: [
    'learning:struggle',
    'learning:confusion',
    'teaching:reinforcement-needed'
  ],
  publishes: [
    'peer:discussion-completed',
    'learning:understanding-improved'
  ],
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: '讨论主题' },
      strategy: { 
        type: 'string', 
        enum: ['feynman', 'debate', 'counterexample', 'analogy', 'error-analysis'],
        description: '伴学策略'
      },
      studentMessage: { type: 'string', description: '学生最新消息' },
      tutorContext: { 
        type: 'array', 
        items: { 
          type: 'object', 
          properties: { 
            role: { type: 'string' }, 
            content: { type: 'string' } 
          } 
        },
        description: '教学对话上下文'
      },
      cognitiveLevel: { type: 'string', description: '学生认知层级' },
      understanding: { type: 'number', description: '学生理解度 (0-1)' }
    },
    required: ['topic', 'strategy', 'tutorContext']
  },
  outputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '伴学消息内容' },
      strategy: { type: 'string', description: '使用的伴学策略' },
      followUpQuestions: { 
        type: 'array', 
        items: { type: 'string' },
        description: '后续问题列表'
      }
    },
    required: ['message', 'strategy']
  },
  endpoint: undefined,
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export interface PeerDiscussionInput {
  topic: string;
  strategy: 'feynman' | 'debate' | 'counterexample' | 'analogy' | 'error-analysis';
  studentMessage?: string;
  tutorContext: Array<{ role: string; content: string }>;
  cognitiveLevel?: string;
  understanding?: number;
}

export interface PeerDiscussionOutput {
  message: string;
  strategy: string;
  followUpQuestions?: string[];
  promptDebug?: any;
  inputEcho?: PeerDiscussionInput;
}

function getStrategyInstruction(strategy: PeerDiscussionInput['strategy']): string {
  const strategyPrompts: Record<PeerDiscussionInput['strategy'], string> = {
    feynman: '请像同学一样请学生把概念讲给你听，并用一个追问检验他是否真的理解。',
    debate: '请提出一个轻量对立视角，让学生比较哪种说法更合理。',
    counterexample: '请给一个边界情况或反例，促使学生检查结论是否还成立。',
    analogy: '请引导学生联想一个相近概念，帮助他做类比迁移。',
    'error-analysis': '请围绕学生刚才的错误或偏差，温和地引导他分析错因。',
  };

  return strategyPrompts[strategy] || strategyPrompts.feynman;
}

function buildPeerUserPayload(input: PeerDiscussionInput) {
  const contextSection = input.tutorContext.length > 0
    ? `\n【最近对话】\n${input.tutorContext.slice(-5).map((m) => `${m.role}: ${m.content.substring(0, 100)}`).join('\n')}`
    : '';

  const studentMessageSection = input.studentMessage
    ? `\n【学生消息】${input.studentMessage}`
    : '';

  const understandingSection = typeof input.understanding === 'number'
    ? `\n【理解度】${input.understanding}`
    : '';

  return `请生成一段同伴讨论消息：
【主题】${input.topic}
【策略】${input.strategy}
【策略要求】${getStrategyInstruction(input.strategy)}
【学生认知层级】${input.cognitiveLevel || 'understand'}${understandingSection}${contextSection}${studentMessageSection}`;
}

function validatePeerParsedOutput(parsed: any) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false as const, failureReason: 'PEER_OUTPUT_NOT_OBJECT' };
  }

  if (typeof parsed.message !== 'string' || !parsed.message.trim()) {
    return { valid: false as const, failureReason: 'PEER_MESSAGE_MISSING' };
  }

  return { valid: true as const };
}

const peerPromptSpec: PromptCallSpec<PeerDiscussionInput, string> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: '',
  caller: {
    agentId: 'teaching-agent',
    skillId: 'peer-reinforcement',
  },
  buildUserPayload: (input) => buildPeerUserPayload(input),
  validateParsedOutput: (parsed) => validatePeerParsedOutput(parsed),
  normalizeOutput: (parsed, input) => {
    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed.trim();
    }

    if (parsed && typeof parsed === 'object' && typeof (parsed as any).message === 'string' && (parsed as any).message.trim()) {
      return (parsed as any).message.trim();
    }

    return '';
  },
  modelDefaults: {
    temperature: 0.7,
    maxTokens: 4000,
  },
};

export class PeerAgent {
  private readonly config = {
    timeout: 30000,
  };

  async discuss(input: PeerDiscussionInput): Promise<PeerDiscussionOutput> {
    return this.execute(input);
  }

  async execute(input: PeerDiscussionInput): Promise<PeerDiscussionOutput> {
    const startTime = Date.now();
    let error: Error | null = null;
    let result: PeerDiscussionOutput | null = null;

    try {
      const promptResult = await callPrompt(peerPromptSpec, input);

      if (!promptResult.success) {
        throw new Error(promptResult.error?.message || 'PEER_PROMPT_FAILED');
      }

      const message = promptResult.output || '';

      if (!message.trim()) {
        throw new Error('PEER_RESPONSE_EMPTY');
      }

      logger.info(`[PeerReinforcementSkill] 生成讨论消息：strategy=${input.strategy}, topic=${input.topic}`);

      result = {
        message,
        strategy: input.strategy,
        followUpQuestions: this.extractFollowUpQuestions(message),
        promptDebug: promptResult.debug || null,
        inputEcho: input,
      };
      return result;
    } catch (e: any) {
      error = e instanceof Error ? e : new Error(e.message);
      if (error.message === 'PEER_RESPONSE_EMPTY') {
        logger.warn('[PeerReinforcementSkill] 讨论生成为空，使用 fallback');
      } else {
        logger.error(`[PeerReinforcementSkill] 讨论生成失败：${error.message}`);
      }
      
      result = {
        message: this.getFallbackMessage(input.strategy, input.topic),
        strategy: input.strategy,
        promptDebug: null,
        inputEcho: input,
      };
      return result;
    } finally {
      const durationMs = Date.now() - startTime;
      logger.debug('[PeerReinforcementSkill] 执行结束', {
        durationMs,
        success: !error,
        error: error?.message || null,
      });
    }
  }

  private extractFollowUpQuestions(message: string): string[] {
    const questions: string[] = [];
    const questionPatterns = [
      /([^\?]+\?)/g,
      /([^)？]+[?？])/g,
    ];

    for (const pattern of questionPatterns) {
      const matches = message.match(pattern);
      if (matches) {
        questions.push(...matches.map(q => q.trim()).filter(q => q.length > 5 && q.length < 100));
      }
    }

    return questions.slice(0, 3);
  }

  private getFallbackMessage(strategy: string, topic: string): string {
    const shortTopic = topic.length > 20 ? topic.substring(0, 20) + '...' : topic;
    
    const fallbacks: Record<string, string> = {
      feynman: `你能给我讲讲"${shortTopic}"吗？就像我是第一次听说一样。`,
      debate: `关于"${shortTopic}"，有人支持，有人反对。你怎么看？`,
      counterexample: `如果条件变了，"${shortTopic}"的结论还成立吗？`,
      analogy: `"${shortTopic}"让你想到之前学过的什么概念？有什么相似之处？`,
      'error-analysis': `刚才那道题好像有点问题，你觉得哪里可能出错了？`,
    };

    return fallbacks[strategy] || fallbacks.feynman;
  }
}

export const peerAgent = new PeerAgent();

export async function peerAgentHandler(input: any, context: any): Promise<any> {
  const startTime = Date.now();
  let success = false;
  
  try {
    const result = await peerAgent.execute(input);
    success = true;
    
    peerAgentDefinition.stats.callCount++;
    peerAgentDefinition.stats.successRate = 
      (peerAgentDefinition.stats.successRate * (peerAgentDefinition.stats.callCount - 1) + 1) 
      / peerAgentDefinition.stats.callCount;
    
    return {
      success: true,
      userVisible: result.message,
      internal: {
        core: {
          stage: 'discussion-completed',
          confidence: 0.8,
          isCompleted: true,
        },
        ext: {
          peer: {
            message: result.message,
            strategy: result.strategy,
            followUpQuestions: result.followUpQuestions || [],
            promptDebug: result.promptDebug || null,
            input: result.inputEcho || input,
          }
        },
        strategy: result.strategy,
        followUpQuestions: result.followUpQuestions,
        output: result
      },
      renderHints: {
        component: 'peer-message',
        followUpQuestions: result.followUpQuestions || []
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '伴学 Skill',
        agentType: 'teaching',
        confidence: 0.8,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error: any) {
    peerAgentDefinition.stats.callCount++;
    peerAgentDefinition.stats.successRate = 
      (peerAgentDefinition.stats.successRate * (peerAgentDefinition.stats.callCount - 1)) 
      / peerAgentDefinition.stats.callCount;
    
    return {
      success: false,
      userVisible: '同伴回复生成失败，请稍后重试。',
      error: {
        code: 'PEER_AGENT_FAILED',
        message: error?.message || 'PeerReinforcementSkill execution failed'
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '伴学 Skill',
        agentType: 'teaching',
        confidence: 0,
        generatedAt: new Date().toISOString(),
      }
    };
  } finally {
    const duration = Date.now() - startTime;
    peerAgentDefinition.stats.avgLatency = 
      (peerAgentDefinition.stats.avgLatency * (peerAgentDefinition.stats.callCount - 1) + duration) 
      / peerAgentDefinition.stats.callCount;
  }
}
