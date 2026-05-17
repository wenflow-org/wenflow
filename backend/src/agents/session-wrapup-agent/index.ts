import prisma from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import { getAPIGateway, CallerInfo } from '../../gateway/api-gateway';
import { agentConfigService } from '../../services/agentConfig.service';
import { logger } from '../../utils/logger';
import type { AgentDefinition, AgentOutput } from '../protocol';

export interface SessionWrapupInput {
  messages: Array<{
    role: string;
    content: string;
    timestamp?: Date | string;
    analysis?: {
      cognitiveLevel?: string;
      understanding?: number;
      confusionPoints?: string[];
      engagement?: number;
      emotionalState?: string;
    };
  }>;
  knowledgePoints: Array<{ name: string; status: string; progress: number }>;
  sessionInfo: {
    subject: string;
    topic: string;
    durationMinutes: number;
    userMessageCount: number;
    assistantMessageCount: number;
    taskType?: string;
    taskTitle?: string;
    taskDescription?: string;
    pathTitle?: string | null;
    pathSummary?: string | null;
  };
  learningState?: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
    recentTrend?: string;
    recommendedPacing?: string;
  };
  knowledgeContext?: {
    initialPoints?: Array<{ name: string; status: string; progress: number }>;
    delta?: {
      newlyMastered: string[];
      movedToReview: string[];
      stillLearning: string[];
      unchangedMastered: string[];
    };
  };
  sessionEvidence?: {
    turnCount: number;
    avgUnderstanding: number | null;
    avgEngagement: number | null;
    dominantCognitiveLevel: string | null;
    lastCognitiveLevel: string | null;
    topConfusionPoints: string[];
    emotionalSignals: {
      positive: number;
      neutral: number;
      frustrated: number;
      confused: number;
    };
    completionCandidateSeen: boolean;
  };
}

export interface SessionWrapupSummary {
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

export interface SessionWrapupEvaluation {
  sessionLss: number;
  sessionKtl: number;
  sessionLf: number;
  confidence: number;
  reasoning: string;
}

export interface SessionWrapupResult {
  summary: SessionWrapupSummary;
  evaluation: SessionWrapupEvaluation | null;
  summarySource: 'model' | 'fallback';
  evaluationSource: 'model' | 'ai-fallback' | 'failed';
}

export interface SessionWrapupArtifact {
  status: 'complete' | 'summary-only';
  sources: {
    summary: 'model' | 'fallback';
    evaluation: 'model' | 'ai-fallback' | 'failed';
  };
  summary: SessionWrapupSummary;
  evaluation: SessionWrapupEvaluation | null;
  progress: {
    newlyMastered: string[];
    movedToReview: string[];
    stillLearning: string[];
    unchangedMastered: string[];
  };
  evidence: {
    turnCount: number;
    avgUnderstanding: number | null;
    avgEngagement: number | null;
    dominantCognitiveLevel: string | null;
    lastCognitiveLevel: string | null;
    topConfusionPoints: string[];
    emotionalSignals: {
      positive: number;
      neutral: number;
      frustrated: number;
      confused: number;
    };
    completionCandidateSeen: boolean;
  };
}

const AGENT_ID = 'session-wrapup-agent';

export const sessionWrapupAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '课后产出 Agent',
  version: '1.0.0',
  type: 'evaluation',
  category: 'standard',
  description: '统一生成单节课的总结与评估结果',
  capabilities: [
    'session-wrapup',
    'session-summary',
    'session-evaluation'
  ],
  subscribes: ['session:completed', 'session:interrupted'],
  publishes: ['summary:generated', 'evaluation:completed'],
  inputSchema: {
    type: 'object',
    properties: {
      messages: { type: 'array' },
      knowledgePoints: { type: 'array' },
      sessionInfo: { type: 'object' },
      learningState: { type: 'object' }
    },
    required: ['messages', 'knowledgePoints', 'sessionInfo']
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'object' },
      evaluation: { type: ['object', 'null'] },
      summarySource: { type: 'string' },
      evaluationSource: { type: 'string' }
    },
    required: ['summary', 'summarySource', 'evaluationSource']
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export const WRAPUP_PROMPT = `你是一位课后产出助手。请基于本节课的结构化证据，输出严格 JSON。

目标：
1. summary：给学生看的课后总结
2. evaluation：给系统使用的本节课评分

证据优先级：
1. sessionEvidence / knowledgeContext.delta
2. knowledgePoints / learningState / task 与 path 上下文
3. recent transcript

重要规则：
1. 只基于输入证据输出，不要虚构学生已经掌握的内容
2. 只总结本节课内发生的进展、困难与下一步建议，不要把历史已掌握内容误写为本节新增成果
3. knowledgeItems 优先复用输入 knowledgePoints 的名称、状态、progress
4. practiceAdvice 必须贴合 taskType；reading 偏阅读复盘，practice 偏练习巩固，project 偏产出推进，quiz 偏错题回顾
5. evaluation 可以为 null；若存在，所有分数字段必须完整且类型正确
6. sessionLss/sessionKtl/sessionLf 范围 0-10
7. confidence 范围 0-1，表示证据充分度，不是主观自信
8. reasoning 最多 120 字，并引用 1-2 个关键证据
9. summary 是给学生看的，禁止直接复述内部字段名或状态码，如 mastered、newlyMastered、avgUnderstanding、sessionKtl

评分参考：
- sessionKtl：本节知识获得质量。高分需要有理解提升、困惑解决、知识点推进或掌握证据。
- sessionLss：本节学习压力。高分需要有明显阻塞、反复困惑、高负荷证据。
- sessionLf：本节疲劳负担。高分需要有参与度下降、低效重复、疲劳/沮丧信号等证据。

JSON 模板：
{
  "summary": {
    "topicSummary": "本节课围绕主题的核心总结",
    "knowledgeSummary": "知识点掌握情况总结",
    "practiceAdvice": "实践建议（多行动，用换行分隔）",
    "learningEvaluation": "亮点和改进建议",
    "knowledgeItems": [
      {"name": "知识点名称", "status": "mastered|learning|pending|review", "progress": 80, "evidence": "证据"}
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
  },
  "evaluation": {
    "sessionLss": 5.8,
    "sessionKtl": 6.2,
    "sessionLf": 4.9,
    "confidence": 0.78,
    "reasoning": "一句简短的证据化说明"
  }
}`;

function parseContent(content: string): Record<string, unknown> | null {
  const candidates: string[] = [content];
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      const match = candidate.match(/\{[\s\S]*\}/);
      if (!match) continue;
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function requireNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function requireReasoning(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isSummary(value: unknown): value is SessionWrapupSummary {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const evaluationHighlights = record.evaluationHighlights as Record<string, unknown> | undefined;
  const metricInterpretation = record.metricInterpretation as Record<string, unknown> | undefined;
  const knowledgeItems = record.knowledgeItems as Array<Record<string, unknown>> | undefined;
  return (
    typeof record.topicSummary === 'string' &&
    typeof record.knowledgeSummary === 'string' &&
    typeof record.practiceAdvice === 'string' &&
    typeof record.learningEvaluation === 'string' &&
    Array.isArray(knowledgeItems) &&
    knowledgeItems.every((item) => typeof item?.name === 'string' && typeof item?.status === 'string' && typeof item?.progress === 'number' && typeof item?.evidence === 'string') &&
    Array.isArray(record.keyTakeaways) &&
    (record.keyTakeaways as unknown[]).every((item) => typeof item === 'string') &&
    Array.isArray(record.actionPlan) &&
    (record.actionPlan as unknown[]).every((item) => typeof item === 'string') &&
    typeof evaluationHighlights === 'object' &&
    Array.isArray(evaluationHighlights?.strengths) &&
    Array.isArray(evaluationHighlights?.improvements) &&
    (evaluationHighlights?.strengths as unknown[]).every((item) => typeof item === 'string') &&
    (evaluationHighlights?.improvements as unknown[]).every((item) => typeof item === 'string') &&
    typeof metricInterpretation === 'object' &&
    typeof metricInterpretation?.session === 'string' &&
    typeof metricInterpretation?.longTerm === 'string' &&
    typeof record.summaryVersion === 'string'
  );
}

function extractEvaluation(value: unknown): SessionWrapupEvaluation | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const sessionLss = requireNumber(record.sessionLss, 0, 10);
  const sessionKtl = requireNumber(record.sessionKtl, 0, 10);
  const sessionLf = requireNumber(record.sessionLf, 0, 10);
  const confidence = requireNumber(record.confidence, 0, 1);
  const reasoning = requireReasoning(record.reasoning);

  if (
    sessionLss === null ||
    sessionKtl === null ||
    sessionLf === null ||
    confidence === null ||
    reasoning === null
  ) {
    return null;
  }

  return {
    sessionLss,
    sessionKtl,
    sessionLf,
    confidence,
    reasoning,
  };
}

function buildFallbackSummary(input: SessionWrapupInput): SessionWrapupSummary {
  const mastered = input.knowledgePoints.filter((kp) => kp.status === 'mastered').length;
  const total = input.knowledgePoints.length;
  const taskType = input.sessionInfo.taskType || 'practice';

  const practiceAdvice = taskType === 'project'
    ? '1. 先把本节涉及的关键步骤整理成可执行清单\n2. 完成一个最小可运行或可提交的产出\n3. 标记仍卡住的实现点并逐个突破'
    : taskType === 'reading'
      ? '1. 复盘本节阅读中的核心概念\n2. 用自己的话写一段总结\n3. 记录仍不清楚的术语或逻辑关系'
      : taskType === 'quiz'
        ? '1. 回顾本节容易出错的题点\n2. 针对薄弱点做一次短练习\n3. 总结一条避免重复出错的规则'
        : '1. 复盘本节课核心概念\n2. 完成一次针对性练习\n3. 记录仍不清楚的问题';

  return {
    topicSummary: `本节课围绕"${input.sessionInfo.topic}"进行了学习，时长${input.sessionInfo.durationMinutes}分钟。`,
    knowledgeSummary: `本节共涉及${total}个知识点，其中${mastered}个已经学会。`,
    practiceAdvice,
    learningEvaluation: '本节课的学习回顾已整理完成，建议根据当前掌握情况继续推进下一步学习。',
    knowledgeItems: input.knowledgePoints.map((kp) => ({
      name: kp.name,
      status: kp.status,
      progress: kp.progress,
      evidence: kp.status === 'mastered' ? '从这节课的表达和应用来看，这个点已经比较稳了。' : '这个点还可以继续练习，再通过例子或复盘加深理解。',
    })),
    keyTakeaways: ['完成本节学习回顾', '已整理知识点掌握情况'],
    actionPlan: ['继续完成下一步练习', '对不稳知识点做针对性复盘'],
    evaluationHighlights: {
      strengths: ['课堂内容已被系统整理'],
      improvements: ['本节课评分暂未生成，请稍后重试查看'],
    },
    metricInterpretation: {
      session: '本节课总结已生成。',
      longTerm: '长期指标需要结合后续稳定评估结果观察。',
    },
    summaryVersion: 'v2',
  };
}

function buildWrapupUserPrompt(input: SessionWrapupInput, mode: 'primary' | 'evaluation-fallback'): string {
  const transcript = input.messages
    .slice(-18)
    .map((message, index) => `${index + 1}. ${message.role === 'user' ? '学生' : message.role === 'assistant' ? '教师' : message.role}: ${message.content.slice(0, 220)}`)
    .join('\n\n');

  if (mode === 'evaluation-fallback') {
    return `【学科】${input.sessionInfo.subject}
【主题】${input.sessionInfo.topic}
【时长】${input.sessionInfo.durationMinutes} 分钟
【学生消息数】${input.sessionInfo.userMessageCount}
【助教消息数】${input.sessionInfo.assistantMessageCount}
【任务类型】${input.sessionInfo.taskType || '未知'}
【任务标题】${input.sessionInfo.taskTitle || input.sessionInfo.topic}
【任务说明】${input.sessionInfo.taskDescription || '无'}
【路径标题】${input.sessionInfo.pathTitle || '无'}
【路径摘要】${input.sessionInfo.pathSummary || '无'}
【知识点状态】${JSON.stringify(input.knowledgePoints)}
【知识点变化】${JSON.stringify(input.knowledgeContext?.delta || null)}
【课堂证据】${JSON.stringify(input.sessionEvidence || null)}
【最近对话片段】${transcript}

只输出 evaluation 对象，严格 JSON，不要输出 summary，不要输出解释性前后文。示例：
{
  "sessionLss": 5.8,
  "sessionKtl": 6.2,
  "sessionLf": 4.9,
  "confidence": 0.78,
  "reasoning": "一句简短的证据化说明"
}`;
  }

  return `【学科】${input.sessionInfo.subject}
【主题】${input.sessionInfo.topic}
【时长】${input.sessionInfo.durationMinutes} 分钟
【学生消息数】${input.sessionInfo.userMessageCount}
【助教消息数】${input.sessionInfo.assistantMessageCount}
【任务类型】${input.sessionInfo.taskType || '未知'}
【任务标题】${input.sessionInfo.taskTitle || input.sessionInfo.topic}
【任务说明】${input.sessionInfo.taskDescription || '无'}
【路径标题】${input.sessionInfo.pathTitle || '无'}
【路径摘要】${input.sessionInfo.pathSummary || '无'}
【知识点状态】${JSON.stringify(input.knowledgePoints)}
【知识点变化】${JSON.stringify(input.knowledgeContext?.delta || null)}
【学习状态】${input.learningState ? JSON.stringify(input.learningState) : '无'}
【课堂证据】${JSON.stringify(input.sessionEvidence || null)}
【最近对话片段】${transcript}

请同时输出 summary 与 evaluation。`;
}

function buildProgressSnapshot(input: SessionWrapupInput) {
  const delta = input.knowledgeContext?.delta;
  return {
    newlyMastered: delta?.newlyMastered || [],
    movedToReview: delta?.movedToReview || [],
    stillLearning: delta?.stillLearning || [],
    unchangedMastered: delta?.unchangedMastered || [],
  };
}

function buildEvidenceSnapshot(input: SessionWrapupInput) {
  return {
    turnCount: input.sessionEvidence?.turnCount || 0,
    avgUnderstanding: input.sessionEvidence?.avgUnderstanding ?? null,
    avgEngagement: input.sessionEvidence?.avgEngagement ?? null,
    dominantCognitiveLevel: input.sessionEvidence?.dominantCognitiveLevel || null,
    lastCognitiveLevel: input.sessionEvidence?.lastCognitiveLevel || null,
    topConfusionPoints: input.sessionEvidence?.topConfusionPoints || [],
    emotionalSignals: input.sessionEvidence?.emotionalSignals || {
      positive: 0,
      neutral: 0,
      frustrated: 0,
      confused: 0,
    },
    completionCandidateSeen: !!input.sessionEvidence?.completionCandidateSeen,
  };
}

export function toWrapupArtifact(result: SessionWrapupResult, input: SessionWrapupInput): SessionWrapupArtifact {
  return {
    status: result.evaluation ? 'complete' : 'summary-only',
    sources: {
      summary: result.summarySource,
      evaluation: result.evaluationSource,
    },
    summary: result.summary,
    evaluation: result.evaluation,
    progress: buildProgressSnapshot(input),
    evidence: buildEvidenceSnapshot(input),
  };
}

export class SessionWrapupAgent {
  async generate(input: SessionWrapupInput): Promise<SessionWrapupResult> {
    const startTime = Date.now();
    let error: Error | null = null;
    let result: SessionWrapupResult | null = null;

    try {
      const gateway = getAPIGateway();
      const caller: CallerInfo = { agentId: AGENT_ID };
      const promptConfig = await agentConfigService.getActivePrompt(AGENT_ID);
      const response = await gateway.execute({
        messages: [
          { role: 'system', content: promptConfig?.systemPrompt || WRAPUP_PROMPT },
          {
            role: 'user',
            content: buildWrapupUserPrompt(input, 'primary')
          }
        ],
        temperature: promptConfig?.temperature,
        max_tokens: promptConfig?.maxTokens,
      }, caller, { userId: 'system' });

      const content = response.choices[0]?.message.content || '{}';
      const parsed = parseContent(content);
      const parsedSummary = parsed?.summary;
      const parsedEvaluation = parsed?.evaluation;

      const summary = isSummary(parsedSummary)
        ? parsedSummary
        : buildFallbackSummary(input);
      let evaluation = extractEvaluation(parsedEvaluation);
      let evaluationSource: 'model' | 'ai-fallback' | 'failed' = evaluation ? 'model' : 'failed';

      if (!evaluation) {
        evaluation = await this.generateEvaluationFallback(input, gateway, caller);
        evaluationSource = evaluation ? 'ai-fallback' : 'failed';
      }

      result = {
        summary,
        evaluation,
        summarySource: isSummary(parsedSummary) ? 'model' : 'fallback',
        evaluationSource,
      };

      return result;
    } catch (e) {
      error = e instanceof Error ? e : new Error('Unknown error');
      logger.error('[SessionWrapupAgent] 生成失败', { error });
      result = {
        summary: buildFallbackSummary(input),
        evaluation: null,
        summarySource: 'fallback',
        evaluationSource: 'failed',
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
            sourceEntry: 'platform',
            success: result !== null && error === null,
            durationMs,
            input: JSON.stringify(input).slice(0, 1000),
            output: result ? JSON.stringify(result).slice(0, 500) : null,
            error: error?.message || null,
            calledAt: new Date(),
          },
        });
      } catch (logError) {
        logger.error('[SessionWrapupAgent] 日志记录失败', { logError });
      }
    }
  }

  private async generateEvaluationFallback(
    input: SessionWrapupInput,
    gateway: ReturnType<typeof getAPIGateway>,
    caller: CallerInfo
  ): Promise<SessionWrapupEvaluation | null> {
    try {
      const response = await gateway.execute({
        messages: [
          {
            role: 'system',
            content: '你是一位课程评估员。请只输出单节课 evaluation JSON，对字段格式严格负责，不要输出 summary，不要输出额外说明。'
          },
          {
            role: 'user',
            content: buildWrapupUserPrompt(input, 'evaluation-fallback')
          }
        ]
      }, caller, { userId: 'system' });

      const content = response.choices[0]?.message.content || '{}';
      const parsed = parseContent(content);
      return extractEvaluation(parsed?.evaluation || parsed);
    } catch (error) {
      logger.warn('[SessionWrapupAgent] AI fallback evaluation 失败', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}

export const sessionWrapupAgent = new SessionWrapupAgent();

export async function sessionWrapupAgentHandler(input: any, context: any): Promise<AgentOutput> {
  const startTime = Date.now();
  let success = false;

  try {
    const result = await sessionWrapupAgent.generate(input);
    success = result.summarySource === 'model' && result.evaluationSource === 'model';

    sessionWrapupAgentDefinition.stats.callCount++;
    sessionWrapupAgentDefinition.stats.successRate =
      (sessionWrapupAgentDefinition.stats.successRate * (sessionWrapupAgentDefinition.stats.callCount - 1) + (success ? 1 : 0))
      / sessionWrapupAgentDefinition.stats.callCount;

    return {
      success: true,
      userVisible: result.summary.topicSummary,
      internal: {
        core: {
          stage: 'wrapup-completed',
          confidence: result.evaluation?.confidence || 0.6,
          isCompleted: true,
        },
        ext: {
          sessionWrapup: {
            result,
            artifact: toWrapupArtifact(result, input),
          },
        }
      },
      renderHints: {
        component: 'session-wrapup',
        sections: ['topicSummary', 'knowledgeSummary', 'practiceAdvice', 'learningEvaluation'],
        metrics: ['sessionLss', 'sessionKtl', 'sessionLf', 'confidence']
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '课后产出 Agent',
        agentType: 'evaluation',
        confidence: result.evaluation?.confidence || 0.6,
        generatedAt: new Date().toISOString(),
      }
    };
  } catch (error: any) {
    sessionWrapupAgentDefinition.stats.callCount++;
    sessionWrapupAgentDefinition.stats.successRate =
      (sessionWrapupAgentDefinition.stats.successRate * (sessionWrapupAgentDefinition.stats.callCount - 1))
      / sessionWrapupAgentDefinition.stats.callCount;

    return {
      success: false,
      userVisible: '课后产出生成失败，请稍后重试。',
      error: {
        code: 'SESSION_WRAPUP_FAILED',
        message: error?.message || 'SessionWrapupAgent execution failed'
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '课后产出 Agent',
        agentType: 'evaluation',
        confidence: 0,
        generatedAt: new Date().toISOString(),
      }
    };
  } finally {
    const duration = Date.now() - startTime;
    sessionWrapupAgentDefinition.stats.avgLatency =
      (sessionWrapupAgentDefinition.stats.avgLatency * (sessionWrapupAgentDefinition.stats.callCount - 1) + duration)
      / sessionWrapupAgentDefinition.stats.callCount;
  }
}

export default sessionWrapupAgentHandler;
