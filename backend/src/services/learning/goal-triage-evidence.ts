/**
 * 生成路径闸门的服务端判定凭证（issue #222，`path-generation-gate` 的上游）。
 *
 * 背景：#217 的闸门只校验「请求里有没有判定字段」，于是任何已登录客户端都能写
 * `understanding:{platform_judgment:'judgeable'}` 把平台判死的目标变成可学路径——
 * 守卫的判据来自被守卫方。本模块把判据改回**服务端已落库的结论**：
 * `/paths/generate` 只接受 `sourceConversationId`，由这里按 `id + userId` 读
 * `goal_conversations`，取出目标会话自己的 `understanding` / `responseTriage`，
 * 再交给 `assertPathGenerationAllowed` 走同一套判定。
 *
 * 光「读服务端结论」还不够（#222 复核补强，两条都是实测可复现的绕过）：
 *  1. **凭证必须与本次要生成的目标绑定**：调用方可以挑自己另一场判为 judgeable 的会话
 *     （例：SQL 机考），再拿婚礼吉他的 description 建路径。因此要求
 *     `conversation.description` 与请求的 description 一致（空白归一后逐字相等）——
 *     目标会话链本来就是用 `conversation.description` 作为 rawGoal 生成路径，
 *     这里只是把同一口径搬到直生成 API。
 *  2. **必须是已完成的判定**：goal 服务每回合都会无条件写一条
 *     `responseTriage=triageGoalResponse(understanding)` 兜底（`goal-conversation.service.ts`），
 *     understanding 缺 `primary_block_type` 时它就是 `learning_path/low`
 *     （reasons=「缺少阻塞类型标注，默认按能力缺口处理」）。若把它当凭证，
 *     「没有判定」会被静默读成「可判定」，正是 #217 的病根。因此要求：
 *     会话 `status='completed'`，且 `collectedData.understanding` 里**确有**判定字段
 *     （复用闸门的 `hasGoalDecisionEvidence`，不另立一套口径）。
 *
 * 不满足任一条 → null，调用方按「无凭证」422 拒绝：
 *  - 会话不存在 / 不属于该用户（不区分二者，避免泄露他人会话存在性）；
 *  - 会话未完成、描述与请求目标不一致；
 *  - `collectedData` 不是合法 JSON / understanding 里没有任何判定字段。
 *
 * 请求体里的 `understanding` 不参与放行，`/paths/generate` 已不再接收该字段。
 *
 * #227：同一个闸门还有另一条入口绕过——「既有路径」（带 `existingPathId`）曾被整条豁免，
 * 而 `POST /paths` 能用任意用户文本建出无 goal 产物的空壳路径。本模块因此补上
 * `resolveGoalTriageEvidenceForExistingPath`：既有路径的凭证只认**它自己携带**的服务端
 * 判定产物（模板 `goalFinalPayload.visibleSummary` 里的判定字段 / 关联目标会话已完成的
 * 判定结论），或本次调用补的服务端会话凭证（即上面这套 `resolveGoalTriageEvidenceForUser`）。
 */
import prisma from '../../config/database';
import {
  assertPathGenerationAllowed,
  hasExplicitNoGoalJudgment,
  hasGoalDecisionEvidence,
  type GoalTriageEvidence,
} from './path-generation-gate';
import { findGoalConversationForPathSummary } from './learning-routes.repo';
import { resolveResponseTriageFromCollectedData } from './response-triage';

export interface GoalTriageEvidenceLookup {
  conversationId: string;
  userId: string;
  /** 本次要生成的目标描述；必须与判定会话的目标一致，否则凭证不适用于该目标。 */
  description: string;
}

/** 目标文本归一：折叠空白后逐字比较（不做任何语义/关键词猜测）。 */
export function normalizeGoalDescription(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * `collectedData` 可能是 JSON 字符串（DB 列）或已解析对象（测试/内部调用）。
 * 只认「understanding 里确有判定字段」的会话；仅有兜底 `responseTriage` 不算凭证。
 */
export function parseGoalTriageEvidence(collectedData: unknown): GoalTriageEvidence | null {
  let data: unknown = collectedData;
  if (typeof collectedData === 'string') {
    try {
      data = JSON.parse(collectedData);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;

  const record = data as Record<string, unknown>;
  if (!hasGoalDecisionEvidence(record.understanding)) return null;

  const understanding = record.understanding as Record<string, unknown>;
  return {
    understanding,
    responseTriage: resolveResponseTriageFromCollectedData(record),
  };
}

/**
 * 读本用户某场目标会话的分诊结论，并校验它与本次目标绑定。
 * 任一条件不满足返回 null（调用方据此 422）；DB 故障照常抛出（服务端故障，不伪装成 422）。
 */
export async function resolveGoalTriageEvidenceForUser(
  input: GoalTriageEvidenceLookup
): Promise<GoalTriageEvidence | null> {
  const conversationId = (input.conversationId || '').trim();
  const description = normalizeGoalDescription(input.description);
  if (!conversationId || !description) return null;

  const conversation = await prisma.goal_conversations.findFirst({
    where: { id: conversationId, userId: input.userId },
    select: { collectedData: true, description: true, status: true },
  });
  if (!conversation) return null;

  // 未完成的会话没有终局判定：goal 服务每回合写的 responseTriage 是兜底值，不能当凭证。
  if (conversation.status !== 'completed') return null;
  // 凭证只对「同一目标」有效：借用另一场 judgeable 会话为别的目标建路径必须被拒。
  if (normalizeGoalDescription(conversation.description) !== description) return null;

  return parseGoalTriageEvidence(conversation.collectedData);
}

// ---------------------------------------------------------------------------
// 既有路径（重新生成 / 整条重建 / 失败重试）的判定凭证（#227）
// ---------------------------------------------------------------------------

/** 既有路径行：路由层与 coordinator 各自已加载/自取的字段子集。 */
export interface ExistingPathTriageTarget {
  id: string;
  userId: string;
  aiPromptTemplate?: string | null;
  description?: string | null;
  title?: string | null;
  name?: string | null;
  /** 服务端生成管线建的路径标记；只有它能为「存量失败占位」兜底（见解析器第 3 档）。 */
  aiGenerated?: boolean | null;
}

export interface ExistingPathTriageLookup {
  path: ExistingPathTriageTarget;
  /** 本次调用实际下发的服务端会话凭证（重新生成请求体的 sourceConversationId），缺省无。 */
  sourceConversationId?: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredTemplate(raw?: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstNonEmptyText(values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** 模板里存的来源目标会话 id（goal 链落库；与 `extractStoredSourceConversationId` 同口径）。 */
function extractStoredConversationId(template: Record<string, unknown> | null): string | null {
  if (!template) return null;
  const goalFinalPayload = isPlainObject(template.goalFinalPayload) ? template.goalFinalPayload : null;
  const generation = isPlainObject(template._generation) ? template._generation : null;
  const candidates = [
    goalFinalPayload?.sourceConversationId,
    isPlainObject(template.normalizedInput) ? template.normalizedInput.sourceConversationId : null,
    isPlainObject(template.generationStatus) ? template.generationStatus.sourceConversationId : null,
    // `_generation.sourceConversationId`（run-lifecycle 写生成状态时带的出处，见 #227 复核）
    generation?.sourceConversationId,
    template.sourceConversationId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * 既有路径重建/重试的判定凭证（#227，`path-generation-gate` 的上游）。
 *
 * 背景：闸门原先用「带 existingPathId」豁免——只要这条路径**存在**就整条跳过唯一守卫。
 * 但 `POST /learning/paths` 能用任意用户文本建出一条 `status=active`、0 里程碑、
 * 无任何 goal 产物的空壳路径（`aiPromptTemplate` 只有显式「无判定」标记），
 * 于是「建空壳 → `regenerate?mode=rebuild-all`」两步就能建出完整可学路径，
 * 而整条链路从未产生过服务端 goal 判定（#227 三名探路者实测复现）。
 *
 * 因此豁免前提改成「**这条路径自身携带服务端产出的 goal 判定**」，按优先级解析：
 *  1. 模板 `goalFinalPayload.visibleSummary` 里**确有判定字段**（`platformJudgment` /
 *     `skillNature`，复用闸门的 `hasGoalDecisionEvidence`，不另立口径）；
 *  2. 该路径关联的目标会话（服务端在生成时回写 `goal_conversations.learningPathId`，或模板里
 *     存的 `sourceConversationId` / `_generation.sourceConversationId`）已 `completed`，
 *     且其 `collectedData.understanding` **确有判定字段**（同一套严格口径，复用
 *     `parseGoalTriageEvidence`）——即 #222 认定的可信来源；
 *  3. 存量「服务端生成占位」路径的救援档：`aiGenerated=true`、有 `path_generation_runs`
 *     记录、模板里从未出现 `goalFinalPayload`。此类路径由服务端生成管线创建、用户无从伪造
 *     （`POST /paths` 建的空壳是 `aiGenerated=false` 且无 run），其目标已被改写成学习者口径、
 *     补不上 #222 凭证；若一并拒绝，『失败占位重试』会稳定 422（#227 复核实测的回归）。
 *     见 `GoalTriageEvidence.serverGeneratedPlaceholder` 的不可利用性论证。
 *  4. 本次调用带来的服务端会话凭证（#222 那套：按 id + userId 读库，且必须与路径目标
 *     逐字一致），供「路径建自旧数据、自己不带判定」时补凭证。
 *
 * 四条都解析不出 → null，调用方按「无凭证」拒绝（422 / `GOAL_TRIAGE_REQUIRED`）。
 * 空壳路径（模板只有显式无判定标记）不会有会话可关联，稳定落在这一支。
 *
 * 注意本解析器**不采信**：请求体自报的判定、以及 goal 服务每回合无条件写的兜底
 * `responseTriage`（缺 `primary_block_type` 时它形如 `learning_path/low`，把它当凭证
 * 正是 #217/#222 的病根；#227 复核指出上一版在此处又开了这道口子，已移除）。
 */
export async function resolveGoalTriageEvidenceForExistingPath(
  input: ExistingPathTriageLookup
): Promise<GoalTriageEvidence | null> {
  const path = input.path;
  if (!path?.id || !path.userId) return null;

  const template = parseStoredTemplate(path.aiPromptTemplate);
  // 显式「无 goal 判定」（`POST /paths` 的空壳路径）：直接判无凭证，不再猜。
  if (hasExplicitNoGoalJudgment(template)) return null;

  const goalFinalPayload = isPlainObject(template?.goalFinalPayload) ? template.goalFinalPayload : null;
  const visibleSummary = isPlainObject(goalFinalPayload?.visibleSummary)
    && Object.keys(goalFinalPayload!.visibleSummary as Record<string, unknown>).length > 0
    ? goalFinalPayload!.visibleSummary as GoalTriageEvidence['visibleSummary']
    : null;

  // 1) 模板自身带判定字段的投影 → 采信（硬阻断由闸门按同一口径拦下）。
  // 先于任何 DB 查询：模板已是权威结论时不该因为关联会话查询失败而把重建打回
  // （学员端「画像回灌 fail-open」的既有契约）。
  if (visibleSummary && hasGoalDecisionEvidence(visibleSummary)) {
    return { visibleSummary };
  }

  // 目标文本：优先路径自己的原始目标（未受历次重建标记污染），其次面向学习者的字段。
  const goalText = firstNonEmptyText([
    goalFinalPayload?.rawGoal,
    path.description,
    path.title,
    path.name,
  ]);

  // 关联会话：模板存的来源会话优先（与 path-regeneration 的回灌口径一致），
  // 其次按 learningPathId 找（服务端生成的路径才会被回写该指针，客户端无法指定）。
  const storedConversationId = extractStoredConversationId(template);
  const linked = await findGoalConversationForPathSummary(storedConversationId, path.id, path.userId);
  const linkedCompleted = !!linked && linked.status === 'completed';

  // 2) 关联目标会话的终局判定（严格：understanding 必须有判定字段）。
  if (linkedCompleted) {
    const linkedEvidence = parseGoalTriageEvidence(linked?.collectedData);
    if (linkedEvidence) return linkedEvidence;
    // 模板投影 + 已完成目标会话，但两处都没判定字段：这是旧提示词版本的 goal 产物
    // （实测存量 25/44 条路径如此），创建时平台就是按这个结论收下的。采信投影本身比
    // 采信会话里每回合写的兜底 responseTriage 更保守，也不会把整批存量路径打成 422。
    if (visibleSummary) return { visibleSummary };
  }

  // 3) 存量服务端生成占位的救援档（见上）。只认「服务端建的、尝试过生成、无 goal 产物」。
  if (await isServerGeneratedPlaceholder(path)) {
    return { serverGeneratedPlaceholder: true };
  }

  // 4) 本次调用带来的服务端凭证：只认已落库结论，且必须与路径目标绑定（#222 口径）。
  const conversationId = typeof input.sourceConversationId === 'string' ? input.sourceConversationId.trim() : '';
  if (conversationId && goalText) {
    return resolveGoalTriageEvidenceForUser({
      conversationId,
      userId: path.userId,
      description: goalText,
    });
  }

  return null;
}

/**
 * 是否属于「服务端生成管线建的存量占位/失败路径」——用户不可伪造：
 *  - `aiGenerated=true`：`POST /learning/paths` 建的空壳是 false；
 *  - 该路径名下确有 `path_generation_runs` 记录：run 只由服务端认领时创建；
 *  - 模板里从来没出现过 `goalFinalPayload`：有 goal 产物的路径走上面更严的档位。
 */
async function isServerGeneratedPlaceholder(path: ExistingPathTriageTarget): Promise<boolean> {
  if (path.aiGenerated !== true) return false;
  const template = parseStoredTemplate(path.aiPromptTemplate);
  if (template && isPlainObject(template.goalFinalPayload)) return false;
  const runCount = await prisma.path_generation_runs.count({ where: { learningPathId: path.id } });
  return runCount > 0;
}

/**
 * 既有路径重建/重试的闸门预检入口（#227）：解析本路径自己的判定凭证并断言放行。
 *
 * 学员端 regenerate / retry 与管理端救援都在**认领 run 之前**调它，好把拒绝变成 422，
 * 而不是「200 + 后台失败 + 路径被打成 failed」。判定与 `pathOrchestrator.generate` 里的
 * 守卫逐字同源（同一个解析器 + 同一个 `assertPathGenerationAllowed`）。
 *
 * **不要**把 `buildGoalPathRequestFromConversation` / `buildStoredGoalPathRequest` 现算出的
 * `visibleSummary` 传进来当凭证（#227 复核实测的绕过面）：那两个函数不看目标会话 status，
 * 而 `evaluateGoalTriageEvidence` 只要拿到非空 visibleSummary 就放行，于是「模板为 null +
 * 关联了一场未完成会话」的路径会在路由层被放行、绕开本解析器自己的 completed 契约。
 */
export async function assertExistingPathGoalTriageAllowed(
  path: ExistingPathTriageTarget,
  sourceConversationId: string | null = null
): Promise<GoalTriageEvidence> {
  const evidence = await resolveGoalTriageEvidenceForExistingPath({ path, sourceConversationId });
  assertPathGenerationAllowed(evidence);
  return evidence as GoalTriageEvidence;
}

/**
 * 只拿得到 pathId 的调用方（`path.coordinator.generate` 的闸门）用这个入口：
 * 自取路径行后走同一套解析，保证「闸门口径」与路由层预检完全一致。
 */
export async function resolveGoalTriageEvidenceForPathId(input: {
  pathId: string;
  userId: string;
  sourceConversationId?: string | null;
}): Promise<GoalTriageEvidence | null> {
  const pathId = (input.pathId || '').trim();
  if (!pathId) return null;

  const path = await prisma.learning_paths.findFirst({
    where: { id: pathId, userId: input.userId },
    select: {
      id: true,
      userId: true,
      aiPromptTemplate: true,
      // 存量服务端生成占位的救援档需要它（#227 复核：不取就整批复核为 422）
      aiGenerated: true,
      description: true,
      title: true,
      name: true,
    },
  });
  if (!path) return null;

  return resolveGoalTriageEvidenceForExistingPath({
    path,
    sourceConversationId: input.sourceConversationId,
  });
}
