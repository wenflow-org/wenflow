#!/usr/bin/env node
/**
 * #48 掌握下降分支活体探针（本地开发库，跑完自动清场）
 *
 * 背景：F1 已实现「code 负证据 → mastered 降级为 learning」与 `masteryDegradeCount`，
 * 但活体课堂从未观测到该分支。本探针用真实 `submitCheckpoint`（含模型回合）跑一次：
 *
 *   1. 复用最近一条路径的 userId/taskId，造一个「光合作用已 mastered」的课堂会话；
 *   2. 挂一个 code 可裁决的单选检查点（答案键 a），提交错误选项 b；
 *   3. 读回 knowledgeState 与 teachingState.masteryDegradeCount。
 *
 * 判据：概念 status 由 mastered 降为 learning、progress 被压到 79、计数 +1。
 * 默认跑完删除临时会话；`--keep` 保留现场供排查。
 *
 * 用法：cd backend && npx ts-node --transpile-only scripts/probe-mastery-degrade.ts [--keep]
 */
import { randomUUID } from 'node:crypto';
import prisma from '../src/config/database';
import { submitCheckpoint } from '../src/services/ai-teaching/teaching-session-ops';

const KEEP = process.argv.includes('--keep');
const CONCEPT = '光合作用';

async function main() {
  const anchor = await prisma.teaching_sessions.findFirst({
    where: { learningPathId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { userId: true, taskId: true, learningPathId: true, milestoneId: true, subject: true, topic: true },
  });
  if (!anchor) throw new Error('库里没有可复用的路径/任务锚点');

  const sessionId = `teaching_probe48_${randomUUID()}`;
  const checkpointId = `cp_probe48_${randomUUID().slice(0, 8)}`;
  const masteredPoint = { name: CONCEPT, status: 'mastered', progress: 100, evidenceSource: 'code' };
  const nowIso = new Date().toISOString();

  await prisma.teaching_sessions.create({
    data: {
      id: sessionId,
      userId: anchor.userId,
      taskId: anchor.taskId,
      learningPathId: anchor.learningPathId,
      milestoneId: anchor.milestoneId,
      subject: anchor.subject,
      topic: anchor.topic,
      taskType: 'concept',
      mode: 'tutor',
      status: 'active',
      revision: 1,
      messages: JSON.stringify([
        { role: 'assistant', content: `我们继续看${CONCEPT}。`, timestamp: nowIso },
        { role: 'user', content: '好，我准备好了。', timestamp: nowIso },
      ]),
      knowledgeState: JSON.stringify([masteredPoint]),
      teachingState: JSON.stringify({
        pendingCheckpoint: {
          id: checkpointId,
          type: 'single_choice',
          title: '光合作用发生的场所',
          question: `${CONCEPT}主要发生在哪个细胞器？`,
          conceptName: CONCEPT,
          options: [
            { id: 'a', text: '叶绿体' },
            { id: 'b', text: '线粒体' },
          ],
          correctOptionIds: ['a'],
          allowSkip: false,
        },
        sessionArtifacts: { initialKnowledgeState: [masteredPoint] },
        completionTargets: [CONCEPT],
      }),
      startTime: new Date(Date.now() - 5 * 60_000),
    },
  });

  console.log(`[probe48] session=${sessionId} checkpoint=${checkpointId}（提交错误选项 b）`);
  try {
    const result = await submitCheckpoint(sessionId, checkpointId, { selectedOptionIds: ['b'] }, 1);
    console.log('[probe48] submit passed =', result.passed);

    const after = await prisma.teaching_sessions.findUnique({
      where: { id: sessionId },
      select: { knowledgeState: true, teachingState: true },
    });
    const knowledge = JSON.parse(after?.knowledgeState || '[]') as Array<Record<string, any>>;
    const teaching = JSON.parse(after?.teachingState || '{}') as Record<string, any>;
    const point = knowledge.find((p) => String(p.name || '').includes(CONCEPT));
    console.log('[probe48] knowledgeState =', JSON.stringify(point));
    console.log('[probe48] masteryDegradeCount =', teaching.masteryDegradeCount ?? 0);

    const ok = point?.status === 'learning' && Number(point?.progress) <= 79 && Number(teaching.masteryDegradeCount || 0) >= 1;
    console.log(ok ? '[probe48] PASS 下降分支可达且已计数' : '[probe48] FAIL 未触发下降/未计数');
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (!KEEP) {
      await prisma.teaching_session_messages.deleteMany({ where: { sessionId } });
      await prisma.learning_metrics.deleteMany({ where: { sourceKey: { contains: sessionId } } });
      await prisma.learner_evidence.deleteMany({ where: { sessionId } });
      await prisma.teaching_sessions.delete({ where: { id: sessionId } }).catch(() => {});
      console.log('[probe48] 已清理临时会话');
    } else {
      console.log(`[probe48] 保留现场：${sessionId}`);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error('[probe48] 失败：', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
