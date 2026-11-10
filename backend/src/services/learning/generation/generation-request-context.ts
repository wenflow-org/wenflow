import { getRequestContext, runWithContext, type RequestContext } from '../../../gateway/api-gateway/context';

/**
 * #248：路径生成期的请求上下文。
 *
 * api-gateway 的调用日志只从 `context.pathId` 取 `metadata.pathId`
 * （gateway/api-gateway/executor.ts:1059），而 `agent_call_logs` 里 path-agent 的阶段流水
 * 是另一条写入口（run-lifecycle.recordPathGenerationStageLog）**自带 pathId**。
 * 生成链路如果不把 pathId 放进上下文，同一次生成就会一半有、一半没有：
 * path: 折叠组按 metadata.pathId 找网关行时一条都找不到，「模型」列恒为空。
 *
 * 注意 `POST /paths/generate` 在占位路径创建**之前**就进了 withPathContext(req)（无 pathId），
 * 因此占位路径生成后必须再补一次——这就是本函数存在的理由，两个生成阶段共用同一口径。
 */
export function buildPathGenerationContext(input: {
  userId?: string | null;
  pathId?: string | null;
  sourceConversationId?: string | null;
}): RequestContext {
  const base = getRequestContext();
  return {
    ...base,
    userId: input.userId || base.userId,
    pathId: input.pathId || base.pathId,
    ...(input.sourceConversationId ? { conversationId: input.sourceConversationId } : {}),
  };
}

/**
 * 在「路径生成期的请求上下文」里执行生成体。
 *
 * 生成入口（stage-enrichment / path-generation.core）都必须走这里补 pathId：
 * 只补 userId 时，agent_call_logs 的阶段流水带 pathId、网关行却是 null，
 * path: 折叠组永远关联不到模型名（见 buildPathGenerationContext 头注）。
 */
export function runWithPathGenerationContext<T>(
  input: {
    userId?: string | null;
    pathId?: string | null;
    sourceConversationId?: string | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  return runWithContext(buildPathGenerationContext(input), fn);
}
