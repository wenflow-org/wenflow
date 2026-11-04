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
 *
 * #222 补充：凭证的**来源**由调用方保证——
 *  - 目标会话/仿真链路：凭证来自服务端自己的 goal 产物（`visibleSummary` / `responseTriage`）；
 *  - 直生成 API（`POST /learning/paths/generate`）：凭证由
 *    `services/learning/goal-triage-evidence` 从 `goal_conversations.collectedData` 读取，
 *    请求体里的 `understanding` 不再下传（那是「客户端自断言 judgeable」的绕过面）。
 *    本模块本身仍只做纯函数判定，不读 DB。
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
  /**
   * 最后一条凭证来源（#227 复核补）：这条既有路径是**服务端生成管线**创建并尝试过的
   * 存量**占位**路径（`aiGenerated=true`、有 `path_generation_runs` 记录、模板里从未出现
   * `goalFinalPayload`）。它没有可解析的判定产物、目标描述也被服务端改写成学习者口径
   * （与任何会话的 description 都不逐字相等），因此既解析不出结论、也补不上 #222 凭证；
   * 若一并拒绝，这类「生成失败待救援」的路径会稳定 422（复核实测的回归）。
   *
   * 为什么它不可被攻击者利用：`POST /learning/paths` 建出的路径 `aiGenerated=false`、
   * 没有任何 run、模板是显式「无 goal 判定」标记，**永远走不到这一档**；用户也无法
   * 自行创建 `path_generation_runs` 行或改写模板。命中这一档时按「无更优结论」处理
   * （即 `triageGoalResponse({})` 的默认路径判定），只用于放行服务端失败路径的救援。
   */
  serverGeneratedPlaceholder?: boolean;
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
  + '并在请求里提交该会话的 sourceConversationId；本入口只认服务端已落库的判定结论，'
  + '不采信请求体自带的判定，也不会在缺少判定时自行猜测并生成路径。';

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
 * 注意：本函数不看凭证**由谁产生**——`{"platform_judgment":"judgeable"}` 这种形状照样能通过。
 * 凭证可信性由调用方保证（#222）：直生成 API 已改为从 `goal_conversations.collectedData`
 * 读取服务端结论，不再下传请求体里的 understanding（见 `goal-triage-evidence.ts`）。
 * 该模块复用本函数判定「这场会话是否真的产出了判定结论」，所以这里必须是唯一口径。
 */
export function hasGoalDecisionEvidence(value: unknown): value is Record<string, unknown> {
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
  const providedUnderstanding = hasGoalDecisionEvidence(evidence?.understanding)
    ? evidence.understanding
    : null;

  const hasEvidence = !!responseTriage || !!visibleSummary || !!providedUnderstanding;
  if (!hasEvidence) {
    // 存量服务端生成占位（失败救援档，见 `GoalTriageEvidence.serverGeneratedPlaceholder`）：
    // 没有任何判定产物可解析，按「无更优结论」走默认分诊（`triageGoalResponse({})`），
    // 与这条路径当初被创建时的口径一致——不把「生成失败」二次判成「无凭证」。
    if (evidence?.serverGeneratedPlaceholder) {
      const triage = triageGoalResponse({});
      return { status: 'allowed', triage };
    }
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
 * 生成路径动作的守卫：命中即抛错，调用方不落库。`pathOrchestrator.generate` 用它守住
 * goal 链 / 仿真 / 直生成 API / 重建 / 重试；重建类入口（学员端 regenerate、失败 retry、
 * 管理端救援）还会在认领 run 之前用它做一次预检，好把拒绝变成 422 而不是后台失败。
 *
 * **不是**「所有生成动作都过这一道」：`learning.service` 的 core 自动恢复
 * （`recoverStaleGeneratingPaths` → `this.generateLearningPath`）绕开 coordinator 直接
 * 调生成，不经过本守卫。该旁路重放的是服务端自己落库的 `inputSnapshot`（用户无法注入
 * 文本），故未纳入；这里如实记录，不再声称覆盖所有入口（#227 复核）。
 *
 * 准入前提分两类（#227 订正，此前文档声称「所有入口都在这一道」是不准确的）：
 *  - **新建路径**：本次调用必须携带 goal 层判定凭证（`GoalTriageEvidence`）；
 *  - **既有路径**（重新生成 / 整条重建 / 失败重试）：豁免的唯一前提是**这条路径自身
 *    携带服务端产出的 goal 判定**（模板 `goalFinalPayload.visibleSummary` 的判定字段，
 *    或它关联的已完成目标会话），或本次调用带了与目标绑定的服务端会话凭证。
 *    「带 existingPathId」本身不是豁免理由——`POST /paths` 能用任意用户文本建出
 *    `status=active`、0 里程碑、无 goal 产物的空壳路径，它同样是「一条已存在的行」。
 *    路径侧凭证的解析在 `goal-triage-evidence.resolveGoalTriageEvidenceForExistingPath`
 *    （读 DB，故不放在本纯函数模块里）。
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

/**
 * `POST /learning/paths`（手工建路径，无任何 goal 层输入）落库时写入的显式标记：
 * 「这条路径**没有** goal 判定」。此前该情形留下 `aiPromptTemplate = null`，
 * 而「旧数据（可能是 goal 链产物）也常常是 null」，一个空值同时表示两件事（#227）。
 * 现在空壳路径有显式 `goalJudgment: null`，闸门读侧据此直接判定无凭证、不再去猜。
 */
export const MANUAL_PATH_PROMPT_TEMPLATE = JSON.stringify({ source: 'manual', goalJudgment: null });

/** 模板里是否带显式「无 goal 判定」标记（`POST /paths` 的空壳路径）。 */
export function hasExplicitNoGoalJudgment(template: unknown): boolean {
  if (!template || typeof template !== 'object') return false;
  const record = template as Record<string, unknown>;
  return record.source === 'manual' && record.goalJudgment === null;
}
