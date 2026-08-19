import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

// 查运行中会话的详情
const running = await p.virtual_sessions.findFirst({
  where: { status: 'running' },
  include: { virtual_learner_profiles: true }
});
if (running) {
  const prof = running.virtual_learner_profiles;
  const data = JSON.parse(prof?.profile || '{}');
  console.log('=== 运行中会话 ===');
  console.log('  session id:', running.id);
  console.log('  profile name:', data.name || data.nameHint || 'unknown');
  console.log('  profile id:', running.virtualProfileId);
  console.log('  status:', running.status);
  console.log('  currentStage:', running.currentStage);
  console.log('  learningPathId:', running.learningPathId);
  console.log('  currentTaskId:', running.currentTaskId);
  console.log('  createdAt:', running.createdAt);
  console.log('  updatedAt:', running.updatedAt);
  
  // 查学习路径
  if (running.learningPathId) {
    const path = await p.learning_paths.findUnique({
      where: { id: running.learningPathId },
      include: { milestones: { include: { subtasks: true } } }
    });
    if (path) {
      console.log('\n=== 学习路径 ===');
      console.log('  title:', path.title);
      console.log('  milestones:', path.milestones.length);
      for (const m of path.milestones) {
        console.log(`  milestone ${m.stageNumber}: ${m.title} (${m.subtasks.length} tasks)`);
        for (const t of m.subtasks) {
          console.log(`    task ${t.order}: ${t.title} [${t.status || 'pending'}]`);
        }
      }
    }
  }
  
  // 查 stageResults
  if (running.stageResults) {
    const sr = typeof running.stageResults === 'string' ? JSON.parse(running.stageResults) : running.stageResults;
    console.log('\n=== stageResults keys ===');
    console.log('  ', Object.keys(sr).join(', '));
  }
} else {
  console.log('没有运行中的会话');
}

await p.$disconnect();
