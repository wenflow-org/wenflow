/** 只读：核对前端「补充说明调整剩余部分」是否真的进了 path-planning 载荷（B2） */
import 'dotenv/config';
import prisma from '../src/config/database';

const NEEDLE = '只练一条结论';

async function main() {
  const since = new Date(Date.now() - 30 * 60 * 1000);
  const rows = await prisma.prompt_call_logs.findMany({
    where: { agentId: 'skill:path-planning', createdAt: { gte: since } },
    select: { createdAt: true, success: true, userPayload: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`近 30 分钟 path-planning 调用 ${rows.length} 条`);
  let hit = 0;
  for (const [i, r] of rows.entries()) {
    const p = r.userPayload || '';
    const hasAdj = p.includes(NEEDLE);
    const hasReplan = p.includes('【路径重调模式】');
    const hasReason = p.includes('【用户补充说明】');
    const nested = (() => { try { const j = JSON.parse(p); return j?.normalizedInput?.understanding?.adjustments ?? null; } catch { return null; } })();
    if (hasAdj) hit += 1;
    console.log(`  #${i} ${r.createdAt.toISOString()} success=${r.success} | 含补充说明原文=${hasAdj} | 重调分区=${hasReplan} | 用户补充说明分区=${hasReason} | normalizedInput.understanding.adjustments=${nested ? JSON.stringify(nested).slice(0, 60) : 'null'}`);
  }
  console.log(hit > 0 ? `PASS 有 ${hit} 条载荷带上了补充说明` : 'CHECK 未在载荷里找到补充说明原文');
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
