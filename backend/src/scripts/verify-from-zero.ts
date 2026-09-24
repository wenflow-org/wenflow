/* eslint-disable @typescript-eslint/no-explicit-any -- 验证脚本：需读会话 blob 与多处返回形状 */
/**
 * **从零验证**：新建虚拟学习者 → 生产链路生成路径 → 上课 → 跨天 → 再上课，逐项核对整条闭环。
 *
 * 与前几个验证脚本的区别：那些都建立在**带历史包袱**的既有学习者上（几十条遗留 trace、几十条到期），
 * 本脚本从**空库**开始，因此能回答一个更硬的问题：**这套东西在没有历史数据时能不能自己长出来？**
 *
 * 观测点（全部用当前代码、真实 LLM）：
 *   0 造人：users(isVirtualLearner) + virtual_learner_profiles + 人设
 *   1 路径：learning_paths + milestones + subtasks
 *   2 第 1 节课（**从零**）：应当**没有温故**（没有到期点）；课后应长出 memory_traces / 学习状态行
 *   3 跨天（模拟到 +3 天）：第 2 节课应当**有温故**（第 1 节的点到期了）——这条同时验证"读侧走模拟时钟"
 *   4 温故结果入库：learner_evidence 出现 review:completed（含 elapsedDays）
 *   5 难度锚点：出现 task:difficulty:adjustment（若有理由）
 *
 * 用法：npx ts-node --transpile-only src/scripts/verify-from-zero.ts [--turns=2] [--days=3]
 */
import 'dotenv/config';
import prisma from '../config/database';
import pathOrchestrator from '../coordinators/path.coordinator';
import { aiTeachingOrchestrator } from '../services/ai-teaching/AITeachingCoordinator';
import { sessionFinalizationService } from '../services/ai-teaching/SessionFinalizationService';
import { reviewCompletedConsumer } from '../services/learner/ReviewCompletedConsumer';
import { DurableEventConsumerRegistry } from '../events/consumer-registry';
import { DurableOutboxWorker } from '../events/outbox.worker';
import { provisionVirtualProfile } from '../virtual-lab/learner-provisioning';
import { runWithSimulatedClock } from '../services/virtual-lab/simulation-clock-context';
import { buildReviewPlan } from '../services/memory/review-plan.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const ok = (label: string, pass: boolean, detail = '') =>
  console.log(`[zero] ${pass ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);

/** 取第一个未完成的任务（阶段任务由后台任务异步生成，可能还没有） */
async function pickTask(userId: string): Promise<{ id: string; title: string } | null> {
  return prisma.subtasks.findFirst({
    where: { userId, status: { not: 'completed' } },
    orderBy: { order: 'asc' },
    select: { id: true, title: true },
  });
}

async function drainOutbox(): Promise<void> {
  const registry = new DurableEventConsumerRegistry();
  registry.register(['review:completed'], async (event) => {
    await reviewCompletedConsumer.handle(event);
  });
  await new DurableOutboxWorker(registry).runOnce();
}

/** 跑一节课：开课 → N 个学生回合 → 结算。返回开课时的温故计划条数。 */
/**
 * 虚拟学习者作答检查点（2026-09-17）。
 *
 * 为什么需要：检查点此前**从不出题/从不被作答**（实测最近 60 个会话零检查点、零证据）⇒
 * 独立成功率带（§7 P1-1）永远没有样本。这里让端到端把「出题 → 代码裁决 → 证据留痕」真的跑一遍。
 * 作答策略**可复算**：`correct=true` 按答案键作答、`false` 故意答错，从而同时覆盖两条判定路径。
 * 返回裁决结果（含从证据回读的 `judgedBy`，因此这条也顺带验证了证据写入）。
 */
async function answerPendingCheckpoint(
  sessionId: string,
  correct: boolean,
): Promise<{ checkpointId: string; type: string; passed: boolean; judgedBy: string | null } | null> {
  const row = await prisma.teaching_sessions.findUnique({
    where: { id: sessionId },
    select: { teachingState: true, revision: true },
  });
  let state: Record<string, any> = {};
  try {
    state = JSON.parse(String(row?.teachingState ?? '{}'));
  } catch {
    return null;
  }
  const checkpoint = state?.pendingCheckpoint ?? state?.sessionArtifacts?.pendingCheckpoint ?? null;
  if (!checkpoint?.id) return null;

  const payload: { selectedOptionIds?: string[]; answerText?: string } = {};
  if (checkpoint.type === 'short_answer') {
    const keywords: string[] = Array.isArray(checkpoint.expectedKeywords) ? checkpoint.expectedKeywords : [];
    payload.answerText = correct ? keywords.join('，') : '我想不起来了';
  } else {
    const optionIds: string[] = (checkpoint.options || []).map((option: any) => option?.id).filter(Boolean);
    const key: string[] = Array.isArray(checkpoint.correctOptionIds) ? checkpoint.correctOptionIds : [];
    payload.selectedOptionIds = correct ? key : optionIds.filter((id) => !key.includes(id)).slice(0, 1);
    if (!payload.selectedOptionIds || payload.selectedOptionIds.length === 0) return null;
  }

  const result = await aiTeachingOrchestrator.submitCheckpoint(
    sessionId,
    checkpoint.id,
    payload,
    row?.revision ?? 0,
  );
  // judgedBy 不在返回值里：从留痕里回读（同时验证证据确实写进去了）
  const evidence = await prisma.learner_evidence.findFirst({
    where: { evidenceKey: `checkpoint:result:${checkpoint.id}` },
    orderBy: { occurredAt: 'desc' },
    select: { payload: true },
  });
  let judgedBy: string | null = null;
  try {
    judgedBy = JSON.parse(String(evidence?.payload ?? '{}'))?.judgedBy ?? null;
  } catch {
    judgedBy = null;
  }
  return { checkpointId: checkpoint.id, type: checkpoint.type, passed: result.passed === true, judgedBy };
}

async function runLesson(input: {
  userId: string;
  taskId: string;
  turns: number;
  studentLines: string[];
}): Promise<{ sessionId: string; warmupItems: number; planLabels: string[]; originTitles: string[]; checkpointResults: Array<{ checkpointId: string; type: string; passed: boolean; judgedBy: string | null }> }> {
  const session = await aiTeachingOrchestrator.startSession({ userId: input.userId, taskId: input.taskId });
  const sessionId = session.sessionId;
  const row = await prisma.teaching_sessions.findUnique({
    where: { id: sessionId },
    select: { teachingState: true },
  });
  let plan: any = null;
  try {
    plan = (JSON.parse(String(row?.teachingState ?? '{}')) as any)?.sessionArtifacts?.memoryWarmup ?? null;
  } catch {
    plan = null;
  }
  const labels: string[] = Array.isArray(plan?.items) ? plan.items.map((item: any) => String(item.label)) : [];
  const originTitles: string[] = Array.isArray(plan?.items)
    ? plan.items.map((item: any) => String(item?.originPathTitle ?? '')).filter(Boolean)
    : [];

  const checkpointResults: Array<{ checkpointId: string; type: string; passed: boolean; judgedBy: string | null }> = [];
  for (let i = 0; i < input.turns; i += 1) {
    const current = await prisma.teaching_sessions.findUnique({ where: { id: sessionId }, select: { revision: true } });
    await aiTeachingOrchestrator.processStudentMessage(
      sessionId,
      input.studentLines[Math.min(i, input.studentLines.length - 1)],
      { expectedRevision: current?.revision ?? 0 },
    );
    // 若本轮出了检查点，虚拟学习者作答（交替对/错，覆盖两条判定路径）
    const answered = await answerPendingCheckpoint(sessionId, i % 2 === 0).catch(() => null);
    if (answered) checkpointResults.push(answered);
  }
  const fresh = await prisma.teaching_sessions.findUnique({ where: { id: sessionId }, select: { revision: true } });
  await sessionFinalizationService.finalize({
    sessionId,
    userId: input.userId,
    action: 'end_only',
    operationId: `zero:${sessionId}:${fresh?.revision ?? 0}`,
    revision: fresh?.revision ?? 0,
    endReason: 'manual-end',
  } as never);
  await drainOutbox();
  return { sessionId, warmupItems: labels.length, planLabels: labels, originTitles, checkpointResults };
}

async function main(): Promise<void> {
  const turns = Math.max(1, Number(arg('turns')) || 2);
  const days = Math.max(1, Number(arg('days')) || 3);
  const stamp = new Date().toISOString().slice(0, 16);

  // ── 0 造人
  const provisioned = await provisionVirtualProfile({
    name: `[from-zero] ${stamp}`,
    learningGoal: '能独立看懂并复述一篇科普文章里的核心论证',
    tags: ['from-zero-verify'],
    notes: '从零验证：空库起步',
  });
  const user = await prisma.users.findUnique({
    where: { id: provisioned.userId },
    select: { id: true, name: true, isVirtualLearner: true },
  });
  ok('0 造人', user?.isVirtualLearner === true, `user=${provisioned.userId.slice(0, 8)} profile=${provisioned.profileId.slice(0, 8)}`);

  // ── 1 路径（生产链路：pathOrchestrator.generate，含 path-reviewer）
  const goal = '能独立看懂并复述一篇科普文章里的核心论证';
  await pathOrchestrator.generate({
    userId: provisioned.userId,
    description: goal,
    userProfile: { skillLevel: '零基础', timePerDay: '30 分钟', learningGoal: goal } as any,
  });
  const path = await prisma.learning_paths.findFirst({
    where: { userId: provisioned.userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });
  const milestones = path
    ? await prisma.milestones.count({ where: { learningPathId: path.id } })
    : 0;
  // 阶段任务由**后台任务**生成（runBackgroundTask('learning.path.stage-enrichment')），
  // generate() 返回时还没有任务 → 必须等（生产线里由前端轮询 run 状态）。
  // 窗口可用 --wait=<秒> 调整：网关慢时（实测单次 150s+）三个里程碑的阶段设计要跑好几分钟，
  // 固定 150s 会把"还在生成"误判成"没生成"。
  const waitSeconds = Math.max(60, Number(arg('wait')) || 600);
  const waitDeadline = Date.now() + waitSeconds * 1000;
  let waited = 0;
  let task = await pickTask(provisioned.userId);
  while (!task && Date.now() < waitDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    waited += 5;
    task = await pickTask(provisioned.userId);
  }
  if (waited) console.log(`[zero] 等待阶段任务生成 ${waited}s`);
  ok('1 路径', Boolean(path && milestones > 0 && task), `path=${path?.id.slice(0, 10)} milestones=${milestones} 首任务=${task?.title ?? '(无)'}（等待 ${waited}s / 上限 ${waitSeconds}s）`);
  if (!path || !task) throw new Error('路径/任务未生成，无法继续');

  const tracesBefore = await prisma.memory_traces.count({ where: { userId: provisioned.userId } });
  ok('1b 空库起步', tracesBefore === 0, `起步时 memory_traces=${tracesBefore}（应为 0）`);

  // ── 2 第 1 节课：从零 → 没有到期点 → 不应温故
  const lesson1 = await runLesson({
    userId: provisioned.userId,
    taskId: task.id,
    turns,
    studentLines: ['老师好，我们开始吧。', '我先自己试着说说我的理解。', '嗯，我记下了。'],
  });
  const tracesAfter1 = await prisma.memory_traces.count({ where: { userId: provisioned.userId } });
  const states1 = await prisma.learning_metrics.count({ where: { userId: provisioned.userId, metricType: 'learning_state' } });
  const reviewEvidence1 = await prisma.learner_evidence.count({ where: { userId: provisioned.userId, evidenceType: 'review:completed' } });
  ok('2 首课无温故（没有到期点）', lesson1.warmupItems === 0, `warmupItems=${lesson1.warmupItems}`);
  ok('2b 课后长出记忆条目', tracesAfter1 > 0, `memory_traces=${tracesAfter1}（起步 0）`);
  ok('2c 课后落学习状态', states1 > 0, `learning_state 行=${states1}`);
  ok('2d 首课不产生复习证据', reviewEvidence1 === 0, `review:completed=${reviewEvidence1}`);

  // ── 3 跨天（模拟 +N 天）：第 2 节课应当有温故（同时验证读侧走模拟时钟）
  const asOf = new Date(Date.now() + days * DAY_MS);
  const lesson2 = await runWithSimulatedClock(asOf, () =>
    runLesson({
      userId: provisioned.userId,
      taskId: task.id,
      turns,
      studentLines: [
        '老师，我准备好了。',
        '我把上次那个点回忆一下：核心论证是作者的主张加上支撑理由，缺一不可。',
        '再补一句：理由要能回答"为什么这个主张成立"。',
      ],
    }),
  );
  const planNow = await buildReviewPlan(provisioned.userId);
  ok(
    `3 跨 ${days} 天后有温故（读侧走模拟时钟）`,
    lesson2.warmupItems > 0,
    `warmupItems=${lesson2.warmupItems}${lesson2.planLabels.length ? ` → ${lesson2.planLabels.join('、')}` : ''}`,
  );

  // ── 4 温故结果入库
  const reviewEvidence2 = await prisma.learner_evidence.findMany({
    where: { userId: provisioned.userId, evidenceType: 'review:completed' },
    select: { payload: true },
    orderBy: { occurredAt: 'desc' },
    take: 3,
  });
  ok('4 温故结果入库', reviewEvidence2.length > 0, reviewEvidence2.map((row) => String(row.payload).slice(0, 110)).join(' ｜ '));

  // ── 6 记忆条目带来源路径（A′ 的前置：溯源；写入时从会话带入）
  const tracesWithPath = await prisma.memory_traces.count({
    where: { userId: provisioned.userId, pathId: { not: null } },
  });
  const tracesAll = await prisma.memory_traces.count({ where: { userId: provisioned.userId } });
  ok('6 记忆条目带来源路径', tracesWithPath > 0, `${tracesWithPath}/${tracesAll} 条有 pathId`);

  // ── 7 温故项能说清来源（**首次温故即可**，不再依赖"曾经复习过"）
  ok(
    '7 温故项带来源路径',
    lesson2.originTitles.length > 0,
    lesson2.originTitles.length > 0 ? lesson2.originTitles.join('、') : '（无来源标题）',
  );

  // ── 8 检查点：代码裁决 + 留痕（独立传感器；§7 P1-1 的前置）
  const checkpointEvidence = await prisma.learner_evidence.findMany({
    where: { userId: provisioned.userId, evidenceType: 'checkpoint:result' },
    select: { payload: true },
    orderBy: { occurredAt: 'desc' },
    take: 5,
  });
  const judgedByCode = checkpointEvidence.filter((row) => {
    try {
      return JSON.parse(String(row.payload))?.judgedBy === 'code';
    } catch {
      return false;
    }
  }).length;
  ok(
    '8 检查点由代码裁决并留痕',
    judgedByCode > 0,
    `${judgedByCode}/${checkpointEvidence.length} 条 judgedBy=code｜本课作答 ${lesson2.checkpointResults.length} 次：` +
      lesson2.checkpointResults
        .map((item) => `${item.type}=${item.passed ? '通过' : '不通过'}(${item.judgedBy ?? '无证据'})`)
        .join('、') || '（本轮未出检查点）',
  );

  // ── 5 难度锚点 / 保持曲线
  const anchors = await prisma.learner_evidence.count({
    where: { userId: provisioned.userId, evidenceType: 'task:difficulty:adjustment' },
  });
  console.log(`[zero] INFO 5 难度锚点=${anchors}（无理由时按设计为 0）；当前计划 backlog=${planNow.backlogCount} successRate=${planNow.successRate ?? 'null'}`);
  console.log(`[zero] 学习者 id=${provisioned.userId}（后续可用 audit-* 脚本回看）`);
}

main()
  .catch((error) => {
    console.error('[zero] 失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await aiTeachingOrchestrator.stop();
    await prisma.$disconnect();
  });
