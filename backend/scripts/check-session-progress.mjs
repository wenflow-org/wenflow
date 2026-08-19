import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const session = await p.virtual_sessions.findFirst({
  where: { id: 'ee795d57-54ea-4051-8da1-9005318cc7c0' },
  select: { id: true, status: true, currentStage: true, currentTaskId: true, stageResults: true, updatedAt: true, learningPathId: true }
});

if (session) {
  console.log('=== Session ===');
  console.log('  status:', session.status);
  console.log('  currentStage:', session.currentStage);
  console.log('  currentTaskId:', session.currentTaskId);
  console.log('  updatedAt:', session.updatedAt);

  const sr = typeof session.stageResults === 'string' ? JSON.parse(session.stageResults) : session.stageResults;
  console.log('\n=== stageResults keys ===');
  console.log('  ', Object.keys(sr).join(', '));

  if (sr.teaching) {
    const t = sr.teaching;
    console.log('\n=== Teaching State ===');
    console.log('  conversationHistory:', Array.isArray(t.conversationHistory) ? t.conversationHistory.length + ' messages' : 'N/A');
    if (t.taskRuntime) {
      console.log('  taskRuntime.status:', t.taskRuntime.status);
      console.log('  taskRuntime.turns:', t.taskRuntime.turns);
      console.log('  taskRuntime.taskId:', t.taskRuntime.taskId);
      console.log('  taskRuntime.taskTitle:', t.taskRuntime.taskTitle);
      console.log('  taskRuntime.error:', (t.taskRuntime.error || '').substring(0, 80));
    }
    if (t.closureDecision) {
      console.log('  closureDecision:', JSON.stringify(t.closureDecision).substring(0, 120));
    }
  }

  // Check path tasks status
  if (session.learningPathId) {
    const path = await p.learning_paths.findUnique({
      where: { id: session.learningPathId },
      include: { milestones: { include: { subtasks: { select: { id: true, title: true, status: true, order: true } } } } }
    });
    if (path) {
      console.log('\n=== Learning Path Tasks ===');
      for (const m of path.milestones) {
        console.log(`  milestone ${m.stageNumber}: ${m.title}`);
        for (const t of m.subtasks) {
          console.log(`    [${t.status || 'todo'}] ${t.title}`);
        }
      }
    }
  }
}

// Count teaching messages
const msgCount = await p.teaching_session_messages.count({
  where: { sessionId: { contains: 'teaching_264ee5a3' } }
}).catch(() => 0);
console.log('\n=== Teaching Messages ===');
console.log('  count:', msgCount);

await p.$disconnect();
