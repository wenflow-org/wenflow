/**
 * Goal 对话的终止态与分诊负向出口结果构造（2026-10-28 抽自 goal-conversation.service）。
 *
 * 为什么单独成文件：硬阻断与「已完成」分支共享同一套 userVisible/internal 形状，
 * 抽出来后 service 只保留状态机判断；同时守住分层棘轮（goal-conversation.service >1000 行）。
 * 纯构造，不直接访问 DB（已完成分支的路径查询由调用方注入 findPath）。
 */
import {
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

export interface HardBlockMessageOptions {
  /** true = completed 会话上已结合用户补充说明重跑分诊、仍被拦后的第二次文案 */
  rejudged?: boolean;
}

/**
 * 硬阻断的原因说明（2026-10-29 诚实文案改写，H-1/H-2）：与实际拦截条件对齐——
 * 硬阻断只拦「平台无法客观判定学习效果」（not_judgeable × 感官/肢体内化）与情绪支持类，
 * 不再复用 referral 的通用建议行（旧行会说「现实条件/资源/流程阻塞」，与对话内已采集画像
 * （器具豆子全齐）直接矛盾）。emotional_support 单独给原因，其余一律按不可判定说明。
 */
function describeHardBlockReason(triage: ResponseTriage | null | undefined): string {
  if (triage?.mode === 'emotional_support') {
    return '你此刻更需要的可能是情绪与信心上的支持，硬排一条练习路径帮不上忙';
  }
  return '平台无法客观判定这类目标的学习效果（结果要靠真实的感官体验才能确认，例如风味、手感、笔锋、音色），线上练习替代不了真人指导';
}

/**
 * 硬阻断终止文案：不生成路径，但「直接回复补充说明，我会重新判断」现在真实有效
 * （completed 会话的 /reply 会走 service 的重判链路，不再 0 秒重放本文案）。
 */
export function buildHardBlockMessage(
  triage: ResponseTriage | null | undefined,
  options?: HardBlockMessageOptions
): string {
  const reason = describeHardBlockReason(triage);
  if (options?.rejudged) {
    return `已结合你的补充说明重新判断，结论不变：${reason}，这次仍不会生成学习路径。\n\n如果想继续，建议换一个知识型框架重新开一场目标对话（例如把目标改成学这项技能背后的方法、原理与判断标准，这些内容平台可以出题练习并客观判定）。`;
  }
  return `这类目标当前不会生成学习路径：${reason}。\n\n如果情况有变化（例如目标改成学其中可判定的方法、原理或知识本身），直接回复这条消息补充说明，我会结合你的补充重新判断。`;
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
