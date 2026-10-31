/**
 * teaching-idempotency-e2e.mjs —— 真实用户 HTTP 端到端实测（2026-10-21）。
 *
 * 与 llm-contract-smoke.ts 的分工：
 * - 那个脚本直连网关，验证 wire format / 参数；
 * - 本脚本走**产品 HTTP API**，验证「新用户 → goal 对话 → 路径生成 → 开课 → 真实教学消息 →
 *   同 Idempotency-Key 重放 → 同 key 异请求 409」整条链路，并回读数据库核对副作用。
 *
 * 用法：
 *   node backend/scripts/test-live/teaching-idempotency-e2e.mjs
 *   E2E_BASE=http://127.0.0.1:3011 node ...   # 指定实例
 *
 * 成本：goal 对话若干轮 + 路径生成 + 开课 + 2 个教学回合，全部走平台模型；
 * 具体额度取决于路径生成技能，通常几分钟内完成。
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
const STAMP = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();
const OUT_DIR = path.join(REPO_ROOT, 'outputs', `e2e-live-${STAMP}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const NAME = process.env.E2E_NAME || `e2e_live_${Date.now()}`;
const PASSWORD = process.env.E2E_PASSWORD || `E2eLive!${randomUUID().slice(0, 12)}`;
const GOAL = {
  opening: '我今年 28 岁，后端程序员，吉他完全零基础。三个月后好朋友结婚，我想在婚礼上自弹自唱一首完整的民谣，比如《平凡之路》。我现在连琴都还没有，谱也不识。每天下班能练 40 分钟，周末能练 1 小时。帮我做一个从零到能上台弹唱的计划。',
  followUps: [
    '还没买琴，打算这周末去买一把入门面单民谣琴。和弦一个都不会按，识谱只会简谱的哆来咪。',
    '唱歌还行，公司年会唱过一次没跑大调。主要是左手按弦和右手节奏完全不会，也没人教。',
    '婚礼大概在明年 1 月 10 号。到时候要能不看谱完整弹唱一首。中间没有别的演出安排。',
    '就按你的思路来，给我出方案吧。',
  ],
};

const result = {
  stamp: STAMP,
  base: BASE,
  user: { name: NAME, id: null, password: PASSWORD },
  steps: [],
  goal: { conversationId: null, rounds: 0, pathId: null },
  path: { generationLifecycle: null, taskId: null },
  session: { sessionId: null, startRevision: null, welcomePreview: '' },
  turns: [],
  assertions: [],
  db: {},
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let cookie = '';

function absorbCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  const pairs = list.map((c) => String(c).split(';')[0]).filter(Boolean);
  if (pairs.length) cookie = pairs.join('; ');
}

async function api(method, urlPath, body, { idempotencyKey = null, timeoutMs = 300_000 } = {}) {
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
  return {
    status: res.status,
    ok: res.ok && json?.success !== false,
    headers: res.headers,
    json,
  };
}

function readDb() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    return {
      session: db.prepare('SELECT id, status, revision, LENGTH(teachingState) AS stateLen FROM teaching_sessions WHERE id = ?').get(result.session.sessionId) || null,
      messageCount: db.prepare('SELECT COUNT(*) AS n FROM teaching_session_messages WHERE sessionId = ?').get(result.session.sessionId)?.n ?? 0,
      userMessageCount: db.prepare(
        'SELECT COUNT(*) AS n FROM teaching_session_messages WHERE sessionId = ? AND payload LIKE ?'
      ).get(result.session.sessionId, `%"role":"user"%`)?.n ?? 0,
      operations: db.prepare(
        'SELECT idempotencyKey, kind, status, revision, LENGTH(resultJson) AS resultLen FROM teaching_message_operations WHERE sessionId = ? ORDER BY createdAt ASC'
      ).all(result.session.sessionId) || [],
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
    log('register failed', `${reg.status} ${JSON.stringify(reg.json?.error || reg.json).slice(0, 200)}`);
    return false;
  }
  const login = await api('POST', '/api/auth/login', { name: NAME, password: PASSWORD, remember: true });
  if (!login.ok) {
    log('login failed', `${login.status} ${JSON.stringify(login.json?.error || login.json).slice(0, 200)}`);
    return false;
  }
  result.user.id = login.json?.data?.user?.id || null;
  log('login', `user=${result.user.id}`);
  return true;
}

async function driveGoal() {
  const start = await api('POST', '/api/goal-conversation/start', { input: { text: GOAL.opening } });
  const core = start.json?.data?.internal?.core || {};
  result.goal.conversationId = core.conversationId || null;
  result.goal.rounds = 1;
  log('goal start', `stage=${core.stage} conv=${result.goal.conversationId} status=${start.status}`);
  if (!result.goal.conversationId) throw new Error('goal start 未返回 conversationId');

  let confirmed = false;
  let followUpIdx = 0;
  for (let guard = 0; guard < 12; guard += 1) {
    const snap = await api('GET', `/api/goal-conversation/${result.goal.conversationId}`);
    const snapCore = snap.json?.data?.internal?.core || {};
    const stage = snapCore.stage;
    const pathId = snapCore.learningPath?.id || null;
    if (pathId) {
      result.goal.pathId = pathId;
      confirmed = true;
      log('goal confirmed', `stage=${stage} path=${pathId}`);
      break;
    }
    if (stage === 'proposing') {
      const reply = await api('POST', `/api/goal-conversation/${result.goal.conversationId}/reply`, {
        input: { text: '可以，就按这个方案生成路径。' },
        confirmProposal: true,
      });
      const d = reply.json?.data || {};
      result.goal.rounds += 1;
      result.goal.pathId = d.internal?.core?.learningPath?.id || d.learningPath?.id || null;
      log('goal confirm', `status=${reply.status} path=${result.goal.pathId} stage=${d.internal?.core?.stage}`);
      if (result.goal.pathId) { confirmed = true; break; }
      continue;
    }
    const text = GOAL.followUps[Math.min(followUpIdx, GOAL.followUps.length - 1)];
    followUpIdx += 1;
    const reply = await api('POST', `/api/goal-conversation/${result.goal.conversationId}/reply`, { input: { text } });
    result.goal.rounds += 1;
    log('goal reply', `round=${result.goal.rounds} status=${reply.status} stage=${reply.json?.data?.internal?.core?.stage || '?'}`);
    await sleep(800);
  }

  if (!result.goal.pathId) {
    const snap = await api('GET', `/api/goal-conversation/${result.goal.conversationId}`);
    result.goal.pathId = snap.json?.data?.internal?.core?.learningPath?.id || null;
  }
  if (!result.goal.pathId) throw new Error('goal 未能生成 learningPathId');
  return confirmed;
}

async function waitForPath() {
  const deadline = Date.now() + 20 * 60 * 1000;
  let lifecycle = '';
  while (Date.now() < deadline) {
    const res = await api('GET', `/api/learning/paths/${result.goal.pathId}/generation-status`);
    lifecycle = res.json?.data?.lifecycle || '';
    result.path.generationLifecycle = lifecycle;
    log('path status', lifecycle || `http=${res.status}`);
    if (lifecycle === 'ready') return true;
    if (String(lifecycle).includes('failed')) return false;
    await sleep(10_000);
  }
  return false;
}

async function findFirstTask() {
  const res = await api('GET', `/api/learning/paths/${result.goal.pathId}`);
  const data = res.json?.data || {};
  const stages = data.stages || data.milestones || [];
  const tasks = stages.flatMap((s) => (s.subtasks || []).map((t) => ({ ...t, stageNumber: s.stageNumber })));
  const task = tasks.find((t) => t.status !== 'completed') || tasks[0];
  if (!task) throw new Error('路径里没有可开始的任务');
  result.path.taskId = task.id;
  log('task selected', `${task.id} S${task.stageNumber} ${String(task.title || '').slice(0, 40)}`);
  return task;
}

async function startSession() {
  const res = await api('POST', `/api/ai-teaching/tasks/${result.path.taskId}/session`, {});
  const d = res.json?.data || {};
  result.session.sessionId = d.sessionId || null;
  result.session.startRevision = d.revision ?? null;
  result.session.welcomePreview = String(d.welcomeMessage || '').slice(0, 160);
  log('session start', `status=${res.status} session=${result.session.sessionId} revision=${d.revision} mode=${d.mode}`);
  if (!result.session.sessionId) throw new Error('开课未返回 sessionId');
}

async function streamMessage(sessionId, body, idempotencyKey, timeoutMs = 300_000) {
  const headers = {
    Origin: 'http://localhost:5173',
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + `/api/ai-teaching/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  absorbCookies(res);
  const events = [];
  if (!res.body) return { status: res.status, headers: res.headers, events };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      const dataLines = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const raw = dataLines.join('\n');
      let data = null;
      if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
      events.push({ event, data });
    }
  }
  return { status: res.status, headers: res.headers, events };
}

function finalEventOf(events) {
  const finals = events.filter((e) => e.event === 'final');
  return finals.length ? finals[finals.length - 1].data : null;
}

async function main() {
  log('config', `base=${BASE} user=${NAME}`);
  if (!(await registerOrLogin())) throw new Error('注册/登录失败');

  await driveGoal();
  const ready = await waitForPath();
  assert('path generation ready', ready, result.path.generationLifecycle);
  if (!ready) throw new Error(`路径生成未 ready：${result.path.generationLifecycle}`);

  const task = await findFirstTask();
  await startSession();

  const baseRevision = result.session.startRevision;
  const key1 = `e2e-${randomUUID()}`;
  const body1 = { message: '老师好，我准备好了，请从最基础的开始。', revision: baseRevision };
  const startedAt = Date.now();
  const turn1 = await api('POST', `/api/ai-teaching/sessions/${result.session.sessionId}/messages`, body1, { idempotencyKey: key1 });
  const d1 = turn1.json?.data || {};
  result.turns.push({ kind: 'first', key: key1, status: turn1.status, revision: d1.revision, aiPreview: String(d1.aiResponse || '').slice(0, 200), durationMs: Date.now() - startedAt });
  assert('first message HTTP 200', turn1.status === 200, `status=${turn1.status}`);
  assert('first message AI non-empty', String(d1.aiResponse || '').trim().length > 0, String(d1.aiResponse || '').slice(0, 120));
  assert('first message revision advanced', Number(d1.revision) > Number(baseRevision), `${baseRevision} -> ${d1.revision}`);
  const firstRevision = d1.revision;

  const dbAfterFirst = readDb();
  result.db.afterFirst = dbAfterFirst;
  assert('first turn persisted in message table', dbAfterFirst.messageCount > 0, `messages=${dbAfterFirst.messageCount}`);
  assert('first operation completed', dbAfterFirst.operations.some((o) => o.idempotencyKey === key1 && o.status === 'completed'), JSON.stringify(dbAfterFirst.operations));

  // 同 key + 完全相同的 body（含旧 revision）→ 必须重放
  const replay = await api('POST', `/api/ai-teaching/sessions/${result.session.sessionId}/messages`, body1, { idempotencyKey: key1 });
  const dr = replay.json?.data || {};
  result.turns.push({ kind: 'replay', key: key1, status: replay.status, replayedHeader: replay.headers.get('idempotency-replayed'), revision: dr.revision, aiPreview: String(dr.aiResponse || '').slice(0, 200) });
  assert('replay HTTP 200', replay.status === 200, `status=${replay.status}`);
  assert('replay marked by header', replay.headers.get('idempotency-replayed') === 'true', String(replay.headers.get('idempotency-replayed')));
  assert('replay returns same revision', Number(dr.revision) === Number(firstRevision), `${firstRevision} vs ${dr.revision}`);
  assert('replay returns same answer', String(dr.aiResponse || '') === String(d1.aiResponse || ''), 'aiResponse equal');

  const dbAfterReplay = readDb();
  result.db.afterReplay = dbAfterReplay;
  assert('replay does not add messages', dbAfterReplay.messageCount === dbAfterFirst.messageCount, `${dbAfterFirst.messageCount} -> ${dbAfterReplay.messageCount}`);

  // 同 key + 不同 body → 409 KEY_REUSED
  const conflict = await api('POST', `/api/ai-teaching/sessions/${result.session.sessionId}/messages`, { message: '这是一条不同的消息', revision: baseRevision }, { idempotencyKey: key1 });
  const conflictCode = conflict.json?.error?.code || null;
  result.turns.push({ kind: 'conflict', key: key1, status: conflict.status, code: conflictCode });
  assert('same key different body -> 409', conflict.status === 409, `status=${conflict.status}`);
  assert('conflict code is KEY_REUSED', conflictCode === 'TEACHING_IDEMPOTENCY_KEY_REUSED', String(conflictCode));

  // 新 key 再发一轮，证明正常链路未被幂等账本卡住
  const key2 = `e2e-${randomUUID()}`;
  const turn2 = await api('POST', `/api/ai-teaching/sessions/${result.session.sessionId}/messages`, { message: '我有点明白了，能再举一个例子吗？', revision: firstRevision }, { idempotencyKey: key2 });
  const d2 = turn2.json?.data || {};
  result.turns.push({ kind: 'second', key: key2, status: turn2.status, revision: d2.revision, aiPreview: String(d2.aiResponse || '').slice(0, 200) });
  assert('second turn HTTP 200', turn2.status === 200, `status=${turn2.status}`);
  assert('second turn revision advanced', Number(d2.revision) > Number(firstRevision), `${firstRevision} -> ${d2.revision}`);

  // 流式回合（真实前端主路径）：SSE final 数据 + 同 key 流式重放
  const key3 = `e2e-${randomUUID()}`;
  const body3 = { message: '那我们开始练习吧，我先试着说一下。', revision: d2.revision };
  const stream1 = await streamMessage(result.session.sessionId, body3, key3);
  const sData = finalEventOf(stream1.events) || {};
  result.turns.push({
    kind: 'stream',
    key: key3,
    status: stream1.status,
    revision: sData.revision,
    aiPreview: String(sData.aiResponse || '').slice(0, 200),
    events: stream1.events.map((e) => e.event),
  });
  assert('stream HTTP 200', stream1.status === 200, `status=${stream1.status}`);
  assert('stream emits final event', Boolean(finalEventOf(stream1.events)), JSON.stringify(stream1.events.map((e) => e.event)));
  assert('stream AI non-empty', String(sData.aiResponse || '').trim().length > 0, String(sData.aiResponse || '').slice(0, 120));
  assert('stream revision advanced', Number(sData.revision) > Number(d2.revision), `${d2.revision} -> ${sData.revision}`);

  const dbAfterStream = readDb();
  result.db.afterStream = dbAfterStream;

  const streamReplay = await streamMessage(result.session.sessionId, body3, key3);
  const srData = finalEventOf(streamReplay.events) || {};
  result.turns.push({
    kind: 'stream-replay',
    key: key3,
    status: streamReplay.status,
    replayedHeader: streamReplay.headers.get('idempotency-replayed'),
    revision: srData.revision,
    aiPreview: String(srData.aiResponse || '').slice(0, 200),
    events: streamReplay.events.map((e) => e.event),
  });
  assert('stream replay HTTP 200', streamReplay.status === 200, `status=${streamReplay.status}`);
  assert('stream replay marked by header', streamReplay.headers.get('idempotency-replayed') === 'true', String(streamReplay.headers.get('idempotency-replayed')));
  assert('stream replay returns same final data', JSON.stringify(srData) === JSON.stringify(sData), 'final payload equal');
  const dbAfterStreamReplay = readDb();
  result.db.afterStreamReplay = dbAfterStreamReplay;
  assert('stream replay does not add messages', dbAfterStreamReplay.messageCount === dbAfterStream.messageCount, `${dbAfterStream.messageCount} -> ${dbAfterStreamReplay.messageCount}`);

  const dbFinal = readDb();
  result.db.final = dbFinal;
  assert('final message count grew by exactly two turns', dbFinal.messageCount === dbAfterFirst.messageCount + 4, `${dbAfterFirst.messageCount} -> ${dbFinal.messageCount}（+4：第二轮与流式各 user+assistant）`);
  assert('all operations completed', dbFinal.operations.filter((o) => o.status === 'completed').length >= 3, JSON.stringify(dbFinal.operations));
  assert('session revision matches stream result', Number(dbFinal.session?.revision) === Number(sData.revision), `db=${dbFinal.session?.revision} api=${sData.revision}`);
}

function writeReport(ok) {
  const lines = [];
  lines.push('# 教学幂等 × 真实 HTTP 端到端实测');
  lines.push('');
  lines.push(`- 时间：${STAMP}`);
  lines.push(`- 实例：${BASE}`);
  lines.push(`- 测试账号：${NAME}（${result.user.id || '未注册'}）`);
  lines.push(`- 结论：**${ok ? 'PASS' : 'FAIL'}**`);
  if (result.error) lines.push(`- 错误：${result.error}`);
  lines.push('');
  lines.push('## 链路');
  lines.push(`- goal 会话：${result.goal.conversationId}（${result.goal.rounds} 轮）`);
  lines.push(`- 路径：${result.goal.pathId}（lifecycle=${result.path.generationLifecycle}）`);
  lines.push(`- 任务：${result.path.taskId}`);
  lines.push(`- 课堂：${result.session.sessionId}（起始 revision=${result.session.startRevision}）`);
  lines.push('');
  lines.push('## 断言');
  lines.push('| 断言 | 结果 | 证据 |');
  lines.push('|---|---|---|');
  for (const a of result.assertions) lines.push(`| ${a.name} | ${a.ok ? 'PASS' : 'FAIL'} | ${String(a.detail || '').replace(/\|/g, '\\|')} |`);
  lines.push('');
  lines.push('## 回合');
  lines.push('| 类型 | HTTP | revision | 说明 |');
  lines.push('|---|---|---|---|');
  for (const t of result.turns) {
    const note = t.aiPreview ? t.aiPreview.slice(0, 80) : (t.code || t.replayedHeader || '');
    lines.push(`| ${t.kind} | ${t.status} | ${t.revision ?? '—'} | ${String(note).replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## 数据库核对');
  for (const [label, db] of Object.entries(result.db)) {
    lines.push(`- ${label}: messages=${db.messageCount}, revision=${db.session?.revision ?? '—'}, operations=${JSON.stringify(db.operations)}`);
  }
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
  console.log(`[e2e] 报告：${OUT_DIR}`);
  process.exitCode = exitCode;
}
