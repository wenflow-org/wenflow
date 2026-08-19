import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const profiles = await p.virtual_learner_profiles.findMany({
  select: { id: true, userId: true, learningGoal: true, knowledgeLevel: true, profile: true },
  take: 15
});
console.log('=== 虚拟学习者列表 ===');
for (const prof of profiles) {
  const data = JSON.parse(prof.profile || '{}');
  const name = data.name || data.nameHint || 'unknown';
  const storyPool = Array.isArray(data.storyPool) ? data.storyPool.length : 0;
  const goal = prof.learningGoal || data.goal || '未设置';
  console.log(`  ${name} | goal=${goal} | stories=${storyPool} | id=${prof.id.slice(0,12)}`);
}

const sessions = await p.virtual_sessions.findMany({
  select: { id: true, status: true, currentStage: true, virtualProfileId: true, learningPathId: true, currentTaskId: true },
  take: 100
});
const byStatus = {};
for (const s of sessions) {
  byStatus[s.status] = (byStatus[s.status] || 0) + 1;
}
console.log('\n=== 会话状态分布 ===');
for (const [k, v] of Object.entries(byStatus)) {
  console.log(`  ${k}: ${v}`);
}

const running = sessions.filter(s => s.status === 'running');
console.log('\n=== 运行中会话 ===');
for (const s of running) {
  const prof = profiles.find(p => p.id === s.virtualProfileId);
  const data = prof ? JSON.parse(prof.profile || '{}') : {};
  console.log(`  ${data.name || 'unknown'} | stage=${s.currentStage} | pathId=${s.learningPathId || 'none'} | taskId=${s.currentTaskId || 'none'}`);
}

await p.$disconnect();
