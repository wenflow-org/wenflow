/**
 * 课堂契约与自由支线（2026-11-19 课堂全面改造）。
 *
 * 设计口径：
 *  - 契约不是「这节课只能学什么」，而是「最低必须完成什么」：1-4 个 coreKc + 独立证据门槛。
 *  - 学生自由需求分型后进支线：clarify/example 是教学内动作；deeper/prerequisite_gap 有预算；
 *    off_topic 进停车区；goal_change 升级到 path 层；test_out 用独立题免修。
 *  - 支线有预算、有账本、有出口；支线正确不算核心 KC 的独立掌握证据。
 *
 * 本模块全部是纯函数（除时间戳），供 lifecycle（建契约）、engine（分支/完成判定）、
 * wrapup（报告）共用；无 IO、无模型调用。
 */
import type { TeachingScenarioContext } from './teaching-context-types';
import { parseSessionArtifacts } from './checkpoint-shared';

export const STUDENT_NEEDS = [
  'answer',
  'clarify',
  'example',
  'deeper',
  'prerequisite_gap',
  'off_topic',
  'goal_change',
  'test_out',
] as const;

export type StudentNeed = typeof STUDENT_NEEDS[number];

export type BranchKind =
  | 'spine'
  | 'clarify'
  | 'example'
  | 'deeper'
  | 'patch'
  | 'park'
  | 'escalate'
  | 'test_out';

export interface LessonCoreKc {
  kcId: string;
  name: string;
}

export interface LessonBranchBudgets {
  /** 每个 KC 最多补几个例子（超出后要求学生自己举例） */
  examplePerKc: number;
  /** 深挖支线最多持续几轮 */
  deeperTurns: number;
  /** 每课最多做几次先修微补 */
  prerequisitePatches: number;
  /** 课内最多回应几次跑题（之后一律停车） */
  offTopicInClassTurns: number;
}

export interface LessonContract {
  version: 1;
  /** 本节课最低必须完成集（不是内容上限） */
  coreKcs: LessonCoreKc[];
  /** 至少几个 coreKc 需要「独立证据」（无提示、首答正确/代码裁决） */
  minIndependentEvidence: number;
  /** 完成前至少经历的教学回合数（防 2 轮秒收） */
  minTurns: number;
  timeBudgetMin: number | null;
  branchBudgets: LessonBranchBudgets;
}

export interface ParkingItem {
  at: string;
  topic: string;
  studentWords?: string | null;
}

export interface BranchState {
  active: BranchKind | null;
  turnsUsed: number;
  budget: number;
  lastNeed: StudentNeed;
  exampleUsedByKc: Record<string, number>;
  /** 本课已使用的深挖轮次（跨支线累计，防止用满后重新开一条） */
  deeperUsed: number;
  patchesUsed: number;
  offTopicTurns: number;
  parkingLot: ParkingItem[];
  /** 下一轮要注入提示词的支线指令（由代码算，模型只执行） */
  directive: string | null;
}

export interface LessonEvidence {
  kcId: string | null;
  kcName: string;
  kind: 'checkpoint' | 'knowledge' | 'test_out' | 'exit-ticket';
  independent: boolean;
  correct: boolean;
  at: string;
  turn: number;
}

/**
 * 课末独立终检题（exit ticket，2026-11-19）。
 *
 * 与课内检查点分离：独立对象、独立生成（teaching-exit-ticket aux skill）、独立证据来源
 * （kind='exit-ticket'）、独立报告字段；每题都是**新情境**，不复用课堂已答过的题。
 * 通过即计入契约独立证据；未通过不冒充证据，由教师补救后再发新题（上一题作废）。
 */
export interface ExitTicket {
  id: string;
  question: string;
  type: 'short_answer' | 'single_choice' | 'multi_choice';
  options?: Array<{ id: string; text: string }>;
  correctOptionIds?: string[];
  expectedKeywords?: string[];
  /** 本题考核的核心 KC 名（必须来自契约 coreKcs） */
  conceptName: string;
  askedAt: string;
  status: 'pending' | 'passed' | 'failed';
  attempts: number;
  judgedBy?: 'code' | 'model-rubric' | 'model-reference';
  passed?: boolean;
  answeredAt?: string;
  answerExcerpt?: string;
  detail?: string | null;
}

export interface LessonContractEvaluation {
  met: boolean;
  coveredKcs: string[];
  missingKcs: string[];
  independentKcs: string[];
  independentCount: number;
  requiredIndependent: number;
  reasons: string[];
}

export interface LessonReport extends LessonContractEvaluation {
  generatedAt: string;
  teachingTurns: number;
  evidence: LessonEvidence[];
  branch: {
    active: BranchKind | null;
    patchesUsed: number;
    offTopicTurns: number;
    examplesUsed: number;
  };
  parkingLot: ParkingItem[];
  /** 课末独立终检（未启用/未发题时缺省） */
  exitTicket?: {
    asked: boolean;
    passed: boolean;
    attempts: number;
    conceptName: string | null;
    judgedBy: string | null;
    question: string | null;
  };
}

const DEFAULT_BUDGETS: LessonBranchBudgets = {
  examplePerKc: 1,
  deeperTurns: 3,
  prerequisitePatches: 1,
  offTopicInClassTurns: 1,
};

const MAX_CORE_KCS = 4;
const MIN_TURNS = 3;
const PATCH_TURNS = 3;

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function dedupeKcs(items: LessonCoreKc[]): LessonCoreKc[] {
  const seen = new Set<string>();
  const out: LessonCoreKc[] = [];
  for (const item of items) {
    const name = String(item.name || '').trim();
    if (!name) continue;
    const kcId = String(item.kcId || '').trim() || `kc_${normalizeName(name)}`;
    const key = kcId || normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kcId, name });
  }
  return out.slice(0, MAX_CORE_KCS);
}

/**
 * 建课契约：优先使用 path-kc-mapping 的 taskKcs；缺 KC 时回退知识种子/核心概念。
 * 纯确定性，不调模型——契约的「必须集」不能由模型每轮改。
 */
export function buildLessonContract(context: TeachingScenarioContext): LessonContract {
  const fromKcs = (Array.isArray(context.taskKcs) ? context.taskKcs : [])
    .map((kc) => ({ kcId: String(kc.kcId || ''), name: String(kc.name || '') }));
  const fromSeeds = (Array.isArray(context.taskKnowledgeSeeds) ? context.taskKnowledgeSeeds : [])
    .map((seed) => ({ kcId: String((seed as any)?.kcId || ''), name: String((seed as any)?.name || '') }));
  const fallback = context.taskProfile?.coreConcept
    ? [{ kcId: '', name: String(context.taskProfile.coreConcept) }]
    : [];
  const coreKcs = dedupeKcs(fromKcs.length > 0 ? fromKcs : fromSeeds.length > 0 ? fromSeeds : fallback);
  return {
    version: 1,
    coreKcs,
    minIndependentEvidence: coreKcs.length > 0 ? Math.max(1, Math.ceil(coreKcs.length / 2)) : 0,
    minTurns: MIN_TURNS,
    timeBudgetMin: Number.isFinite(Number(context.taskEstimatedMinutes))
      ? Math.max(1, Number(context.taskEstimatedMinutes))
      : null,
    branchBudgets: { ...DEFAULT_BUDGETS },
  };
}

export function normalizeStudentNeed(raw: unknown): StudentNeed {
  const value = String(raw ?? '').trim().toLowerCase();
  return (STUDENT_NEEDS as readonly string[]).includes(value) ? value as StudentNeed : 'answer';
}

export function normalizeBranchState(raw: unknown): BranchState {
  const value = raw && typeof raw === 'object' ? raw as Partial<BranchState> : {};
  return {
    active: (typeof value.active === 'string' && value.active) ? value.active as BranchKind : null,
    turnsUsed: Math.max(0, Number(value.turnsUsed) || 0),
    budget: Math.max(0, Number(value.budget) || 0),
    lastNeed: normalizeStudentNeed(value.lastNeed),
    exampleUsedByKc: value.exampleUsedByKc && typeof value.exampleUsedByKc === 'object'
      ? { ...value.exampleUsedByKc as Record<string, number> }
      : {},
    deeperUsed: Math.max(0, Number(value.deeperUsed) || 0),
    patchesUsed: Math.max(0, Number(value.patchesUsed) || 0),
    offTopicTurns: Math.max(0, Number(value.offTopicTurns) || 0),
    parkingLot: Array.isArray(value.parkingLot)
      ? (value.parkingLot as ParkingItem[]).filter((item) => item && typeof item.topic === 'string').slice(-20)
      : [],
    directive: typeof value.directive === 'string' ? value.directive : null,
  };
}

function branchLabel(branch: BranchKind): string {
  switch (branch) {
    case 'deeper': return '深挖';
    case 'patch': return '先修补';
    case 'example': return '举例';
    case 'clarify': return '澄清';
    case 'park': return '停车';
    case 'escalate': return '目标调整';
    case 'test_out': return '免修验证';
    default: return '主线';
  }
}

function focusKcName(contract: LessonContract, focus?: string | null): string {
  const normalized = normalizeName(focus);
  if (normalized) {
    const hit = contract.coreKcs.find((kc) => normalizeName(kc.name) === normalized);
    if (hit) return hit.name;
  }
  return contract.coreKcs.map((kc) => kc.name).slice(0, 2).join('、');
}

function spineDirective(contract: LessonContract): string {
  const names = contract.coreKcs.map((kc) => kc.name).slice(0, 3).join('、');
  return `回到主线：${names || '本课核心 KC'}。支线内容用一句话收束，不再展开。`;
}

export interface BranchDecision {
  branch: BranchKind;
  state: BranchState;
  addParkingItem: ParkingItem | null;
  /** 下一轮载荷注入的指令（代码算；模型只执行） */
  directive: string | null;
}

/**
 * 分支判定（确定性）：模型只报 studentNeed，代码决定进哪条支线、还剩多少预算。
 * 这样自由需求不会悄悄挤掉契约，也不会因为提示词漂移而无限展开。
 */
export function resolveBranchDecision(input: {
  need: StudentNeed;
  contract: LessonContract;
  state: BranchState;
  message?: string | null;
  focusKc?: string | null;
  now?: string;
}): BranchDecision {
  const now = input.now || new Date().toISOString();
  const budgets = input.contract.branchBudgets || DEFAULT_BUDGETS;
  const state: BranchState = {
    ...input.state,
    exampleUsedByKc: { ...input.state.exampleUsedByKc },
    parkingLot: [...input.state.parkingLot],
    lastNeed: input.need,
  };
  let branch: BranchKind = 'spine';
  let addParkingItem: ParkingItem | null = null;
  let directive: string | null = null;

  // 先在入口结算上一轮的支线预算：用满 → 关闭并强制回主线
  let budgetExhausted = false;
  if (state.active) {
    if (state.turnsUsed >= state.budget) {
      budgetExhausted = true;
      state.active = null;
      state.turnsUsed = 0;
      state.budget = 0;
    }
  }

  switch (input.need) {
    case 'clarify':
      branch = 'clarify';
      break;
    case 'example': {
      const key = normalizeName(input.focusKc) || 'default';
      const used = Number(state.exampleUsedByKc[key]) || 0;
      if (used < budgets.examplePerKc) {
        state.exampleUsedByKc[key] = used + 1;
        branch = 'example';
      } else {
        branch = 'spine';
        directive = '举例额度已用完：让学生自己举一个例子或复述，不再由老师追加新例。';
      }
      break;
    }
    case 'deeper':
      if (state.active === 'deeper' && state.turnsUsed < state.budget) {
        state.turnsUsed += 1;
        state.deeperUsed += 1;
        branch = 'deeper';
      } else if (state.deeperUsed < budgets.deeperTurns && state.active !== 'patch') {
        state.active = 'deeper';
        state.turnsUsed = 1;
        state.budget = budgets.deeperTurns;
        state.deeperUsed += 1;
        branch = 'deeper';
      } else {
        branch = 'spine';
        directive = '深挖预算已用尽：一句话回应后回到主线。';
      }
      break;
    case 'prerequisite_gap':
      if (state.patchesUsed < budgets.prerequisitePatches) {
        state.patchesUsed += 1;
        state.active = 'patch';
        state.turnsUsed = 1;
        state.budget = PATCH_TURNS;
        branch = 'patch';
      } else {
        branch = 'park';
        addParkingItem = { at: now, topic: '先修缺口（本课补课额度已用完）', studentWords: String(input.message || '').slice(0, 120) };
        directive = '先修微补额度已用完：把缺口记入停车区，课后安排补课；本轮回到主线。';
      }
      break;
    case 'off_topic':
      if (state.offTopicTurns < budgets.offTopicInClassTurns) {
        state.offTopicTurns += 1;
        branch = 'park';
        addParkingItem = { at: now, topic: String(input.message || '学生提出的主线外问题').slice(0, 60), studentWords: String(input.message || '').slice(0, 120) };
        directive = '跑题问题：用一句话回应并告知已记入停车区，随后回到主线，不展开。';
      } else {
        branch = 'park';
        addParkingItem = { at: now, topic: String(input.message || '主线外问题').slice(0, 60), studentWords: String(input.message || '').slice(0, 120) };
        directive = '课内不再展开跑题问题：只记入停车区，直接回到主线。';
      }
      break;
    case 'goal_change':
      branch = 'escalate';
      state.active = null;
      state.turnsUsed = 0;
      state.budget = 0;
      directive = '学生要改目标：停止本节课契约，明确告知会转入目标/路径重规划，不在课堂里假装完成。';
      break;
    case 'test_out':
      branch = 'test_out';
      state.active = null;
      state.turnsUsed = 0;
      state.budget = 0;
      directive = '免修验证：先出一道独立题（不给提示）；通过则标记该 KC 已掌握并压缩本课，不通过按正常教学继续。';
      break;
    default:
      if (state.active) {
        state.turnsUsed += 1;
        branch = state.active;
      } else {
        branch = 'spine';
      }
      break;
  }

  // 当前在支线：下一轮指令带剩余轮次；预算用尽则强制回主线
  if (state.active) {
    const remaining = Math.max(0, state.budget - state.turnsUsed);
    directive = `${branchLabel(state.active)}支线进行中，剩余 ${remaining} 轮；讲完必须回到主线（${focusKcName(input.contract, input.focusKc)}）。`;
    if (remaining === 0) {
      directive = `${branchLabel(state.active)}支线预算已用尽：本轮一句话收束，然后回到主线（${focusKcName(input.contract, input.focusKc)}）。`;
    }
  } else if (budgetExhausted && !directive) {
    directive = spineDirective(input.contract);
  }

  if (addParkingItem) {
    state.parkingLot = [...state.parkingLot.slice(-19), addParkingItem];
  }
  state.directive = directive;
  return { branch, state, addParkingItem, directive };
}

/** 只读取本轮之前的状态，生成当前轮载荷里的指令（用于「预算已耗尽」在同轮就生效）。 */
export function buildBranchDirective(state: BranchState | null, contract: LessonContract): string | null {
  if (!state || !state.active) return state?.directive || null;
  const remaining = Math.max(0, state.budget - state.turnsUsed);
  if (remaining <= 0) {
    return `${branchLabel(state.active)}支线预算已用尽：本轮先一句话收束，然后回到主线（${contract.coreKcs.map((kc) => kc.name).slice(0, 3).join('、')}）。`;
  }
  return `${branchLabel(state.active)}支线进行中，剩余 ${remaining} 轮；讲完必须回到主线（${contract.coreKcs.map((kc) => kc.name).slice(0, 3).join('、')}）。`;
}

function matchKc(contract: LessonContract, rawName: unknown, rawKcId?: unknown): LessonCoreKc | null {
  const kcId = String(rawKcId ?? '').trim();
  if (kcId) {
    const byId = contract.coreKcs.find((kc) => kc.kcId === kcId);
    if (byId) return byId;
  }
  const name = normalizeName(rawName);
  if (!name) return null;
  const exact = contract.coreKcs.find((kc) => normalizeName(kc.name) === name);
  if (exact) return exact;
  // 模型在看板/检查点里常把 KC 写长或写短（「识别工具返回」vs「识别工具返回的观察结果」）：
  // 中文短语用包含关系兜底（双方至少 3 字），避免契约因命名漂移永远达不成。
  if (name.length >= 3) {
    return contract.coreKcs.find((kc) => {
      const kcName = normalizeName(kc.name);
      return kcName.length >= 3 && (name.includes(kcName) || kcName.includes(name));
    }) || null;
  }
  return null;
}

/**
 * 从检查点历史 + 当前知识看板收敛证据账本。
 * 独立证据 = 代码裁决（judgedBy=code）且首答正确；模型 rubric / 看板 mastered 只算覆盖，不算独立。
 */
export function collectLessonEvidence(input: {
  contract: LessonContract;
  checkpointHistory?: unknown;
  exitTickets?: ExitTicket[];
  knowledgeState?: unknown;
  teachingTurns?: number;
  now?: string;
}): LessonEvidence[] {
  const now = input.now || new Date().toISOString();
  const turn = Math.max(0, Number(input.teachingTurns) || 0);
  const evidence: LessonEvidence[] = [];
  // 课末终检：通过即独立证据（每题都是新题，attempts 恒为 1；模型参考判分不算独立）。
  const exitTickets = Array.isArray(input.exitTickets) ? input.exitTickets : [];
  for (const ticket of exitTickets) {
    if (!ticket || ticket.status !== 'passed' || ticket.passed !== true) continue;
    const kc = matchKc(input.contract, ticket.conceptName);
    if (!kc) continue;
    evidence.push({
      kcId: kc.kcId,
      kcName: kc.name,
      kind: 'exit-ticket',
      independent: ticket.judgedBy !== 'model-reference' && Math.max(1, Number(ticket.attempts) || 1) <= 1,
      correct: true,
      at: String(ticket.answeredAt || ticket.askedAt || now),
      turn,
    });
  }
  const history = Array.isArray(input.checkpointHistory) ? input.checkpointHistory : [];
  for (const row of history) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, any>;
    if (record.passed !== true) continue;
    const kc = matchKc(input.contract, record.conceptName ?? record.knowledgePoint ?? record.conceptKey, record.kcId);
    if (!kc) continue;
    evidence.push({
      kcId: kc.kcId,
      kcName: kc.name,
      kind: 'checkpoint',
      // 独立证据：首答通过且不是「无答案键时的模型参考判分」。代码裁决优先，但简答题的
      // rubric 首答通过也算独立（否则全简答课永远达不成契约，完成率会被人为锁死）。
      independent: record.judgedBy !== 'model-reference' && Math.max(1, Number(record.attempts) || 1) <= 1,
      correct: true,
      at: String(record.answeredAt || record.at || now),
      turn,
    });
  }
  const points = Array.isArray(input.knowledgeState) ? input.knowledgeState : [];
  for (const point of points) {
    if (!point || typeof point !== 'object') continue;
    const record = point as Record<string, any>;
    const mastered = record.status === 'mastered' || Number(record.progress) >= 80;
    if (!mastered) continue;
    const kc = matchKc(input.contract, record.name, record.kcId);
    if (!kc) continue;
    evidence.push({
      kcId: kc.kcId,
      kcName: kc.name,
      kind: 'knowledge',
      independent: false,
      correct: true,
      at: now,
      turn,
    });
  }
  return evidence;
}

export function evaluateLessonContract(input: {
  contract: LessonContract;
  evidence: LessonEvidence[];
  teachingTurns: number;
}): LessonContractEvaluation {
  const { contract } = input;
  if (!contract.coreKcs || contract.coreKcs.length === 0) {
    return {
      met: true,
      coveredKcs: [],
      missingKcs: [],
      independentKcs: [],
      independentCount: 0,
      requiredIndependent: 0,
      reasons: [],
    };
  }
  const coveredKcs: string[] = [];
  const missingKcs: string[] = [];
  const independentKcs: string[] = [];
  for (const kc of contract.coreKcs) {
    const rows = input.evidence.filter((item) => item.correct && (
      (kc.kcId && item.kcId === kc.kcId)
      || normalizeName(item.kcName) === normalizeName(kc.name)
    ));
    if (rows.length > 0) coveredKcs.push(kc.name);
    else missingKcs.push(kc.name);
    if (rows.some((item) => item.independent)) independentKcs.push(kc.name);
  }
  const independentCount = independentKcs.length;
  const reasons: string[] = [];
  if (missingKcs.length > 0) reasons.push(`缺少证据的 KC：${missingKcs.join('、')}`);
  if (independentCount < contract.minIndependentEvidence) {
    reasons.push(`独立证据不足：${independentCount}/${contract.minIndependentEvidence}（支线/提示证据不计入）`);
  }
  if (input.teachingTurns < contract.minTurns) {
    reasons.push(`教学回合不足：${input.teachingTurns}/${contract.minTurns}`);
  }
  return {
    met: missingKcs.length === 0
      && independentCount >= contract.minIndependentEvidence
      && input.teachingTurns >= contract.minTurns,
    coveredKcs,
    missingKcs,
    independentKcs,
    independentCount,
    requiredIndependent: contract.minIndependentEvidence,
    reasons,
  };
}

export function buildLessonReport(input: {
  contract: LessonContract;
  evaluation: LessonContractEvaluation;
  evidence: LessonEvidence[];
  branchState: BranchState;
  teachingTurns: number;
  /** 最近一次课末终检（未发题时缺省）；一旦发过题，未通过即视为契约未达成 */
  exitTicket?: ExitTicket | null;
  now?: string;
}): LessonReport {
  const ticket = input.exitTicket && typeof input.exitTicket === 'object' ? input.exitTicket : null;
  const ticketAsked = !!ticket;
  const ticketPassed = ticket?.status === 'passed';
  const reasons = [...input.evaluation.reasons];
  if (ticketAsked && !ticketPassed) {
    reasons.push(ticket?.status === 'failed'
      ? `课末终检未通过：${ticket.conceptName}（${ticket.detail || '未达到通过标准'}）`
      : `课末终检待作答：${ticket?.conceptName || '核心 KC'}`);
  }
  return {
    ...input.evaluation,
    // 结课报告口径：课末终检一旦发出，就是完成前的最后一道验证——未通过/未作答不算达成。
    met: input.evaluation.met && (!ticketAsked || ticketPassed),
    reasons,
    generatedAt: input.now || new Date().toISOString(),
    teachingTurns: input.teachingTurns,
    evidence: input.evidence.slice(-40),
    branch: {
      active: input.branchState.active,
      patchesUsed: input.branchState.patchesUsed,
      offTopicTurns: input.branchState.offTopicTurns,
      examplesUsed: Object.values(input.branchState.exampleUsedByKc).reduce((sum, value) => sum + (Number(value) || 0), 0),
    },
    parkingLot: input.branchState.parkingLot.slice(-20),
    ...(ticketAsked
      ? {
          exitTicket: {
            asked: true,
            passed: ticketPassed,
            attempts: Math.max(1, Number(ticket?.attempts) || 1),
            conceptName: ticket?.conceptName || null,
            judgedBy: ticket?.judgedBy || null,
            question: ticket?.question || null,
          },
        }
      : {}),
  };
}

/** 课末终检同一节课最多重发几道（失败→教师补救→换新题；用尽仍不过 = 本节课不达标） */
export const MAX_EXIT_TICKET_ATTEMPTS = 2;

/**
 * 把学生的一条自由文本解析成终检作答。
 * 选择题：认选项 id（"B"/"选B"）或选项原文（归一后包含）；多选取所有命中 id。
 * 简答题：整条文本即作答。
 */
export function parseExitTicketSubmission(
  ticket: Pick<ExitTicket, 'type' | 'options'>,
  message: string,
): { selectedOptionIds?: string[]; answerText?: string } {
  const text = String(message ?? '').trim();
  if (ticket.type === 'short_answer') return { answerText: text };
  const options = Array.isArray(ticket.options) ? ticket.options : [];
  const normalized = text.toLowerCase();
  const ids = options
    .filter((option) => {
      if (!option || typeof option.id !== 'string') return false;
      const id = option.id.trim();
      if (!id) return false;
      // 选项 id 作为独立词出现（避免 "A" 命中 "and" 之类的英文单词）
      const idHit = new RegExp(`(^|[^a-z0-9])${id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(normalized);
      const textHit = typeof option.text === 'string'
        && option.text.trim().length >= 2
        && normalized.includes(option.text.trim().toLowerCase());
      return idHit || textHit;
    })
    .map((option) => option.id.trim());
  return { selectedOptionIds: Array.from(new Set(ids)) };
}

export interface LessonContractGate {  /** 建课时已冻结契约且未被环境开关关闭——才允许把「未达成」当硬门 */
  enforced: boolean;
  /** 最近一次回合落库的契约报告是否达成；没有报告按未达成处理（宁可拦在结算前） */
  met: boolean;
  reasons: string[];
}

/**
 * 从已落库的 teachingState 读「契约完成门」（纯读，无 IO）。
 *
 * 唯一口径：只有**建课时持久化**的契约才是硬门（旧会话/测试夹具补建的契约仅观测）；
 * `LESSON_CONTRACT_ENFORCE=0` 是显式应急开关。
 * 结算入口（finalize / VL 收束）共用本函数，避免「一处拦一处漏」。
 */
export function evaluateLessonContractGate(
  teachingState: Record<string, any> | null | undefined,
): LessonContractGate {
  const artifacts = parseSessionArtifacts(teachingState);
  const contract = artifacts.lessonContract as LessonContract | undefined;
  const report = artifacts.lessonReport as LessonReport | undefined;
  const enforced = !!contract
    && Array.isArray(contract.coreKcs)
    && contract.coreKcs.length > 0
    && process.env.LESSON_CONTRACT_ENFORCE !== '0';
  return {
    enforced,
    met: report?.met === true,
    reasons: Array.isArray(report?.reasons) ? report.reasons : [],
  };
}
