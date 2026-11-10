/**
 * Goal 对话信封里 `internal.ext.goalConversation` 的统一构造（#251③）。
 *
 * 背景：同一条结果在 service / exit 里有多处手写字面量，字段集合各不相同，
 * 于是 responseTriage（服务层已经按 understanding 算出来、并落 collectedData）
 * 只在其中一两处出现；路由层白名单重建再挑一次，HTTP 信封就彻底丢了它。
 * 这里收口成一个函数：分支只传差异字段，responseTriage 默认按同一纯函数补齐。
 *
 * 纯构造，不访问 DB——分层守卫不受影响（本文件远小于 1000 行）。
 */
import { triageGoalResponse, type ResponseTriage } from './response-triage';

export interface GoalConversationExtInput {
  understanding?: Record<string, unknown> | null;
  nextQuestions?: string[];
  quickReplies?: string[];
  collected?: Record<string, unknown> | null;
  /** 显式分诊结论（如落库值 / 待确认提议）；缺省按 understanding 纯函数推导 */
  responseTriage?: ResponseTriage | null;
  /** 分支特有字段（confirmedProposal / structuredData 等） */
  extra?: Record<string, unknown>;
}

export function buildGoalConversationExt(input: GoalConversationExtInput = {}) {
  return {
    understanding: input.understanding || {},
    nextQuestions: input.nextQuestions || [],
    quickReplies: input.quickReplies || [],
    ...(input.extra || {}),
    responseTriage: input.responseTriage ?? triageGoalResponse(input.understanding || {}),
    collected: input.collected || {},
  };
}
