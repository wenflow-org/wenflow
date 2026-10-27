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
 *     evidence / real_problem / pain_points 命中**高精度**「可学习成分」词（方法/思路/框架/模板/…）→ combination。
 *     注意：这里**不用**宽模式，因为 `技能|流程|配置|使用|操作|工具` 既是这两类阻塞自身的定义词，
 *     又常出现在命名实体里（如"职业技能鉴定"），会把权限类案例误抬成 combination（宁可漏判不误报）。
 *  5. oneoff_operation → combination（一次性操作含少量可学习成分）。
 *  6. urgency 极高且 constraints_and_boundaries 非空 → confidence 降一档，并写入 reasons。
 *  7. 第二轴 support_need（none | emotional | referral，"除学习外是否还需要别的支持"）叠加：
 *     非 none 时把 learning_path 抬升为 combination；emotional_support × referral / referral × emotional
 *     也归 combination；none 时完全不改变上表（零变化）。
 *     动机：primary_block_type 回答"要学什么"，support_need 回答"还要不要补情绪/现实支持"，
 *     二者是不同维度（实测 8 例情绪主导语料里 5 例确有真实可学缺口，若只用第一轴会被压成 learning_path）。
 *
 * 兼容口径：字段既接受 goal 产出的 snake_case（real_problem / constraints_and_boundaries /
 * primary_block_type / support_need 等），也接受 scenario 标注的 camelCase（primaryBlockType 等）。
 */
export const PRIMARY_BLOCK_TYPES = [
  'capability',
  'oneoff_operation',
  'environment_tooling',
  'permission_process',
  'emotion_relationship',
] as const;

export type PrimaryBlockType = (typeof PRIMARY_BLOCK_TYPES)[number];

/**
 * 第二轴：除学习之外的支持需求（与 primary_block_type 独立，可同时存在）。
 *  - none      ＝ 学习路径本身足够
 *  - emotional ＝ 情绪/信心/羞耻/恐惧主导，需先稳定情绪再学
 *  - referral  ＝ 现实条件/资源/流程/他人配合阻塞，需先解决外部问题
 */
export const SUPPORT_NEEDS = ['none', 'emotional', 'referral'] as const;
export type SupportNeed = (typeof SUPPORT_NEEDS)[number];

export const RESPONSE_TRIAGE_MODES = [
  'learning_path',
  'combination',
  'emotional_support',
  'referral',
] as const;

export type ResponseTriageMode = (typeof RESPONSE_TRIAGE_MODES)[number];
export type ResponseTriageConfidence = 'low' | 'medium' | 'high';

/** 问题结构轴（2026-10-25 方向改造，静默推断——禁止向用户追问，从已有文本字段确定性识别）：
 *  - coupling（多变量耦合度）：高=输入条件多变/多因素互相影响/时好时坏分不清原因（单次抄答案失效的判据之一）
 *  - stakes（试错代价）：high=搞错一次有明显业务/金钱/机会损失（需要看得懂推理链才敢拍板的判据之一）
 *  与 recurrence 合成「三条件测试」：≥2 条成立时单次解答失效、值得学习路径（20 场景框架）。
 */
export type ProblemCoupling = 'low' | 'medium' | 'high';
export type ProblemStakes = 'low' | 'high';

export interface ResponseTriage {
  mode: ResponseTriageMode;
  reasons: string[];
  confidence: ResponseTriageConfidence;
  /** 静默推断的问题结构轴（缺证据时不输出，消费者须容忍 undefined） */
  coupling?: ProblemCoupling;
  stakes?: ProblemStakes;
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
  /** 第二轴：none | emotional | referral（缺失/非法视为 none，零变化） */
  supportNeed?: unknown;
  motivation?: unknown;
  urgency?: unknown;
  constraintsAndBoundaries?: unknown;
  painPoints?: unknown;
  [key: string]: unknown;
}

const CONFIDENCE_ORDER: ResponseTriageConfidence[] = ['low', 'medium', 'high'];

/** 「提到具体技能」的判定词：只认可学习的技能/方法/概念，不认泛化的"不会/不知道"。 */
const SPECIFIC_SKILL_PATTERN =
  /(技能|方法|操作|使用|配置|概念|原理|写法|模板|公式|技巧|练习|掌握|学会|步骤|工具|流程|框架)/;

/**
 * `environment_tooling` / `permission_process` 判断「是否另有可学习成分」用的**高精度**模式。
 *
 * 为什么另起一套：宽模式里的 `技能 | 流程 | 配置 | 使用 | 操作 | 工具` 既是这两类阻塞自身的定义词
 * （权限/审批/流程/交接、设备/软件/网络/配置），又极易出现在命名实体里——
 * 实测：周敏（nurse-career-transition）的 evidence 是「是搜"健康管理师"还是搜"职业技能鉴定"？」，
 * `技能` 命中命名实体 ⇒ 权限类案例被误抬成 combination。
 * 这里只保留「学习动作 / 认知对象」类词，宁可漏判也不误报（真要有主导性学习缺口，
 * 模型应把 primary_block_type 判成 capability，而不是靠这里兜）。
 */
const LEARNABLE_COMPONENT_PATTERN =
  /(方法|思路|框架|模板|公式|技巧|练习|掌握|学会|理解|概念|原理|基础|认知|步骤)/;

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

function hasLearnableComponent(text: string | null): boolean {
  return !!text && LEARNABLE_COMPONENT_PATTERN.test(text);
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

/** coupling 高精度词：多变/多因素/互相影响/时好时坏/分不清原因（宁可漏判不误报）。 */
const COUPLING_HIGH_PATTERN =
  /(时好时坏|忽好忽坏|一会儿.{0,8}一会儿|有时.{0,12}有时|不稳定|时准时不准|多个因素|多种因素|互相影响|相互影响|分不清.{0,10}(原因|哪个)|搞不清.{0,10}(原因|哪个)|又.{0,10}又.{0,10}(怕|担心|不行|不准)|连锁)/;
/** coupling 中置信词：明确的两个以上变量并置（如「受活动和天气影响」）。 */
const COUPLING_MEDIUM_PATTERN =
  /(.{2,12}(以及|和|与|跟).{2,12})?(天气|活动|季节|促销|假期|节假日).{0,16}(天气|活动|季节|促销|假期|节假日|影响|变量)/;

/** stakes 高精度词：搞错/白干一次有明确损失。 */
const STAKES_HIGH_PATTERN =
  /(流失|亏|赔|损失|白费|白搭|报废|砸了|搞砸|耽误|错过|客诉|投诉|退货|退单|事故|罚款|丢(了)?(客户|单|工作|机会)|没等就走了|排错|排班失误|不敢.{0,8}(改|调|动)|风险)/;

/**
 * 静默推断 coupling（从 realProblem/evidence/painPoints 的自由文本，确定性、可解释）。
 * 命中高精度词 → high；仅中置信词 → medium；有文本但都不命中 → low；完全无文本 → null（不输出）。
 */
export function inferCoupling(texts: Array<string | null | undefined>): ProblemCoupling | null {
  const joined = texts.filter((t): t is string => !!t && t.trim().length > 0).join('\n');
  if (!joined) return null;
  if (COUPLING_HIGH_PATTERN.test(joined)) return 'high';
  if (COUPLING_MEDIUM_PATTERN.test(joined)) return 'medium';
  return 'low';
}

/** 静默推断 stakes：命中高精度词 → high；有文本不命中 → low；无文本 → null。 */
export function inferStakes(texts: Array<string | null | undefined>): ProblemStakes | null {
  const joined = texts.filter((t): t is string => !!t && t.trim().length > 0).join('\n');
  if (!joined) return null;
  return STAKES_HIGH_PATTERN.test(joined) ? 'high' : 'low';
}

/**
 * 三条件测试（20 场景框架）：recurrence=recurring / coupling≥medium / stakes=high，
 * 命中 ≥2 → 单次解答大概率失效，学习路径成立；命中 ≤1 且 capability 型 → 一次性解答场景，
 * 路径可能过重（confidence 降档 + reasons 标注；真正的「即时解答」路由目的地是产品决策，未落地前只降置信不开新 mode）。
 */
function applyProblemStructureAxes(
  base: ResponseTriage,
  recurrence: string | null,
  coupling: ProblemCoupling | null,
  stakes: ProblemStakes | null
): ResponseTriage {
  if (base.mode !== 'learning_path') return base;
  const hits = [
    recurrence === 'recurring',
    coupling === 'medium' || coupling === 'high',
    stakes === 'high',
  ].filter(Boolean).length;
  const axes: Record<string, unknown> = {};
  if (coupling) axes.coupling = coupling;
  if (stakes) axes.stakes = stakes;
  const reasons = [...base.reasons];
  let confidence = base.confidence;
  if (hits >= 2) {
    if (confidence !== 'high') confidence = 'high';
    reasons.push(`三条件测试命中 ${hits}/3（复现×耦合×代价）→ 单次解答失效，学习路径成立`);
  } else if (hits === 0 && coupling === 'low' && stakes === 'low') {
    confidence = downgrade(confidence);
    reasons.push('三条件测试 0/3（低复现×低耦合×低代价）→ 更像一次性解答场景，学习路径可能过重');
  }
  return { ...base, ...axes, confidence, reasons };
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

/** support_need 归一化：缺失/非法一律 `none`（保证「模型没给该字段」时零变化）。 */
export function normalizeSupportNeed(value: string | null | undefined): SupportNeed {
  return value === 'emotional' || value === 'referral' ? value : 'none';
}

/**
 * 依据 goal understanding 做确定性分诊（两轴）：
 *  - primary_block_type（"要学什么"）→ 基础模式；
 *  - support_need（"除学习外还要什么"）→ 在基础模式上叠加出负向出口。
 * 缺字段/形状非法一律容忍：两轴都缺 → learning_path + low（等价于「不拦截」）。
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
  const supportNeed = normalizeSupportNeed(pickString(understanding, ['supportNeed', 'support_need']));

  // 即时微操作覆盖（2026-10-27 外部审查，R8 冒烟 E10 实证）：
  // surface_goal 带当日死线词且 objectiveScopeHours ≤ 1.5 时，对话里「以后每个月还会遇到」
  // 这类随口话会把 primary_block_type 带成 capability → 误开学习路径。
  // 「今天就要交的东西」不是学习路径的对象，一律按 oneoff_operation 分诊。
  const surfaceGoal = pickString(understanding, ['surfaceGoal', 'surface_goal']);
  const objectiveHours = Number(
    (asObject((understanding as any)?.time_dimensions) as any)?.objectiveScopeHours
      ?? (understanding as any)?.objectiveScopeHours,
  );
  const immediateDelivery = !!surfaceGoal
    && /(今天|今晚|马上|立刻|小时内|半小时后|下班前|等下|待会儿?)/.test(surfaceGoal);
  const immediateOneoff =
    immediateDelivery && Number.isFinite(objectiveHours) && objectiveHours > 0 && objectiveHours <= 1.5;
  const effectiveBlockType = immediateOneoff ? 'oneoff_operation' : blockType;

  if (isUnknownBlockType(effectiveBlockType)) {
    // 阻塞类型缺失（模型证据不足）：若已明确表达支持需求，仍按需求出负向出口；否则不拦截。
    if (supportNeed === 'emotional') {
      return {
        mode: 'emotional_support',
        confidence: 'medium',
        reasons: ['缺少阻塞类型标注，但用户表达了情绪/信心支持需求'],
      };
    }
    if (supportNeed === 'referral') {
      return {
        mode: 'referral',
        confidence: 'medium',
        reasons: ['缺少阻塞类型标注，但存在现实条件/资源/流程支持需求'],
      };
    }
    return {
      mode: 'learning_path',
      confidence: 'low',
      reasons: ['缺少阻塞类型标注，默认按能力缺口处理'],
    };
  }

  const base = triageByBlockType(effectiveBlockType as PrimaryBlockType, {
    recurrence,
    evidence,
    realProblem,
    painPoints,
    urgency,
    constraints,
  });
  const withSupport = applySupportNeed(base, supportNeed);
  if (immediateOneoff) {
    withSupport.reasons.unshift('当日死线 + 客观体量 ≤1.5h：按一次性微操作分诊（覆盖 primary_block_type）');
  }
  // 问题结构轴（静默推断，禁止向用户追问）：与 recurrence 合成三条件测试，
  // 只调制 learning_path 的置信度与 reasons；轴值随结论落 collectedData 供后续路由消费。
  const axisTexts = [realProblem, evidence, ...painPoints];
  return applyProblemStructureAxes(
    withSupport,
    recurrence,
    inferCoupling(axisTexts),
    inferStakes(axisTexts)
  );
}

interface BlockTypeContext {
  recurrence: string | null;
  evidence: string | null;
  realProblem: string | null;
  painPoints: string[];
  urgency: string | null;
  constraints: string[];
}

/** 第一轴：仅按 primary_block_type（"要学什么"）决定基础模式；support_need 由 applySupportNeed 叠加。 */
function triageByBlockType(blockType: PrimaryBlockType, ctx: BlockTypeContext): ResponseTriage {
  const { recurrence, evidence, realProblem, painPoints, urgency, constraints } = ctx;
  switch (blockType) {
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
        hasLearnableComponent(evidence) ||
        hasLearnableComponent(realProblem) ||
        painPoints.some((point) => hasLearnableComponent(point));
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

/**
 * 第二轴叠加（support_need）：非 none 时在基础模式上抬升为负向出口。
 *  - learning_path + (emotional | referral) → combination（既要学、也要补）
 *  - emotional_support + referral → combination
 *  - referral + emotional → combination
 *  - support_need=none 或已被覆盖 → 原样返回（零变化）
 */
function applySupportNeed(base: ResponseTriage, supportNeed: SupportNeed): ResponseTriage {
  if (supportNeed === 'none') return base;
  const needReason =
    supportNeed === 'emotional'
      ? 'support_need=emotional（情绪/信心阻力）'
      : 'support_need=referral（现实条件/资源/流程阻塞）';
  const conflicts =
    base.mode === 'learning_path' ||
    (base.mode === 'emotional_support' && supportNeed === 'referral') ||
    (base.mode === 'referral' && supportNeed === 'emotional');
  if (!conflicts) return base;
  return {
    mode: 'combination',
    confidence: base.confidence,
    reasons: [...base.reasons, `${needReason} → 学习路径 + 补充支持组合`],
  };
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
  // 问题结构轴（2026-10-25）：容忍读回——非法/缺失不输出，消费者须容忍 undefined
  const coupling = candidate.coupling;
  const stakes = candidate.stakes;
  const axes: Pick<ResponseTriage, 'coupling' | 'stakes'> = {};
  if (coupling === 'low' || coupling === 'medium' || coupling === 'high') axes.coupling = coupling;
  if (stakes === 'low' || stakes === 'high') axes.stakes = stakes;
  return { mode: mode as ResponseTriageMode, confidence: normalizedConfidence, reasons, ...axes };
}
