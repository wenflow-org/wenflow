/* eslint-disable no-console -- 一次性案例报告 CLI（只读） */
/**
 * 案例报告：把某虚拟学习者的**路径结构 + 概念图**打印出来（只读）。
 *
 * 用法：npx ts-node --transpile-only scripts/kc-case-report.ts --name="[case] 3-6岁"
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { conceptGraphService } from '../src/services/learner/concept-graph.service';

const NAME = process.argv.find((a) => a.startsWith('--name='))?.slice('--name='.length) || '[case]';

async function main() {
  const user = await prisma.users.findFirst({ where: { name: { contains: NAME } }, select: { id: true, name: true } });
  if (!user) throw new Error(`找不到学习者：${NAME}`);
  console.log(`\n学习者：${user.name} (${user.id})`);

  const paths = await prisma.learning_paths.findMany({
    where: { userId: user.id }, orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, status: true, totalMilestones: true, estimatedHours: true },
  });
  for (const p of paths) {
    console.log(`\n路径 ${p.id}｜${p.title}｜status=${p.status} 里程碑=${p.totalMilestones} 预估${p.estimatedHours}h`);
    const milestones = await prisma.milestones.findMany({
      where: { learningPathId: p.id }, orderBy: { order: 'asc' },
      select: { stageNumber: true, title: true, coreConceptName: true, conceptId: true, subtasks: { orderBy: { order: 'asc' }, select: { title: true, linkedConceptName: true, knowledgeType: true, cognitiveLevel: true, status: true } } },
    });
    for (const m of milestones) {
      console.log(`  阶段${m.stageNumber}｜${m.title}`);
      console.log(`    核心概念：${m.coreConceptName ?? '—'}${m.conceptId ? '（已注册）' : '（未注册）'}`);
      for (const t of m.subtasks) {
        console.log(`      · [${t.status}] ${String(t.title).slice(0, 44)}  ← KC: ${String(t.linkedConceptName ?? '—').slice(0, 28)}${t.knowledgeType ? ` (${t.knowledgeType})` : ''}`);
      }
    }
    const view = await conceptGraphService.buildGraphView(user.id, { pathId: p.id });
    const byRel: Record<string, number> = {};
    for (const e of view.edges) byRel[e.relation] = (byRel[e.relation] ?? 0) + 1;
    console.log(`  图：节点=${view.meta.nodeCount} 边=${view.meta.edgeCount} ${JSON.stringify(byRel)}`);
  }

  const traces = await prisma.memory_traces.count({ where: { userId: user.id } });
  const miscon = await prisma.misconception_ledger.count({ where: { userId: user.id } });
  const done = await prisma.subtasks.count({ where: { userId: user.id, status: 'completed' } });
  const total = await prisma.subtasks.count({ where: { userId: user.id } });
  console.log(`\n痕迹=${traces} 误解=${miscon} 完成任务=${done}/${total}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
