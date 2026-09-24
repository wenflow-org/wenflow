/** 只读：concept-consolidator 失败画像（审计 P1 §2.4 最后一条） */
import 'dotenv/config';
import prisma from '../src/config/database';

async function main() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const total = await prisma.prompt_call_logs.count({ where: { agentId: 'skill:concept-consolidator', createdAt: { gte: since } } });
  const failed = await prisma.prompt_call_logs.groupBy({
    by: ['errorCode', 'errorMessage'],
    where: { agentId: 'skill:concept-consolidator', success: false, createdAt: { gte: since } },
    _count: { _all: true },
  });
  console.log(`近 7 天 concept-consolidator：总计 ${total} 条`);
  for (const row of failed.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  失败 ${row._count._all} × [${row.errorCode}] ${String(row.errorMessage).slice(0, 90)}`);
  }
  const allTime = await prisma.prompt_call_logs.groupBy({
    by: ['errorCode'], where: { agentId: 'skill:concept-consolidator', success: false }, _count: { _all: true },
  });
  console.log('全时段失败分布：', allTime.map((r) => `${r.errorCode}×${r._count._all}`).join(' | ') || '(无)');
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
