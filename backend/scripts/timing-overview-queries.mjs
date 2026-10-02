/** 临时计时探针（2026-10-01 性能批次）：overview/stats 重算 21s 定位用，可删 */
import { Prisma } from '@prisma/client';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const REAL = { isVirtualLearner: false, deletedAt: null };
const t = async (label, fn) => { const t0 = Date.now(); const r = await fn(); console.log(label.padEnd(36), Date.now() - t0, 'ms', 'rows', Array.isArray(r) ? r.length : (typeof r === 'number' ? '' : Object.keys(r || {}).length || '')); return r; };

const businessExecutionWhere = { OR: [{ executionLayer: 'api-gateway' }, { agentId: { startsWith: 'skill:' } }] };
const realUserScope = { userId: { in: (await prisma.users.findMany({ where: REAL, select: { id: true } })).map((u) => u.id) } };
const week = new Date(Date.now() - 7 * 86400000);
const day = new Date(Date.now() - 86400000);

await t('A trend7d: 7天全行(calledAt,success)', () => prisma.agent_call_logs.findMany({ where: { ...businessExecutionWhere, ...realUserScope, calledAt: { gte: week } }, orderBy: { calledAt: 'asc' }, select: { calledAt: true, success: true } }));
await t('B topSkills: 7天 groupBy×3', async () => {
  await prisma.agent_call_logs.groupBy({ by: ['agentId'], where: { ...businessExecutionWhere, ...realUserScope, calledAt: { gte: week } }, _count: { _all: true } });
  await prisma.agent_call_logs.groupBy({ by: ['agentId'], where: { ...businessExecutionWhere, ...realUserScope, calledAt: { gte: week }, success: false }, _count: { _all: true } });
  return prisma.agent_call_logs.groupBy({ by: ['agentId'], where: { ...businessExecutionWhere, ...realUserScope, calledAt: { gte: week }, success: true }, _count: { _all: true } });
});
await t('C usage失败行: 7天失败全列无LIMIT', () => prisma.agent_call_logs.findMany({ where: { ...businessExecutionWhere, ...realUserScope, calledAt: { gte: week }, success: false }, orderBy: { calledAt: 'desc' } }));
await t('D wrapup: take50 select output', () => prisma.agent_call_logs.findMany({ where: { agentId: 'skill:session-wrapup', ...realUserScope }, orderBy: { calledAt: 'desc' }, take: 50, select: { output: true } }));
await t('E last24h: 24桶行(calledAt,success)', () => prisma.agent_call_logs.findMany({ where: { ...businessExecutionWhere, ...realUserScope, calledAt: { gte: day } }, orderBy: { calledAt: 'asc' }, select: { calledAt: true, success: true } }));
await t('F last24h groupBy bySource等×3', async () => {
  await prisma.agent_call_logs.groupBy({ by: ['sourceEntry'], where: { calledAt: { gte: day } }, _count: { _all: true } });
  await prisma.agent_call_logs.groupBy({ by: ['agentId'], where: { calledAt: { gte: day }, success: true }, _count: { _all: true } });
  return prisma.agent_call_logs.groupBy({ by: ['sourceEntry'], where: { calledAt: { gte: day }, success: false }, _count: { _all: true } });
});
await t('G 全历史 groupBy×2 (10min子缓存)', async () => {
  await prisma.agent_call_logs.groupBy({ by: ['executionLayer'], _count: { _all: true } });
  return prisma.agent_call_logs.groupBy({ by: ['executionLayer'], where: { success: false }, _count: { _all: true } });
});
await t('H 用户活跃 distinct(今日会话)', () => prisma.teaching_sessions.findMany({ where: { users: REAL, startTime: { gte: new Date(new Date().setHours(0,0,0,0)), lt: new Date(Date.now() + 86400000) } }, distinct: ['userId'], select: { userId: true } }));
await t('I llm_execution_attempts agg×2+groupBy', async () => {
  await prisma.llm_execution_attempts.aggregate({ _count: { _all: true } });
  await prisma.llm_execution_attempts.aggregate({ where: { createdAt: { gte: week } }, _count: { _all: true } });
  return prisma.llm_execution_attempts.groupBy({ by: ['model'], where: { createdAt: { gte: week } }, _count: { _all: true } });
});
await prisma.$disconnect();
