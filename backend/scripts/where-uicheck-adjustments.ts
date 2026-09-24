/** 只读：定位补充说明在载荷中的落点 */
import 'dotenv/config';
import prisma from '../src/config/database';

const NEEDLE = '只练一条结论';

async function main() {
  const row = await prisma.prompt_call_logs.findFirst({
    where: { agentId: 'skill:path-planning', userPayload: { contains: NEEDLE } },
    select: { createdAt: true, userPayload: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) { console.log('未找到'); return; }
  const p = row.userPayload || '';
  console.log('createdAt =', row.createdAt.toISOString(), '| 载荷长度 =', p.length);
  const idx = p.indexOf(NEEDLE);
  console.log('\n--- 落点上下文（前后 300 字）---\n' + p.slice(Math.max(0, idx - 300), idx + 200));
  console.log('\n--- 载荷前 400 字 ---\n' + p.slice(0, 400));
  const keys = (() => { try { return Object.keys(JSON.parse(p)); } catch { return '(非 JSON，是文本载荷)'; } })();
  console.log('\n顶层键 =', Array.isArray(keys) ? keys.join(', ') : keys);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
