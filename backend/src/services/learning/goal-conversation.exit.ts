/**
 * Goal 对话的终止态与分诊负向出口结果构造（2026-10-28 抽自 goal-conversation.service）。
 *
 * 为什么单独成文件：硬阻断与「已完成」分支共享同一套 userVisible/internal 形状，
 * 抽出来后 service 只保留状态机判断；同时守住分层棘轮（goal-conversation.service >1000 行）。
 * 纯构造，不直接访问 DB（已完成分支的路径查询由调用方注入 findPath）。
 */
import {
  buildTriageAdvisoryLine,
  isHardBlockResponseTriage,
  resolveResponseTriageFromCollectedData,
  type ResponseTriage,
} from './response-triage';

export interface GoalExitContext {
  conversationId: string;
  understanding: Record<string, unknown>;
  confidence: number;
  collected: Record<string, unknown>;
}

/** 硬阻断终止文案：不生成路径，但保留「补充信息后可重新判断」的出口。 */
export function buildHardBlockMessage(triage: ResponseTriage | null | undefined): string {
  const line = buildTriageAdvisoryLine(triage).trim();
  return `${line}\n\n这类目标我不会生成学习路径。如果情况有变化（例如外部条件已解决，或目标改成平台可练习的具体技能），补充说明后我会重新判断。`;
}

export function buildHardBlockResult(ctx: GoalExitContext, triage: ResponseTriage) {
  return {
    userVisible: buildHardBlockMessage(triage),
    internal: {
      core: {
        conversationId: ctx.conversationId,
        stage: 'completed' as const,
        confidence: ctx.confidence,
        isCompleted: true,
        learningPath: null,
      },
      ext: {
        goalConversation: {
          understanding: ctx.understanding,
          nextQuestions: [] as string[],
          quickReplies: [] as string[],
          collected: ctx.collected,
          responseTriage: triage,
        },
      },
    },
  };
}

/**
 * 已完成会话的返回：有路径 → 提示去查看；无路径且分诊判硬阻断 → 继续返回阻断文案，
 * 不能因为 status=completed 就谎称「学习路径已经生成」（F96/F97 复访实证）。
 */
export async function buildCompletedConversationResult(input: {
  conversationId: string;
  collectedData: string | null;
  learningPathId: string | null;
  findPath: (id: string) => Promise<{ id: string; status: string } | null>;
}) {
  const data = JSON.parse(input.collectedData || '{}');
  const triage = resolveResponseTriageFromCollectedData(data);
  if (!input.learningPathId && isHardBlockResponseTriage(triage, data.understanding)) {
    return buildHardBlockResult(
      {
        conversationId: input.conversationId,
        understanding: data.understanding || {},
        confidence: data.confidence || 0,
        collected: data.collected || {},
      },
      triage as ResponseTriage,
    );
  }

  let learningPath = null;
  if (input.learningPathId) {
    const path = await input.findPath(input.learningPathId);
    if (path) learningPath = { id: path.id, status: path.status };
  }

  return {
    userVisible: '学习路径已经生成，可以去查看啦！',
    internal: {
      core: {
        conversationId: input.conversationId,
        stage: 'completed' as const,
        confidence: data.confidence || 0,
        isCompleted: true,
        learningPath,
      },
      ext: {
        goalConversation: {
          understanding: data.understanding || {},
          nextQuestions: [] as string[],
          quickReplies: [] as string[],
          collected: data.collected || {},
        },
      },
    },
  };
}
