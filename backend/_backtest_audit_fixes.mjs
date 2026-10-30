#!/usr/bin/env node
/**
 * 外部审计修复后的两课回测：
 *  - 建会话（autopilot=off）→ 手动 /auto 分块推进
 *  - 记录每节课开始时的 conversationHistory（验证 P0-1 不串课、开场白进历史）
 *  - 记录每节课完成时的最后一条教师消息（验证 P0-2 不带着未答末问结课）
 *  - 导出 checkpointHistory 与对话（验证 P0-4 题面可见/作答对齐）
 *
 * 用法：node _backtest_audit_fixes.mjs [--max-minutes=45] [--profile=<id>]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const PORT = process.env.PORT || '3011';
const BASE = process.env.BACKTEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const ORIGIN = process.env.BACKTEST_ORIGIN || 'http://localhost:5173';
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const MAX_MINUTES = Number(arg('max-minutes', '45'));
const MAX_TASKS = Number(arg('max-tasks', '2'));
const PROFILE_ID = arg('profile', '02dfdaad-9194-4ad4-815f-04bfe00bf704');
const REUSE_SESSION_ID = arg('session', '');
const prisma = new PrismaClient();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cookie = null;
async function api(method, urlPath, body, timeoutMs = 12 * 60_000, allowRelogin = true) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* ignore */ }
  // 同一设备后登录会吊销旧会话（管理员会话单活）；被前端/其他进程挤掉时自动重登一次
  if (res.status === 403 && allowRelogin) {
    const message = String(parsed?.error?.message || '');
    if (/吊销|过期|会话/.test(message)) {
      await login();
      return api(method, urlPath, body, timeoutMs, false);
    }
  }
  return { status: res.status, body: parsed };
}

async function login() {
  const name = process.env.E2E_ADMIN_NAME || process.env.INIT_ADMIN_NAME;
  const password = process.env.E2E_ADMIN_PASSWORD || process.env.INIT_ADMIN_PASSWORD;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${BASE}/api/admin-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ name, password, remember: true }),
    });
    const setCookie = res.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0] || null;
    if (res.ok && cookie) {
      console.log(`[backtest] 登录成功（attempt ${attempt + 1}）`);
      return;
    }
    console.log(`[backtest] 登录失败 http=${res.status}，${attempt < 2 ? '重试中' : '放弃'}`);
    await sleep(3000);
  }
  throw new Error('管理员登录失败（重试 3 次）');
}

function parseTeaching(stageResults) {
  try {
    const parsed = typeof stageResults === 'string' ? JSON.parse(stageResults) : stageResults;
    return parsed?.teaching || {};
  } catch {
    return {};
  }
}

async function sessionState(sessionId) {
  const row = await prisma.virtual_sessions.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, currentStage: true, currentTaskId: true, completedTasks: true, totalTasks: true, stageResults: true },
  });
  if (!row) return null;
  const teaching = parseTeaching(row.stageResults);
  return {
    ...row,
    teaching,
    history: Array.isArray(teaching.conversationHistory) ? teaching.conversationHistory : [],
  };
}

function lastTeacherMessage(history) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'assistant') return String(history[i].content || '');
  }
  return '';
}

function tail(text, n = 220) {
  return String(text || '').replace(/\s+/g, ' ').slice(-n);
}

const main = async () => {
  await login();
  const started = Date.now();
  let sessionId = REUSE_SESSION_ID;
  if (!sessionId) {
    const startedSession = await api('POST', `/api/admin/virtual-learners/${PROFILE_ID}/start-session`, {
      storyIndex: 0,
      autopilot: 'off',
    });
    if (startedSession.status !== 200 || !startedSession.body?.success) {
      throw new Error(`建会话失败 http=${startedSession.status} ${JSON.stringify(startedSession.body).slice(0, 300)}`);
    }
    sessionId = startedSession.body.data.id;
  }
  console.log(`[backtest] session=${sessionId}`);

  const lessonStarts = [];
  const lessonCompletions = [];
  let lastTaskId = null;
  let lastCompleted = 0;
  let rounds = 0;

  while (rounds < 80) {
    const elapsedMin = (Date.now() - started) / 60000;
    if (elapsedMin > MAX_MINUTES) {
      console.log(`[backtest] 达到时间上限 ${MAX_MINUTES} 分钟，停止推进`);
      break;
    }
    const state = await sessionState(sessionId);
    if (!state) throw new Error('会话不存在');

    if (state.currentTaskId && state.currentTaskId !== lastTaskId) {
      lastTaskId = state.currentTaskId;
      lessonStarts.push({
        at: new Date().toISOString(),
        taskId: state.currentTaskId,
        historyLength: state.history.length,
        firstMessage: state.history[0]?.content || null,
        firstRole: state.history[0]?.role || null,
        history: state.history.slice(0, 4),
      });
      console.log(`[backtest] 新课开始 task=${state.currentTaskId} history=${state.history.length} first="${tail(state.history[0]?.content, 80)}"`);
    }
    if (state.completedTasks > lastCompleted) {
      lastCompleted = state.completedTasks;
      lessonCompletions.push({
        at: new Date().toISOString(),
        taskId: state.currentTaskId,
        completedTasks: state.completedTasks,
        status: state.status,
        lastTeacherMessage: lastTeacherMessage(state.history),
        historyLength: state.history.length,
      });
      console.log(`[backtest] 完成 ${state.completedTasks}/${state.totalTasks} 最后教师消息="${tail(lastTeacherMessage(state.history), 120)}"`);
    }
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'abandoned') {
      console.log(`[backtest] 会话终态 ${state.status} (${state.completedTasks}/${state.totalTasks})`);
      break;
    }
    if (state.completedTasks >= MAX_TASKS) {
      console.log(`[backtest] 已完成 ${state.completedTasks} 课，按上限停止推进`);
      break;
    }

    rounds += 1;
    const before = state.completedTasks;
    console.log(`[backtest] round ${rounds} stage=${state.currentStage} task=${state.currentTaskId || '-'} completed=${state.completedTasks}/${state.totalTasks}`);
    if (state.currentStage === 'goal') {
      const auto = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/auto`, { maxRounds: 4 }, 12 * 60_000);
      if (auto.status !== 200 || !auto.body?.success) {
        console.log(`[backtest] /auto 失败 http=${auto.status} ${JSON.stringify(auto.body).slice(0, 300)}`);
        await sleep(10_000);
        continue;
      }
      const results = auto.body.data?.results || [];
      const last = results[results.length - 1] || {};
      console.log(`[backtest]   goal rounds=${results.length} last=${JSON.stringify({ success: last.success, goalReady: last.goalReady, error: last.error || null }).slice(0, 220)}`);
      await sleep(3000);
      continue;
    }
    if (state.currentStage === 'path') {
      const started = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/start-learning`, {}, 5 * 60_000);
      console.log(`[backtest] start-learning http=${started.status} ${JSON.stringify(started.body?.data || started.body?.error || {}).slice(0, 220)}`);
      await sleep(3000);
      continue;
    }
    // teaching：一次推一个回合，便于观察课界与跨课历史
    const step = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/teaching-step`, {}, 12 * 60_000);
    if (step.status !== 200) {
      console.log(`[backtest] teaching-step 失败 http=${step.status} ${JSON.stringify(step.body).slice(0, 300)}`);
      await sleep(10_000);
      continue;
    }
    const last = step.body?.data || {};
    console.log(`[backtest]   teaching-step ${JSON.stringify({ success: last.success, taskCompleted: last.taskCompleted, currentTaskStopped: last.currentTaskStopped, isPathCompleted: last.isPathCompleted, error: last.error || null }).slice(0, 260)}`);
    if (before === state.completedTasks) await sleep(2000);
  }

  const finalState = await sessionState(sessionId);
  const pathId = finalState?.learningPathId || (await prisma.virtual_sessions.findUnique({ where: { id: sessionId }, select: { learningPathId: true } }))?.learningPathId;
  const teachingSessions = pathId
    ? await prisma.teaching_sessions.findMany({
        where: { learningPathId: pathId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, taskId: true, topic: true, status: true, messages: true, teachingState: true, startTime: true, endTime: true },
      })
    : [];
  // 数据还债 B1 之后 messages 列不再写入，真实逐字稿在 teaching_session_messages 侧表；
  // 旧检查读空列会把"题面可见/跨课重叠"全判错（2026-10-30 回测误报）。
  const sideRows = teachingSessions.length
    ? await prisma.teaching_session_messages.findMany({
        where: { sessionId: { in: teachingSessions.map((session) => session.id) } },
        orderBy: { id: 'asc' },
      })
    : [];
  const messagesBySession = new Map();
  for (const row of sideRows) {
    let payload = row.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { payload = null; }
    }
    if (!payload) continue;
    if (!messagesBySession.has(row.sessionId)) messagesBySession.set(row.sessionId, []);
    messagesBySession.get(row.sessionId).push({ role: payload.role, content: String(payload.content || '') });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sessionId,
    pathId,
    finalStatus: finalState?.status,
    completedTasks: finalState?.completedTasks,
    totalTasks: finalState?.totalTasks,
    lessonStarts,
    lessonCompletions,
    teachingSessions: teachingSessions.map((session) => {
      const messages = messagesBySession.get(session.id) || [];
      let teachingState = {};
      try { teachingState = typeof session.teachingState === 'string' ? JSON.parse(session.teachingState) : session.teachingState || {}; } catch { /* ignore */ }
      const checkpointHistory = Array.isArray(teachingState.checkpointHistory) ? teachingState.checkpointHistory : [];
      return {
        id: session.id,
        taskId: session.taskId,
        topic: session.topic,
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        messageCount: messages.length,
        teacherMessages: messages.filter((m) => m.role === 'assistant').map((m) => String(m.content || '')),
        learnerMessages: messages.filter((m) => m.role === 'user').map((m) => String(m.content || '')),
        lastTeacherMessage: [...messages].reverse().find((m) => m.role === 'assistant')?.content || '',
        checkpointHistory: checkpointHistory.map((item) => ({
          question: item.question || null,
          passed: item.passed,
          selectedOptionIds: item.selectedOptionIds || [],
          correctOptionIds: item.correctOptionIds || [],
        })),
        pendingCheckpoint: teachingState.pendingCheckpoint || null,
        completionDeferrals: teachingState.completionDeferrals ?? null,
        completionDeferralQuestionCount: teachingState.completionDeferralQuestionCount ?? null,
      };
    }),
  };

  const outDir = path.resolve('outputs', `audit-backtest-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[backtest] 报告已写入 ${outDir}`);

  // 结论性检查（全部以侧表逐字稿为准；运行期 lessonCompletions 在完成瞬间已切到下一课，
  // 直接用它会把下一课开场白当成上一课收尾，产生假告警）
  const problems = [];
  const sessionByTask = new Map(report.teachingSessions.map((session) => [session.taskId, session]));
  lessonStarts.forEach((start, index) => {
    if (index === 0) return;
    if (start.historyLength > 1) {
      problems.push(`第 ${index + 1} 课开场 history=${start.historyLength}（>1，疑似带上节课历史）`);
    }
    const first = String(start.firstMessage || '');
    const prev = sessionByTask.get(lessonStarts[index - 1]?.taskId)?.lastTeacherMessage || '';
    if (prev && first && prev.includes(first.slice(0, 30))) {
      problems.push(`第 ${index + 1} 课开场首条消息与上节课结尾重叠`);
    }
  });
  for (const session of report.teachingSessions) {
    const last = String(session.lastTeacherMessage || '');
    if (session.status === 'completed' && /[？?]/.test(last)) {
      problems.push(`第 ${session.taskId.slice(-8)} 课完成时最后教师消息仍含问号：${tail(last, 100)}`);
    }
    for (const cp of session.checkpointHistory) {
      if (!cp.question) continue;
      const normalizedQuestion = String(cp.question).replace(/\s+/g, '');
      const visible = session.teacherMessages.some((m) => String(m).replace(/\s+/g, '').includes(normalizedQuestion));
      if (!visible) problems.push(`检查点题面未出现在教师可见消息：${cp.question.slice(0, 50)}`);
    }
  }
  console.log(`[backtest] 结论：${problems.length ? '发现问题' : '未发现目标问题'}`);
  for (const problem of problems) console.log(`  - ${problem}`);
  await prisma.$disconnect();
};

main().catch(async (error) => {
  console.error('[backtest] 失败', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
