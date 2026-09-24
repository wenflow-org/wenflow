import 'dotenv/config';
import prisma from '../src/config/database';

async function main() {
  const s = await prisma.teaching_sessions.findFirst({ where: { topic: { contains: '从月度总结中挑一条结论' } }, orderBy: { createdAt: 'desc' } });
  if (!s) { console.log('无会话'); return; }
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    console.log(`${k} = ${String(text).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
