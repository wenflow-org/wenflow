import prisma from '../../config/database';
import { Prisma } from '@prisma/client';
import { REAL_USER_WHERE as REAL_USER_WHERE_UTILS } from '../../utils/test-account';

/**
 * Admin · Token 成本统计 DB 查询单点。
 *
 * 供 `routes/admin/token-cost.ts` 消费：真实用户集合、窗口聚合与 token 归因分组聚合、
 * by-user 用户名邮箱补全。聚合/缓存/口径逻辑保留在路由（纯计算，不触库）。
 *
 * 2026-10-04 性能改造：原实现在 7 天窗外拉 17.5 万行全量行 + 8.4 万 token 行
 * （metadata 合计 ~100MB，逐行 JSON.parse 取 skillId）到 JS 聚合，实测 28.5s。
 * 改为 SQL 端聚合（json_extract 在 C 层取 skillId，分组基数 ~4k；逐日小窗走
 * calledAt 索引）——纯 IO 查询返回聚合结果，JS 只做装配。
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

/** 时间窗聚合结果（一次扫描）：calls/failed = 全量行口径；tokens = gateway+tokensUsed>0 口径 */
export interface WindowAggregate {
  calls: number;
  failed: number;
  tokens: number;
}

function userScopeSql(realUserIds: string[] | null): Prisma.Sql {
  return realUserIds ? Prisma.sql`AND userId IN (${Prisma.join(realUserIds)})` : Prisma.empty;
}

const toNum = (v: number | bigint | null | undefined): number => Number(v ?? 0);

/**
 * 时间窗聚合：[fromMs, toMs) 一次扫出 调用数 / 失败数 / token 数。
 * toMs=null 表示至当前。calledAt 是 epoch 毫秒整数列。
 * 失败口径：success=0 显式失败（success 为 NULL 的行不计失败，与原 JS `=== false` 口径一致）。
 */
export async function aggregateWindow(
  fromMs: number,
  toMs: number | null,
  realUserIds: string[] | null,
): Promise<WindowAggregate> {
  const upper = toMs == null ? Prisma.empty : Prisma.sql`AND calledAt < ${toMs}`;
  const rows = await prisma.$queryRaw<Array<{ calls: number | bigint; failed: number | bigint | null; tokens: number | bigint | null }>>(Prisma.sql`
    SELECT COUNT(*) AS calls,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN executionLayer = 'api-gateway' AND tokensUsed > 0 THEN tokensUsed ELSE 0 END) AS tokens
    FROM agent_call_logs
    WHERE calledAt >= ${fromMs} ${upper} ${userScopeSql(realUserIds)}
  `);
  const r = rows[0];
  return { calls: toNum(r?.calls), failed: toNum(r?.failed), tokens: toNum(r?.tokens) };
}

/** token 归因分组（skillId × userId × model 组内合计；组基数 ~4k vs 原 8.4 万行外拉） */
export interface TokenGroupAggregate {
  skillId: string | null;
  userId: string | null;
  model: string | null;
  calls: number;
  failed: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * token 行按 (metadata.skillId, userId, model) 分组聚合（json_extract 在 SQLite 端取值，
 * metadata 不再跨进程传输/解析）。条件与旧 findTokenCostRows 第一项一致：
 * executionLayer='api-gateway' AND tokensUsed>0 AND calledAt>=since。
 */
export async function aggregateTokenGroups(
  sinceMs: number,
  realUserIds: string[] | null,
): Promise<TokenGroupAggregate[]> {
  const rows = await prisma.$queryRaw<Array<{
    skillId: string | null;
    userId: string | null;
    model: string | null;
    calls: number | bigint;
    failed: number | bigint | null;
    tokens: number | bigint | null;
    promptTokens: number | bigint | null;
    completionTokens: number | bigint | null;
  }>>(Prisma.sql`
    SELECT json_extract(metadata, '$.skillId') AS skillId,
           userId, model,
           COUNT(*) AS calls,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
           SUM(tokensUsed) AS tokens,
           SUM(promptTokens) AS promptTokens,
           SUM(completionTokens) AS completionTokens
    FROM agent_call_logs
    WHERE executionLayer = 'api-gateway' AND tokensUsed > 0 AND calledAt >= ${sinceMs} ${userScopeSql(realUserIds)}
    GROUP BY skillId, userId, model
  `);
  return rows.map((r) => ({
    skillId: r.skillId ?? null,
    userId: r.userId ?? null,
    model: r.model ?? null,
    calls: toNum(r.calls),
    failed: toNum(r.failed),
    tokens: toNum(r.tokens),
    promptTokens: toNum(r.promptTokens),
    completionTokens: toNum(r.completionTokens),
  }));
}

/** by-user 排行前 N 的用户名邮箱补全 */
export function listUsersBasicInfo(ids: string[]) {
  return prisma.users.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
}
