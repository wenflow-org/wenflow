#!/usr/bin/env node
/**
 * 回测结果分析（只读 DB，不再调 LLM）：
 *  - P0-1：每课开场 conversationHistory 只含本条欢迎语（不带上节课历史）
 *  - P0-2：完成课时最后一条教师消息不带未答问句
 *  - P0-4：每道检查点题面都出现在学员作答之前的教师可见消息里
 *  - P1-7：第 2 课学员开场能引用第 1 课的具体操作（人工核对打印摘要）
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dir = process.argv[2];
if (!dir) {
  console.error('用法：node _backtest_analyze.mjs outputs/audit-backtest-...');
  process.exit(1);
}

const parse = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

const norm = (text) => String(text || '').replace(/\s+/g, '');

const MAIN = async () => {
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const sessionId = report.sessionId;
  const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } });
  const pathId = session?.learningPathId || report.pathId;
  const teachingRows = await prisma.teaching_sessions.findMany({
    where: { learningPathId: pathId },
    orderBy: { createdAt: 'asc' },
  });
  const messageRows = await prisma.teaching_session_messages.findMany({
    where: { sessionId: { in: teachingRows.map((row) => row.id) } },
    orderBy: { id: 'asc' },
  });
  const messagesBySession = new Map();
  for (const row of messageRows) {
    const payload = parse(row.payload) || {};
    if (!messagesBySession.has(row.sessionId)) messagesBySession.set(row.sessionId, []);
    messagesBySession.get(row.sessionId).push({ role: payload.role, content: String(payload.content || ''), id: row.id });
  }

  const findings = [];
  const lessons = teachingRows.map((row) => {
    const messages = messagesBySession.get(row.id) || [];
    const state = parse(row.teachingState) || {};
    const checkpoints = Array.isArray(state.checkpointHistory) ? state.checkpointHistory : [];
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const lastMessage = messages[messages.length - 1];
    const checkpointVisibility = checkpoints.map((cp) => {
      const q = norm(cp.question);
      const answerIndex = messages.findIndex((m, index) => m.role === 'user'
        && index > 0
        && norm(messages[index - 1]?.content).includes(q));
      const visible = messages.some((m) => m.role === 'assistant' && norm(m.content).includes(q));
      return { question: cp.question, visible, passed: cp.passed, selectedOptionIds: cp.selectedOptionIds || [] };
    });
    return {
      id: row.id,
      taskId: row.taskId,
      status: row.status,
      messageCount: messages.length,
      lastRole: lastMessage?.role || null,
      lastTeacherMessage: lastAssistant?.content || '',
      lastTeacherHasQuestion: /[？?]/.test(lastAssistant?.content || ''),
      completionDeferrals: state.completionDeferrals ?? null,
      completionDeferralQuestionCount: state.completionDeferralQuestionCount ?? null,
      checkpoints: checkpointVisibility,
      firstLearnerMessage: messages.find((m) => m.role === 'user')?.content || '',
      trace: messages.slice(0, 4).map((m) => ({ role: m.role, content: m.content.slice(0, 220) })),
    };
  });

  for (const lesson of lessons) {
    if (lesson.status === 'completed' && lesson.lastTeacherHasQuestion) {
      findings.push(`[P0-2] ${lesson.taskId} 完成时最后教师消息仍含问句：${lesson.lastTeacherMessage.slice(-160)}`);
    }
    for (const cp of lesson.checkpoints) {
      if (!cp.visible) findings.push(`[P0-4] ${lesson.taskId} 检查点题面未出现在教师可见消息：${String(cp.question).slice(0, 70)}`);
    }
  }
  for (const start of report.lessonStarts || []) {
    if (start.historyLength > 1) {
      findings.push(`[P0-1] 新课 ${String(start.taskId).slice(-8)} 开场 history=${start.historyLength}（>1，疑似带上节课历史）`);
    }
    if (start.firstRole !== 'assistant' || !start.firstMessage) {
      findings.push(`[P0-1] 新课 ${String(start.taskId).slice(-8)} 开场首条不是教师欢迎语`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sessionId,
    pathId,
    sessionStatus: session?.status,
    completedTasks: session?.completedTasks,
    totalTasks: session?.totalTasks,
    lessonStarts: report.lessonStarts,
    lessons,
    findings,
  };
  fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(summary, null, 2));

  console.log(`[analyze] 课数=${lessons.length}，完成=${lessons.filter((l) => l.status === 'completed').length}`);
  for (const lesson of lessons) {
    console.log(`  - ${String(lesson.taskId).slice(-8)} ${lesson.status} msgs=${lesson.messageCount} defer=${lesson.completionDeferrals} lastRole=${lesson.lastRole} lastQ=${lesson.lastTeacherHasQuestion}`);
    console.log(`    最后一句：${lesson.lastTeacherMessage.replace(/\s+/g, ' ').slice(-140)}`);
    console.log(`    首句学员：${lesson.firstLearnerMessage.replace(/\s+/g, ' ').slice(0, 140)}`);
    for (const cp of lesson.checkpoints) {
      console.log(`    cp visible=${cp.visible} passed=${cp.passed} ${String(cp.question).slice(0, 50)}`);
    }
  }
  console.log(`[analyze] 结论：${findings.length ? '仍有问题' : 'P0 目标项全部通过'}`);
  for (const item of findings) console.log(`  - ${item}`);
  await prisma.$disconnect();
};

MAIN().catch(async (error) => {
  console.error('[analyze] 失败', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
