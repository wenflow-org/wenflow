import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const session = await p.virtual_sessions.findFirst({
  where: { id: 'ee795d57-54ea-4051-8da1-9005318cc7c0' },
  select: { id: true, status: true, currentStage: true, currentTaskId: true, stageResults: true, updatedAt: true, learningPathId: true }
});

if (session) {
  console.log('=== Session State ===');
  console.log('  status:', session.status);
  console.log('  currentStage:', session.currentStage);
  console.log('  currentTaskId:', session.currentTaskId);
  console.log('  updatedAt:', session.updatedAt);
  console.log('  learningPathId:', session.learningPathId);
  
  // Parse stageResults
  const sr = typeof session.stageResults === 'string' ? JSON.parse(session.stageResults) : session.stageResults;
  console.log('\n=== stageResults keys ===');
  for (const key of Object.keys(sr)) {
    const val = sr[key];
    const summary = typeof val === 'object' ? JSON.stringify(val).substring(0, 100) : String(val).substring(0, 100);
    console.log(`  ${key}: ${summary}`);
  }
  
  // Check teaching state specifically
  if (sr.teaching) {
    const t = sr.teaching;
    console.log('\n=== Teaching State ===');
    console.log('  taskRuntime:', JSON.stringify(t.taskRuntime).substring(0, 200));
    console.log('  teachingSessionId:', t.teachingSessionId);
    console.log('  conversationHistory length:', Array.isArray(t.conversationHistory) ? t.conversationHistory.length : 'N/A');
  } else {
    console.log('\n  No teaching state in stageResults');
  }
  
  // Check path review
  if (sr.path_review) {
    console.log('\n=== Path Review ===');
    console.log('  ', JSON.stringify(sr.path_review).substring(0, 200));
  }
}

// Check path with tasks
if (session?.learningPathId) {
  const path = await p.learning_paths.findUnique({
    where: { id: session.learningPathId },
    include: { milestones: { include: { subtasks: true } } }
  });
  if (path) {
    console.log('\n=== Learning Path ===');
    console.log('  title:', path.title);
    console.log('  milestones:', path.milestones.length);
    let totalTasks = 0;
    for (const m of path.milestones) {
      console.log(`  milestone ${m.stageNumber}: ${m.title} (${m.subtasks.length} tasks)`);
      totalTasks += m.subtasks.length;
      for (const t of m.subtasks) {
        console.log(`    task ${t.order}: ${t.title} [status=${t.status || 'pending'}]`);
      }
    }
    console.log('  total tasks:', totalTasks);
  }
}

await p.$disconnect();
