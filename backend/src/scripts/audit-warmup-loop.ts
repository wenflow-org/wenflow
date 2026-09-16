/**
 * 只读审计：**课内温故（memoryWarmup）闭环在真实数据上到底有没有跑起来**。
 *
 * 背景（2026-09-16 调查，详见 doc/LEARNING_SCIENCE_AUDIT.md §3.2）：
 * 该环曾被认为"已实现但暂无数据"，实测发现是**三处断点导致环完全断电**：
 *   1) `completeInitialization` 重写 sessionArtifacts 时丢掉 memoryWarmup（计划被抹掉）；
 *   2) `generateOpening` 未传 memoryWarmup、回合 context 也不回填 → 模型**从未看到**温故计划；
 *   3) `extractWarmupOutcomes` 依赖同一个 null 计划 → 结果摘取被饿死 → 无 `review:completed` 证据
 *      → `computeLoadBudget` 的 successRate 恒为 null → 预算恒停基准 2.0。
 *
 * 本脚本把上述结论变成可复现的观测量：
 *   每个虚拟学习者：memory_traces 数 / 当前到期数 / 本节温故计划条数与预算 / 成功率 /
 *   近 5 节课是否带计划与带结果 / 末课时间。
 *
 * 只读：不写任何表；`buildReviewPlan` 读取计划本身无副作用。
 *
 * 用法：npx ts-node --transpile-only src/scripts/audit-warmup-loop.ts
 */
import 'dotenv/config';
import prisma from '../config/database';
import { buildReviewPlan } from '../services/memory/review-plan.service';

function hasSessionArtifact(teachingState: unknown, key: string): boolean {
  return JSON.stringify(teachingState ?? '').includes(key);
}

async function main(): Promise<void> {
  const learners = await prisma.users.findMany({
    where: { isVirtualLearner: true },
    select: { id: true, name: true },
  });
  console.log(`虚拟学习者 ${learners.length} 人（到期/计划为当前时刻复算；无 traces 者为 0）`);
  console.log('学习者       traces 到期  计划  预算/占用            成功率  近5课带计划 带结果  末课(UTC)');

  for (const learner of learners) {
    const sessions = await prisma.teaching_sessions.findMany({
      where: { userId: learner.id },
      orderBy: { startTime: 'desc' },
      take: 5,
      select: { startTime: true, teachingState: true },
    });
    const traces = await prisma.memory_traces.count({ where: { userId: learner.id } });
    const dueNow = await prisma.memory_traces.count({
      where: { userId: learner.id, dueAt: { lte: new Date() } },
    });

    let items = -1;
    let budgetText = '(构建失败)';
    try {
      const plan = await buildReviewPlan(learner.id);
      items = plan.items.length;
      budgetText = `budget=${plan.budget} used=${plan.usedLoad} backlog=${plan.backlogCount} sr=${plan.successRate ?? '-'}`;
    } catch (error) {
      budgetText = error instanceof Error ? error.message.slice(0, 40) : String(error);
    }

    const withPlan = sessions.filter((s) => hasSessionArtifact(s.teachingState, 'memoryWarmup')).length;
    const withOutcome = sessions.filter((s) => hasSessionArtifact(s.teachingState, '"outcome"')).length;
    const lastAt = sessions[0]?.startTime
      ? new Date(Number(sessions[0].startTime)).toISOString().slice(0, 16)
      : '(无课时)';

    console.log(
      `${(learner.name || learner.id).slice(0, 10).padEnd(11)} ` +
        `${String(traces).padStart(6)} ${String(dueNow).padStart(4)} ` +
        `${String(items).padStart(5)}  ${budgetText.padEnd(42)} ` +
        `${String(withPlan).padStart(8)} ${String(withOutcome).padStart(5)}  ${lastAt}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
