import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const session = await p.virtual_sessions.findFirst({
  where: { id: 'ee795d57-54ea-4051-8da1-9005318cc7c0' },
  select: { id: true, status: true, currentStage: true, currentTaskId: true, updatedAt: true, learningPathId: true }
});

console.log('=== 虚拟学习者会话状态 ===');
if (session) {
  console.log('  session id:', session.id);
  console.log('  status:', session.status);
  console.log('  currentStage:', session.currentStage);
  console.log('  currentTaskId:', session.currentTaskId);
  console.log('  updatedAt:', session.updatedAt);
  console.log('  learningPathId:', session.learningPathId);
  
  // 检查所有 running 会话
  const allRunning = await p.virtual_sessions.findMany({
    where: { status: 'running' },
    select: { id: true, currentStage: true, virtualProfileId: true, updatedAt: true }
  });
  console.log('\n=== 所有 running 会话 ===');
  if (allRunning.length === 0) {
    console.log('  无 running 会话');
  }
  for (const s of allRunning) {
    const prof = await p.virtual_learner_profiles.findUnique({
      where: { id: s.virtualProfileId },
      select: { profile: true }
    });
    const name = prof ? (JSON.parse(prof.profile || '{}').name || 'unknown') : 'unknown';
    console.log(`  ${name} | stage=${s.currentStage} | updated=${s.updatedAt} | id=${s.id.substring(0,12)}`);
  }
  
  // 检查最近活动
  const recentLogs = await p.agent_call_logs.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 30 * 60000) } },
    select: { id: true, createdAt: true, status: true, callerAgent: true, skillId: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('\n=== 最近30分钟 agent 调用 ===');
  if (recentLogs.length === 0) {
    console.log('  无调用（后端可能空闲）');
  }
  for (const l of recentLogs) {
    console.log(`  ${l.createdAt} | ${l.status} | ${l.callerAgent} | ${l.skillId || ''}`);
  }
} else {
  console.log('  会话不存在');
}

await p.$disconnect();
