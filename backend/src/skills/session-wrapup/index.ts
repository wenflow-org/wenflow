import { CallerInfo } from '../../gateway/api-gateway';
import { callPrompt } from '../../composers/prompt-composer';
import { buildDefaultRuntimeContract } from '../../services/prompt-lab/runtime-contract';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { PromptCallSpec } from '../../composers/types';
import { logger } from '../../utils/logger';
import type { AgentDefinition, AgentOutput } from '../../agents/protocol';
import { buildSkillOutcome, type SkillOutcome } from '../outcome';

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
  sessionStructure?: {
    pathBackground?: Record<string, any> | null;
    finalClassroomContext?: Record<string, any> | null;
    classroomEventHistory?: Array<Record<string, any>>;
    stageHistory?: Array<Record<string, any>>;
    endReason?: string | null;
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
  runtimeEnvelope?: ReturnType<typeof adaptToRuntimeEnvelope>;
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

const AGENT_ID = 'skill:session-wrapup';

export const sessionWrapupAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '课后产出 Skill',
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

/**
 * The primary prompt promises both blocks. Validate that raw contract before
 * normalization so malformed model output gets one corrective retry instead
 * of silently bypassing the model result and falling back immediately.
 */
export function validateSessionWrapupParsedOutput(parsed: unknown) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false as const, failureReason: 'SESSION_WRAPUP_OUTPUT_NOT_OBJECT' };
  }

  const record = parsed as Record<string, unknown>;
  if (!isSummary(record.summary)) {
    return { valid: false as const, failureReason: 'SESSION_WRAPUP_SUMMARY_INVALID' };
  }

  if (!extractEvaluation(record.evaluation)) {
    return { valid: false as const, failureReason: 'SESSION_WRAPUP_EVALUATION_INVALID' };
  }

  return { valid: true as const };
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
      strengths: mastered > 0 ? ['本节课已有明确知识点推进或掌握证据'] : ['课堂内容已被系统整理，已形成后续复盘基础'],
      improvements: ['仍需结合本节证据继续判断哪些知识点只是巩固、哪些已真正掌握'],
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
【路径背景】${JSON.stringify(input.sessionStructure?.pathBackground || null)}
【课堂最终状态】${JSON.stringify(input.sessionStructure?.finalClassroomContext || null)}
【课堂事件历史】${JSON.stringify(input.sessionStructure?.classroomEventHistory || [])}
【阶段轨迹】${JSON.stringify(input.sessionStructure?.stageHistory || [])}
【结束原因】${input.sessionStructure?.endReason || '无'}
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
【路径背景】${JSON.stringify(input.sessionStructure?.pathBackground || null)}
【课堂最终状态】${JSON.stringify(input.sessionStructure?.finalClassroomContext || null)}
【课堂事件历史】${JSON.stringify(input.sessionStructure?.classroomEventHistory || [])}
【阶段轨迹】${JSON.stringify(input.sessionStructure?.stageHistory || [])}
【结束原因】${input.sessionStructure?.endReason || '无'}
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

function buildConservativeEvaluation(input: SessionWrapupInput): SessionWrapupEvaluation {
  const turnCount = input.sessionEvidence?.turnCount || 0;
  const avgUnderstanding = typeof input.sessionEvidence?.avgUnderstanding === 'number'
    ? input.sessionEvidence.avgUnderstanding
    : 0.5;
  const avgEngagement = typeof input.sessionEvidence?.avgEngagement === 'number'
    ? input.sessionEvidence.avgEngagement
    : 0.5;
  const confusionCount = input.sessionEvidence?.topConfusionPoints?.length || 0;
  const progressRatio = input.knowledgePoints.length > 0
    ? input.knowledgePoints.reduce((sum, point) => sum + Math.max(0, Math.min(100, point.progress)), 0) / (input.knowledgePoints.length * 100)
    : 0.35;
  const masteredRatio = input.knowledgePoints.length > 0
    ? input.knowledgePoints.filter((point) => point.status === 'mastered').length / input.knowledgePoints.length
    : 0;

  const sessionKtl = Math.max(1, Math.min(10, Number(((progressRatio * 4.5) + (masteredRatio * 3) + (avgUnderstanding * 2.5)).toFixed(1))));
  const sessionLss = Math.max(1, Math.min(10, Number((((1 - avgUnderstanding) * 4.5) + (confusionCount * 1.2) + ((turnCount > 6 ? 1 : 0) * 1.5)).toFixed(1))));
  const sessionLf = Math.max(1, Math.min(10, Number((((1 - avgEngagement) * 5) + (turnCount > 8 ? 2 : turnCount > 5 ? 1 : 0)).toFixed(1))));

  return {
    sessionLss,
    sessionKtl,
    sessionLf,
    confidence: 0.2,
    reasoning: '证据不足，已基于本节对话轮数、理解度、投入度与知识点进展生成保守评分。',
  };
}

const SESSION_WRAPUP_FALLBACK_RUNTIME_CONTRACT = buildDefaultRuntimeContract('session-wrapup', 'distiller');

const sessionWrapupPromptSpec: PromptCallSpec<SessionWrapupInput, Record<string, unknown> | null> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: '',
  requireActivePrompt: true,
  caller: {
    agentId: 'learning-agent',
    skillId: 'session-wrapup',
  },
  buildUserPayload: (input) => buildWrapupUserPrompt(input, 'primary'),
  normalizeOutput: (parsed) => (parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null),
  validateParsedOutput: (parsed) => validateSessionWrapupParsedOutput(parsed),
  mapEnvelope: (output, _input, runtimeContract) => adaptToRuntimeEnvelope({
    contract: runtimeContract,
    artifact: output,
    phase: 'wrapup-generated',
    status: 'succeeded',
    isTerminal: false,
    nextAction: 'finalize-session',
    nextState: {
      stage: 'wrapup-generated',
      hasSummary: !!(output && typeof output === 'object' && (output as any).summary),
      hasEvaluation: !!(output && typeof output === 'object' && (output as any).evaluation),
    },
  }),
    retryStrategy: {
    maxAttempts: 2,
    onValidationFail: ({ failureReason }) => `请只输出完整的课后总结 JSON，必须同时包含符合规格的 summary 和 evaluation。上次失败原因：${failureReason}`,
  },
};

export function toWrapupArtifact(result: SessionWrapupResult, input: SessionWrapupInput): SessionWrapupArtifact {
  const hasReliableEvaluation = result.evaluationSource !== 'failed' && !!result.evaluation;
  return {
    status: hasReliableEvaluation ? 'complete' : 'summary-only',
    sources: {
      summary: result.summarySource,
      evaluation: result.evaluationSource,
    },
    summary: result.summary,
    evaluation: hasReliableEvaluation ? result.evaluation : null,
    progress: buildProgressSnapshot(input),
    evidence: buildEvidenceSnapshot(input),
  };
}

/**
 * 内部 canonical sidecar；公开扁平 wrapup DTO 仍由 coordinator 投影 result/artifact。
 * durable 写入仍由 Coordinator 负责，Phase 2 不在这里声明 ProposedTransition。
 */
export function toWrapupSkillOutcome(
  result: SessionWrapupResult,
  input: SessionWrapupInput
): SkillOutcome<SessionWrapupArtifact> {
  const artifact = toWrapupArtifact(result, input);
  const quality =
    result.summarySource === 'fallback' || result.evaluationSource === 'failed'
      ? result.summarySource === 'fallback' && result.evaluationSource === 'failed'
        ? 'fallback'
        : 'partial'
      : result.evaluationSource === 'ai-fallback'
        ? 'partial'
        : 'model';

  return buildSkillOutcome({
    skillId: AGENT_ID,
    artifact,
    quality,
    runtimeEnvelope: result.runtimeEnvelope || null,
    transition: null,
  });
}

export class SessionWrapupAgent {
  async generate(input: SessionWrapupInput): Promise<SessionWrapupResult> {
    const startTime = Date.now();
    let error: Error | null = null;
    let result: SessionWrapupResult | null = null;

    try {
      const caller: CallerInfo = { agentId: 'learning-agent', skillId: 'session-wrapup' };
      const promptResult = await callPrompt(sessionWrapupPromptSpec, input);

      // A failed raw-contract retry still retains the final extracted JSON in
      // debug. Keep the existing partial-model fallback behavior: a valid
      // summary or evaluation block must not be discarded just because its
      // sibling block remains invalid after the corrective retry.
      const parsed = promptResult.output
        || parseContent(promptResult.debug.extractedJson || promptResult.debug.rawModelOutput);
      const parsedSummary = parsed?.summary;
      const parsedEvaluation = parsed?.evaluation;

      const summary = isSummary(parsedSummary)
        ? parsedSummary
        : buildFallbackSummary(input);
      let evaluation = extractEvaluation(parsedEvaluation);
      let evaluationSource: 'model' | 'ai-fallback' | 'failed' = evaluation ? 'model' : 'failed';

      if (!evaluation) {
        evaluation = await this.generateEvaluationFallback(input, caller);
        evaluationSource = evaluation ? 'ai-fallback' : 'failed';
      }

      if (!evaluation) {
        evaluation = buildConservativeEvaluation(input);
        evaluationSource = 'failed';
      }

      result = {
        summary,
        evaluation,
        summarySource: isSummary(parsedSummary) ? 'model' : 'fallback',
        evaluationSource,
        runtimeEnvelope: promptResult.runtimeEnvelope || adaptToRuntimeEnvelope({
          contract: SESSION_WRAPUP_FALLBACK_RUNTIME_CONTRACT,
          artifact: { summary, evaluation },
          phase: evaluationSource === 'failed' ? 'wrapup-generated' : 'wrapup-generated',
          status: evaluationSource === 'failed' ? 'partial' : 'succeeded',
          isTerminal: false,
          nextAction: 'finalize-session',
          nextState: { stage: 'wrapup-generated', summarySource: isSummary(parsedSummary) ? 'model' : 'fallback', evaluationSource },
        }),
      };

      return result;
    } catch (e) {
      error = e instanceof Error ? e : new Error('Unknown error');
      logger.error('[SessionWrapupAgent] 生成失败', { error });
      const fallbackSummary = buildFallbackSummary(input);
      const fallbackEvaluation = buildConservativeEvaluation(input);
      result = {
        summary: fallbackSummary,
        evaluation: fallbackEvaluation,
        summarySource: 'fallback',
        evaluationSource: 'failed',
        runtimeEnvelope: adaptToRuntimeEnvelope({
          contract: SESSION_WRAPUP_FALLBACK_RUNTIME_CONTRACT,
          artifact: { summary: fallbackSummary, evaluation: fallbackEvaluation },
          phase: 'wrapup-generated',
          status: 'failed',
          isTerminal: false,
          nextAction: 'finalize-session',
          reason: error.message,
          nextState: { stage: 'wrapup-generated', summarySource: 'fallback', evaluationSource: 'failed' },
        }),
      };
      return result;
    } finally {
      const durationMs = Date.now() - startTime;
      logger.debug('[SessionWrapupAgent] 执行结束', {
        durationMs,
        success: result !== null && error === null,
        error: error?.message || null,
      });
    }
  }

  private async generateEvaluationFallback(
    input: SessionWrapupInput,
    caller: CallerInfo
  ): Promise<SessionWrapupEvaluation | null> {
    try {
      // 懒加载避免 skills/index -> session-wrapup -> skills/index 循环依赖
      const { executeSkill, auxSkillDefinitionMap } = await import('..');
      const output = await executeSkill(auxSkillDefinitionMap['session-evaluation-fallback'], {
        ...input,
        __fallback: null,
        __prompt: {
          requestPath: '/skills/session-wrapup/evaluation-fallback',
          callerAgentId: caller.agentId,
        },
      });
      return output ? (extractEvaluation(output) as SessionWrapupEvaluation) : null;
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

    const artifact = toWrapupArtifact(result, input);
    const skillOutcome = toWrapupSkillOutcome(result, input);

    return {
      success: true,
      userVisible: result.summary.topicSummary,
      runtimeEnvelope: result.runtimeEnvelope,
      internal: {
        core: {
          stage: 'wrapup-completed',
          confidence: result.evaluation?.confidence || 0.6,
          isCompleted: true,
        },
        ext: {
          sessionWrapup: {
            result,
            artifact,
            // 内部协议 sidecar；coordinator 继续读 result/artifact，公开 DTO 不变
            skillOutcome,
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
        agentName: '课后产出 Skill',
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
        agentName: '课后产出 Skill',
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
