/** 只读：取 uicheck 用户最新路径（供前端走查导航） */
import 'dotenv/config';
import prisma from '../src/config/database';

async function main() {
  const user = await prisma.users.findFirst({ where: { name: { startsWith: 'uicheck' } }, select: { id: true }, orderBy: { createdAt: 'desc' } });
  if (!user) throw new Error('找不到 uicheck 用户');
  const paths = await prisma.learning_paths.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, status: true, totalMilestones: true, estimatedHours: true, createdAt: true,
      milestones: { orderBy: { stageNumber: 'asc' }, select: { id: true, stageNumber: true, title: true, coreConceptId: true, subtasks: { select: { id: true, title: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  for (const p of paths) {
    console.log(`path ${p.id} | ${p.name} | status=${p.status} | milestones=${p.totalMilestones} | hours=${p.estimatedHours}`);
    for (const m of p.milestones) {
      console.log(`   阶段${m.stageNumber} ${m.title} | concept=${m.coreConceptId ?? '-'} | tasks=${m.subtasks.length} | 首任务=${m.subtasks[0]?.title?.slice(0, 40) ?? '-'}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
