import prisma from '../../config/database';
import { REAL_USER_WHERE as REAL_USER_WHERE_UTILS } from '../../utils/test-account';

/**
 * Admin · Token 成本统计 DB 查询单点。
 *
 * 供 `routes/admin/token-cost.ts` 消费：真实用户集合、agent_call_logs 两类行
 * （带 token 的 gateway 行 + 全量调用行）、by-user 用户名邮箱补全。
 * 聚合/缓存/口径逻辑保留在路由（纯计算，不触库）。
 */

/** 真实用户过滤：虚拟/测试账号排除 + 软删排除（与 platform.ts 同口径） */
const REAL_USER_WHERE = {
  ...REAL_USER_WHERE_UTILS,
  deletedAt: null,
};

/** 真实用户 id 集合（includeTest=false 时的 userId 过滤源） */
export async function resolveRealUserIds(): Promise<string[]> {
  const ids = (await prisma.users.findMany({ where: REAL_USER_WHERE, select: { id: true } })).map((u) => u.id);
  return ids;
}

/**
 * 统一数据加载所需的两类行：
 * - 第一项：带 token 的 gateway 行（含 metadata.skillId 解析源）
 * - 第二项：全量行（调用/失败计数）
 */
export function findTokenCostRows(params: {
  since: Date;
  userScope: Record<string, unknown>;
}) {
  const { since, userScope } = params;
  return Promise.all([
    prisma.agent_call_logs.findMany({
      where: { executionLayer: 'api-gateway', tokensUsed: { gt: 0 }, calledAt: { gte: since }, ...userScope },
      select: { metadata: true, userId: true, model: true, tokensUsed: true, promptTokens: true, completionTokens: true, success: true, calledAt: true, sessionId: true, agentId: true },
    }),
    prisma.agent_call_logs.findMany({
      where: { calledAt: { gte: since }, ...userScope },
      select: { agentId: true, success: true, calledAt: true },
    }),
  ]);
}

/** by-user 排行前 N 的用户名邮箱补全 */
export function listUsersBasicInfo(ids: string[]) {
  return prisma.users.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
}
