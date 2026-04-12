import prisma from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { logger } from '../../utils/logger';
import type { AgentDefinition } from '../protocol';

const AGENT_ID = 'summary-agent';

export const summaryAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '总结 Agent',
  version: '2.0.0',
  type: 'evaluation',
  category: 'standard',
  description: '根据课堂对话和知识点状态生成结构化学习总结',
  capabilities: [
    'topic-summarization',
    'knowledge-evaluation',
    'practice-advice',
    'metric-interpretation'
  ],
  subscribes: [
    'session:completed',
    'session:interrupted'
  ],
  publishes: [
    'summary:generated',
    'knowledge:updated'
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
      learningState: {
        type: 'object',
        properties: {
          lss: { type: 'number' },
          ktl: { type: 'number' },
          lf: { type: 'number' },
          lsb: { type: 'number' }
        },
        description: '学习状态指标'
      },
      sessionInfo: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          topic: { type: 'string' },
          duration: { type: 'number' },
          messageCount: { type: 'number' }
        },
        required: ['subject', 'topic', 'duration', 'messageCount'],
        description: '会话信息'
      }
    },
    required: ['messages', 'knowledgePoints', 'sessionInfo']
  },
  outputSchema: {
    type: 'object',
    properties: {
      topicSummary: { type: 'string' },
      knowledgeSummary: { type: 'string' },
      practiceAdvice: { type: 'string' },
      learningEvaluation: { type: 'string' },
      knowledgeItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
            progress: { type: 'number' },
            evidence: { type: 'string' }
          }
        }
      },
      keyTakeaways: { type: 'array', items: { type: 'string' } },
      actionPlan: { type: 'array', items: { type: 'string' } },
      evaluationHighlights: {
        type: 'object',
        properties: {
          strengths: { type: 'array', items: { type: 'string' } },
          improvements: { type: 'array', items: { type: 'string' } }
        }
      },
      metricInterpretation: {
        type: 'object',
        properties: {
          session: { type: 'string' },
          longTerm: { type: 'string' }
        }
      },
      summaryVersion: { type: 'string' }
    },
    required: ['topicSummary', 'knowledgeSummary', 'practiceAdvice', 'learningEvaluation']
  },
  endpoint: undefined,
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export interface SummaryInput {
  messages: Array<{ role: string; content: string; timestamp?: Date }>;
  knowledgePoints: Array<{ name: string; status: string; progress: number }>;
  learningState?: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  };
  sessionInfo: {
    subject: string;
    topic: string;
    duration: number;
    messageCount: number;
  };
}

export interface SummaryOutput {
  topicSummary: string;
  knowledgeSummary: string;
  practiceAdvice: string;
  learningEvaluation: string;
  knowledgeItems: Array<{ name: string; status: string; progress: number; evidence: string }>;
  keyTakeaways: string[];
  actionPlan: string[];
  evaluationHighlights: {
    strengths: string[];
    improvements: string[];
  };
  metricInterpretation: {
    session: string;
    longTerm: string;
  };
  summaryVersion: string;
}

export interface SummaryResult {
  source: 'model' | 'fallback';
  summary: SummaryOutput;
}

export class SummaryAgent {
  async generate(input: SummaryInput): Promise<SummaryResult> {
    const startTime = Date.now();
    let error: Error | null = null;
    let result: SummaryResult | null = null;

    try {
      const transcript = input.messages
        .slice(-12)
        .map((m, i) => `${i + 1}. ${m.role === 'user' ? '学生' : '教师'}: ${m.content.slice(0, 150)}`)
        .join('\n');

      const systemPrompt = `你是学习总结助手。请根据课堂对话和知识点状态，生成结构化总结 JSON。

约束：
1) 必须只输出 JSON，不要输出其它内容
2) 所有字段必须存在
3) knowledgeItems 数组中的每个元素必须包含 name, status, progress, evidence

JSON 模板：
{
  "topicSummary": "本节课围绕主题的核心总结",
  "knowledgeSummary": "知识点掌握情况总结",
  "practiceAdvice": "实践建议（多行动，用换行分隔）",
  "learningEvaluation": "亮点和改进建议",
  "knowledgeItems": [
    {"name": "知识点名称", "status": "mastered|learning|pending", "progress": 0.8, "evidence": "证据"}
  ],
  "keyTakeaways": ["收获 1", "收获 2"],
  "actionPlan": ["行动 1", "行动 2"],
  "evaluationHighlights": {
    "strengths": ["优点 1"],
    "improvements": ["改进 1"]
  },
  "metricInterpretation": {
    "session": "本节指标解读",
    "longTerm": "长期指标说明"
  },
  "summaryVersion": "v2"
}`;

      const userPrompt = `【学科】${input.sessionInfo.subject}
【主题】${input.sessionInfo.topic}
【时长】${input.sessionInfo.duration}分钟
【消息数】${input.sessionInfo.messageCount}
【知识点状态】${JSON.stringify(input.knowledgePoints)}
【学习状态】${input.learningState ? JSON.stringify(input.learningState) : '无'}
【对话片段】${transcript}

请生成结构化总结：`;

      const client = getOpenAIClient();
      const response = await client.chatCompletion({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt } as ChatMessage,
          { role: 'user', content: userPrompt } as ChatMessage,
        ],
        temperature: 0.3,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message.content || '{}';
      const parsed = this.parseContent(content);

      if (parsed && this.isValidSummary(parsed)) {
        result = {
          source: 'model',
          summary: parsed as SummaryOutput,
        };
        logger.info(`[SummaryAgent] 生成总结成功：topic=${input.sessionInfo.topic}`);
        return result;
      }

      logger.warn('[SummaryAgent] JSON 解析失败，使用兜底总结', {
        rawPreview: content.slice(0, 400),
      });
      throw new Error('SUMMARY_OUTPUT_INVALID');
    } catch (e) {
      error = e instanceof Error ? e : new Error('Unknown error');
      logger.error('[SummaryAgent] 生成失败', { error });
      result = {
        source: 'fallback',
        summary: this.buildFallbackSummary(input),
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
            success: result?.source === 'model' && error === null,
            durationMs,
            input: JSON.stringify(input).slice(0, 1000),
            output: result ? JSON.stringify(result).slice(0, 500) : null,
            error: error?.message || null,
            calledAt: new Date(),
          },
        });
      } catch (logError) {
        logger.error('[SummaryAgent] 日志记录失败', { logError });
      }
    }
  }

  private parseContent(content: string): SummaryOutput | null {
    const candidates: string[] = [content];
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) candidates.unshift(fenced[1]);

    for (const candidate of candidates) {
      const parsed = this.tryParse(candidate);
      if (parsed && typeof parsed === 'object') {
        if (this.isValidSummary(parsed as Record<string, unknown>)) {
          return parsed as SummaryOutput;
        }
      }

      const extracted = this.extractFirstJsonObject(candidate);
      if (!extracted) continue;
      const extractedParsed = this.tryParse(extracted);
      if (extractedParsed && typeof extractedParsed === 'object' && this.isValidSummary(extractedParsed as Record<string, unknown>)) {
        return extractedParsed as SummaryOutput;
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

  private isValidSummary(obj: unknown): obj is SummaryOutput {
    if (typeof obj !== 'object' || obj === null) return false;
    const record = obj as Record<string, unknown>;
    return (
      typeof record.topicSummary === 'string' &&
      typeof record.knowledgeSummary === 'string' &&
      typeof record.practiceAdvice === 'string' &&
      typeof record.learningEvaluation === 'string' &&
      Array.isArray(record.knowledgeItems) &&
      Array.isArray(record.keyTakeaways) &&
      Array.isArray(record.actionPlan) &&
      typeof record.evaluationHighlights === 'object' &&
      typeof record.metricInterpretation === 'object' &&
      typeof record.summaryVersion === 'string'
    );
  }

  private buildFallbackSummary(input: SummaryInput): SummaryOutput {
    const mastered = input.knowledgePoints.filter((kp) => kp.status === 'mastered').length;
    const total = input.knowledgePoints.length;

    return {
      topicSummary: `本节课围绕"${input.sessionInfo.topic}"进行了学习，时长${input.sessionInfo.duration}分钟。`,
      knowledgeSummary: `共学习${total}个知识点，已掌握${mastered}个。`,
      practiceAdvice: '1. 复习本节课核心概念\n2. 完成相关练习\n3. 总结学习笔记',
      learningEvaluation: '课堂参与度良好，建议继续加强实践应用。',
      knowledgeItems: input.knowledgePoints.map((kp) => ({
        name: kp.name,
        status: kp.status as any,
        progress: kp.progress,
        evidence: kp.status === 'mastered' ? '已通过问答验证理解' : '已覆盖，建议继续练习',
      })),
      keyTakeaways: ['完成学习目标', '形成实践方向'],
      actionPlan: ['本周完成一次实践应用', '整理学习问题'],
      evaluationHighlights: {
        strengths: ['课堂互动积极'],
        improvements: ['建议增加跨案例对比'],
      },
      metricInterpretation: {
        session: `本节学习时长${input.sessionInfo.duration}分钟`,
        longTerm: '长期指标受历史累计影响，不等于单节课程成绩',
      },
      summaryVersion: 'v2',
    };
  }
}

export const summaryAgent = new SummaryAgent();

export async function summaryAgentHandler(input: any, context: any): Promise<any> {
  const startTime = Date.now();
  let success = false;
  
  try {
    const result = await summaryAgent.generate(input);
    success = result.source === 'model';
    
    summaryAgentDefinition.stats.callCount++;
    summaryAgentDefinition.stats.successRate = 
      (summaryAgentDefinition.stats.successRate * (summaryAgentDefinition.stats.callCount - 1) + (success ? 1 : 0)) 
      / summaryAgentDefinition.stats.callCount;
    
    return {
      success: true,
      output: result.summary
    };
  } catch (error: any) {
    summaryAgentDefinition.stats.callCount++;
    summaryAgentDefinition.stats.successRate = 
      (summaryAgentDefinition.stats.successRate * (summaryAgentDefinition.stats.callCount - 1)) 
      / summaryAgentDefinition.stats.callCount;
    
    return {
      success: false,
      error: {
        code: 'SUMMARY_AGENT_FAILED',
        message: error?.message || 'SummaryAgent execution failed'
      }
    };
  } finally {
    const duration = Date.now() - startTime;
    summaryAgentDefinition.stats.avgLatency = 
      (summaryAgentDefinition.stats.avgLatency * (summaryAgentDefinition.stats.callCount - 1) + duration) 
      / summaryAgentDefinition.stats.callCount;
  }
}
