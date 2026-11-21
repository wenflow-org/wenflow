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
import { buildGoalConversationExt } from './goal-conversation.ext';

/**
 * 会话终局类型（2026-11-21 状态机修复）。
 *
 * `goal_conversations.status='completed'` 此前把四种完全不同的结局压成同一个值：
 * 已绑路径、分诊硬阻断、answer-only 直答收口、以及历史遗留的「completed 但无路径」。
 * 前端只能靠 `learningPath`/拒绝文案猜测，于是「无路径完成」被当成「路径已创建」，
 * `/reply` 也把后续输入全部短路成同一句成功的假话。
 *
 * 这里把终局原因显式、持久地写进 `collectedData.terminalKind`（不改表结构），
 * 读侧（信封 / GET / 前端）一律以它为准：
 * - `path_bound`：确认已绑定路径，终局不可再聊；
 * - `hard_blocked`：分诊硬阻断，后续补充说明走重判；
 * - `answer_only`：模型判定一句话直答即收口，没有提案、也不生成路径（可继续补充目标）；
 * - `no_path`：历史遗留/异常无路径终局（同样按可重开处理，绝不谎称已生成）。
 */
export type GoalTerminalKind = 'path_bound' | 'hard_blocked' | 'answer_only' | 'no_path';

export const GOAL_TERMINAL_KIND_KEY = 'terminalKind';
export const GOAL_TERMINAL_AT_KEY = 'terminalAt';

const GOAL_TERMINAL_KINDS: ReadonlySet<GoalTerminalKind> = new Set([
  'path_bound',
  'hard_blocked',
  'answer_only',
  'no_path',
]);

export function isGoalTerminalKind(value: unknown): value is GoalTerminalKind {
  return typeof value === 'string' && GOAL_TERMINAL_KINDS.has(value as GoalTerminalKind);
}

/** 读取已落库终局类型（兼容 snake_case 旧数据），非法值按缺失处理。 */
export function readGoalTerminalKind(data: Record<string, unknown> | null | undefined): GoalTerminalKind | null {
  if (!data) return null;
  const value = data[GOAL_TERMINAL_KIND_KEY] ?? data.terminal_kind;
  return isGoalTerminalKind(value) ? value : null;
}

/** 落库终局标记（collectedData 是整包读改写，额外顶层键会被原样保留）。 */
export function markGoalTerminal(
  data: Record<string, unknown>,
  kind: GoalTerminalKind,
  at: Date = new Date()
): void {
  data[GOAL_TERMINAL_KIND_KEY] = kind;
  data[GOAL_TERMINAL_AT_KEY] = at.toISOString();
}

/** 重开（answer-only / no_path 续聊、硬阻断重判回到 proposing）时清掉终局标记。 */
export function clearGoalTerminal(data: Record<string, unknown>): void {
  delete data[GOAL_TERMINAL_KIND_KEY];
  delete data.terminal_kind;
  delete data[GOAL_TERMINAL_AT_KEY];
}

/**
 * 解析会话终局类型：显式落库值优先；旧数据按「已绑路径 / 硬阻断 / 无路径」确定性回退。
 * 返回 null = 会话尚未终局。
 */
export function resolveGoalTerminalKind(
  data: Record<string, unknown> | null | undefined,
  options: { learningPathId?: string | null; status?: string | null }
): GoalTerminalKind | null {
  const stored = readGoalTerminalKind(data);
  if (stored) {
    // 路径终局必须真有绑定；脏数据（路径被删除但 terminalKind 残留）按无路径处理。
    if (stored === 'path_bound' && !options.learningPathId) return 'no_path';
    return stored;
  }
  if (options.learningPathId) return 'path_bound';
  if (options.status !== 'completed') return null;
  const triage = resolveResponseTriageFromCollectedData(data || {});
  if (isHardBlockResponseTriage(triage, data?.understanding)) return 'hard_blocked';
  return 'no_path';
}

/** 是否是可继续补充/重开的无路径终局（硬阻断另有重判链路）。 */
export function isReopenableGoalTerminal(kind: GoalTerminalKind | null | undefined): boolean {
  return kind === 'answer_only' || kind === 'no_path';
}

export interface GoalExitContext {
  conversationId: string;
  understanding: Record<string, unknown>;
  confidence: number;
  collected: Record<string, unknown>;
  /** Phase 4：澄清契约（存在时分诊不复读身份标签） */
  clarification?: unknown;
}

export interface HardBlockMessageOptions {
  /** true = completed 会话上已结合用户补充说明重跑分诊、仍被拦后的第二次文案 */
  rejudged?: boolean;
}

/**
 * 硬阻断的原因说明（2026-10-29 诚实文案改写，H-1/H-2）：与实际拦截条件对齐——
 * 硬阻断针对平台无法客观判定的目标与情绪支持类，
 * 不再复用 referral 的通用建议行（旧行会说「现实条件/资源/流程阻塞」，与对话内已采集画像
 * （器具豆子全齐）直接矛盾）。emotional_support 单独给原因，其余一律按不可判定说明。
 */
function describeHardBlockReason(triage: ResponseTriage | null | undefined): string {
  if (triage?.mode === 'emotional_support') {
    return '你此刻更需要的可能是情绪与信心上的支持，硬排一条练习路径帮不上忙';
  }
  return '平台无法客观判定这类目标的学习效果，建议用能直接观察结果的方式验证，或请真人指导';
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
        // 硬阻断终局标记（2026-11-05 UX 审计 P0）：completed 信封需要区分
        // 「有路径的正常完成」与「分诊硬阻断、无路径」两态——此前前端把这类信封
        // 与普通完成同样处理，弹出「路径已创建 · 生成中」假成功弹层。
        // outputSchema 未开 additionalProperties，该字段原样透传到前端。
        hardBlocked: true,
        terminalKind: 'hard_blocked' as const,
      },
      ext: {
        goalConversation: buildGoalConversationExt({
          understanding: ctx.understanding,
          collected: ctx.collected,
          clarification: ctx.clarification,
          responseTriage: triage,
        }),
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
  findPath: (id: string) => Promise<{
    id: string;
    status: string;
    lifecycle?: string | null;
    canStartLearning?: boolean | null;
  } | null>;
}) {
  const data = JSON.parse(input.collectedData || '{}');
  const triage = resolveResponseTriageFromCollectedData(data);
  const terminalKind = resolveGoalTerminalKind(data, {
    learningPathId: input.learningPathId,
    status: 'completed',
  });

  if (!input.learningPathId && terminalKind === 'hard_blocked') {
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
  let pathCanStartLearning: boolean | null = null;
  if (input.learningPathId) {
    const path = await input.findPath(input.learningPathId);
    if (path) {
      learningPath = { id: path.id, status: path.status };
      pathStatus = path.status;
      pathLifecycle = path.lifecycle ?? null;
      pathCanStartLearning = path.canStartLearning ?? null;
    }
  }

  // 无路径终局（answer_only / no_path）绝不复述「学习路径已经生成」。
  // 模型直答（answer-only）的收口就是历史里最后一条 AI 文本；旧数据没有文本时给中性说明。
  const noPathText = learningPath
    ? null
    : (lastAssistantTextFromData(data) || PATH_NO_PATH_TERMINAL_USER_VISIBLE);

  return {
    // #228 残余：这条早退分支原先写死「已生成」，与同一响应体里的 learningPath.status 自相矛盾。
    // 现在与 GET 快照共用同一个分支函数：只有 lifecycle=ready（或已可开始学习的渐进式路径）才说已生成。
    userVisible: noPathText ?? resolvePathCompletionUserVisible({
      lifecycle: pathLifecycle,
      status: pathStatus,
      canStartLearning: pathCanStartLearning,
      readyText: PATH_COMPLETED_USER_VISIBLE,
    }),
    internal: {
      core: {
        conversationId: input.conversationId,
        stage: 'completed' as const,
        confidence: data.confidence || 0,
        isCompleted: true,
        learningPath,
        terminalKind: terminalKind || (learningPath ? 'path_bound' : 'no_path'),
      },
      ext: {
        goalConversation: buildGoalConversationExt({
          understanding: data.understanding,
          collected: data.collected,
          clarification: data.clarification,
          // #251③：优先用落库的分诊值；缺失时由 helper 按 understanding 纯函数兜底
          responseTriage: triage,
        }),
      },
    },
  };
}

/**
 * 路径仍在生成时的用户可见文案。与 /reply（goal-conversation.service.ts 的
 * confirmProposal 同步返回）共用同一句，避免同一操作在两处口径不一（#223）。
 */
export const PATH_GENERATING_USER_VISIBLE =
  '已收到确认，学习路径正在生成，通常需要 5-20 分钟（阶段越多越久）。可以先忙别的，稍后回到“学习路径”查看进度。';

/** 路径生成失败时的用户可见文案：如实说失败并可重试，绝不说已生成（#223）。 */
const PATH_GENERATION_FAILED_USER_VISIBLE = '学习路径生成失败，可前往“学习路径”重试。';

/** 路径确已就绪时的用户可见文案（/reply 早退与确认同步返回共用同一句）。 */
export const PATH_COMPLETED_USER_VISIBLE = '学习路径已经生成，可以去查看啦！';

/** 渐进式路径：已有阶段可学、后续阶段仍在准备时的用户可见文案。 */
export const PATH_PARTIAL_READY_USER_VISIBLE =
  '学习路径已经生成，可以先开始学习；后续阶段会随你的学习进度继续准备。';

/** 渐进式路径：已有阶段可学、后续阶段准备失败时的用户可见文案。 */
export const PATH_PARTIAL_DESIGN_FAILED_USER_VISIBLE =
  '学习路径已经生成，可以先开始学习；后续阶段准备遇到问题，可前往“学习路径”重试。';

/** completed 且无路径、又没有可回放的 AI 文本时的中性终局说明（绝不谎称已生成）。 */
export const PATH_NO_PATH_TERMINAL_USER_VISIBLE =
  '本次对话已经结束，没有生成学习路径。如有需要，可以继续补充目标。';

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
  /**
   * 渐进式路径的关键区分：`stage_design_processing/failed` 时已有阶段可能已经可学。
   * true 时不再把「后续阶段还在准备」说成整条路径未生成（学习进度与设计进度分离）。
   */
  canStartLearning?: boolean | null;
  readyText: string;
}): string {
  const lifecycle = typeof input.lifecycle === 'string' && input.lifecycle.length > 0 ? input.lifecycle : null;
  if (lifecycle) {
    if (lifecycle === 'ready') return input.readyText;
    if (input.canStartLearning === true) {
      return lifecycle.endsWith('_failed')
        ? PATH_PARTIAL_DESIGN_FAILED_USER_VISIBLE
        : PATH_PARTIAL_READY_USER_VISIBLE;
    }
    if (lifecycle.endsWith('_failed')) return PATH_GENERATION_FAILED_USER_VISIBLE;
    return PATH_GENERATING_USER_VISIBLE;
  }
  if (input.canStartLearning === true) return PATH_PARTIAL_READY_USER_VISIBLE;
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
 * - 已完成 + 未绑路径 + 存档分诊判硬阻断：优先回传历史里已落库的拒绝文案（初判 A / 重判仍拦截 B，
 *   后者由重判分支落库，#213）；历史里没有拒绝文案时才按当前分诊重建，保证「当场返回」与「刷新重建」一致；
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
  learningPath: {
    id: string;
    name?: string | null;
    status?: string | null;
    lifecycle?: string | null;
    canStartLearning?: boolean | null;
  } | null;
  messages: Array<{ role?: unknown; content?: unknown }> | null | undefined;
}): string | null {
  if (input.status === 'completed') {
    if (input.learningPath) {
      // 会话 completed 只说明确认已落库，不等于路径已生成（#223/#228）：占位路径在确认时就已绑定，
      // 权威信号是活动 run 推导的 lifecycle（status 在 stage design 窗口恒为 active）。
      return resolvePathCompletionUserVisible({
        lifecycle: input.learningPath.lifecycle,
        status: input.learningPath.status,
        canStartLearning: input.learningPath.canStartLearning,
        readyText: `学习路径已生成：${input.learningPath.name || '未命名路径'}`,
      });
    }
    // 已绑路径但权威行缺失：既不谎称「已生成」，也不误落硬阻断拒绝文案。
    if (input.learningPathId) return null;
    const data = JSON.parse(input.collectedData || '{}');
    const triage = resolveResponseTriageFromCollectedData(data);
    // 无路径非阻断终局（answer_only / no_path）：能回放模型收口文本就回放，
    // 没有文本时返回中性说明——绝不落成「学习路径已生成」。
    if (!isHardBlockResponseTriage(triage, data.understanding)) {
      return lastAssistantText(input.messages) || PATH_NO_PATH_TERMINAL_USER_VISIBLE;
    }
    // #213：重判仍被拦截时 /reply 返回的是 B（「已结合你的补充说明重新判断，结论不变…」），
    // 若这里一律按初判重建 A，重载后 B 就消失了。两版文案都含同一句标记，故以「历史里已落库的
    // 那一版」为准；只有历史里根本没有拒绝文案（旧数据）时才重建。
    const persistedRefusal = lastAssistantText(input.messages);
    if (persistedRefusal && persistedRefusal.includes(HARD_BLOCK_REFUSAL_MARKER)) return persistedRefusal;
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

  return lastAssistantText(input.messages);
}

/** 硬阻断拒绝文案的稳定片段：初判版与重判版都含这一句（#213 用它区分「拒绝文案」与普通 AI 回合）。 */
const HARD_BLOCK_REFUSAL_MARKER = '不会生成学习路径';

/** collectedData.messages 里最后一条非空 assistant/ai 文本；取不到返回 null。 */
function lastAssistantTextFromData(data: Record<string, unknown> | null | undefined): string | null {
  const messages = data && Array.isArray(data.messages) ? data.messages : [];
  return lastAssistantText(messages as Array<{ role?: unknown; content?: unknown }>);
}

/** 历史里最后一条非空 assistant/ai 文本；取不到返回 null。 */
function lastAssistantText(
  messages: Array<{ role?: unknown; content?: unknown }> | null | undefined,
): string | null {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (message?.role !== 'ai' && message?.role !== 'assistant') continue;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content;
  }
  return null;
}
