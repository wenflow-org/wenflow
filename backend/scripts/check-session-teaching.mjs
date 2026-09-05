import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const session = await p.virtual_sessions.findFirst({
  where: { id: 'ee795d57-54ea-4051-8da1-9005318cc7c0' },
  select: { id: true, status: true, currentStage: true, currentTaskId: true, stageResults: true, updatedAt: true }
});

if (session) {
  console.log('=== Session ===');
  console.log('  status:', session.status);
  console.log('  currentStage:', session.currentStage);
  console.log('  currentTaskId:', session.currentTaskId);
  console.log('  updatedAt:', session.updatedAt);
  
  const sr = typeof session.stageResults === 'string' ? JSON.parse(session.stageResults) : session.stageResults;
  if (sr.teaching) {
    const t = sr.teaching;
    console.log('\n=== Teaching State ===');
    console.log('  teachingSessionId:', t.teachingSessionId);
    console.log('  taskRuntime:', JSON.stringify(t.taskRuntime).substring(0, 200));
    console.log('  conversationHistory:', Array.isArray(t.conversationHistory) ? t.conversationHistory.length + ' messages' : 'N/A');
    if (t.taskRuntime) {
      console.log('  turns:', t.taskRuntime.turns);
      console.log('  status:', t.taskRuntime.status);
      console.log('  error:', t.taskRuntime.error);
    }
  }
}

// Check recent LLM attempts
const recentAttempts = await p.llm_execution_attempts.findMany({
  where: { createdAt: { gte: new Date(Date.now() - 10 * 60000) } },
  select: { id: true, status: true, errorCode: true, errorMessage: true, createdAt: true },
  orderBy: { createdAt: 'desc' },
  take: 5
});
console.log('\n=== Recent LLM Attempts (last 10min) ===');
for (const a of recentAttempts) {
  console.log(`  ${a.createdAt} | ${a.status} | ${a.errorCode || ''} | ${(a.errorMessage || '').substring(0, 60)}`);
}

await p.$disconnect();
