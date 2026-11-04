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
  /** lifecycle 是权威信号（活动 run 推导，见 resolvePathCompletionUserVisible），由调用方投影后注入 */
  findPath: (id: string) => Promise<{ id: string; status: string; lifecycle?: string | null } | null>;
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
  let pathLifecycle: string | null = null;
  let pathStatus: string | null = null;
  if (input.learningPathId) {
    const path = await input.findPath(input.learningPathId);
    if (path) {
      learningPath = { id: path.id, status: path.status };
      pathStatus = path.status;
      pathLifecycle = path.lifecycle ?? null;
    }
  }

  return {
    // #228 残余：这条早退分支原先写死「已生成」，与同一响应体里的 learningPath.status 自相矛盾。
    // 现在与 GET 快照共用同一个分支函数：只有 lifecycle=ready 才说已生成。
    userVisible: resolvePathCompletionUserVisible({
      lifecycle: pathLifecycle,
      status: pathStatus,
      readyText: PATH_COMPLETED_USER_VISIBLE,
    }),
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

/**
 * 路径仍在生成时的用户可见文案。与 /reply（goal-conversation.service.ts 的
 * confirmProposal 同步返回）共用同一句，避免同一操作在两处口径不一（#223）。
 */
export const PATH_GENERATING_USER_VISIBLE =
  '已收到确认，学习路径正在生成，通常 10-60 秒内完成，可前往“学习路径”查看进度。';

/** 路径生成失败时的用户可见文案：如实说失败并可重试，绝不说已生成（#223）。 */
const PATH_GENERATION_FAILED_USER_VISIBLE = '学习路径生成失败，可前往“学习路径”重试。';

/** 路径确已就绪时的用户可见文案（/reply 早退与确认同步返回共用同一句）。 */
export const PATH_COMPLETED_USER_VISIBLE = '学习路径已经生成，可以去查看啦！';

/**
 * 路径完成态文案的**唯一分档**（#223 残余 / #228）——GET 快照与 /reply 都走这里，避免两处各写一套。
 *
 * 权威入参是 `lifecycle`（活动 run 推导：`ready | core_processing | stage_design_processing |
 * stage_design_failed | …`，见 getPathGenerationLifecycle），**不是** `learning_paths.status`：
 * status 在 stage design 窗口恒为 `active`（core 落库时就置 active），只用它必然在 25-50 秒的
 * 阶段设计窗口里谎称「已生成」，与 `/paths/:id/generation-status` 互相打架。
 *
 * - `ready` → readyText（已生成的句式由调用方给：GET 是「学习路径已生成：<名字>」）；
 * - `*_failed` → 失败文案；
 * - 其余（core/stage_design 的 processing / queued / stale）→ 正在生成文案（与 /reply 同源常量）；
 * - `lifecycle` 拿不到时退回 `status`（generating / failed）判定，都拿不到才按 readyText（保持旧行为）。
 */
export function resolvePathCompletionUserVisible(input: {
  lifecycle?: string | null;
  status?: string | null;
  readyText: string;
}): string {
  const lifecycle = typeof input.lifecycle === 'string' && input.lifecycle.length > 0 ? input.lifecycle : null;
  if (lifecycle) {
    if (lifecycle === 'ready') return input.readyText;
    if (lifecycle.endsWith('_failed')) return PATH_GENERATION_FAILED_USER_VISIBLE;
    return PATH_GENERATING_USER_VISIBLE;
  }
  if (input.status === 'generating') return PATH_GENERATING_USER_VISIBLE;
  if (input.status === 'failed') return PATH_GENERATION_FAILED_USER_VISIBLE;
  return input.readyText;
}

/**
 * GET 快照的 userVisible（#213 / #221 / #223 / #228）：字段语义是「用户可见的结果」，不能落成
 * HTTP 层占位串。按状态给值：
 *
 * - 已完成 + 已绑路径：按 `learningPath.lifecycle` 分档（见 resolvePathCompletionUserVisible）——
 *   只有 ready 才说「学习路径已生成：<名字>」；生成中（core / stage design 窗口）说正在生成；
 *   失败（含 stage design 失败）如实报失败。只用 status 判定会在阶段设计窗口谎称已生成（#228）；
 * - 已完成 + 未绑路径 + 存档分诊判硬阻断：复用 /reply 同源的 buildHardBlockResult
 *   重建拒绝文案（#213：保证「当场返回」与「刷新重建」逐字一致）；
 * - 已完成 + 未绑路径 + 非硬阻断：返回 null（无用户可见的终局文案，不臆造）；
 * - 进行中：返回最后一条 assistant 消息文本（用户看到的就是它），没有则 null。
 *
 * 调用方不得再用占位串兜底——null 就是「没有可展示的文案」。
 */
export function resolveConversationUserVisible(input: {
  conversationId: string;
  status: string;
  collectedData: string | null;
  learningPathId: string | null;
  learningPath: { id: string; name?: string | null; status?: string | null; lifecycle?: string | null } | null;
  messages: Array<{ role?: unknown; content?: unknown }> | null | undefined;
}): string | null {
  if (input.status === 'completed') {
    if (input.learningPath) {
      // 会话 completed 只说明确认已落库，不等于路径已生成（#223/#228）：占位路径在确认时就已绑定，
      // 权威信号是活动 run 推导的 lifecycle（status 在 stage design 窗口恒为 active）。
      return resolvePathCompletionUserVisible({
        lifecycle: input.learningPath.lifecycle,
        status: input.learningPath.status,
        readyText: `学习路径已生成：${input.learningPath.name || '未命名路径'}`,
      });
    }
    // 已绑路径但权威行缺失：既不谎称「已生成」，也不误落硬阻断拒绝文案。
    if (input.learningPathId) return null;
    const data = JSON.parse(input.collectedData || '{}');
    const triage = resolveResponseTriageFromCollectedData(data);
    if (!isHardBlockResponseTriage(triage, data.understanding)) return null;
    return buildHardBlockResult(
      {
        conversationId: input.conversationId,
        understanding: data.understanding || {},
        confidence: data.confidence || 0,
        collected: data.collected || {},
      },
      triage as ResponseTriage,
    ).userVisible;
  }

  const messages = Array.isArray(input.messages) ? input.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'ai' && message?.role !== 'assistant') continue;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content;
  }
  return null;
}
