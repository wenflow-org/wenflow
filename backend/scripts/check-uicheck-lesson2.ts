import 'dotenv/config';
import prisma from '../src/config/database';

async function main() {
  const user = await prisma.users.findFirst({ where: { name: { startsWith: 'uicheck' } }, select: { id: true }, orderBy: { createdAt: 'desc' } });
  const sessions = await prisma.teaching_sessions.findMany({ where: { userId: user!.id }, select: { id: true, status: true, mode: true, topic: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 3 });
  console.log('teaching_sessions =', JSON.stringify(sessions));
  for (const s of sessions) {
    const msgs = await prisma.teaching_session_messages.findMany({ where: { sessionId: s.id }, select: { payload: true }, orderBy: { id: 'asc' }, take: 6 });
    console.log(`会话 ${s.id} status=${s.status} | 消息 ${msgs.length} 条`);
    msgs.forEach((m) => {
      let role = '?'; let content = '';
      try { const j = JSON.parse(m.payload); role = j.role ?? j.type ?? '?'; content = j.content ?? j.text ?? JSON.stringify(j).slice(0, 120); } catch { content = String(m.payload).slice(0, 120); }
      console.log(`   [${role}] ${String(content).replace(/\s+/g, " ").slice(0, 150)}`);
    });
  }
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const calls = await prisma.prompt_call_logs.groupBy({
    by: ['agentId', 'success'], where: { createdAt: { gte: since } }, _count: { _all: true },
  });
  console.log('\n近 15 分钟调用：', calls.map((c) => `${c.agentId}(success=${c.success})×${c._count._all}`).join(' | '));
  const fails = await prisma.prompt_call_logs.findMany({ where: { createdAt: { gte: since }, success: false }, select: { agentId: true, errorCode: true, errorMessage: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 });
  for (const f of fails) console.log(`  失败 ${f.createdAt.toISOString()} ${f.agentId} [${f.errorCode}] ${String(f.errorMessage).slice(0, 100)}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
