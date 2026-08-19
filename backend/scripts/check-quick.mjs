import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const session = await p.virtual_sessions.findFirst({
  where: { id: 'ee795d57-54ea-4051-8da1-9005318cc7c0' },
  select: { id: true, status: true, currentStage: true, stageResults: true, updatedAt: true }
});

if (session) {
  const sr = typeof session.stageResults === 'string' ? JSON.parse(session.stageResults) : session.stageResults;
  const t = sr.teaching || {};
  const tr = t.taskRuntime || {};
  console.log('status:', session.status);
  console.log('stage:', session.currentStage);
  console.log('updatedAt:', session.updatedAt);
  console.log('turns:', tr.turns || 0);
  console.log('taskStatus:', tr.status);
  console.log('taskTitle:', tr.taskTitle);
  console.log('convHistory:', Array.isArray(t.conversationHistory) ? t.conversationHistory.length : 0, 'messages');
  console.log('closureDecision:', JSON.stringify(t.closureDecision).substring(0, 120));
}

await p.$disconnect();
