/**
 * Goal 澄清契约（Clarification Contract）——设计稿 v0.1 的可执行内核。
 *
 * 背景：Goal 阶段的现行产物是一组身份标签（intent_type / entry_state /
 * primary_block_type / support_need / skill_nature / platform_judgment），
 * 标签一旦落库就被 Path 当硬输入，误判只能靠继续加规则修补。
 *
 * 这里把 Goal 的产物换成一个“问题契约”：
 *   core（核心问题/张力） + baseline（先验证据） + stopping（停机条件） + constraints
 * 并用信息价值（planImpact）判断“还缺什么、值不值得再问、能不能出方案”。
 *
 * 本模块是纯函数（无 DB / 无 LLM / 无副作用），作为 Phase 1 的服务端门控种子；
 * 在接入 goal-conversation.service 之前不改变任何线上行为。
 */

export type ClarificationPlanImpact = 'first-station' | 'stopping' | 'scope' | 'later';

export type ClarificationStoppingKind = 'explain' | 'do' | 'decide';
export type ClarificationStoppingScope = 'instance' | 'class';
export type ClarificationStoppingEvidence = 'platform' | 'self' | 'external';
export type ClarificationBlockingNeed = 'none' | 'emotional' | 'referral';

export interface ClarificationUnknown {
  id: string;
  question: string;
  /** 不知道它会改变什么：第一站 / 停机条件 / 范围 / 后续阶段 */
  planImpact: ClarificationPlanImpact;
  /** 两种（或更多）答案分别把路径带到哪；说不清差异的问题不该问 */
  discriminates: string[];
}

export interface ClarificationContract {
  core: {
    /** 具体张力/问题，不是主题词（“学习科学”不是问题） */
    question: string | null;
    /** 用户原话/术语，作为问题成立的证据 */
    evidence: string[];
  };
  baseline: {
    /** 有证据的已知（术语、经历、作品、判断） */
    known: string[];
    /** 明确未知 */
    unknown: string[];
    /** 有证据的误解 */
    misconceptions: string[];
    /** 基线证据：用户原话/具体经历，不使用 beginner/intermediate 标签 */
    evidence: string[];
  };
  stopping: {
    kind: ClarificationStoppingKind;
    scope: ClarificationStoppingScope;
    evidence: ClarificationStoppingEvidence;
    /** 什么证据出现算“通了/解决了” */
    statement: string | null;
  };
  constraints: {
    timePerSessionMin?: number;
    totalBudgetHours?: number;
    deadline?: string;
    environment?: string[];
  };
  assumptions: string[];
  blockingNeed: ClarificationBlockingNeed;
  unknowns: ClarificationUnknown[];
}

export type ClarificationGapField =
  | 'core.question'
  | 'baseline.evidence'
  | 'stopping.statement'
  | 'baseline.unknown'
  | 'unknowns.first-station'
  | 'unknowns.stopping'
  | 'unknowns.scope'
  | 'constraints'
  | 'milestone.rationale';

export interface ClarificationGap {
  field: ClarificationGapField;
  /** blocking = 阻止出学习方案；advisory = 可带假设继续 */
  severity: 'blocking' | 'advisory';
  reason: string;
}

export interface ProposalGateResult {
  allowed: boolean;
  blocking: ClarificationGap[];
  advisory: ClarificationGap[];
  reasons: string[];
}

export type GoalRoute = 'learning_path' | 'one_off' | 'support' | 'clarify';

const PLAN_IMPACT_ORDER: Record<ClarificationPlanImpact, number> = {
  'first-station': 0,
  stopping: 1,
  scope: 2,
  later: 3,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => item !== null);
};

const asEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const text = asString(value);
  return text && (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
};

const asPositiveNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const normalizeUnknown = (value: unknown, index: number): ClarificationUnknown | null => {
  const record = asRecord(value);
  const question = asString(record.question);
  if (!question) return null;
  return {
    id: asString(record.id) || `u${index + 1}`,
    question,
    planImpact: asEnum<ClarificationPlanImpact>(
      record.planImpact,
      ['first-station', 'stopping', 'scope', 'later'],
      'later'
    ),
    discriminates: asStringArray(record.discriminates),
  };
};

/**
 * 宽容归一化：字段缺失/类型不对时回落安全默认，不抛错。
 * “缺什么”由 deriveClarificationGaps 判断，而不是靠 normalization 抛异常。
 */
export function normalizeClarificationContract(input: unknown): ClarificationContract {
  const root = asRecord(input);
  const core = asRecord(root.core);
  const baseline = asRecord(root.baseline);
  const stopping = asRecord(root.stopping);
  const constraints = asRecord(root.constraints);
  const rawUnknowns = Array.isArray(root.unknowns) ? root.unknowns : [];

  return {
    core: {
      question: asString(core.question),
      evidence: asStringArray(core.evidence),
    },
    baseline: {
      known: asStringArray(baseline.known),
      unknown: asStringArray(baseline.unknown),
      misconceptions: asStringArray(baseline.misconceptions),
      evidence: asStringArray(baseline.evidence),
    },
    stopping: {
      kind: asEnum<ClarificationStoppingKind>(stopping.kind, ['explain', 'do', 'decide'], 'explain'),
      scope: asEnum<ClarificationStoppingScope>(stopping.scope, ['instance', 'class'], 'class'),
      evidence: asEnum<ClarificationStoppingEvidence>(
        stopping.evidence,
        ['platform', 'self', 'external'],
        'self'
      ),
      statement: asString(stopping.statement),
    },
    constraints: {
      ...(asPositiveNumber(constraints.timePerSessionMin) !== undefined
        ? { timePerSessionMin: asPositiveNumber(constraints.timePerSessionMin) }
        : {}),
      ...(asPositiveNumber(constraints.totalBudgetHours) !== undefined
        ? { totalBudgetHours: asPositiveNumber(constraints.totalBudgetHours) }
        : {}),
      ...(asString(constraints.deadline) ? { deadline: asString(constraints.deadline)! } : {}),
      ...(asStringArray(constraints.environment).length > 0
        ? { environment: asStringArray(constraints.environment) }
        : {}),
    },
    assumptions: asStringArray(root.assumptions),
    blockingNeed: asEnum<ClarificationBlockingNeed>(
      root.blockingNeed,
      ['none', 'emotional', 'referral'],
      'none'
    ),
    unknowns: rawUnknowns
      .map((item, index) => normalizeUnknown(item, index))
      .filter((item): item is ClarificationUnknown => item !== null)
      .sort((a, b) => PLAN_IMPACT_ORDER[a.planImpact] - PLAN_IMPACT_ORDER[b.planImpact]),
  };
}

/**
 * 列出“还缺什么”。只有会改变第一站/停机条件的缺口是 blocking；
 * 范围/后续阶段缺口是 advisory，允许“先提案 + 写假设”。
 */
export function deriveClarificationGaps(input: unknown): ClarificationGap[] {
  const contract = normalizeClarificationContract(input);
  const gaps: ClarificationGap[] = [];

  if (!contract.core.question) {
    gaps.push({
      field: 'core.question',
      severity: 'blocking',
      reason: '还没有把主题收窄成一个具体问题/张力',
    });
  }
  if (contract.baseline.evidence.length === 0) {
    gaps.push({
      field: 'baseline.evidence',
      severity: 'blocking',
      reason: '没有任何先验基线证据，无法决定第一站从哪起笔',
    });
  }
  // 2026-11-20 外部评审补漏：模型把「会改变第一站」的未知只写进 baseline.unknown，
  // 不写进 unknowns，就能绕过提案门控（股票案例：baseline.unknown 有「是否读懂K线」，
  // unknowns 只留 scope 项，于是直接提案）。这里把未消化的 baseline.unknown 视为缺口；
  // 但「已镜像进 unknowns 的 first-station/stopping 项」不算：那些项本身就会拦提案，
  // 再按 baseline.unknown 拦一次，会逼模型为了过门而删掉真实的基线记录。
  // 已答清的应移到 known；不打算问的写进 assumptions。
  const hasBlockingUnknown = contract.unknowns.some(
    (unknown) => unknown.planImpact === 'first-station' || unknown.planImpact === 'stopping'
  );
  if (contract.baseline.unknown.length > 0 && !hasBlockingUnknown) {
    gaps.push({
      field: 'baseline.unknown',
      severity: 'blocking',
      reason: `基线里仍有未决项：${contract.baseline.unknown.join('；')}——先判断是否改变第一站；要问的写进 unknowns，不打算问的写进 assumptions`,
    });
  }
  if (!contract.stopping.statement) {
    gaps.push({
      field: 'stopping.statement',
      severity: 'blocking',
      reason: '没有停机条件，无法定义路径终点与验收',
    });
  }

  for (const unknown of contract.unknowns) {
    if (unknown.planImpact === 'first-station') {
      gaps.push({
        field: 'unknowns.first-station',
        severity: 'blocking',
        reason: `未决：${unknown.question}（会影响第一站）`,
      });
    } else if (unknown.planImpact === 'stopping') {
      gaps.push({
        field: 'unknowns.stopping',
        severity: 'blocking',
        reason: `未决：${unknown.question}（会影响停机条件）`,
      });
    } else if (unknown.planImpact === 'scope') {
      gaps.push({
        field: 'unknowns.scope',
        severity: 'advisory',
        reason: `未决：${unknown.question}（只影响范围，可带假设提案）`,
      });
    }
  }

  if (
    contract.constraints.timePerSessionMin === undefined
    && contract.constraints.totalBudgetHours === undefined
  ) {
    gaps.push({
      field: 'constraints',
      severity: 'advisory',
      reason: '没有时间约束；Path 可按默认单次时长起步',
    });
  }

  return gaps;
}

/**
 * 提案门控：替代“类型标签决定能不能出方案”。
 *
 * 只拦**会改变方案结构**的缺口：first-station / stopping 级未知、以及停机条件本身。
 * `core.question` / `baseline.evidence` 缺失记为 advisory：它们是契约的表达质量，
 * 不改变“第一站从哪起、到哪算通”；20 例 A/B 实测证明把它们当 blocking 会让模型
 * 在已经给出可用方案时被反复要求补字段（core.question 空 → 连续澄清 → 学习者离场），
 * 正是用户批评的“填表式入口”。Path 生成前的 `assertClarificationReadyForPath`
 * 仍按严格口径要求它们（路径需要可追溯的问题与基线）。
 */
const PROPOSAL_BLOCKING_FIELDS: ReadonlySet<ClarificationGapField> = new Set([
  'stopping.statement',
  'baseline.unknown',
  'unknowns.first-station',
  'unknowns.stopping',
]);

export function canProposeClarification(input: unknown): ProposalGateResult {
  const gaps = deriveClarificationGaps(input);
  const blocking = gaps.filter(
    (gap) => gap.severity === 'blocking' && PROPOSAL_BLOCKING_FIELDS.has(gap.field)
  );
  const blockingFields = new Set(blocking.map((gap) => gap.field));
  // 其余 blocking 缺口降为 advisory（表达质量），仍返回给调用方观测。
  const advisory = gaps.filter(
    (gap) => !blockingFields.has(gap.field)
  );
  return {
    allowed: blocking.length === 0,
    blocking,
    advisory,
    reasons: blocking.map((gap) => gap.reason),
  };
}

/**
 * 选下一个问题：只从 planImpact 最高的未决项里选；没有值得问的就返回 null。
 * 这保证“一次一个、先问会改变第一站/停机条件的问题”。
 */
export function selectNextClarificationQuestion(input: unknown): ClarificationUnknown | null {
  const contract = normalizeClarificationContract(input);
  const blocking = contract.unknowns.filter(
    (unknown) => unknown.planImpact === 'first-station' || unknown.planImpact === 'stopping'
  );
  return blocking[0] ?? null;
}

/**
 * 由契约属性派生去向，替代 intent_type / entry_state / support_need 的分诊。
 * 注意：判断对象是“这个请求”，不是“这个人”。
 */
export function deriveGoalRoute(input: unknown): GoalRoute {
  const contract = normalizeClarificationContract(input);
  if (contract.blockingNeed !== 'none') return 'support';
  if (contract.stopping.scope === 'instance') return 'one_off';
  if (canProposeClarification(contract).allowed) return 'learning_path';
  return 'clarify';
}

export interface ClarificationGateDecision {
  blocked: boolean;
  blocking: ClarificationGapField[];
  /** 被拦截时给用户的澄清提问；未拦截为 null */
  prompt: string | null;
}

/**
 * Phase 2 门控判定：在「模型已经给了提案」时，判断契约是否允许它进入 proposing。
 * 与 shadow 的区别：shadow 只返回观测对象，这里返回可执行的 blocked + 改写提问。
 */
export function decideClarificationGate(input: {
  clarification?: unknown;
  nextAction?: string | null;
  confirmedProposal?: unknown;
  stage?: string | null;
  requireContract?: boolean;
}): ClarificationGateDecision {
  if (!input.clarification && !input.requireContract) {
    return { blocked: false, blocking: [], prompt: null };
  }
  const proposalPresent = Boolean(input.confirmedProposal)
    || input.nextAction === 'propose'
    || input.stage === 'proposing'
    || input.stage === 'ready';
  if (!proposalPresent) {
    return { blocked: false, blocking: [], prompt: null };
  }

  const gate = canProposeClarification(input.clarification);
  if (gate.allowed) {
    return { blocked: false, blocking: [], prompt: null };
  }

  const contract = normalizeClarificationContract(input.clarification);
  const nextQuestion = selectNextClarificationQuestion(contract)?.question;
  const blocking = gate.blocking.map((gap) => gap.field);
  return {
    blocked: true,
    blocking,
    prompt: nextQuestion
      ? `在给你排方案前，我还需要确认一件事：${nextQuestion}`
      : buildClarificationRepairPrompt(blocking, contract),
  };
}

function buildClarificationRepairPrompt(
  blocking: ClarificationGapField[],
  contract?: ReturnType<typeof normalizeClarificationContract>
): string {
  if (blocking.includes('core.question')) {
    return '在给你排方案前，我还需要确认一件事：你最想弄清的具体问题或矛盾是什么？';
  }
  if (blocking.includes('stopping.statement')) {
    return '在给你排方案前，我还需要确认一件事：对你来说，什么算把这件事弄通了？';
  }
  if (blocking.includes('baseline.unknown') && contract?.baseline.unknown.length) {
    const item = contract.baseline.unknown[0].replace(/[。.!！?？]+$/, '');
    return `在给你排方案前，我还需要确认一件事：${item}——能具体说说吗？`;
  }
  if (blocking.includes('baseline.evidence') || blocking.includes('baseline.unknown')) {
    return '在给你排方案前，我还需要确认一件事：你之前接触过这方面的什么内容，或者现在卡在哪一步？';
  }
  return '在给你排方案前，我还需要确认一件事：你能再具体说说你的起点或目标吗？';
}

/**
 * Phase 3 开关：默认开启。
 * 显式 `GOAL_CLARIFICATION_ENFORCE=0|false|off|no` 关闭（唯一回滚口）；
 * 不设或设 1/true/on 均按开启处理。
 */
export function isClarificationEnforceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = String(env.GOAL_CLARIFICATION_ENFORCE ?? '').trim().toLowerCase();
  if (!value) return true;
  return !['0', 'false', 'off', 'no'].includes(value);
}

export interface ProposalTraceIssue {
  field: string;
  reason: string;
}

/**
 * Path 生成前的澄清契约门（Phase 2/3）：契约不完整时不生成路径，把缺口原样带回 Goal。
 * 默认启用（`GOAL_CLARIFICATION_ENFORCE=0` 可关闭）；旧会话/旧调用方（无 clarification）不受影响。
 */
export class ClarificationRequiredError extends Error {
  readonly code = 'CLARIFICATION_REQUIRED';
  readonly status = 422;

  constructor(readonly gaps: ClarificationGap[]) {
    super('CLARIFICATION_REQUIRED');
    this.name = 'ClarificationRequiredError';
  }
}

/**
 * Path/确认边界用的严格缺口：与提案门控不同，这里同时要求 `core.question` 与
 * `baseline.evidence`——路径需要可追溯的问题与基线，不能只靠「第一站级未知已清空」。
 * `baseline.unknown` 仍豁免：提案前已用它拦过一轮，到了确认/Path 入口允许带假设生成，
 * 不再二次判死（那会逼模型为了过门删掉真实基线记录）。
 */
function derivePathReadyBlockingGaps(input: unknown): ClarificationGap[] {
  return deriveClarificationGaps(input).filter(
    (gap) => gap.severity === 'blocking' && gap.field !== 'baseline.unknown'
  );
}

export function assertClarificationReadyForPath(input: unknown): void {
  // 严格口径（2026-11-21 修正）：此前误用提案门控（core.question / baseline.evidence 已降为
  // advisory），与注释和设计稿 §3.5 的「路径需要可追溯的问题与基线」不一致。
  // 确认边界与 Path 入口共用本函数，避免两处判据漂移。
  const blocking = derivePathReadyBlockingGaps(input);
  if (blocking.length > 0) {
    throw new ClarificationRequiredError(blocking);
  }
}

export interface ClarificationConfirmationGateDecision {
  /** true = 不应进入路径绑定；服务层应把确认改写成澄清回合 */
  blocked: boolean;
  /** 满足严格口径（core.question + baseline.evidence + stopping + 结构性未知） */
  blocking: ClarificationGapField[];
  /** 被拦截时给用户的澄清提问；未拦截为 null */
  prompt: string | null;
  /** true = 历史会话（没有 clarification 契约），一律放行，保持旧行为 */
  legacy: boolean;
}

/**
 * 确认边界门控（2026-11-21）：用户点确认/打字确认时，新会话必须先满足严格澄清契约。
 *
 * 历史会话兼容：没有 `clarification` 字段（旧会话、旧测试夹具、旧调用方）→ legacy=true，
 * 完全按旧行为放行；只有模型产出了契约的新会话才受过门约束。
 */
export function decideClarificationConfirmationGate(input: {
  clarification?: unknown;
  requireContract?: boolean;
}): ClarificationConfirmationGateDecision {
  const contractInput = input?.clarification;
  if (!input.requireContract && (contractInput === undefined || contractInput === null)) {
    return { blocked: false, blocking: [], prompt: null, legacy: true };
  }
  const blocking = derivePathReadyBlockingGaps(contractInput);
  if (blocking.length === 0) {
    return { blocked: false, blocking: [], prompt: null, legacy: false };
  }
  const contract = normalizeClarificationContract(contractInput);
  const nextQuestion = selectNextClarificationQuestion(contract)?.question;
  const fields = blocking.map((gap) => gap.field);
  return {
    blocked: true,
    blocking: fields,
    prompt: nextQuestion
      ? `在开始排方案前，我还需要确认一件事：${nextQuestion}`
      : buildClarificationRepairPrompt(fields, contract),
    legacy: false,
  };
}

export interface MilestoneRationaleAudit {
  ok: boolean;
  missingRationale: number[];
  invalidServes: number[];
  stoppingCovered: boolean;
  reasons: string[];
}

const MILESTONE_SERVES = ['core', 'baseline', 'stopping', 'constraint'] as const;

/**
 * MilestoneRationale 审计：每个 milestone 必须声明它服务契约的哪一条；
 * 最后一个 milestone 必须服务 stopping（否则路径终点不产出停机证据）。
 *
 * `options.requireStopping=false` 用于 subject（教材/多单元平行）拓扑：这类路径没有
 * 「贯穿单一作品」的收口，末单元不是全书终评，强制 stopping 会把最后一章扭曲成全书大作业。
 * 纯结构检查；语义级“真的服务了”由 path-reviewer 的 LLM 评审负责。
 */
export function auditMilestoneRationales(
  milestones: unknown,
  clarification: unknown,
  options?: { requireStopping?: boolean }
): MilestoneRationaleAudit {
  const requireStopping = options?.requireStopping !== false;
  const contract = normalizeClarificationContract(clarification);
  const list = Array.isArray(milestones) ? milestones : [];
  const missingRationale: number[] = [];
  const invalidServes: number[] = [];
  const reasons: string[] = [];

  if (!contract.stopping.statement) {
    reasons.push('契约缺少 stopping.statement，无法审计路径终点');
  }
  if (list.length === 0) {
    reasons.push('没有 milestones 可审计');
  }

  list.forEach((item, index) => {
    const milestone = asRecord(item);
    const rationale = asRecord(milestone.rationale);
    const serves = asString(rationale.serves);
    const evidence = asString(rationale.evidence);
    if (!serves || !evidence) {
      missingRationale.push(index);
      return;
    }
    if (!(MILESTONE_SERVES as readonly string[]).includes(serves)) {
      invalidServes.push(index);
    }
  });

  const last = list.length > 0 ? asRecord(asRecord(list[list.length - 1]).rationale) : {};
  const stoppingCovered = asString(last.serves) === 'stopping';

  if (missingRationale.length > 0) {
    reasons.push(`milestones[${missingRationale.join(',')}] 缺少 rationale.serves/evidence`);
  }
  if (invalidServes.length > 0) {
    reasons.push(`milestones[${invalidServes.join(',')}] 的 serves 不在 ${MILESTONE_SERVES.join('|')}`);
  }
  if (list.length > 0 && requireStopping && !stoppingCovered) {
    reasons.push('最后一个 milestone 没有 serves=stopping，路径终点不产出停机证据');
  }

  return {
    ok: reasons.length === 0 && missingRationale.length === 0 && invalidServes.length === 0,
    missingRationale,
    invalidServes,
    stoppingCovered,
    reasons,
  };
}

export interface ClarificationShadowObservation {
  conversationId: string;
  stage: string;
  nextAction: string | null;
  coreQuestion: string | null;
  baselineEvidenceCount: number;
  stoppingStatement: string | null;
  blocking: ClarificationGapField[];
  reasons: string[];
  unknowns: Array<{ id: string; planImpact: ClarificationPlanImpact; question: string }>;
}

/**
 * Phase 1 shadow 观测：只在「模型给了提案（或 nextAction=propose）、但契约说
 * 还有第一站/停机条件级未知」时返回观测对象；其他情况返回 null（不记日志）。
 * 纯函数，服务端只负责把它写进 logger —— 不改回复、不改阶段、不改持久化。
 */
export function buildClarificationShadowObservation(input: {
  conversationId: string;
  stage: string;
  clarification?: unknown;
  nextAction?: string | null;
  confirmedProposal?: unknown;
}): ClarificationShadowObservation | null {
  if (!input.clarification) return null;
  const proposalPresent = Boolean(input.confirmedProposal) || input.nextAction === 'propose';
  if (!proposalPresent) return null;

  const gate = canProposeClarification(input.clarification);
  if (gate.allowed) return null;

  const contract = normalizeClarificationContract(input.clarification);
  return {
    conversationId: input.conversationId,
    stage: input.stage,
    nextAction: input.nextAction || null,
    coreQuestion: contract.core.question,
    baselineEvidenceCount: contract.baseline.evidence.length,
    stoppingStatement: contract.stopping.statement,
    blocking: gate.blocking.map((gap) => gap.field),
    reasons: gate.reasons,
    unknowns: contract.unknowns.map((unknown) => ({
      id: unknown.id,
      planImpact: unknown.planImpact,
      question: unknown.question,
    })),
  };
}

/**
 * 提案可追溯性检查（最小版）：
 * - 方向/第一站/停机证据必须非空；
 * - 契约里还有未决项时，必须写 assumptions，不能假装没有未知；
 * - 停机证据必须与契约的 stopping.statement 一致（允许措辞不同，但不能为空）。
 * 语义级“每个名词是否能回溯到用户证据”需要 LLM/评测集，这里只做结构门禁。
 */
export function validateProposalTraceability(
  proposal: unknown,
  contractInput: unknown
): ProposalTraceIssue[] {
  const contract = normalizeClarificationContract(contractInput);
  const proposalRecord = asRecord(proposal);
  const issues: ProposalTraceIssue[] = [];

  if (!asString(proposalRecord.direction)) {
    issues.push({ field: 'proposal.direction', reason: '提案缺少方向' });
  }
  if (!asString(proposalRecord.firstStation)) {
    issues.push({ field: 'proposal.firstStation', reason: '提案缺少第一站' });
  }
  if (!asString(proposalRecord.stoppingEvidence)) {
    issues.push({ field: 'proposal.stoppingEvidence', reason: '提案缺少停机证据' });
  }
  if (contract.unknowns.length > 0 && asStringArray(proposalRecord.assumptions).length === 0) {
    issues.push({
      field: 'proposal.assumptions',
      reason: '契约仍有未决项，提案必须写明假设',
    });
  }
  return issues;
}
