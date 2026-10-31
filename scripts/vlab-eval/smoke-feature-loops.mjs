#!/usr/bin/env node
/**
 * smoke-feature-loops.mjs — 功能可用性冒烟（2026-10-21）
 *
 * 覆盖两条「VL 侧从来没用过」的真实用户端点，证明功能不是死线：
 *   1) 延伸学：POST /api/ai-teaching/tasks/:taskId/extension-session →
 *      POST /sessions/:id/finalize {action:'end_only'} → 校验 mode/wrapup.extensionObservability
 *   2) 建议处置：POST /sessions/:id/advisory-response {action:'later'} → 校验 advisory.learnerResponse
 *
 * 用 VL 的 projection token 直接扮演学习者（与 blackbox 同一条鉴权路径），不经过模型模拟。
 * 产物：JSON 摘要到 stdout；退出码 0=全过、2=有失败。
 *
 * 用法：node scripts/vlab-eval/smoke-feature-loops.mjs [--base=http://127.0.0.1:3001]
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

async function api(method, p, { cookie, projection, body } = {}) {
  const headers = { 'content-type': 'application/json', origin: 'http://localhost:5173' };
  if (cookie) headers.cookie = cookie;
  if (projection) headers['x-projection-token'] = projection;
  if (method === 'POST') headers['idempotency-key'] = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

function pickExtensionTarget() {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const row = db.prepare(`
      select ts.userId, ts.taskId, p.id as profileId
      from teaching_sessions ts
      join virtual_learner_profiles p on p.userId = ts.userId
      where ts.mode = 'tutor' and ts.status = 'completed' and ts.taskId is not null
        and not exists (
          select 1 from teaching_sessions e
          where e.userId = ts.userId and e.taskId = ts.taskId and e.mode = 'extension'
        )
        and not exists (
          select 1 from teaching_sessions a
          where a.userId = ts.userId and a.taskId = ts.taskId
            and a.status in ('active','paused','timeout','finalizing')
        )
      order by ts.updatedAt desc
      limit 1
    `).get();
    const active = row ? db.prepare(`
      select count(*) n from teaching_sessions
      where userId = ? and taskId = ? and status in ('active','paused','timeout','finalizing')
    `).get(row.userId, row.taskId) : null;
    return row ? { ...row, active: active?.n || 0 } : null;
  } finally {
    db.close();
  }
}

function pickAdvisoryTarget() {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(`
      select ts.id as sessionId, ts.userId, p.id as profileId
      from teaching_sessions ts
      join virtual_learner_profiles p on p.userId = ts.userId
      where ts.status = 'completed'
        and json_extract(ts.advisory, '$.shouldSuggest') = 1
        and json_extract(ts.advisory, '$.learnerResponse') is null
      order by ts.updatedAt desc
      limit 1
    `).get() || null;
  } finally {
    db.close();
  }
}

function verifyExtension(sessionId) {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(`select mode, status, wrapup, taskId from teaching_sessions where id = ?`).get(sessionId);
  } finally {
    db.close();
  }
}

function verifyAdvisory(sessionId) {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(`select json_extract(advisory, '$.learnerResponse') response from teaching_sessions where id = ?`).get(sessionId);
  } finally {
    db.close();
  }
}

async function mintToken(profileId) {
  const res = await api('POST', `/api/admin/virtual-learners/${encodeURIComponent(profileId)}/projection-token`, {
    cookie: adminCookie,
    body: { scope: 'full' },
  });
  if (res.status !== 200 || !res.json?.data?.token) {
    throw new Error(`projection token 失败：HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
  }
  return res.json.data.token;
}

async function runExtensionLoop() {
  const target = pickExtensionTarget();
  if (!target) {
    record('延伸学', false, { reason: '没有可作为延伸源的已完成正课' });
    return;
  }
  if (target.active > 0) {
    record('延伸学', false, { reason: '该任务仍有未收束课堂', target });
    return;
  }
  const token = await mintToken(target.profileId);
  const created = await api('POST', `/api/ai-teaching/tasks/${encodeURIComponent(target.taskId)}/extension-session`, {
    projection: token,
    body: {},
  });
  if (created.status !== 200 || !created.json?.data?.sessionId) {
    record('延伸学-开课', false, { status: created.status, body: created.json });
    return;
  }
  const { sessionId, revision, mode } = created.json.data;
  record('延伸学-开课', mode === 'extension' && typeof revision === 'number', { sessionId, revision, mode });

  // 幽灵课判定（<2 学生回合且 <60s）会把 0 回合收束当弃跑、不写 wrapup。
  // 这里按真实学习者送两句，再 end_only 收束。
  let rev = revision;
  for (const message of ['老师，我想再深入看看这个知识点。', '能再给我一个具体一点的例子吗。']) {
    const turn = await api('POST', `/api/ai-teaching/sessions/${encodeURIComponent(sessionId)}/messages`, {
      projection: token,
      body: { message, revision: rev },
    });
    if (turn.status !== 200) {
      record('延伸学-发言', false, { status: turn.status, body: turn.json });
      return;
    }
    rev = turn.json?.data?.revision ?? rev;
  }

  const finalized = await api('POST', `/api/ai-teaching/sessions/${encodeURIComponent(sessionId)}/finalize`, {
    projection: token,
    body: { action: 'end_only', revision: rev, reason: 'manual-end' },
  });
  const row = verifyExtension(sessionId);
  let observability = null;
  try { observability = JSON.parse(row?.wrapup || 'null')?.extensionObservability || null; } catch { /* ignore */ }
  record('延伸学-收束', finalized.status === 200 && row?.status === 'completed' && row?.mode === 'extension', {
    http: finalized.status,
    status: row?.status,
    mode: row?.mode,
    hasObservability: Boolean(observability),
  });
}

async function runAdvisoryLoop() {
  const target = pickAdvisoryTarget();
  if (!target) {
    record('建议处置', false, { reason: '没有待处置的 VL 建议' });
    return;
  }
  const token = await mintToken(target.profileId);
  const res = await api('POST', `/api/ai-teaching/sessions/${encodeURIComponent(target.sessionId)}/advisory-response`, {
    projection: token,
    body: { action: 'later' },
  });
  const row = verifyAdvisory(target.sessionId);
  // advisory 列存的是整体 JSON 文本，json_extract 得到内层文本 → 需要再 parse 一次
  let response = row?.response ?? null;
  if (typeof response === 'string') { try { response = JSON.parse(response); } catch { /* keep raw */ } }
  record('建议处置', res.status === 200 && response?.action === 'later', {
    http: res.status,
    sessionId: target.sessionId,
    response,
  });
}

await runExtensionLoop();
await runAdvisoryLoop();

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ base: BASE, results, failed: failed.length }, null, 2));
process.exit(failed.length > 0 ? 2 : 0);
