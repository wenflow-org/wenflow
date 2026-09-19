/**
 * 目标对话生命周期的原子更新（乐观锁）。
 *
 * `goal_conversations.messages` / `collectedData` 是整包 JSON 读改写，并发提交（双击/重试）
 * 会互相覆盖。本模块把「读 → 改 → 写」收敛到一处，并支持 `expectedRevision` CAS：
 * 传入时期望版本失配则**整轮不写库并返回 false**（2026-09-17 审计 §1.4：确认动作缺幂等）。
 *
 * 纯依赖注入（`db`），便于单测；服务层直接传 prisma。
 */

import { runWithTransaction } from '../../utils/with-transaction';

export interface ConversationLifecycleMessage {
  role: 'user' | 'ai';
  content: string;
}

export interface ConversationLifecycleOptions {
  stage: string;
  status?: string;
  completedAt?: Date | null;
  learningPathId?: string | null;
  learningPath?: { id: string; status?: string } | null;
  appendMessage?: ConversationLifecycleMessage;
  mutateCollectedData?: (data: Record<string, unknown>) => void;
  sanitizeContent?: (text: string) => string;
  /** 传值 = 以 revision 条件更新（CAS）；失配返回 false 且不写入任何字段 */
  expectedRevision?: number;
}

interface ConversationRow {
  id: string;
  collectedData: string | null;
  revision: number;
}

export interface ConversationLifecycleTx {
  goal_conversations: {
    findUnique: (args: { where: { id: string } }) => Promise<ConversationRow | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
}

export interface ConversationLifecycleDb extends ConversationLifecycleTx {
  $transaction: <T>(fn: (tx: ConversationLifecycleTx) => Promise<T>) => Promise<T>;
}

/** 内部哨兵：用抛错回滚整轮事务 */
class LifecycleRevisionMismatch extends Error {}

export async function applyConversationLifecycle(
  db: ConversationLifecycleDb,
  conversationId: string,
  options: ConversationLifecycleOptions
): Promise<boolean> {
  try {
    await runWithTransaction(db, async (tx) => {
      const conversation = await tx.goal_conversations.findUnique({ where: { id: conversationId } });
      if (!conversation) throw new Error('对话会话不存在');

      const collectedData = JSON.parse(conversation.collectedData || '{}');
      collectedData.stage = options.stage;
      options.mutateCollectedData?.(collectedData);

      if (options.learningPath !== undefined) {
        collectedData.learningPath = options.learningPath;
      }

      if (options.appendMessage) {
        collectedData.messages = Array.isArray(collectedData.messages) ? collectedData.messages : [];
        collectedData.messages.push({
          role: options.appendMessage.role,
          content: options.sanitizeContent
            ? options.sanitizeContent(options.appendMessage.content)
            : options.appendMessage.content,
          time: new Date().toISOString(),
        });
      }

      const data: Record<string, unknown> = {
        stage: options.stage,
        collectedData: JSON.stringify(collectedData),
        // S1 数据质量修复：messages 列与 collectedData.messages 双写
        ...(options.appendMessage ? { messages: JSON.stringify(collectedData.messages) } : {}),
        status: options.status,
        completedAt: options.completedAt,
        learningPathId: options.learningPathId,
        // 乐观锁：每次生命周期写入都推进版本，供后续 CAS 使用
        revision: { increment: 1 },
      };

      if (options.expectedRevision === undefined) {
        await tx.goal_conversations.update({ where: { id: conversationId }, data });
        return;
      }

      const updated = await tx.goal_conversations.updateMany({
        where: { id: conversationId, revision: options.expectedRevision },
        data,
      });
      if (updated.count !== 1) throw new LifecycleRevisionMismatch();
    }, { label: 'goal-conversation.lifecycle' });
    return true;
  } catch (error) {
    if (error instanceof LifecycleRevisionMismatch) return false;
    throw error;
  }
}
