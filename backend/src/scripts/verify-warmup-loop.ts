/* eslint-disable @typescript-eslint/no-explicit-any -- 验证脚本：需直接读会话 blob 与调用协调器私有形态 */
/**
 * 课内温故闭环的**端到端验证**（用当前代码开一节新虚拟课，不用历史数据）。
 *
 * 对应 doc/LEARNING_SCIENCE_AUDIT.md §3.5 的 5 个观测点：
 *   1 计划是否落库（teachingState.sessionArtifacts.memoryWarmup）
 *   2 计划是否到达模型（行为证据：模型能否报出温故点结果——它没看到就问不出来）
 *   3 结果是否摘取（items[].outcome）
 *   4 是否产生 review:completed 证据
 *   5 预算是否分档（successRate 由 null 变为数值；样本 1/1 成功 → 预期 3.0 高档）
 *   6 难度调整锚点是否落库（P0-2；本节没有降档/升档理由时按设计不留痕）
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/verify-warmup-loop.ts [--user=<ID>] [--turns=2] [--start-only]
 *
 * `--start-only`：只开课 + 查观测 1/6，跳过回合与结算（省 LLM 调用）。
 *
 * 注意：会真实开课（LLM 调用 + 写会话/证据数据），目标应为**虚拟学习者**。
 */
import 'dotenv/config';
import prisma from '../config/database';
import { aiTeachingOrchestrator } from '../services/ai-teaching/AITeachingCoordinator';
import { sessionFinalizationService } from '../services/ai-teaching/SessionFinalizationService';
import { reviewCompletedConsumer } from '../services/learner/ReviewCompletedConsumer';
import { DurableEventConsumerRegistry } from '../events/consumer-registry';
import { DurableOutboxWorker } from '../events/outbox.worker';
import { buildReviewPlan } from '../services/memory/review-plan.service';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function readArtifacts(teachingState: unknown): any {
  try {
    const state = typeof teachingState === 'string' ? JSON.parse(teachingState) : teachingState;
    return (state as any)?.sessionArtifacts ?? {};
  } catch {
    return {};
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pickTarget(): Promise<{ userId: string; taskId: string; label: string }> {
  const requested = arg('user');
  const learners = await prisma.users.findMany({
    where: { isVirtualLearner: true, ...(requested ? { id: requested } : {}) },
    select: { id: true, name: true },
  });
  for (const learner of learners) {
    const due = await prisma.memory_traces.count({
      where: { userId: learner.id, dueAt: { lte: new Date() } },
    });
    if (due === 0) continue;
    const task = await prisma.subtasks.findFirst({
      where: {
        userId: learner.id,
        status: { in: ['pending', 'in_progress'] },
      },
      orderBy: { order: 'asc' },
      select: { id: true, title: true },
    });
    if (!task) continue;
    const plan = await buildReviewPlan(learner.id);
    if (plan.items.length === 0) continue;
    return { userId: learner.id, taskId: task.id, label: `${learner.name || learner.id} / ${task.title}` };
  }
  throw new Error('找不到「有到期点 + 有未完成任务」的虚拟学习者');
}

async function main(): Promise<void> {
  const turns = Math.max(1, Number(arg('turns')) || 2);
  const target = await pickTarget();
  console.log(`[verify] 目标：${target.label}`);

  const before = await buildReviewPlan(target.userId);
  console.log(
    `[verify] 开课前计划：items=${before.items.length} backlog=${before.backlogCount} budget=${before.budget} successRate=${before.successRate ?? 'null'}`
  );
  for (const item of before.items) {
    console.log(`         · 「${item.label}」retention=${item.retention.toFixed(2)} load=${item.load} reason=${item.reason}`);
  }

  // ── 开课（真实 LLM 开场）
  const session = await aiTeachingOrchestrator.startSession({ userId: target.userId, taskId: target.taskId });
  const sessionId = session.sessionId;
  console.log(`[verify] 已开课 ${sessionId}｜startSession 返回值带计划=${Array.isArray((session as any).memoryWarmup?.items) ? (session as any).memoryWarmup.items.length : 0} 条`);

  // ── 观测点 1：计划是否落库
  const row1 = await prisma.teaching_sessions.findUnique({ where: { id: sessionId }, select: { teachingState: true } });
  const artifacts1 = readArtifacts(row1?.teachingState);
  const persisted = artifacts1.memoryWarmup;
  const obs1 = !!persisted && Array.isArray(persisted.items) && persisted.items.length > 0;
  console.log(`[verify] 观测1 计划落库=${obs1 ? 'PASS' : 'FAIL'}（items=${persisted?.items?.length ?? 0}）${obs1 ? '' : ' ← 断点1 未修复'}`);

  // ── 观测点 6：难度调整锚点是否落库（P0-2：生产路径此前只有模拟脚本在留痕）
  const anchor = await prisma.learner_evidence.findFirst({
    where: { taskId: target.taskId, evidenceType: 'task:difficulty:adjustment' },
    select: { payload: true },
  });
  console.log(
    `[verify] 观测6 难度锚点落库=${anchor ? 'PASS' : '未触发'}${
      anchor ? ` → ${String(anchor.payload).slice(0, 170)}` : '（本节没有任何降档/升档理由，按设计不留痕）'
    }`
  );

  if (process.argv.includes('--start-only')) {
    console.log('[verify] --start-only：跳过回合与结算（省 LLM 调用）');
    return;
  }

  // ── 回合（学生发言）
  // 说明：本脚本验证的是**管道**，因此第 1 轮由「学生」主动把到期点回忆出来（不依赖模型是否记得先提问）。
  const firstLabel = before.items[0]?.label ?? '上次那个点';
  const studentLines = [
    `老师，我先自己把上次那个点捞一遍：「${firstLabel}」——我的回忆是：只有判断流程走到需要验证的那一步时才触发数据流，触发前要先把验证参数定下来，否则拿回来的数据没法判定。你看这样算想起来了吗？`,
    '我再补一句：参数和触发条件是绑在一起的，缺了参数就没法判定对错。',
    '好，那我们进今天的内容吧。',
  ];
  for (let i = 0; i < turns; i += 1) {
    const beforeTurn = await prisma.teaching_sessions.findUnique({ where: { id: sessionId }, select: { revision: true } });
    const reply = await aiTeachingOrchestrator.processStudentMessage(sessionId, studentLines[Math.min(i, studentLines.length - 1)], {
      expectedRevision: beforeTurn?.revision ?? 0,
    });
    console.log(`[verify] 回合${i + 1} 老师：${String(reply.aiResponse || '').replace(/\s+/g, ' ').slice(0, 150)}`);
    const rowN = await prisma.teaching_sessions.findUnique({ where: { id: sessionId }, select: { teachingState: true } });
    const items: any[] = readArtifacts(rowN?.teachingState).memoryWarmup?.items ?? [];
    const done = items.filter((item) => item?.outcome?.status);
    console.log(
      `[verify] 观测3 结果摘取：已回捞 ${done.length}/${items.length}${done.length ? ` → ${done.map((item) => `${item.label}:${item.outcome.status}`).join('、')}` : ''}`
    );
  }

  // ── 结算（走真实收束路径 → applyWarmupExtraction → review:completed）
  const fresh = await prisma.teaching_sessions.findUnique({ where: { id: sessionId }, select: { revision: true } });
  await sessionFinalizationService.finalize({
    sessionId,
    userId: target.userId,
    action: 'end_only',
    operationId: `verify:${sessionId}:${fresh?.revision ?? 0}`,
    revision: fresh?.revision ?? 0,
    endReason: 'manual-end',
  } as any);

  // 事件派发器只在服务启动时挂载（src/index.ts），脚本里要手动注册并 drain 一次，
  // 否则 review:completed 会留在 outbox 里——这是 harness 缺口，不是产品缺陷。
  const registry = new DurableEventConsumerRegistry();
  registry.register(['review:completed'], async (event) => {
    await reviewCompletedConsumer.handle(event);
  });
  const worker = new DurableOutboxWorker(registry);
  await worker.runOnce();

  // ── 观测点 4：是否产生 review:completed 证据（等 outbox 消费者）
  let evidence: any[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    evidence = await prisma.learner_evidence.findMany({
      where: { sessionId, evidenceType: 'review:completed' },
      select: { evidenceKey: true, confidence: true, payload: true },
    });
    if (evidence.length > 0) break;
    await sleep(1000);
  }
  console.log(`[verify] 观测4 review:completed 证据=${evidence.length ? 'PASS' : 'FAIL'}（${evidence.length} 条）`);
  for (const row of evidence) {
    console.log(`         · ${row.evidenceKey} confidence=${row.confidence} payload=${String(row.payload).slice(0, 120)}`);
  }

  // ── 观测点 5：预算是否分档
  const after = await buildReviewPlan(target.userId);
  const obs5 = after.successRate !== null;
  console.log(
    `[verify] 观测5 成功率/预算：successRate=${after.successRate ?? 'null'} budget=${after.budget}（开课前 budget=${before.budget}）→ ${obs5 ? 'PASS（回校准已激活）' : 'FAIL/暂无样本'}`
  );

  console.log(
    `[verify] 小结：观测1=${obs1 ? 'PASS' : 'FAIL'}｜观测4=${evidence.length ? 'PASS' : 'FAIL'}｜观测5=${obs5 ? 'PASS' : 'FAIL'}｜观测2/3 见上文回合日志`
  );
}

main()
  .catch((error) => {
    console.error('[verify] 失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await aiTeachingOrchestrator.stop();
    await prisma.$disconnect();
  });
