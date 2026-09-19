/**
 * 非能力问题的「分诊 + 负向出口」纯函数模块（无 DB / 无 LLM / 无副作用）。
 *
 * 背景（基准实测）：14 条固定语料里 50–57% 被判「不该只产出学习路径」，
 * 但流水线 100% 产路径。本模块依据 L1 已有的阻塞类型标注做确定性分诊，
 * 供 goal→path 链路在生成提议时决定「学习路径 / 组合 / 情绪支持 / 转介」。
 *
 * ── primaryBlockType 合法取值（源头：prompts/core/virtual-learner-scenario-designer.yaml）──
 *   capability          ＝ 存在可迁移的概念/技能缺口，需"建认知结构 + 多步练习"
 *   oneoff_operation    ＝ 一次性具体操作/工具用法，学会点哪里即可
 *   environment_tooling ＝ 设备/软件/网络/配置/环境阻塞，修好系统即可
 *   permission_process  ＝ 账号/权限/审批/流程/交接/他人配合阻塞
 *   emotion_relationship＝ 情绪调节/恐惧/面子/焦虑/人际冲突是主要阻塞
 *
 * ── 规则表（确定性、可解释；缺字段一律容忍）──
 *  1. primaryBlockType 缺失/非法/未知 → learning_path，confidence=low，reasons 记「缺少阻塞类型标注」。
 *  2. capability → learning_path；有 recurrence=recurring 或 blockTypeEvidence → high，否则 medium。
 *  3. emotion_relationship → 默认 emotional_support；
 *     若 blockTypeEvidence 非空且命中"具体技能"词 → combination（情绪 × 技能缺口）。
 *  4. environment_tooling / permission_process → 默认 referral（现实条件/资源/流程）；
 *     evidence / real_problem / pain_points 命中"具体技能/可学习成分" → combination。
 *  5. oneoff_operation → combination（一次性操作含少量可学习成分）。
 *  6. urgency 极高且 constraints_and_boundaries 非空 → confidence 降一档，并写入 reasons。
 *
 * 兼容口径：字段既接受 goal 产出的 snake_case（real_problem / constraints_and_boundaries /
 * primary_block_type 等），也接受 scenario 标注的 camelCase（primaryBlockType 等）。
 */
export const PRIMARY_BLOCK_TYPES = [
  'capability',
  'oneoff_operation',
  'environment_tooling',
  'permission_process',
  'emotion_relationship',
] as const;

export type PrimaryBlockType = (typeof PRIMARY_BLOCK_TYPES)[number];

export const RESPONSE_TRIAGE_MODES = [
  'learning_path',
  'combination',
  'emotional_support',
  'referral',
] as const;

export type ResponseTriageMode = (typeof RESPONSE_TRIAGE_MODES)[number];
export type ResponseTriageConfidence = 'low' | 'medium' | 'high';

export interface ResponseTriage {
  mode: ResponseTriageMode;
  reasons: string[];
  confidence: ResponseTriageConfidence;
}

/** `goal_conversations.collectedData` 中承载分诊结论的顶层键。 */
export const RESPONSE_TRIAGE_KEY = 'responseTriage';
/** gated 模式下「分诊结论待确认」的标记键（再次确认即放行路径生成）。 */
export const RESPONSE_TRIAGE_PENDING_KEY = 'responseTriagePending';
/** 平台设置键（system 库 platform_settings，值 'advisory' | 'gated'）。 */
export const RESPONSE_TRIAGE_SETTING_KEY = 'responseTriageMode';

export type ResponseTriageEnforcementMode = 'advisory' | 'gated';
/** 默认 advisory：只提示、照常生成路径，保证现有基准与线上行为零变化。 */
export const DEFAULT_RESPONSE_TRIAGE_ENFORCEMENT: ResponseTriageEnforcementMode = 'advisory';

export interface ResponseTriageInput {
  realProblem?: unknown;
  primaryBlockType?: unknown;
  recurrence?: unknown;
  blockTypeEvidence?: unknown;
  motivation?: unknown;
  urgency?: unknown;
  constraintsAndBoundaries?: unknown;
  painPoints?: unknown;
  [key: string]: unknown;
}

const CONFIDENCE_ORDER: ResponseTriageConfidence[] = ['low', 'medium', 'high'];

/** 「提到具体技能」的判定词：只认可学习的技能/方法/概念，不认泛化的"不会/不知道"。 */
const SPECIFIC_SKILL_PATTERN =
  /(技能|方法|操作|使用|配置|概念|原理|写法|模板|公式|技巧|练习|掌握|学会|步骤|工具|流程|步骤|框架)/;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

function pickStringArray(source: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const raw = source[key];
    if (Array.isArray(raw)) {
      return raw
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
    }
    if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  }
  return [];
}

function hasSpecificSkillSignal(text: string | null): boolean {
  return !!text && SPECIFIC_SKILL_PATTERN.test(text);
}

function isUnknownBlockType(value: string | null): boolean {
  return !value || !(PRIMARY_BLOCK_TYPES as readonly string[]).includes(value);
}

function isHighUrgency(urgency: string | null): boolean {
  if (!urgency) return false;
  const text = urgency.trim().toLowerCase();
  if (!text) return false;
  if (/(极高|很高|超高|非常急|紧急|紧迫|火烧|马上|立刻|deadline|urgent|critical|asap)/i.test(text)) {
    return true;
  }
  return text === '高' || text === 'high';
}

function downgrade(confidence: ResponseTriageConfidence): ResponseTriageConfidence {
  const index = CONFIDENCE_ORDER.indexOf(confidence);
  return CONFIDENCE_ORDER[Math.max(0, index - 1)];
}

/** 统一在末尾应用「urgency 极高 + 存在硬约束 → 降一档」。 */
function finalize(
  base: ResponseTriage,
  urgency: string | null,
  constraints: string[]
): ResponseTriage {
  const reasons = [...base.reasons];
  let confidence = base.confidence;
  if (confidence !== 'low' && constraints.length > 0 && isHighUrgency(urgency)) {
    confidence = downgrade(confidence);
    reasons.push('urgency 极高且存在硬约束 → 置信度降一档');
  }
  return { mode: base.mode, confidence, reasons };
}

export function normalizeResponseTriageEnforcementMode(
  value: unknown
): ResponseTriageEnforcementMode {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text === 'gated' ? 'gated' : DEFAULT_RESPONSE_TRIAGE_ENFORCEMENT;
}

/**
 * 依据 goal understanding 的阻塞类型标注做确定性分诊。
 * 缺字段/形状非法一律容忍，按 learning_path + low 处理（等价于「不拦截」）。
 */
export function triageGoalResponse(input: ResponseTriageInput | null | undefined): ResponseTriage {
  const understanding = asObject(input);
  const realProblem = pickString(understanding, ['realProblem', 'real_problem']);
  const blockType = pickString(understanding, ['primaryBlockType', 'primary_block_type']);
  const recurrence = pickString(understanding, ['recurrence']);
  const evidence = pickString(understanding, ['blockTypeEvidence', 'block_type_evidence']);
  const urgency = pickString(understanding, ['urgency']);
  const constraints = pickStringArray(understanding, [
    'constraintsAndBoundaries',
    'constraints_and_boundaries',
  ]);
  const painPoints = pickStringArray(understanding, ['painPoints', 'pain_points']);

  if (isUnknownBlockType(blockType)) {
    return {
      mode: 'learning_path',
      confidence: 'low',
      reasons: ['缺少阻塞类型标注，默认按能力缺口处理'],
    };
  }

  switch (blockType as PrimaryBlockType) {
    case 'capability': {
      const hasRecurringOrEvidence = recurrence === 'recurring' || !!evidence;
      return finalize(
        {
          mode: 'learning_path',
          confidence: hasRecurringOrEvidence ? 'high' : 'medium',
          reasons: [
            '阻塞类型为 capability（可迁移的概念/技能缺口）',
            recurrence === 'recurring' ? 'recurrence=recurring（反复发生）' : '缺少 recurrence 复现证据',
          ],
        },
        urgency,
        constraints
      );
    }

    case 'emotion_relationship': {
      // 仅按任务口径：blockTypeEvidence 非空且提到具体技能才算组合响应。
      const hasSkillGap = hasSpecificSkillSignal(evidence);
      if (hasSkillGap) {
        return finalize(
          {
            mode: 'combination',
            confidence: 'medium',
            reasons: [
              '主阻塞为情绪/关系，但 blockTypeEvidence 出现具体技能缺口 → 学习 + 情绪支持组合',
            ],
          },
          urgency,
          constraints
        );
      }
      return finalize(
        {
          mode: 'emotional_support',
          confidence: 'medium',
          reasons: ['阻塞类型为 emotion_relationship（情绪/恐惧/关系为主）'],
        },
        urgency,
        constraints
      );
    }

    case 'environment_tooling':
    case 'permission_process': {
      const learnable =
        hasSpecificSkillSignal(evidence) ||
        hasSpecificSkillSignal(realProblem) ||
        painPoints.some((point) => hasSpecificSkillSignal(point));
      if (learnable) {
        return finalize(
          {
            mode: 'combination',
            confidence: 'medium',
            reasons: [`阻塞类型为 ${blockType}，但存在可学习成分 → 组合响应`],
          },
          urgency,
          constraints
        );
      }
      return finalize(
        {
          mode: 'referral',
          confidence: 'medium',
          reasons: [`阻塞类型为 ${blockType}（现实条件/资源/流程为主，无可学习成分）`],
        },
        urgency,
        constraints
      );
    }

    case 'oneoff_operation':
      return finalize(
        {
          mode: 'combination',
          confidence: 'medium',
          reasons: ['阻塞类型为 oneoff_operation（一次性操作，含少量可学习成分）'],
        },
        urgency,
        constraints
      );

    default:
      return {
        mode: 'learning_path',
        confidence: 'low',
        reasons: ['缺少阻塞类型标注，默认按能力缺口处理'],
      };
  }
}

const ADVISORY_BY_MODE: Record<Exclude<ResponseTriageMode, 'learning_path'>, string> = {
  combination:
    '系统判断：你卡住的主因不只是知识缺口，学习路径只是其中一部分——建议同时安排情绪/现实条件方面的支持。',
  emotional_support:
    '系统判断：你卡住的主因更偏情绪/信心，学习路径只是其中一部分——建议先处理情绪阻力，再进入系统学习。',
  referral:
    '系统判断：你卡住的主因更偏现实条件/资源/流程，学习路径只是其中一部分——建议先解决外部阻塞，再规划学习。',
};

/**
 * 生成面向用户/模拟者的「负向出口」一行可读结论。
 * learning_path 或无效输入返回空串（调用方据此决定是否追加，保证默认零变化）。
 */
export function buildTriageAdvisoryLine(triage: ResponseTriage | null | undefined): string {
  if (!triage || triage.mode === 'learning_path') return '';
  const base = ADVISORY_BY_MODE[triage.mode];
  if (!base) return '';
  const suffix = triage.confidence === 'low' ? '（置信度低，仅供参考）' : '';
  return `\n\n${base}${suffix}`;
}

/** 从 `collectedData` 读回已落库的分诊结论（缺失/损坏返回 null）。 */
export function resolveResponseTriageFromCollectedData(
  collectedData: unknown
): ResponseTriage | null {
  if (!collectedData || typeof collectedData !== 'object') return null;
  const raw = (collectedData as Record<string, unknown>)[RESPONSE_TRIAGE_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const mode = candidate.mode;
  if (typeof mode !== 'string' || !(RESPONSE_TRIAGE_MODES as readonly string[]).includes(mode)) {
    return null;
  }
  const confidence = candidate.confidence;
  const normalizedConfidence: ResponseTriageConfidence =
    confidence === 'low' || confidence === 'high' || confidence === 'medium'
      ? confidence
      : 'medium';
  const reasons = Array.isArray(candidate.reasons)
    ? candidate.reasons.filter((item): item is string => typeof item === 'string')
    : [];
  return { mode: mode as ResponseTriageMode, confidence: normalizedConfidence, reasons };
}
