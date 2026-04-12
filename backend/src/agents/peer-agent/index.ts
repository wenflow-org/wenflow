/**
 * PeerAgent - 伴学 Agent
 * 在教学 Agent 判断学生需要强化时，主动介入进行讨论式对话
 */

import prisma from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { logger } from '../../utils/logger';
import type { AgentDefinition } from '../protocol';

const AGENT_ID = 'peer-agent';

export const peerAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '伴学 Agent',
  version: '1.0.0',
  type: 'teaching',
  category: 'standard',
  description: '讨论式伴学，通过费曼技巧、辩论、反例等方式强化理解',
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
}

export class PeerAgent {
  private readonly strategyPrompts: Record<string, string> = {
    feynman: '你采用费曼技巧：请学生给你讲解这个概念，通过提问检验理解深度。语气好奇、谦逊。',
    debate: '你采用观点辨析：提出两种对立观点，让学生分析哪种更合理。语气探讨性。',
    counterexample: '你采用反例挑战：提出边界情况或反例，让学生思考结论是否仍然成立。语气挑战性。',
    analogy: '你采用类比迁移：引导学生联想之前学过的类似概念，建立知识联系。语气启发性。',
    'error-analysis': '你采用错误分析：指出学生刚才的错误，引导分析错因。语气温和、建设性。',
  };

  private readonly config = {
    temperature: 0.8,
    maxTokens: 500,
    timeout: 30000,
    model: 'deepseek-chat',
  };

  async discuss(input: PeerDiscussionInput): Promise<PeerDiscussionOutput> {
    return this.execute(input);
  }

  async execute(input: PeerDiscussionInput): Promise<PeerDiscussionOutput> {
    const startTime = Date.now();
    let error: Error | null = null;
    let result: PeerDiscussionOutput | null = null;

    try {
      const systemPrompt = `你是学习伙伴，和学生一起探索问题。
${this.strategyPrompts[input.strategy] || this.strategyPrompts.feynman}

当前讨论主题：${input.topic}
学生认知层级：${input.cognitiveLevel || 'understand'}
学生理解度：${input.understanding || 0.5}

【对话原则】
- 语气平等，像同学讨论，不要像老师
- 不要直接给正确答案，引导用户自己发现
- 可以提出疑问、分享想法、请学生讲解
- 每次只问一个问题，不要连续追问
- 使用口语化表达，适当使用表情符号`;

      const contextSection = input.tutorContext.length > 0
        ? `\n【最近对话】\n${input.tutorContext.slice(-5).map(m => `${m.role}: ${m.content.substring(0, 100)}`).join('\n')}`
        : '';

      const studentMessageSection = input.studentMessage
        ? `\n【学生消息】${input.studentMessage}`
        : '';

      const userPrompt = `请生成一段同伴讨论消息：${contextSection}${studentMessageSection}`;

      const client = getOpenAIClient();
      const response = await client.chatCompletion({
        model: this.config.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      });

      const message = response.choices[0]?.message?.content || '';

      logger.info(`[PeerAgent] 生成讨论消息：strategy=${input.strategy}, topic=${input.topic}`);

      result = {
        message,
        strategy: input.strategy,
        followUpQuestions: this.extractFollowUpQuestions(message),
      };
      return result;
    } catch (e: any) {
      error = e instanceof Error ? e : new Error(e.message);
      logger.error(`[PeerAgent] 讨论生成失败：${error.message}`);
      
      result = {
        message: this.getFallbackMessage(input.strategy, input.topic),
        strategy: input.strategy,
      };
      return result;
    } finally {
      try {
        const durationMs = Date.now() - startTime;
        await prisma.agent_call_logs.create({
          data: {
            id: uuidv4(),
            agentId: AGENT_ID,
            userId: 'system',
            success: error === null,
            durationMs,
            input: JSON.stringify(input).slice(0, 1000),
            output: result ? JSON.stringify(result).slice(0, 500) : null,
            error: error?.message || null,
            calledAt: new Date(),
          },
        });
      } catch (logError) {
        logger.error('[PeerAgent] 日志记录失败', { logError });
      }
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
      output: result
    };
  } catch (error: any) {
    peerAgentDefinition.stats.callCount++;
    peerAgentDefinition.stats.successRate = 
      (peerAgentDefinition.stats.successRate * (peerAgentDefinition.stats.callCount - 1)) 
      / peerAgentDefinition.stats.callCount;
    
    return {
      success: false,
      error: {
        code: 'PEER_AGENT_FAILED',
        message: error?.message || 'PeerAgent execution failed'
      }
    };
  } finally {
    const duration = Date.now() - startTime;
    peerAgentDefinition.stats.avgLatency = 
      (peerAgentDefinition.stats.avgLatency * (peerAgentDefinition.stats.callCount - 1) + duration) 
      / peerAgentDefinition.stats.callCount;
  }
}
