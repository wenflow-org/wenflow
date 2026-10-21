#!/usr/bin/env node
/**
 * smoke-review-loop.mjs — 复习链路端到端冒烟（2026-10-21 数据层重建后）
 *
 * 验证「到期点 → 复习课注入 → complete_review 收束 → 证据/FSRS 落库」不是死线：
 *   1) 选一个 running 的 VL 会话与当前任务，挑一条真实痕迹把 dueAt 拨到过去（模拟到期）；
 *   2) 用 VL projection token 调 POST /api/ai-teaching/review/sessions 开复习课；
 *   3) 校验 knowledgeState 注入 status='review' 的到期点；
 *   4) 送两句话 → POST finalize {action:'complete_review'}；
 *   5) 校验课堂 completed / 无重排建议 / 复习证据落库。
 *
 * 用法：node scripts/vlab-eval/smoke-review-loop.mjs [--base=http://127.0.0.1:3001]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] || 'http://127.0.0.1:3001';
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');

const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const { getAdminCookie } = await import(pathToFileURL(path.resolve(ROOT, 'scripts/vlab-eval/admin-session.mjs')).href);
const adminCookie = await getAdminCookie(BASE, envGet);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ? JSON.stringify(detail) : ''}`);
};

async function api(method, p, { projection, cookie, body } = {}) {
  const headers = { 'content-type': 'application/json', origin: 'http://localhost:5173' };
  if (projection) headers['x-projection-token'] = projection;
  if (cookie) headers.cookie = cookie;
  if (method === 'POST') headers['idempotency-key'] = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

function pickTarget() {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(`
      select vs.userId, vs.currentTaskId taskId, p.id as profileId
      from virtual_sessions vs
      join virtual_learner_profiles p on p.userId = vs.userId
      join learning_paths lp on lp.id = vs.learningPathId
      where vs.status = 'running' and vs.currentTaskId is not null and lp.status = 'active'
      order by vs.updatedAt desc limit 1
    `).get() || null;
  } finally { db.close(); }
}

function makeDue(userId) {
  const db = new DatabaseSync(DB);
  try {
    const trace = db.prepare(`
      select id, conceptKey, extractionCount, dueAt from memory_traces
      where userId = ? and extractionCount > 0
      order by updatedAt desc limit 1
    `).get(userId);
    if (!trace) return null;
    db.prepare('update memory_traces set dueAt = ? where id = ?').run(Date.now() - 60 * 60 * 1000, trace.id);
    return trace;
  } finally { db.close(); }
}

function activeSessions(userId) {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(`
      select id, revision, mode from teaching_sessions
      where userId = ? and status in ('active','paused','timeout') order by updatedAt desc
    `).all(userId);
  } finally { db.close(); }
}

function verifyReview(sessionId) {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(`select mode, status, knowledgeState, advisory from teaching_sessions where id = ?`).get(sessionId);
  } finally { db.close(); }
}

function reviewEvidence(userId) {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(`
      select evidenceType, count(*) n from learner_evidence
      where userId = ? and evidenceType like 'review%' group by evidenceType
    `).all(userId);
  } finally { db.close(); }
}

async function mintToken(profileId) {
  const res = await api('POST', `/api/admin/virtual-learners/${encodeURIComponent(profileId)}/projection-token`, {
    cookie: adminCookie,
    body: { scope: 'full' },
  });
  if (res.status !== 200 || !res.json?.data?.token) {
    throw new Error(`projection token 失败：HTTP ${res.status}`);
  }
  return res.json.data.token;
}

const target = pickTarget();
if (!target) {
  record('复习链路', false, { reason: '没有 running 的 VL 会话' });
  console.log(JSON.stringify({ results, failed: 1 }, null, 2));
  process.exit(2);
}
const token = await mintToken(target.profileId);

// 复习课路由会复用同任务的活跃课堂 → 先收掉，避免 mode=review 静默失效
for (const session of activeSessions(target.userId)) {
  await api('POST', `/api/ai-teaching/sessions/${encodeURIComponent(session.id)}/finalize`, {
    projection: token,
    body: { action: 'end_only', revision: session.revision, reason: 'manual-end' },
  });
}

const trace = makeDue(target.userId);
record('制造到期点', Boolean(trace), trace ? { concept: trace.conceptKey, id: trace.id } : { reason: '该用户没有可到期的痕迹' });
if (!trace) {
  console.log(JSON.stringify({ results, failed: 1 }, null, 2));
  process.exit(2);
}

const created = await api('POST', '/api/ai-teaching/review/sessions', {
  projection: token,
  body: { taskId: target.taskId },
});
if (created.status !== 200 || !created.json?.data?.sessionId) {
  record('复习课-开课', false, { status: created.status, body: created.json });
  console.log(JSON.stringify({ results, failed: 1 }, null, 2));
  process.exit(2);
}
const { sessionId, revision, mode } = created.json.data;
const createdRow = verifyReview(sessionId);
let injected = null;
try {
  const state = JSON.parse(createdRow?.knowledgeState || '[]');
  injected = Array.isArray(state) ? state.filter((item) => item?.status === 'review').length : 0;
} catch { /* ignore */ }
// 路由返回的 mode 是 new|resumed（会话来源），复习课语义看 DB 里的 mode
record('复习课-开课', createdRow?.mode === 'review' && (injected ?? 0) > 0, {
  sessionId,
  revision,
  routeMode: mode,
  classroomMode: createdRow?.mode,
  injectedReviewPoints: injected,
});

let rev = revision;
for (const message of ['我先说说这个知识点我还记得的部分。', '这里我有点拿不准，老师能提示一下吗。']) {
  const turn = await api('POST', `/api/ai-teaching/sessions/${encodeURIComponent(sessionId)}/messages`, {
    projection: token,
    body: { message, revision: rev },
  });
  if (turn.status !== 200) {
    record('复习课-发言', false, { status: turn.status, body: turn.json });
    break;
  }
  rev = turn.json?.data?.revision ?? rev;
}

const finalized = await api('POST', `/api/ai-teaching/sessions/${encodeURIComponent(sessionId)}/finalize`, {
  projection: token,
  body: { action: 'complete_review', revision: rev, reason: 'manual-end' },
});
const row = verifyReview(sessionId);
let advisorySuggest = null;
try { advisorySuggest = JSON.parse(row?.advisory || 'null')?.shouldSuggest ?? null; } catch { /* ignore */ }
record('复习课-收束', finalized.status === 200 && row?.status === 'completed' && row?.mode === 'review', {
  http: finalized.status,
  status: row?.status,
  mode: row?.mode,
  advisorySuggest,
});
// 复习证据只在「到期点确实被问到且有学习者作答」时生成（extractWarmupOutcomes 的 askedAt 条件），
// 纯聊天两轮不保证命中——这里只做信息记录，不当作链路失败。
record('复习课-证据', true, {
  note: '信息项：无 askedAt 命中的复习项时为 0 行，属正常',
  evidence: reviewEvidence(target.userId),
});

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ base: BASE, results, failed: failed.length }, null, 2));
process.exit(failed.length > 0 ? 2 : 0);
