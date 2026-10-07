import { CallerInfo } from '../../gateway/api-gateway';
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { buildDefaultRuntimeContract } from '../../services/prompt-lab/runtime-contract';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { PromptCallSpec } from '../../composers/types';
import { logger } from '../../utils/logger';
import type { AgentDefinition, AgentOutput } from '../../agents/protocol';
import { buildSkillOutcome, type SkillOutcome } from '../outcome';
import {
  isSessionEvaluationTier,
  sessionEvaluationTierToValue,
  SESSION_EVALUATION_ZERO_EVIDENCE,
  type SessionEvaluationTier,
} from '../../services/learning/session-evaluation-scale';

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
    /**
     * FSRS 记忆保持率提示（P1-10 断链修复）：编排层 `loadRetrievabilityHints`
     * （teaching-session-lifecycle.ts:1137）产出、随 `knowledgeContext` 注入；
     * 每项 { concept, retrievability 0-1 }，仅含 <0.8 的即将遗忘点（≤5 条）。
     * 缺失/空 = 无数据：模型不得提及记忆保持率（yaml 规则 9），输出侧另有确定性校验兜底。
     */
    reviewHints?: Array<{ concept: string; retrievability: number }>;
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
  /**
   * LLM 判定的档位（2026-09-22 起 LLM 输出档位而非 0-10 数值）。
   * legacy 数值输出时为 undefined。档位→数值的唯一映射见 session-evaluation-scale。
   */
  metricTiers?: {
    sessionKtl?: SessionEvaluationTier;
    sessionLss?: SessionEvaluationTier;
    sessionLf?: SessionEvaluationTier;
  };
  /** 每项档位判定引用的证据句（若有） */
  metricEvidence?: {
    sessionKtl?: string;
    sessionLss?: string;
    sessionLf?: string;
  };
}

export interface SessionWrapupResult {
  summary: SessionWrapupSummary;
  evaluation: SessionWrapupEvaluation | null;
  summarySource: 'model' | 'fallback';
  /**
   * evaluation 来源：
   * - 'model'：主 prompt 产出
   * - 'ai-fallback'：仅存量数据可能携带（2026-08-11 起不再产出）
   * - 'unavailable'：evaluation 缺失（纯重试+明确失败：不补全、不保守评分，evaluation=null）
   * - 'failed'：历史/兜底路径标记
   */
  evaluationSource: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
  runtimeEnvelope?: ReturnType<typeof adaptToRuntimeEnvelope>;
}

export interface SessionWrapupArtifact {
  status: 'complete' | 'summary-only';
  sources: {
    summary: 'model' | 'fallback';
    evaluation: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
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

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const SESSION_WRAPUP_PROMPT = loadPromptFile(AGENT_ID)?.systemPrompt || '';

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

/**
 * P1-11 输出保真：输入未提供 reviewHints 时的「保持率 / 记得几成 + 数值」话术检测。
 *
 * 实证违规样本（pcl_b863d7d9，2026-09-23，success=1）：
 *   summary.metricInterpretation.longTerm = 「学生长期记忆保持率良好（lsb 4.6）…」
 * ——把 learningState 的内部字段（lsb，0-10）包装成"长期记忆保持率"渲染给真学生，
 * 同时违反 yaml 规则 9（无数据不得提及）/ 规则 10（不得复述内部字段名）/ 规则 21（不得编造数值）。
 * 合规样本（pcl_ca05e333）：明确声明"本次输入未提供长期记忆保持率的数值，因此不引用具体百分比"——
 * 无带数值的断言，本检测**不得**误伤该类声明（不命中）。
 *
 * 触发条件 = 同一小句内「保持率/记忆保持/记得N成/记得N% 话术」+「数值」并存。
 * 以逗号级小句为最小单位（而非整句）：违规的量化断言与其后的合理建议常同句，
 * 小句粒度既能命中又能只剥离违规部分。
 */
const RETENTION_CLAIM_RE = /保持率|记忆保持|(?:记得|记住)[^，,；;。！？\n]{0,6}(?:[0-9零一二三四五六七八九十两]+\s*成|[0-9]+\s*%|百分之[0-9零一二三四五六七八九十百两]+)/;
const NUMERIC_VALUE_RE = /[0-9]|[零一二三四五六七八九十百两]+成|百分之/;

/** 无 reviewHints 时，被整段剥离字段的确定性替代文案（本身不含保持率话术与数值） */
const RETENTION_FREE_NEUTRAL_TEXT = '本节未提供长期记忆相关数据，此处不引用具体数值。';

/** 是否具备可引用的记忆保持率输入（空数组/缺失 = 无数据） */
export function hasReviewHints(input: SessionWrapupInput | undefined | null): boolean {
  const hints = input?.knowledgeContext?.reviewHints;
  return Array.isArray(hints) && hints.length > 0;
}

/** 按小句切分（保留分隔符），用于逐小句判定与剥离 */
function splitClauses(text: string): string[] {
  return String(text).match(/[^，,、；;。！？\n]*[，,、；;。！？\n]?/g)?.filter((part) => part !== '') || [];
}

function isUnsupportedRetentionClaim(clause: string): boolean {
  return RETENTION_CLAIM_RE.test(clause) && NUMERIC_VALUE_RE.test(clause);
}

/** summary 内所有学生可见文本（P1-11 检测面；不含内部字段 evaluation） */
function collectSummaryTexts(summary: unknown): string[] {
  const record = (summary || {}) as Record<string, unknown>;
  const texts: string[] = [];
  const pushText = (value: unknown) => {
    if (typeof value === 'string') texts.push(value);
  };
  pushText(record.topicSummary);
  pushText(record.knowledgeSummary);
  pushText(record.practiceAdvice);
  pushText(record.learningEvaluation);
  if (Array.isArray(record.keyTakeaways)) (record.keyTakeaways as unknown[]).forEach(pushText);
  if (Array.isArray(record.actionPlan)) (record.actionPlan as unknown[]).forEach(pushText);
  const highlights = record.evaluationHighlights as Record<string, unknown> | undefined;
  if (Array.isArray(highlights?.strengths)) (highlights?.strengths as unknown[]).forEach(pushText);
  if (Array.isArray(highlights?.improvements)) (highlights?.improvements as unknown[]).forEach(pushText);
  const metric = record.metricInterpretation as Record<string, unknown> | undefined;
  pushText(metric?.session);
  pushText(metric?.longTerm);
  if (Array.isArray(record.knowledgeItems)) {
    (record.knowledgeItems as Array<Record<string, unknown>>).forEach((item) => pushText(item?.evidence));
  }
  return texts;
}

/** 找出无数据支撑的保持率数值断言（返回命中句，供校验失败原因/日志引用） */
export function findUnsupportedRetentionClaims(summary: unknown, hasHints: boolean): string[] {
  if (hasHints) return [];
  const hits: string[] = [];
  for (const text of collectSummaryTexts(summary)) {
    for (const clause of splitClauses(text)) {
      const trimmed = clause.trim();
      if (trimmed && isUnsupportedRetentionClaim(trimmed)) hits.push(trimmed);
    }
  }
  return hits;
}

/**
 * 确定性剥离（corrective retry 失效后的兜底）：把无数据支撑的保持率断言按小句移除，
 * 不重写语义；整字段被清空时补一句中性文案。返回新的 summary（浅拷贝），入参不被修改。
 */
export function stripUnsupportedRetentionClaims(
  summary: SessionWrapupSummary,
  hasHints: boolean,
): { summary: SessionWrapupSummary; removed: string[] } {
  const removed: string[] = [];
  if (hasHints) return { summary, removed };
  // emptyFallback：整段被清空时的替代——长文本字段补中性文案；数组项留空（调用方丢弃该项，
  // 避免 actionPlan/keyTakeaways 里剩一条无信息量的占位句）
  const clean = (text: string, emptyFallback: string): string => {
    const kept = splitClauses(text).filter((clause) => {
      const trimmed = clause.trim();
      if (!trimmed) return false;
      const hit = isUnsupportedRetentionClaim(trimmed);
      if (hit) removed.push(trimmed);
      return !hit;
    });
    const joined = kept.join('').replace(/^[，,、；;\s]+/, '').trim();
    if (joined) return joined;
    return String(text).trim() ? emptyFallback : text;
  };
  const cleanArray = (items: string[]): string[] =>
    items
      .map((item) => clean(String(item), ''))
      .filter((item) => item.trim() !== '');

  const metric = summary.metricInterpretation;
  return {
    summary: {
      ...summary,
      topicSummary: clean(summary.topicSummary, RETENTION_FREE_NEUTRAL_TEXT),
      knowledgeSummary: clean(summary.knowledgeSummary, RETENTION_FREE_NEUTRAL_TEXT),
      practiceAdvice: clean(summary.practiceAdvice, RETENTION_FREE_NEUTRAL_TEXT),
      learningEvaluation: clean(summary.learningEvaluation, RETENTION_FREE_NEUTRAL_TEXT),
      keyTakeaways: cleanArray(summary.keyTakeaways),
      actionPlan: cleanArray(summary.actionPlan),
      evaluationHighlights: {
        strengths: cleanArray(summary.evaluationHighlights.strengths),
        improvements: cleanArray(summary.evaluationHighlights.improvements),
      },
      knowledgeItems: summary.knowledgeItems.map((item) => ({
        ...item,
        evidence: clean(item.evidence, RETENTION_FREE_NEUTRAL_TEXT),
      })),
      metricInterpretation: {
        session: clean(metric.session, RETENTION_FREE_NEUTRAL_TEXT),
        longTerm: clean(metric.longTerm, RETENTION_FREE_NEUTRAL_TEXT),
      },
    },
    removed,
  };
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

/**
 * 解析单个评估指标。为兼容历史数据与新旧输出，支持三种形态：
 * - 档位对象：{ "tier": "low|mid|high", "evidence": "…" }（2026-09-22 起的主形态）
 * - 档位字符串："low" | "mid" | "high"
 * - legacy 数值：0-10
 * 未能识别返回 undefined。档位→数值映射统一走 session-evaluation-scale（唯一来源）。
 */
function readEvaluationMetric(
  value: unknown,
): { value: number; tier?: SessionEvaluationTier; evidence?: string } | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (isSessionEvaluationTier(record.tier)) {
      return {
        value: sessionEvaluationTierToValue(record.tier),
        tier: record.tier,
        evidence: typeof record.evidence === 'string' && record.evidence.trim()
          ? record.evidence.trim()
          : undefined,
      };
    }
    const numeric = requireNumber(record.tier, 0, 10);
    if (numeric !== null) return { value: numeric };
    return undefined;
  }
  if (isSessionEvaluationTier(value)) {
    return { value: sessionEvaluationTierToValue(value), tier: value };
  }
  const numeric = requireNumber(value, 0, 10);
  return numeric !== null ? { value: numeric } : undefined;
}

function extractEvaluation(value: unknown): SessionWrapupEvaluation | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const sessionLss = readEvaluationMetric(record.sessionLss);
  const sessionKtl = readEvaluationMetric(record.sessionKtl);
  const sessionLf = readEvaluationMetric(record.sessionLf);
  const confidence = requireNumber(record.confidence, 0, 1);
  const reasoning = requireReasoning(record.reasoning);

  if (
    !sessionLss ||
    !sessionKtl ||
    !sessionLf ||
    confidence === null ||
    reasoning === null
  ) {
    return null;
  }

  const metricTiers = {
    ...(sessionKtl.tier ? { sessionKtl: sessionKtl.tier } : {}),
    ...(sessionLss.tier ? { sessionLss: sessionLss.tier } : {}),
    ...(sessionLf.tier ? { sessionLf: sessionLf.tier } : {}),
  };
  const metricEvidence = {
    ...(sessionKtl.evidence ? { sessionKtl: sessionKtl.evidence } : {}),
    ...(sessionLss.evidence ? { sessionLss: sessionLss.evidence } : {}),
    ...(sessionLf.evidence ? { sessionLf: sessionLf.evidence } : {}),
  };

  return {
    sessionLss: sessionLss.value,
    sessionKtl: sessionKtl.value,
    sessionLf: sessionLf.value,
    confidence,
    reasoning,
    ...(Object.keys(metricTiers).length > 0 ? { metricTiers } : {}),
    ...(Object.keys(metricEvidence).length > 0 ? { metricEvidence } : {}),
  };
}

/**
 * 零证据分支（确定式）：输入缺少会话消息（<2 条）、知识看板为空或回合数 < 1
 * 时视为"会话未产生可评估内容"。与 prompts/core/session-wrapup.yaml 规则一致，
 * 三项固定取 3、confidence 0.1 —— 由代码保证，不依赖 LLM 是否遵守提示词。
 */
export function isZeroEvidenceSessionInput(input: SessionWrapupInput): boolean {
  const messageCount = Array.isArray(input.messages) ? input.messages.length : 0;
  if (messageCount < 2) return true;
  const knowledgeCount = Array.isArray(input.knowledgePoints) ? input.knowledgePoints.length : 0;
  if (knowledgeCount === 0) return true;
  const turnCount = input.sessionEvidence?.turnCount ?? 0;
  return turnCount < 1;
}

/**
 * The primary prompt promises both blocks. Validate that raw contract before
 * normalization so malformed model output gets one corrective retry instead
 * of silently bypassing the model result and falling back immediately.
 *
 * P1-11 追加确定性校验：输入无 reviewHints 时，summary 不得出现
 * 「保持率/记得几成 + 数值」话术（编造量化记忆状态）→ 触发 corrective retry。
 * `input` 省略时跳过该检查（保持既有单参调用点/历史测试行为不变）。
 */
export function validateSessionWrapupParsedOutput(parsed: unknown, input?: SessionWrapupInput) {
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

  if (input) {
    const unsupported = findUnsupportedRetentionClaims(record.summary, hasReviewHints(input));
    if (unsupported.length > 0) {
      return {
        valid: false as const,
        failureReason:
          'SESSION_WRAPUP_UNSUPPORTED_RETENTION_CLAIM: 输入未提供记忆保持率（reviewHints），'
          + `summary 不得出现带数值的保持率/记得成数表述，请删除后重写。命中：${unsupported.slice(0, 3).join(' ｜ ')}`,
      };
    }
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
【记忆保持率提示】${JSON.stringify(input.knowledgeContext?.reviewHints || null)}
【课堂证据】${JSON.stringify(input.sessionEvidence || null)}
【最近对话片段】${transcript}

只输出 evaluation 对象，严格 JSON，不要输出 summary，不要输出解释性前后文。示例：
{
  "sessionKtl": { "tier": "mid", "evidence": "引导下完成了核心任务，但对概念的表述仍不稳定" },
  "sessionLss": { "tier": "low", "evidence": "全场无明显阻塞，节奏顺畅" },
  "sessionLf": { "tier": "high", "evidence": "后段出现重复、投入下降" },
  "confidence": 0.78,
  "reasoning": "一句简短的证据化说明"
}
tier 只能取 low | mid | high（档位定义见 system prompt 的评分参考），不要输出 0-10 数字。`;

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
【记忆保持率提示】${JSON.stringify(input.knowledgeContext?.reviewHints || null)}
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

const SESSION_WRAPUP_FALLBACK_RUNTIME_CONTRACT = buildDefaultRuntimeContract('session-wrapup', 'distiller');

const sessionWrapupPromptSpec: PromptCallSpec<SessionWrapupInput, Record<string, unknown> | null> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: SESSION_WRAPUP_PROMPT,
  requireActivePrompt: true,
  caller: {
    agentId: 'teaching-agent',
    skillId: 'session-wrapup',
  },
  buildUserPayload: (input) => buildWrapupUserPrompt(input, 'primary'),
  normalizeOutput: (parsed) => (parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null),
  validateParsedOutput: (parsed, input) => validateSessionWrapupParsedOutput(parsed, input),
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
    onValidationFail: ({ failureReason }) => failureReason.startsWith('SESSION_WRAPUP_UNSUPPORTED_RETENTION_CLAIM')
      // P1-11 纠偏语：只改这一件事，避免模型把 summary/evaluation 整体重写跑偏
      ? '本次输入未提供记忆保持率数据（reviewHints 为空/缺失），summary 中不得出现"保持率""记得几成/记得百分之几"这类带数值的记忆断言（含 metricInterpretation）。请仅删除该类表述，重新输出完整 JSON（同时包含符合规格的 summary 与 evaluation）。'
      : `请只输出完整的课后总结 JSON，必须同时包含符合规格的 summary 和 evaluation。上次失败原因：${failureReason}`,
  },
};

export function toWrapupArtifact(result: SessionWrapupResult, input: SessionWrapupInput): SessionWrapupArtifact {
  const hasReliableEvaluation =
    (result.evaluationSource === 'model' || result.evaluationSource === 'ai-fallback') && !!result.evaluation;
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
  const evaluationFailed = result.evaluationSource === 'failed' || result.evaluationSource === 'unavailable';
  const quality =
    result.summarySource === 'fallback' || evaluationFailed
      ? result.summarySource === 'fallback' && evaluationFailed
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
      const promptResult = await callPrompt(sessionWrapupPromptSpec, input);

      // A failed raw-contract retry still retains the final extracted JSON in
      // debug. Keep the existing partial-model fallback behavior: a valid
      // summary or evaluation block must not be discarded just because its
      // sibling block remains invalid after the corrective retry.
      const parsed = promptResult.output
        || parseContent(promptResult.debug.extractedJson || promptResult.debug.rawModelOutput);
      const parsedSummary = parsed?.summary;
      const parsedEvaluation = parsed?.evaluation;

      const rawSummary = isSummary(parsedSummary)
        ? parsedSummary
        : buildFallbackSummary(input);
      // P1-11 确定性剥离兜底：corrective retry 用尽后仍带无数据支撑的保持率断言时，
      // 按小句剥离（不落回 fallback，尽量保住其余内容），保证"编造量化记忆状态"不渲染给学生。
      let summary = rawSummary;
      if (!hasReviewHints(input)) {
        const stripped = stripUnsupportedRetentionClaims(rawSummary, false);
        if (stripped.removed.length > 0) {
          summary = stripped.summary;
          logger.warn('[SessionWrapupAgent] 剥离无数据支撑的记忆保持率断言（P1-11 输出保真）', {
            removedCount: stripped.removed.length,
            samples: stripped.removed.slice(0, 3),
          });
        }
      }
      // 纯重试+明确失败：主 prompt 重试后仍缺 evaluation → 不补全、不保守评分，
      // 直接 evaluation=null + evaluationSource='unavailable'（下游全链 null 容忍，与 M1 兜底同形态）。
      const parsedEvaluationResult = extractEvaluation(parsedEvaluation);
      // 零证据兜底保持确定式：LLM 有回应时，无论其自由发挥成什么值，都覆盖为固定保守值
      // （三项 3 / confidence 0.1），与 prompt 规则同源但由代码保证，不靠模型依从。
      const evaluation: SessionWrapupEvaluation | null = parsedEvaluationResult
        ? (isZeroEvidenceSessionInput(input)
            ? {
                sessionLss: SESSION_EVALUATION_ZERO_EVIDENCE.lss,
                sessionKtl: SESSION_EVALUATION_ZERO_EVIDENCE.ktl,
                sessionLf: SESSION_EVALUATION_ZERO_EVIDENCE.lf,
                confidence: SESSION_EVALUATION_ZERO_EVIDENCE.confidence,
                reasoning: SESSION_EVALUATION_ZERO_EVIDENCE.reasoning,
              }
            : parsedEvaluationResult)
        : null;
      const evaluationSource: SessionWrapupResult['evaluationSource'] = evaluation ? 'model' : 'unavailable';

      result = {
        summary,
        evaluation,
        summarySource: isSummary(parsedSummary) ? 'model' : 'fallback',
        evaluationSource,
        runtimeEnvelope: promptResult.runtimeEnvelope || adaptToRuntimeEnvelope({
          contract: SESSION_WRAPUP_FALLBACK_RUNTIME_CONTRACT,
          artifact: { summary, evaluation },
          phase: 'wrapup-generated',
          status: evaluationSource === 'unavailable' ? 'partial' : 'succeeded',
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
      result = {
        summary: fallbackSummary,
        evaluation: null,
        summarySource: 'fallback',
        evaluationSource: 'unavailable',
        runtimeEnvelope: adaptToRuntimeEnvelope({
          contract: SESSION_WRAPUP_FALLBACK_RUNTIME_CONTRACT,
          artifact: { summary: fallbackSummary, evaluation: null },
          phase: 'wrapup-generated',
          status: 'failed',
          isTerminal: false,
          nextAction: 'finalize-session',
          reason: error.message,
          nextState: { stage: 'wrapup-generated', summarySource: 'fallback', evaluationSource: 'unavailable' },
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
