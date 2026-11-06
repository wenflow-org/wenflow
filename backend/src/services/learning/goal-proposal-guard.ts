/**
 * 「可确认的提案」判据与确认内容门禁（#162）。
 *
 * 确认通道要能放行，前提是会话里**真的有一份提案**：模型某轮没产出 confirmedProposal
 * （或只给了半截）时，确认按钮/自然语言确认都不应代签，否则 bindGeneratingPath 拿到的
 * confirmedProposal 是 null，直接生成一条从未被确认过的路径。
 * 字段口径与 skill 侧 proposal-output 门禁一致（learning_direction / first_deliverable /
 * key_stages，后者至少 2 个有效阶段）。
 */
import { logger } from '../../utils/logger';

export function isConfirmableProposal(proposal: any): boolean {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return false;
  const direction = typeof proposal.learning_direction === 'string' && proposal.learning_direction.trim().length > 0;
  const deliverable = typeof proposal.first_deliverable === 'string' && proposal.first_deliverable.trim().length > 0;
  const stages = Array.isArray(proposal.key_stages)
    && proposal.key_stages.filter((stage: any) => typeof stage === 'string' && stage.trim().length > 0).length >= 2;
  return direction && deliverable && stages;
}

/**
 * 提案内容门禁（#162）：确认通道此前只看 `stage==='proposing' && confirmProposal`，
 * 从不看提案内容——模型这一轮没给提案（confirmedProposal=null）时，按钮/自然语言
 * 照样确认，bindGeneratingPath 直接拿 null 生成一条「还没够就开始建路径」的路径。
 * 判据与 skill 侧门禁同源（promptRole=proposal-output 的 learning_direction /
 * first_deliverable / key_stages；见 skills/goal-conversation 的 proposal-output 门禁）。
 * 没有可用提案时不代签，转向普通回合由模型先补提案。
 */
export function hasConfirmableProposal(
  collectedData: string | null | undefined,
  logContext: { conversationId: string; userId: string; stage: string },
): boolean {
  let snapshotProposal: any = null;
  try {
    snapshotProposal = JSON.parse(collectedData || '{}')?.confirmedProposal ?? null;
  } catch {
    snapshotProposal = null;
  }
  if (isConfirmableProposal(snapshotProposal)) return true;
  logger.warn('[goal-conversation] 确认收到但本会话没有可用提案，不生成路径，按普通回合补提案', {
    conversationId: logContext.conversationId,
    userId: logContext.userId,
    stage: logContext.stage,
    hasProposal: snapshotProposal !== null,
  });
  return false;
}
