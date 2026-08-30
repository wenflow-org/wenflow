/**
 * Learning Predictor Skill
 *
 * 任务开始前的学习表现预测（CIKT/LBM 思路的轻量落地）：
 * 输入最近一次知识状态摘要 + 概念台账 + 疲劳信号 + 目标任务，输出卡壳风险与建议教学深度。
 * 输出会被 prediction_records 表记录，任务完成后与真实结果对照，形成「实证置信度」校准闭环。
 */
import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const LEARNING_PREDICTOR_PROMPT = loadPromptFile('skill:learning-predictor')?.systemPrompt || '';

export const learningPredictorDefinition: SkillDefinition = {
  name: 'learning-predictor',
  displayName: '学习表现预测器',
  version: '1.0.0',
  category: 'analysis',
  description: '任务开始前：基于知识状态摘要与台账预测卡壳风险、学习基调与建议深度，供校准闭环验证。',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      knowledgeStateSummary: { type: 'string', description: '最近一次知识状态摘要（lesson-knowledge-enricher 产出）' },
      conceptLedger: { type: 'array', description: '概念台账（已掌握/脆弱概念）' },
      recentConfusions: { type: 'array', description: '最近反复混淆' },
      fatigueSignal: { type: 'string', description: '疲劳/状态信号（low|medium|high）' },
      taskContext: { type: 'object', description: '目标任务：title/knowledgeType/learningObjectives' },
      historySummary: { type: 'string', description: '历史表现摘要（可选）' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      stallRisk: { type: 'number', description: '卡壳风险 0-1' },
      predictedTone: { type: 'string', description: 'smooth|struggle|fatigue' },
      suggestedDepth: { type: 'string', description: 'shallow|standard|deep' },
      focusConcepts: { type: 'array', description: '建议聚焦概念（≤3）' },
      rationale: { type: 'string', description: '一句话预测依据' }
    }
  },
  capabilities: ['learning-prediction', 'calibration-feedback'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface LearningPredictorInput {
  knowledgeStateSummary?: string;
  conceptLedger?: Array<Record<string, unknown>>;
  recentConfusions?: Array<Record<string, unknown>>;
  fatigueSignal?: 'low' | 'medium' | 'high';
  taskContext?: {
    title?: string;
    knowledgeType?: string;
    learningObjectives?: string[];
  };
  historySummary?: string;
}

export interface LearningPredictorOutput {
  stallRisk: number;
  predictedTone: 'smooth' | 'struggle' | 'fatigue';
  suggestedDepth: 'shallow' | 'standard' | 'deep';
  focusConcepts: string[];
  rationale: string;
}

function clamp(value: unknown, fallback: number): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export async function learningPredictor(
  input: LearningPredictorInput
): Promise<SkillExecutionResult<LearningPredictorOutput>> {
  const startTime = Date.now();
  const result = await callPrompt<LearningPredictorInput, LearningPredictorOutput>({
    agentId: 'skill:learning-predictor',
    defaultSystemPrompt: LEARNING_PREDICTOR_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'learning-predictor' },
    buildUserPayload: (payload) => payload,
    normalizeOutput: (parsed) => {
      const obj = parsed && typeof parsed === 'object' ? parsed : {};
      const stallRisk = clamp(obj.stallRisk, 0.5);
      const tone = pick(obj.predictedTone, ['smooth', 'struggle', 'fatigue'], 'smooth');
      const depth = pick(obj.suggestedDepth, ['shallow', 'standard', 'deep'], 'standard');
      // 自洽约束：高风险不应是顺畅基调
      const finalTone = stallRisk >= 0.7 && tone === 'smooth' ? 'struggle' : tone;
      return {
        stallRisk,
        predictedTone: finalTone,
        suggestedDepth: depth,
        focusConcepts: Array.isArray(obj.focusConcepts)
          ? obj.focusConcepts.map((c: unknown) => String(c || '').trim()).filter(Boolean).slice(0, 3)
          : [],
        rationale: typeof obj.rationale === 'string' ? obj.rationale.trim() : '',
      };
    },
    validateParsedOutput: (parsed) =>
      parsed && typeof parsed === 'object'
        ? { valid: true }
        : { valid: false, failureReason: 'LEARNING_PREDICTOR_OUTPUT_NOT_OBJECT' },
    // 2026-08-30：解析/校验失败时带上一轮 rawOutput 重试一次（此前 maxAttempts 默认 1，
    // 模型输出带围栏/解释文本时整单失败，见当日 24 次 INVALID_JSON 日志）
    retryStrategy: {
      maxAttempts: 2,
      onValidationFail: ({ failureReason }) =>
        `上一次输出的 JSON 解析失败（${failureReason}）。请只输出一个合法的 JSON 对象，不要包含 markdown 代码块、解释文字或其他文本。`,
    },
  }, input);

  if (!result.success || !result.output) {
    throw new Error(result.error?.message || 'LEARNING_PREDICTOR_FAILED');
  }

  return {
    success: true,
    output: result.output,
    duration: Date.now() - startTime,
    quality: 'model',
  };
}

export default learningPredictor;
