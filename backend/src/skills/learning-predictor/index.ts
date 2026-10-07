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
      fatigueSignal: { type: 'string', description: '疲劳/状态信号（low|medium|high）' },
      taskContext: { type: 'object', description: '目标任务：title/knowledgeType/learningObjectives' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      stallRisk: { type: 'number', description: '卡壳风险 0-1' },
      predictedTone: { type: 'string', description: '机器判定枚举 smooth|struggle|fatigue（由原始自由描述收敛/推断而来）' },
      toneDetail: { type: 'string', description: '模型原始 predictedTone 自由描述（枚举仅作机器判定，原文透传给教学层）' },
      suggestedDepth: { type: 'string', description: '机器判定枚举 shallow|standard|deep（由原始自由描述收敛/推断而来）' },
      depthDetail: { type: 'string', description: '模型原始 suggestedDepth 自由描述（原文透传给教学层）' },
      focusConcepts: { type: 'array', description: '建议聚焦概念（≤3）' },
      rationale: { type: 'string', description: '一句话预测依据' }
    }
  },
  capabilities: ['learning-prediction', 'calibration-feedback'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface LearningPredictorInput {
  knowledgeStateSummary?: string;
  fatigueSignal?: 'low' | 'medium' | 'high';
  taskContext?: {
    title?: string;
    knowledgeType?: string;
    learningObjectives?: string[];
  };
}

export interface LearningPredictorOutput {
  stallRisk: number;
  /** 机器判定枚举（由原始自由描述收敛/推断而来，供下游阈值判定） */
  predictedTone: 'smooth' | 'struggle' | 'fatigue';
  /** 模型原始 predictedTone 自由描述（枚举仅作机器判定；原文透传给教学层，P1-13）。
   *  可选：DB 复用路径（TeachingContextBuilder 从 prediction_records 重建）无此列。 */
  toneDetail?: string | null;
  suggestedDepth: 'shallow' | 'standard' | 'deep';
  /** 模型原始 suggestedDepth 自由描述（原文透传给教学层，P1-13）。可选同 toneDetail。 */
  depthDetail?: string | null;
  focusConcepts: string[];
  rationale: string;
}

function clamp(value: unknown, fallback: number): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
}

/**
 * 自由描述 → 机器判定枚举的语义推断（P1-13）。
 *
 * 提示词鼓励模型给自由描述（如「预计在材料/工具栏位区分环节反复卡壳，其余部分较顺畅」），
 * 旧实现 `pick()` 只认严格枚举，非枚举值静默落兜底 'smooth'——把「反复卡壳」这类调速信号
 * 在进入开场策略前就抹平（DB：最近 100 条 98 条为自由描述）。此处按关键词推断枚举，
 * 让信号进入机器判定；原文另存 toneDetail 透传给教学层。
 *
 * 优先级：疲劳 > 吃力/卡壳 > 顺畅（混合描述取非乐观侧，避免「其余部分较顺畅」盖住主卡点）。
 */
const STRUGGLE_NEGATION = /无障碍|无困难|无问题|无卡壳|没什么(?:困难|障碍|问题|卡壳)|不(?:太)?(?:困难|卡壳|卡住|吃力|费劲|费力|受阻|挣扎|慢|难)|不会(?:卡壳|卡住|受阻)|不容易(?:卡壳|卡住|受阻)|没(?:有)?(?:困难|障碍|问题|卡壳|卡住)/g;

export function inferToneEnum(value: unknown): 'smooth' | 'struggle' | 'fatigue' | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'smooth' || lower === 'struggle' || lower === 'fatigue') return lower as 'smooth' | 'struggle' | 'fatigue';
  // 疲劳（最优先）：精力/状态类信号
  if (/疲劳|疲惫|疲倦|乏力|精力不足|精力差|状态不佳|状态差|睡眠不足|熬夜|困乏/.test(text)) return 'fatigue';
  // 吃力/卡壳：主卡点信号（含「反复卡壳/反复出错/受阻/放慢/偏难」）。
  // 先剥离「否定式轻松表达」（无障碍/不困难/没卡壳…），否则 struggle 分支会先命中「障碍/困难」，
  // 把明确的顺畅语义误判成吃力（复核反例：无障碍→struggle、不困难→struggle）。
  const stripped = text.replace(STRUGGLE_NEGATION, '');
  if (/卡壳|卡住|吃力|费劲|困难|受阻|挣扎|不畅|不顺|挫败|瓶颈|障碍|放慢|放缓|反复出错|偏难|太难|很难|有点难|较难|难度高/.test(stripped)) {
    return 'struggle';
  }
  // 顺畅：无未否定的卡点信号时才认（混合描述已被上面截获）
  if (/顺畅|顺利|流畅|轻松|无障碍|良好|不困难|不卡壳|不容易(?:卡壳|卡住|受阻)|没问题|没什么(?:困难|障碍|问题|卡壳)|偏简单|较简单|太简单/.test(text)) return 'smooth';
  return null;
}

/** 自由描述 → 深度枚举的语义推断（P1-13）：deep/shallow 关键词，未命中回落中性 'standard'。 */
export function inferDepthEnum(value: unknown): 'shallow' | 'standard' | 'deep' | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === 'shallow' || lower === 'standard' || lower === 'deep') return lower as 'shallow' | 'standard' | 'deep';
  if (/深挖|深入|原理|对比练习|系统讲|彻底|细节|推导|为什么|难度高|偏难/.test(text)) return 'deep';
  if (/轻量|简单|带过|基础复习|快速|略讲|浅|入门|复习即可/.test(text)) return 'shallow';
  if (/常规|标准|适中|正常/.test(text)) return 'standard';
  return null;
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
    // 稳定键前置：payload-stability 声明 fatigueSignal/knowledgeStateSummary 稳定、taskContext 后置。
    // 旧实现直接透传调用方键序，调用方只传 taskContext（或键序不同）时首键漂移，
    // 打乱可缓存前缀并触发 prompts:payload-prefix:check:strict 违规。此处统一收敛为声明顺序并补默认值。
    buildUserPayload: (payload) => {
      const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const ordered: Record<string, unknown> = {
        fatigueSignal: typeof p.fatigueSignal === 'string' && p.fatigueSignal ? p.fatigueSignal : 'low',
        knowledgeStateSummary:
          typeof p.knowledgeStateSummary === 'string' && p.knowledgeStateSummary.trim()
            ? p.knowledgeStateSummary
            : '无历史摘要',
      };
      if (p.taskContext && typeof p.taskContext === 'object') ordered.taskContext = p.taskContext;
      // 保留声明外的额外键（不丢信息），置于稳定段之后
      for (const key of Object.keys(p)) {
        if (!(key in ordered)) ordered[key] = p[key];
      }
      return ordered;
    },
    normalizeOutput: (parsed) => {
      const obj = parsed && typeof parsed === 'object' ? parsed : {};
      const stallRisk = clamp(obj.stallRisk, 0.5);

      // P1-13：枚举仅作机器判定，模型自由描述原文透传为 toneDetail/depthDetail。
      // 旧实现 pick() 严格枚举过滤 → 98/100 条自由描述被静默抹成兜底 'smooth'，
      // 「反复卡壳」类调速信号在下发前丢失（teaching-turn 只读 normalized 值）。
      const rawTone = typeof obj.predictedTone === 'string' ? obj.predictedTone.trim() : '';
      const rawDepth = typeof obj.suggestedDepth === 'string' ? obj.suggestedDepth.trim() : '';
      const explicitToneDetail = typeof obj.toneDetail === 'string' ? obj.toneDetail.trim() : '';
      const explicitDepthDetail = typeof obj.depthDetail === 'string' ? obj.depthDetail.trim() : '';
      const TONES = ['smooth', 'struggle', 'fatigue'] as const;
      const DEPTHS = ['shallow', 'standard', 'deep'] as const;

      const toneExact = TONES.includes(rawTone as (typeof TONES)[number])
        ? (rawTone as (typeof TONES)[number])
        : null;
      // 新契约把自由描述放 toneDetail；兼容旧契约时才从 predictedTone 读取自由文本。
      const toneText = explicitToneDetail || rawTone;
      const toneInferred = inferToneEnum(toneText);
      // 语义可分类 → 用推断枚举（「反复卡壳」不再落 smooth）；纯无法分类/缺失 → 保持历史兜底 smooth，
      // 但原文经 toneDetail 透传（不再静默抹掉）。显式 smooth 与 detail 的负向语义冲突时取非乐观侧。
      const tone: (typeof TONES)[number] =
        toneExact === 'smooth' && (toneInferred === 'struggle' || toneInferred === 'fatigue')
          ? toneInferred
          : toneExact ?? toneInferred ?? 'smooth';

      const depthExact = DEPTHS.includes(rawDepth as (typeof DEPTHS)[number])
        ? (rawDepth as (typeof DEPTHS)[number])
        : null;
      const depth: (typeof DEPTHS)[number] = depthExact ?? inferDepthEnum(explicitDepthDetail || rawDepth) ?? 'standard';

      // 新契约字段优先；旧契约的自由文本仍兼容透传，枚举 token 不重复占位。
      const toneDetail = explicitToneDetail || (rawTone && !toneExact ? rawTone : null);
      const depthDetail = explicitDepthDetail || (rawDepth && !depthExact ? rawDepth : null);

      // 自洽约束：高风险不应是顺畅基调
      const finalTone = stallRisk >= 0.7 && tone === 'smooth' ? 'struggle' : tone;
      return {
        stallRisk,
        predictedTone: finalTone,
        toneDetail,
        suggestedDepth: depth,
        depthDetail,
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
