/** 只读：核对前端点「开始学习」后的课堂会话状态（D 节点走查） */
import 'dotenv/config';
import prisma from '../src/config/database';

async function main() {
  const user = await prisma.users.findFirst({ where: { name: { startsWith: 'uicheck' } }, select: { id: true }, orderBy: { createdAt: 'desc' } });
  const sessions = await prisma.teaching_sessions.findMany({
    where: { userId: user!.id },
    select: { id: true, status: true, mode: true, topic: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  console.log('teaching_sessions =', JSON.stringify(sessions, null, 1));
  for (const s of sessions) {
    const msgs = await prisma.teaching_messages.findMany({ where: { sessionId: s.id }, select: { role: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 6 });
    console.log(`\n会话 ${s.id} status=${s.status} 消息 ${msgs.length} 条：`);
    for (const m of msgs) console.log(`  [${m.role}] ${String(m.content).replace(/\s+/g, " ").slice(0, 160)}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
