#!/usr/bin/env node
/**
 * #59/#60 修复后读数（本地开发库，只读）
 *
 * 用真实的 LearnerKnowledgeMemoryService.build 取 globalSignals，输出 fragile/struggling/
 * severe/mastered 名单。与 PBL 报告里的旧口径（memory_traces 直算，四位 VL 8-36 个 fragile）
 * 对比，确认证据门 / 最近信号优先 / 幽灵痕排除 / slug 过滤真的生效。
 *
 * 用法：cd backend && npx ts-node --transpile-only scripts/probe-fragile-after-fix.ts [--limit 6]
 */
import prisma from '../src/config/database';
import { learnerKnowledgeMemoryService } from '../src/services/learner/LearnerKnowledgeMemoryService';

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 6 : 6;

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ userId: string; name: string | null; c: bigint }>>(
    `SELECT u.id AS userId, u.name AS name, COUNT(m.id) AS c
       FROM users u JOIN memory_traces m ON m.userId = u.id
      GROUP BY u.id ORDER BY c DESC LIMIT ${LIMIT}`
  );
  console.log('[fragile-after-fix] user | fragile | struggling | severe | mastered | reviewPriority');
  for (const row of rows) {
    const memory = await learnerKnowledgeMemoryService.build({ userId: row.userId });
    const signals = memory.globalSignals;
    const fragile = signals.fragileConcepts || [];
    const struggling = signals.strugglingConcepts || [];
    const severe = (signals as unknown as { severeStrugglingConcepts?: string[] }).severeStrugglingConcepts || [];
    const mastered = signals.masteredConcepts || [];
    console.log(
      `- ${row.name || row.userId}: fragile=${fragile.length} struggling=${struggling.length} severe=${severe.length} mastered=${mastered.length}`
    );
    if (fragile.length) console.log(`    fragile: ${fragile.slice(0, 6).join(' / ')}${fragile.length > 6 ? ' …' : ''}`);
    const junk = fragile.filter((name) => /^concept-\d+$/i.test(name) || /^[A-Za-z0-9]+[_-][A-Za-z0-9_-]+$/.test(name));
    if (junk.length) console.log(`    ⚠ 仍含占位/机器键: ${junk.join(' / ')}`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[fragile-after-fix] 失败：', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
