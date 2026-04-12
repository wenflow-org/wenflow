import prisma from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

import { ChatMessage, getOpenAIClient } from '../../gateway/openai-client';
import { logger } from '../../utils/logger';
import type { AgentDefinition } from '../protocol';

const AGENT_ID = 'session-evaluation-agent';

export const sessionEvaluationAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '会话评估 Agent',
  version: '1.0.0',
  type: 'evaluation',
  category: 'standard',
  description: '根据单节课对话证据，评估学习压力、知识获得质量和疲劳度',
  capabilities: [
    'session-lss-evaluation',
    'session-ktl-evaluation',
    'session-lf-evaluation',
    'evidence-based-reasoning'
  ],
  subscribes: [
    'session:completed',
    'session:interrupted'
  ],
  publishes: [
    'evaluation:completed',
    'metrics:session-updated'
  ],
  inputSchema: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            content: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' }
          }
        },
        description: '课堂对话历史'
      },
      knowledgePoints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
            progress: { type: 'number' }
          }
        },
        description: '知识点状态列表'
      },
      sessionInfo: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          topic: { type: 'string' },
          durationMinutes: { type: 'number' },
          userMessageCount: { type: 'number' },
          assistantMessageCount: { type: 'number' }
        },
        required: ['subject', 'topic', 'durationMinutes'],
        description: '会话信息'
      }
    },
    required: ['messages', 'knowledgePoints', 'sessionInfo']
  },
  outputSchema: {
    type: 'object',
    properties: {
      sessionLss: { type: 'number', minimum: 0, maximum: 10, description: '学习压力评分' },
      sessionKtl: { type: 'number', minimum: 0, maximum: 10, description: '知识获得质量' },
      sessionLf: { type: 'number', minimum: 0, maximum: 10, description: '疲劳负担' },
      confidence: { type: 'number', minimum: 0, maximum: 1, description: '评估置信度' },
      reasoning: { type: 'string', description: '证据化说明' }
    },
    required: ['sessionLss', 'sessionKtl', 'sessionLf', 'confidence', 'reasoning']
  },
  endpoint: undefined,
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export interface SessionEvaluationInput {
  messages: Array<{ role: string; content: string; timestamp?: Date }>;
  knowledgePoints: Array<{ name: string; status: string; progress: number }>;
  sessionInfo: {
    subject: string;
    topic: string;
    durationMinutes: number;
    userMessageCount: number;
    assistantMessageCount: number;
  };
}

export interface SessionEvaluationOutput {
  sessionLss: number;
  sessionKtl: number;
  sessionLf: number;
  confidence: number;
  reasoning: string;
}

export interface SessionEvaluationResult {
  source: 'model';
  evaluation: SessionEvaluationOutput;
}

export class SessionEvaluationAgent {
  async evaluate(input: SessionEvaluationInput): Promise<SessionEvaluationResult> {
    const startTime = Date.now();
    let error: Error | null = null;
    let result: SessionEvaluationResult | null = null;

    try {
      const transcript = input.messages
        .slice(-18)
        .map((m, index) => `${index + 1}. ${m.role === 'assistant' ? '教师' : m.role === 'user' ? '学生' : m.role}: ${m.content}`)
        .join('\n\n');

      const systemPrompt = `你是课程评估员。请根据单节课对话证据，输出会话评分 JSON。

评分定义（0-10）：
- sessionLss: 本节课学习压力（难度、阻塞、认知负荷）
- sessionKtl: 本节课知识获得质量（理解与掌握）
- sessionLf: 本节课疲劳负担（注意力衰减、重复低效）
- confidence: 评估置信度（0-1）

约束：
1) 必须只输出 JSON，不要输出其它内容
2) 所有分数字段必须是数字
3) sessionLss/sessionKtl/sessionLf 范围 0-10
4) confidence 范围 0-1
5) reasoning 最多 120 字

【会话信息】
- 学科：${input.sessionInfo.subject}
- 主题：${input.sessionInfo.topic}
- 时长：${input.sessionInfo.durationMinutes} 分钟
- 学生消息数：${input.sessionInfo.userMessageCount}
- 助教消息数：${input.sessionInfo.assistantMessageCount}

【知识点状态】
${JSON.stringify(input.knowledgePoints)}

【最近对话片段】
${transcript}

JSON 模板：
{
  "sessionLss": 5.8,
  "sessionKtl": 6.2,
  "sessionLf": 4.9,
  "confidence": 0.78,
  "reasoning": "一句简短的证据化说明"
}`;

      const client = getOpenAIClient();
      const response = await client.chatCompletion({
        messages: [{ role: 'system', content: systemPrompt } as ChatMessage],
        temperature: 0.2,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message.content || '{}';
      const parsed = this.parseContent(content);

      if (parsed) {
        result = {
          source: 'model',
          evaluation: {
            sessionLss: this.requireNumber(parsed.sessionLss, 0, 10, 'sessionLss'),
            sessionKtl: this.requireNumber(parsed.sessionKtl, 0, 10, 'sessionKtl'),
            sessionLf: this.requireNumber(parsed.sessionLf, 0, 10, 'sessionLf'),
            confidence: this.requireNumber(parsed.confidence, 0, 1, 'confidence'),
            reasoning: this.requireReasoning(parsed.reasoning),
          },
        };
        return result;
      }

      logger.warn('[SessionEvaluationAgent] JSON 解析失败，终止评估', {
        rawPreview: content.slice(0, 400),
      });
      throw new Error('SESSION_EVALUATION_OUTPUT_INVALID');
    } catch (e) {
      error = e instanceof Error ? e : new Error('Unknown error');
      logger.error('[SessionEvaluationAgent] 评估失败', { error });
      throw error;
    } finally {
      try {
        const durationMs = Date.now() - startTime;
        await prisma.agent_call_logs.create({
          data: {
            id: uuidv4(),
            agentId: AGENT_ID,
            userId: 'system',
            success: result !== null && error === null,
            durationMs,
            input: JSON.stringify(input).slice(0, 1000),
            output: result ? JSON.stringify(result).slice(0, 500) : null,
            error: error?.message || null,
            calledAt: new Date(),
          },
        });
      } catch (logError) {
        logger.error('[SessionEvaluationAgent] 日志记录失败', { logError });
      }
    }
  }

  private parseContent(content: string): Record<string, unknown> | null {
    const candidates: string[] = [content];
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) candidates.unshift(fenced[1]);

    for (const candidate of candidates) {
      const parsed = this.tryParse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;

      const extracted = this.extractFirstJsonObject(candidate);
      if (!extracted) continue;
      const extractedParsed = this.tryParse(extracted);
      if (extractedParsed && typeof extractedParsed === 'object') {
        return extractedParsed as Record<string, unknown>;
      }
    }

    return null;
  }

  private tryParse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private extractFirstJsonObject(raw: string): string | null {
    const start = raw.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth += 1;
        continue;
      }

      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return raw.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  private requireNumber(value: unknown, min: number, max: number, field: string): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`SESSION_EVALUATION_OUTPUT_INVALID: ${field} must be a number`);
    }
    if (value < min || value > max) {
      throw new Error(`SESSION_EVALUATION_OUTPUT_INVALID: ${field} out of range`);
    }
    return value;
  }

  private requireReasoning(value: unknown): string {
    if (typeof value !== 'string') {
      throw new Error('SESSION_EVALUATION_OUTPUT_INVALID: reasoning must be a string');
    }
    const text = value.trim();
    if (!text) {
      throw new Error('SESSION_EVALUATION_OUTPUT_INVALID: reasoning cannot be empty');
    }
    return text;
  }
}

export const sessionEvaluationAgent = new SessionEvaluationAgent();

export async function sessionEvaluationAgentHandler(input: any, context: any): Promise<any> {
  const startTime = Date.now();
  let success = false;
  
  try {
    const result = await sessionEvaluationAgent.evaluate(input);
    success = true;
    
    sessionEvaluationAgentDefinition.stats.callCount++;
    sessionEvaluationAgentDefinition.stats.successRate = 
      (sessionEvaluationAgentDefinition.stats.successRate * (sessionEvaluationAgentDefinition.stats.callCount - 1) + 1) 
      / sessionEvaluationAgentDefinition.stats.callCount;
    
    return {
      success: true,
      output: result.evaluation
    };
  } catch (error: any) {
    sessionEvaluationAgentDefinition.stats.callCount++;
    sessionEvaluationAgentDefinition.stats.successRate = 
      (sessionEvaluationAgentDefinition.stats.successRate * (sessionEvaluationAgentDefinition.stats.callCount - 1)) 
      / sessionEvaluationAgentDefinition.stats.callCount;
    
    return {
      success: false,
      error: {
        code: 'SESSION_EVALUATION_FAILED',
        message: error?.message || 'SessionEvaluationAgent execution failed'
      }
    };
  } finally {
    const duration = Date.now() - startTime;
    sessionEvaluationAgentDefinition.stats.avgLatency = 
      (sessionEvaluationAgentDefinition.stats.avgLatency * (sessionEvaluationAgentDefinition.stats.callCount - 1) + duration) 
      / sessionEvaluationAgentDefinition.stats.callCount;
  }
}
