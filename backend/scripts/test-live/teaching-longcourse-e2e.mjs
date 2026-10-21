/**
 * teaching-longcourse-e2e.mjs —— 长课收束 + 跨课真实 HTTP 实测（2026-10-21）。
 *
 * 覆盖 teaching-idempotency-e2e.mjs 未覆盖的部分：
 * - 多轮真实教学直到模型/门禁给出完课信号（不是固定两轮）；
 * - 收束链路 `/end` + finalization 轮询，直到会话终态 completed；
 * - 同一路径下**再开第二课**（跨课），验证新会话独立 revision / 事件流；
 * - 统一事件日志 `session_events` 完整时间线（initialized / turn.committed / completed）；
 * - 日志表 `prompt_call_logs` / `llm_execution_attempts` 的 `sessionId` 真列归因；
 * - 收束后同 key 重放仍返回收束前那一次的结果（幂等账本与业务同事务）。
 *
 * 用法：
 *   node backend/scripts/test-live/teaching-longcourse-e2e.mjs
 *   E2E_BASE=http://127.0.0.1:3011 E2E_MAX_TURNS=6 node ...
 *
 * 成本：goal（若干轮）+ 路径生成 + 两堂课（合计约 6-10 个教学回合），
 * 每回合 60-90s，整体约 15-25 分钟。免费档限流时脚本会退避重试。
 *
 * 退出码：0 全过；1 断言失败；2 环境/流程失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(REPO_ROOT, 'backend', 'prisma', 'dev.db');
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const MAX_TURNS = Math.max(3, Math.min(Number(process.env.E2E_MAX_TURNS || 8), 14));
const STAMP = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();
const OUT_DIR = path.join(REPO_ROOT, 'outputs', `e2e-longcourse-${STAMP}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const NAME = process.env.E2E_NAME || `e2e_long_${Date.now()}`;
const PASSWORD = process.env.E2E_PASSWORD || `E2eLong!${randomUUID().slice(0, 12)}`;
/**
 * 复用已有路径跳过 goal/路径生成（约省 6 分钟）：配合 E2E_NAME/E2E_PASSWORD 登录同一账号。
 * 调收束门禁时可反复跑，不必每次重建学习路径。
 */
const RESUME_PATH = process.env.E2E_PATH_ID || null;
const GOAL = {
  opening: '我是做前端开发的，想系统补一下 TypeScript 的类型系统。平时只会写 any 和简单的 interface，泛型、条件类型、类型体操完全看不懂。每周能挤出 3 次、每次 40 分钟。希望一个月内能读懂公司代码库里那些复杂的类型声明。',
  followUps: [
    '我平时主要写 Vue 和 React，项目里已经开了 strict。最常卡住的是泛型约束和 infer。',
    '不太想做太多理论推导，更希望能看懂并改得动现有代码。练习最好有真实的小例子。',
    '一个月后能读懂泛型工具类型，并且自己能写一个简单的 Pick/Partial 就算达标。',
    '就按这个思路，帮我生成学习路径。',
  ],
};

const result = {
  stamp: STAMP,
  base: BASE,
  maxTurns: MAX_TURNS,
  // password 落报告只为让下一次用 E2E_NAME/E2E_PASSWORD 续跑同一账号；这是本地测试账号随机口令
  user: { name: NAME, id: null, password: PASSWORD },
  goal: { conversationId: null, rounds: 0, pathId: null },
  path: { lifecycle: null, tasks: [] },
  sessions: [],
  assertions: [],
  db: {},
  steps: [],
  error: null,
};

function log(step, detail = '') {
  const line = `[${new Date().toISOString()}] ${step}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  result.steps.push({ at: new Date().toISOString(), step, detail });
}

function assert(name, ok, detail = '') {
  result.assertions.push({ name, ok: Boolean(ok), detail });
  log(ok ? `ASSERT PASS ${name}` : `ASSERT FAIL ${name}`, detail);
  return Boolean(ok);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cookie = '';
function absorbCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  const pairs = list.map((c) => String(c).split(';')[0]).filter(Boolean);
  if (pairs.length) cookie = pairs.join('; ');
}

async function rawApi(method, urlPath, body, { idempotencyKey = null, timeoutMs = 300_000 } = {}) {
  const headers = { Origin: 'http://localhost:5173' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  absorbCookies(res);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, ok: res.ok && json?.success !== false, headers: res.headers, json };
}

/**
 * 网络层瞬断重试（Node fetch 偶发 `fetch failed` / ECONNRESET 会把长测整轮判红）。
 * 只重试传输异常，不重试业务错误；写请求均带 Idempotency-Key 或稳定 operationId，重复执行安全。
 */
async function api(method, urlPath, body, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await rawApi(method, urlPath, body, options);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      const transient = /fetch failed|ECONNRESET|socket hang up|UND_ERR|other side closed/i.test(message);
      if (!transient || attempt === 2) throw error;
      log('network retry', `${method} ${urlPath} attempt=${attempt + 1} — ${message}`);
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastError;
}

/** 429 / 5xx 退避重试（免费档上游限流是 live 测试的主要噪声源）。 */
async function apiWithRetry(method, urlPath, body, options = {}, attempts = 3) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await api(method, urlPath, body, options);
    if (last.status !== 429 && last.status < 500) return last;
    log('retry', `${method} ${urlPath} status=${last.status} attempt=${i + 1}`);
    await sleep(10_000 * (i + 1));
  }
  return last;
}

function readDb(sessionId) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    return {
      session: db.prepare('SELECT id, status, revision, endTime FROM teaching_sessions WHERE id = ?').get(sessionId) || null,
      messages: db.prepare('SELECT COUNT(*) AS n FROM teaching_session_messages WHERE sessionId = ?').get(sessionId)?.n ?? 0,
      events: db.prepare('SELECT kind, COUNT(*) AS n FROM session_events WHERE sessionId = ? GROUP BY kind ORDER BY kind').all(sessionId) || [],
      eventRows: db.prepare('SELECT id, kind, status, revision FROM session_events WHERE sessionId = ? ORDER BY id ASC').all(sessionId) || [],
      promptCalls: db.prepare('SELECT COUNT(*) AS n FROM prompt_call_logs WHERE sessionId = ?').get(sessionId)?.n ?? 0,
      attempts: db.prepare('SELECT COUNT(*) AS n FROM llm_execution_attempts WHERE sessionId = ?').get(sessionId)?.n ?? 0,
      operations: db.prepare('SELECT idempotencyKey, kind, status, revision FROM teaching_message_operations WHERE sessionId = ? ORDER BY createdAt ASC').all(sessionId) || [],
    };
  } finally {
    db.close();
  }
}

async function registerOrLogin() {
  const reg = await api('POST', '/api/auth/register', { name: NAME, password: PASSWORD, remember: true });
  if (reg.ok) {
    result.user.id = reg.json?.data?.user?.id || null;
    log('register', `user=${result.user.id}`);
    return true;
  }
  const code = reg.json?.error?.code;
  if (code && !/EXISTS|TAKEN|DUPLICATE/i.test(String(code))) {
    log('register failed', `${reg.status} ${String(JSON.stringify(reg.json?.error || reg.json)).slice(0, 200)}`);
    return false;
  }
  const login = await api('POST', '/api/auth/login', { name: NAME, password: PASSWORD, remember: true });
  if (!login.ok) {
    log('login failed', `${login.status} ${String(JSON.stringify(login.json?.error || login.json)).slice(0, 200)}`);
    return false;
  }
  result.user.id = login.json?.data?.user?.id || null;
  log('login', `user=${result.user.id}`);
  return true;
}

async function driveGoal() {
  const start = await apiWithRetry('POST', '/api/goal-conversation/start', { input: { text: GOAL.opening } });
  const core = start.json?.data?.internal?.core || {};
  result.goal.conversationId = core.conversationId || null;
  result.goal.rounds = 1;
  if (!result.goal.conversationId) throw new Error('goal start 未返回 conversationId');

  let followUpIdx = 0;
  for (let guard = 0; guard < 14; guard += 1) {
    const snap = await api('GET', `/api/goal-conversation/${result.goal.conversationId}`);
    const snapCore = snap.json?.data?.internal?.core || {};
    if (snapCore.learningPath?.id) {
      result.goal.pathId = snapCore.learningPath.id;
      break;
    }
    if (snapCore.stage === 'proposing') {
      const reply = await apiWithRetry('POST', `/api/goal-conversation/${result.goal.conversationId}/reply`, {
        input: { text: '可以，就按这个方案生成路径。' },
        confirmProposal: true,
      });
      result.goal.rounds += 1;
      result.goal.pathId = reply.json?.data?.internal?.core?.learningPath?.id || reply.json?.data?.learningPath?.id || null;
      if (result.goal.pathId) break;
      continue;
    }
    const text = GOAL.followUps[Math.min(followUpIdx, GOAL.followUps.length - 1)];
    followUpIdx += 1;
    await apiWithRetry('POST', `/api/goal-conversation/${result.goal.conversationId}/reply`, { input: { text } });
    result.goal.rounds += 1;
    await sleep(800);
  }
  if (!result.goal.pathId) throw new Error('goal 未能生成 learningPathId');
  log('goal done', `rounds=${result.goal.rounds} path=${result.goal.pathId}`);
}

async function waitForPath() {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await api('GET', `/api/learning/paths/${result.goal.pathId}/generation-status`);
    result.path.lifecycle = res.json?.data?.lifecycle || '';
    if (result.path.lifecycle === 'ready') return true;
    if (String(result.path.lifecycle).includes('failed')) return false;
    await sleep(10_000);
  }
  return false;
}

async function collectTasks() {
  const res = await api('GET', `/api/learning/paths/${result.goal.pathId}`);
  const data = res.json?.data || {};
  const stages = data.stages || data.milestones || [];
  const tasks = stages.flatMap((s) => (s.subtasks || []).map((t) => ({
    id: t.id,
    title: String(t.title || '').slice(0, 60),
    status: t.status,
    stageNumber: s.stageNumber,
  })));
  result.path.tasks = tasks;
  log('tasks', `${tasks.length} 个（未完成 ${tasks.filter((t) => t.status !== 'completed').length}）`);
  return tasks;
}

async function startSession(taskId) {
  const res = await apiWithRetry('POST', `/api/ai-teaching/tasks/${taskId}/session`, {});
  const d = res.json?.data || {};
  if (!d.sessionId) throw new Error(`开课失败：status=${res.status} ${JSON.stringify(res.json?.error || {})}`);
  return { sessionId: d.sessionId, revision: d.revision ?? 0, mode: d.mode };
}

/** 跑一轮教学消息（带 429 退避）。 */
async function turn(sessionId, revision, text) {
  const key = `long-${randomUUID()}`;
  const requestBody = { message: text, revision };
  const res = await apiWithRetry(
    'POST',
    `/api/ai-teaching/sessions/${sessionId}/messages`,
    requestBody,
    { idempotencyKey: key },
    2,
  );
  const data = res.json?.data || {};
  return {
    key,
    // 原始请求体：收束后重放要用逐字节相同的 body（requestHash 对 message+revision+meta 取值）
    body: requestBody,
    status: res.status,
    revision: data.revision,
    aiResponse: String(data.aiResponse || ''),
    isCompletion: data.isCompletion === true,
    shouldConfirmEnd: data.shouldConfirmEnd === true,
    endReason: data.endReason || null,
    checkpoint: data.checkpoint || null,
  };
}

const TURN_LINES = [
  '老师好，我准备好了，请从最基础的开始。',
  '我理解了一点，但还想确认：泛型约束里 extends 和普通继承有什么区别？',
  '这个例子清楚了。我能自己写一个简单的 Pick 吗？',
  '我试着说一遍：Pick 是从对象类型里挑几个键，用 K extends keyof T 限制范围。',
  '明白了。那 Partial 为什么能让所有属性可选？',
  '我觉得这一课的核心内容我已经掌握了，可以结束了。',
  '再补充一点：条件类型里的 infer 是推断占位符，对吗？',
  '好的，我已经能读懂公司代码里的类型声明了，想结束这一课。',
];

/** 提交课堂理解检查：有选项选第一项，简答给一段占位作答。 */
async function submitCheckpoint(sessionId, checkpoint, revision) {
  const key = `long-cp-${randomUUID()}`;
  const body = { revision };
  const firstOption = Array.isArray(checkpoint?.options) ? checkpoint.options[0] : null;
  if (firstOption?.id) body.selectedOptionIds = [firstOption.id];
  else body.answerText = '我的理解是：先看声明的形状要求，再代入具体类型判断是否满足。';
  const res = await apiWithRetry(
    'POST',
    `/api/ai-teaching/sessions/${sessionId}/checkpoints/${checkpoint.id}/submit`,
    body,
    { idempotencyKey: key },
    2,
  );
  const data = res.json?.data || {};
  log('checkpoint submit', `status=${res.status} passed=${data.passed} revision=${revision}->${data.revision}`);
  return { status: res.status, revision: data.revision ?? revision, passed: data.passed === true };
}

async function runLesson(session, turnStart, turnCount) {
  let revision = session.revision;
  const turns = [];
  const checkpoints = [];
  for (let i = 0; i < turnCount; i += 1) {
    const line = TURN_LINES[Math.min(turnStart + i, TURN_LINES.length - 1)];
    const t = await turn(session.sessionId, revision, line);
    turns.push(t);
    log('turn', `#${i + 1} status=${t.status} revision=${revision}->${t.revision} completion=${t.isCompletion} end=${t.endReason} ai=${t.aiResponse.slice(0, 40)}`);
    if (!(t.status === 200) || !t.aiResponse.trim()) {
      log('turn interrupted', `status=${t.status}`);
      break;
    }
    revision = t.revision;
    // 课堂出了理解检查：先作答再继续（收束门禁要求没有未作答的检查点）
    if (t.checkpoint?.id) {
      const submitted = await submitCheckpoint(session.sessionId, t.checkpoint, revision);
      checkpoints.push({ checkpointId: t.checkpoint.id, ...submitted });
      revision = submitted.revision;
    }
    // 模型/门禁已给出完课信号：继续跑也不会推进教学目标，直接进入收束
    if (t.isCompletion || t.shouldConfirmEnd) {
      log('completion signal', `endReason=${t.endReason}`);
      break;
    }
  }
  return { revision, turns, checkpoints };
}

/** 从 DB 读当前待作答的检查点（收束门禁会拦它）。 */
function readPendingCheckpoint(sessionId) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const row = db.prepare('SELECT teachingState FROM teaching_sessions WHERE id = ?').get(sessionId);
    if (!row?.teachingState) return null;
    const state = JSON.parse(row.teachingState);
    return state?.pendingCheckpoint || null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function finalizeSession(sessionId, revision) {
  const endCall = () => apiWithRetry('POST', `/api/ai-teaching/sessions/${sessionId}/end`, {
    revision,
    reason: 'manual-end',
  });

  let res = await endCall();
  log('end', `status=${res.status} data=${JSON.stringify(res.json?.data || {}).slice(0, 160)}`);

  // 收束门禁（产品行为，脚本需按学生身份把前置条件做完）：
  // - FINALIZATION_PENDING_CHECKPOINT：还有未作答的理解检查 → 提交后重试；
  // - FINALIZATION_OPEN_QUESTION：老师刚提了问题 → 学生先回答再结束；
  // - FINALIZATION_LAST_CHECKPOINT_FAILED：最后一题答错且还有机会 → 再答一次。
  // 每次「回答」都会触发新回合，可能再产生新问题，故循环到门禁放行或到上限。
  for (let attempt = 0; attempt < 6 && res.status === 409; attempt += 1) {
    const code = String(res.json?.error?.code || '');
    log('end blocked', `code=${code || '?'} attempt=${attempt + 1}`);
    if (code.includes('PENDING_CHECKPOINT')) {
      const pending = readPendingCheckpoint(sessionId);
      if (!pending?.id) break;
      const submitted = await submitCheckpoint(sessionId, pending, revision);
      revision = submitted.revision;
    } else if (code.includes('OPEN_QUESTION') || code.includes('LAST_CHECKPOINT_FAILED')) {
      const answered = await turn(
        sessionId,
        revision,
        '我的回答：这一课的核心是「先看声明要求的形状，再代入具体类型判断是否满足」。'
        + '我确认自己已经掌握，检查题也做完了，这一课可以结束了。',
      );
      if (answered.status !== 200 || !answered.revision) break;
      revision = answered.revision;
      if (answered.checkpoint?.id) {
        const submitted = await submitCheckpoint(sessionId, answered.checkpoint, revision);
        revision = submitted.revision;
      }
    } else {
      break;
    }
    res = await endCall();
    log('end retry', `status=${res.status} code=${res.json?.error?.code || 'ok'}`);
  }

  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    let status = null;
    try {
      const statusRes = await api('GET', `/api/ai-teaching/sessions/${sessionId}/finalization`);
      status = statusRes.json?.data?.status || statusRes.json?.data?.finalization?.status || null;
    } catch (error) {
      log('finalization poll error', error instanceof Error ? error.message : String(error));
    }
    if (!status || status === 'completed' || status === 'failed') {
      return { endStatus: res.status, endCode: res.json?.error?.code || null, finalizationStatus: status };
    }
    await sleep(5000);
  }
  return { endStatus: res.status, endCode: res.json?.error?.code || null, finalizationStatus: 'timeout' };
}

async function main() {
  log('config', `base=${BASE} user=${NAME} maxTurns=${MAX_TURNS}`);
  if (!(await registerOrLogin())) throw new Error('注册/登录失败');

  if (RESUME_PATH) {
    result.goal.pathId = RESUME_PATH;
    result.path.lifecycle = 'ready';
    log('resume path', RESUME_PATH);
  } else {
    await driveGoal();
    const ready = await waitForPath();
    assert('path generation ready', ready, result.path.lifecycle);
    if (!ready) throw new Error(`路径生成未 ready：${result.path.lifecycle}`);
  }

  const tasks = await collectTasks();
  assert('path has at least 2 tasks (跨课前提)', tasks.length >= 2, `tasks=${tasks.length}`);

  // ── 第一课：多轮教学 → 收束 ────────────────────────────────────────────
  const first = await startSession(tasks[0].id);
  const firstSession = { ...first, taskId: tasks[0].id, label: 'lesson-1', turns: [], finalized: null };
  result.sessions.push(firstSession);
  log('lesson-1 start', `session=${first.sessionId} revision=${first.revision}`);

  const firstRun = await runLesson(firstSession, 0, MAX_TURNS);
  firstSession.turns = firstRun.turns;
  firstSession.checkpoints = firstRun.checkpoints;
  firstSession.revision = firstRun.revision;

  assert('lesson-1 produced teaching turns', firstRun.turns.length >= 2, `turns=${firstRun.turns.length}`);
  assert('lesson-1 every turn HTTP 200', firstRun.turns.every((t) => t.status === 200), `statuses=${firstRun.turns.map((t) => t.status).join(',')}`);
  assert('lesson-1 revision strictly advanced', firstRun.turns.every((t, i) => Number(t.revision) > (i === 0 ? Number(first.revision) : Number(firstRun.turns[i - 1].revision))), `${first.revision} -> ${firstRun.revision}`);

  firstSession.finalized = await finalizeSession(first.sessionId, firstRun.revision);
  await sleep(3000);

  const db1 = readDb(first.sessionId);
  result.db.lesson1 = db1;
  assert('lesson-1 session completed', db1.session?.status === 'completed', `status=${db1.session?.status}`);
  assert('lesson-1 has session.initialized event', db1.events.some((e) => e.kind === 'session.initialized'), JSON.stringify(db1.events));
  assert(
    'lesson-1 turn.committed events match turns',
    (db1.events.find((e) => e.kind === 'turn.committed')?.n ?? 0) >= firstRun.turns.length,
    JSON.stringify(db1.events),
  );
  assert('lesson-1 has session.completed event', db1.events.some((e) => e.kind === 'session.completed'), JSON.stringify(db1.events));
  assert('lesson-1 prompt_call_logs carry sessionId', db1.promptCalls > 0, `rows=${db1.promptCalls}`);
  assert('lesson-1 llm_execution_attempts carry sessionId', db1.attempts > 0, `rows=${db1.attempts}`);
  assert('lesson-1 message rows persisted', db1.messages >= firstRun.turns.length + 1, `messages=${db1.messages}`);

  // 收束后同 key 重放：账本与业务同事务落库，应仍返回同一 revision 而非 409
  const lastTurn = firstRun.turns[firstRun.turns.length - 1];
  if (lastTurn) {
    const replay = await api(
      'POST',
      `/api/ai-teaching/sessions/${first.sessionId}/messages`,
      lastTurn.body,
      { idempotencyKey: lastTurn.key },
    );
    const replayed = replay.headers.get('idempotency-replayed') === 'true';
    const replayCode = replay.json?.error?.code || null;
    assert('post-completion replay served from ledger', replay.status === 200 && replayed, `status=${replay.status} replayed=${replayed} code=${replayCode}`);
    assert('post-completion replay keeps same revision', Number(replay.json?.data?.revision) === Number(lastTurn.revision), `${lastTurn.revision} vs ${replay.json?.data?.revision}`);
  }

  // ── 第二课：跨课 ──────────────────────────────────────────────────────
  const second = await startSession(tasks[1].id);
  const secondSession = { ...second, taskId: tasks[1].id, label: 'lesson-2', turns: [], finalized: null };
  result.sessions.push(secondSession);
  log('lesson-2 start', `session=${second.sessionId} revision=${second.revision}`);

  assert('lesson-2 uses a different session id', second.sessionId !== first.sessionId, `${first.sessionId} vs ${second.sessionId}`);
  assert('lesson-2 starts at its own revision baseline', Number(second.revision) <= 2, `revision=${second.revision}`);

  const secondRun = await runLesson(secondSession, 2, Math.min(3, MAX_TURNS));
  secondSession.turns = secondRun.turns;
  secondSession.checkpoints = secondRun.checkpoints;
  secondSession.revision = secondRun.revision;

  assert('lesson-2 produced teaching turns', secondRun.turns.length >= 1, `turns=${secondRun.turns.length}`);
  assert('lesson-2 every turn HTTP 200', secondRun.turns.every((t) => t.status === 200), `statuses=${secondRun.turns.map((t) => t.status).join(',')}`);

  await sleep(3000);
  const db2 = readDb(second.sessionId);
  result.db.lesson2 = db2;
  assert('lesson-2 has its own session.initialized event', db2.events.some((e) => e.kind === 'session.initialized'), JSON.stringify(db2.events));
  assert('lesson-2 prompt_call_logs carry its own sessionId', db2.promptCalls > 0, `rows=${db2.promptCalls}`);
  assert('lesson-2 events do not leak lesson-1 turns', (db2.events.find((e) => e.kind === 'turn.committed')?.n ?? 0) >= secondRun.turns.length, JSON.stringify(db2.events));

  // ── 事件时间线可查询（读 API）─────────────────────────────────────────
  const eventsRes = await api('GET', `/api/ai-teaching/sessions/${first.sessionId}/events?limit=200`);
  const apiEvents = eventsRes.json?.data?.events || [];
  result.db.eventsApi = { status: eventsRes.status, count: apiEvents.length, kinds: apiEvents.map((e) => e.kind) };
  assert('events API returns timeline', eventsRes.status === 200 && apiEvents.length > 0, `count=${apiEvents.length}`);
  assert('events API orders by id ascending', apiEvents.every((e, i) => i === 0 || e.id > apiEvents[i - 1].id), 'ascending');
  assert('events API decodes payload JSON', apiEvents.every((e) => e.payload === null || typeof e.payload === 'object'), 'payload parsed');

  const tail = apiEvents.length ? apiEvents[apiEvents.length - 1].id : 0;
  const deltaRes = await api('GET', `/api/ai-teaching/sessions/${first.sessionId}/events?sinceId=${tail}`);
  assert('events API cursor returns nothing new', (deltaRes.json?.data?.events || []).length === 0, `tail=${tail}`);
}

function writeReport(ok) {
  const lines = [];
  lines.push('# 长课收束 × 跨课 真实 HTTP 实测');
  lines.push('');
  lines.push(`- 时间：${STAMP}`);
  lines.push(`- 实例：${BASE}`);
  lines.push(`- 测试账号：${NAME}（${result.user.id || '未注册'}）`);
  lines.push(`- 教学轮次上限：${MAX_TURNS}`);
  lines.push(`- 结论：**${ok ? 'PASS' : 'FAIL'}**`);
  if (result.error) lines.push(`- 错误：${result.error}`);
  lines.push('');
  lines.push('## 断言');
  lines.push('| 断言 | 结果 | 证据 |');
  lines.push('|---|---|---|');
  for (const a of result.assertions) {
    lines.push(`| ${a.name} | ${a.ok ? 'PASS' : 'FAIL'} | ${String(a.detail || '').replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## 会话');
  for (const s of result.sessions) {
    lines.push(`- ${s.label}: session=${s.sessionId} task=${s.taskId} turns=${s.turns.length} revision=${s.revision} finalized=${JSON.stringify(s.finalized)}`);
  }
  lines.push('');
  lines.push('## 数据库核对');
  for (const [label, db] of Object.entries(result.db)) {
    if (!db || typeof db !== 'object' || !('messages' in db)) continue;
    lines.push(`- ${label}: status=${db.session?.status} revision=${db.session?.revision} messages=${db.messages} events=${JSON.stringify(db.events)} promptCalls=${db.promptCalls} attempts=${db.attempts}`);
  }
  lines.push(`- eventsApi: ${JSON.stringify(result.db.eventsApi || {})}`);
  lines.push('');
  lines.push('## 原始步骤');
  for (const s of result.steps) lines.push(`- ${s.at} ${s.step}${s.detail ? ` — ${s.detail}` : ''}`);
  fs.writeFileSync(path.join(OUT_DIR, 'REPORT.md'), lines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
}

let exitCode = 0;
try {
  await main();
  const failed = result.assertions.filter((a) => !a.ok);
  exitCode = failed.length === 0 ? 0 : 1;
  if (failed.length) result.error = `${failed.length} 个断言失败：${failed.map((f) => f.name).join(', ')}`;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  exitCode = 2;
} finally {
  writeReport(exitCode === 0);
  console.log(`[e2e-long] 报告：${OUT_DIR}`);
  process.exitCode = exitCode;
}
