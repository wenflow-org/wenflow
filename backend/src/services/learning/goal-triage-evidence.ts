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
 */
import prisma from '../../config/database';
import {
  hasGoalDecisionEvidence,
  type GoalTriageEvidence,
} from './path-generation-gate';
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
