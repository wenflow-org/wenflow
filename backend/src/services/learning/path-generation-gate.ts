/**
 * 「生成学习路径」这个动作的前置闸门（issue #217）。
 *
 * 背景：硬阻断判定（`response-triage` → `mode:'referral'` → `isHardBlockResponseTriage`）
 * 此前只挂在目标会话链上。`POST /learning/paths/generate` 直接调 `pathOrchestrator.generate`，
 * 入参里没有分诊结论——同一个「平台判不了」的目标（实测：三个月后在婚礼上自弹自唱民谣吉他）
 * 走目标会话得到 `terminal=hard_block`，走 API 却照样建出一条 `status=active` 的路径。
 *
 * 关键约束（第二次评审）：本模块**不做任何基于关键词的可判定性猜测**。
 * 「平台能不能判定这个目标」是 goal 层（LLM understanding）的结论；句子里的乐器/运动词
 * 既会误伤可判定的目标（Python 分析巴赫钢琴曲、吉他教学法、篮球战术分析），
 * 也能被一句「把乐理原理搞清楚」绕过。伪造结论等于把闸门换成另一个语料。
 *
 * 因此闸门口径是**凭证制**（issue #217 建议修法 2）：
 *  - 生成路径这个动作必须携带 goal 层产物（`visibleSummary` 或 `understanding`）；
 *  - 有产物 → 用**同一套** `triageGoalResponse` + `isHardBlockResponseTriage` 判定
 *    （产物里没有 hidden 字段就按 `triageGoalResponse` 既有的「缺字段一律容忍」口径）；
 *  - 命中硬阻断 → 不生成，复用 `goal-conversation.exit.buildHardBlockMessage`（#213 文案）；
 *  - **没有产物 → 拒绝生成**，而不是「缺上下文按可判定处理」放行——放行正是本 issue 的缺陷。
 */
import {
  isHardBlockResponseTriage,
  triageGoalResponse,
  type ResponseTriage,
} from './response-triage';
import { buildHardBlockMessage } from './goal-conversation.exit';

/**
 * goal 层判定凭证。
 *
 * - `responseTriage`：goal 链已算好的分诊结论（最优来源，优先使用）。
 * - `understanding`：goal 层 understanding（可含 `platform_judgment` / `skill_nature` /
 *   `primary_block_type` / `support_need` 等）；直连入口由调用方提供。
 * - `visibleSummary`：goal→path 的确定性投影（`platformJudgment` / `skillNature`）。
 *   目标会话/仿真链路走这个形状。
 *
 * 三者都不存在（或 `understanding` 不含任一判定字段）⇒ 视为「没有判定凭证」⇒ 拒绝。
 */
export interface GoalTriageEvidence {
  responseTriage?: ResponseTriage | null;
  understanding?: Record<string, unknown> | null;
  visibleSummary?: { platformJudgment?: string | null; skillNature?: string | null } | null;
}

export type GoalTriageDecision =
  | { status: 'allowed'; triage: ResponseTriage }
  | { status: 'blocked'; triage: ResponseTriage; message: string }
  | { status: 'unverified'; message: string };

/**
 * 缺少判定凭证时的契约文案（**不是**硬阻断文案）：硬阻断说的是「这类目标平台判不了」，
 * 而这里只是没拿到 goal 层结论，不能冒充前者。
 */
export const GOAL_TRIAGE_REQUIRED_MESSAGE =
  '生成学习路径前需要目标判定结论：请先完成目标对话（平台会判断这个目标能否客观判定），'
  + '再把判定结果随请求一起提交；本入口不会在缺少判定时自行猜测并生成路径。';

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0;
}

/**
 * `understanding` 里被 `response-triage` 真正消费的判定字段（snake / camel 两种命名都认）。
 * 只有带上其中之一，才算「有判定结论」。
 */
const DECISION_KEYS = [
  'platform_judgment', 'platformJudgment',
  'skill_nature', 'skillNature',
  'primary_block_type', 'primaryBlockType',
  'support_need', 'supportNeed',
];

/**
 * 只认「带判定结论」的 understanding。
 *
 * 为什么不能只判非空对象：那样闸门只是从「不发凭证就 201」变成「发任意对象就 201」，
 * `{"x":1}` 照样能造出路径，issue #217 的契约仍然没守住（第五轮独立复核结论）。
 *
 * 注意：这**不**解决「客户端伪造判定」——`{"platform_judgment":"judgeable"}` 仍能被构造。
 * 凭证可信性要靠服务端自算、或读服务端已落库的分诊结论（#217 的后续说明），
 * 那是比这个纯函数大得多的一步，不在这里假装解决。
 */
function hasDecisionEvidence(value: unknown): value is Record<string, unknown> {
  if (!isNonEmptyObject(value)) return false;
  for (const key of DECISION_KEYS) {
    const v = value[key];
    if (typeof v === 'string' && v.trim().length > 0) return true;
  }
  return false;
}

/**
 * 生成路径前的分诊判定（纯函数，无 DB / 无 LLM / 无副作用）。
 * 同一套 `response-triage` 规则，只是把「无凭证」显式判成 `unverified`。
 */
export function evaluateGoalTriageEvidence(
  evidence: GoalTriageEvidence | null | undefined,
): GoalTriageDecision {
  const responseTriage = evidence?.responseTriage || null;
  const visibleSummary = evidence?.visibleSummary || null;
  const providedUnderstanding = hasDecisionEvidence(evidence?.understanding)
    ? evidence.understanding
    : null;

  const hasEvidence = !!responseTriage || !!visibleSummary || !!providedUnderstanding;
  if (!hasEvidence) {
    return { status: 'unverified', message: GOAL_TRIAGE_REQUIRED_MESSAGE };
  }

  const understanding = providedUnderstanding || {
    platform_judgment: visibleSummary?.platformJudgment ?? null,
    skill_nature: visibleSummary?.skillNature ?? null,
  };
  const triage = responseTriage || triageGoalResponse(understanding);
  if (isHardBlockResponseTriage(triage, understanding)) {
    return { status: 'blocked', triage, message: buildHardBlockMessage(triage) };
  }
  return { status: 'allowed', triage };
}

/** 命中硬阻断：message 即目标会话的拒绝文案，`triage` 供日志/遥测。 */
export class PathGenerationBlockedError extends Error {
  readonly code = 'GOAL_NOT_JUDGEABLE';
  readonly triage: ResponseTriage;

  constructor(triage: ResponseTriage) {
    super(buildHardBlockMessage(triage));
    this.name = 'PathGenerationBlockedError';
    this.triage = triage;
  }
}

/** 没有 goal 层判定凭证：拒绝生成（不放行、不猜测）。 */
export class GoalTriageRequiredError extends Error {
  readonly code = 'GOAL_TRIAGE_REQUIRED';

  constructor(message: string = GOAL_TRIAGE_REQUIRED_MESSAGE) {
    super(message);
    this.name = 'GoalTriageRequiredError';
  }
}

/**
 * 生成路径动作的唯一守卫：所有入口（goal 链、仿真、直生成 API、重建兜底）都在
 * `pathOrchestrator.generate` 里过这一道。命中即抛错，调用方不落库。
 */
export function assertPathGenerationAllowed(evidence: GoalTriageEvidence | null | undefined): void {
  const decision = evaluateGoalTriageEvidence(evidence);
  if (decision.status === 'blocked') {
    throw new PathGenerationBlockedError(decision.triage);
  }
  if (decision.status === 'unverified') {
    throw new GoalTriageRequiredError(decision.message);
  }
}
