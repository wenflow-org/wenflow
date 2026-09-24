// Phase-2 驱动：对已生成 Path 的会话做 评审→接受→进教学→逐回合上课
// 用法: node scripts/agent-audit/e2e-drive2.mjs <sessionId> [maxSteps]  （sessionId 传 all 则处理 3 个预置会话，串行）
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://127.0.0.1:3001';
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const OUT_DIR = path.join(ROOT, 'scripts', 'agent-audit', 'results');
fs.mkdirSync(OUT_DIR, { recursive: true });

let cookie = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (k, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}][${k}] ${msg}`);

async function login() {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('login failed');
}

async function api(method, urlPath, bodyObj, timeoutMs = 280000) {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, {
    method, headers, body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok || json?.success === false) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${String(json?.error?.message || json?.error || json?.raw).slice(0, 220)}`);
  }
  return json;
}

const dbRO = () => new DatabaseSync(DB_PATH, { readOnly: true });
const sess = id => { const db = dbRO(); try { return db.prepare('SELECT * FROM virtual_sessions WHERE id=?').get(id); } finally { db.close(); } };

async function waitForPathReady(sessionId, maxMin = 15) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMin * 60 * 1000) {
    const s = sess(sessionId);
    if (s.learningPathId) return s;
    // 路径可能已生成但 learningPathId 尚未挂上；查 learning_paths 表兜底
    await sleep(15 * 1000);
  }
  return sess(sessionId);
}

async function driveTeaching(sessionId, maxSteps) {
  const timeline = [];
  const note = (phase, detail) => { timeline.push({ t: new Date().toISOString(), phase, detail }); log(sessionId.slice(0, 8), `[${phase}] ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 240)}`); };
  let steps = 0, taskDone = 0, errs = 0;
  const t0 = Date.now();
  while (steps < maxSteps && Date.now() - t0 < 55 * 60 * 1000) {
    const s = sess(sessionId);
    if (['completed', 'failed', 'abandoned'].includes(s.status)) { note('stop-status', s.status); break; }
    try {
      const r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/teaching-step`, {}, 280000);
      steps++;
      const d = r?.data || {};
      const now = sess(sessionId);
      note('step', {
        i: steps, done: d.done ?? d.completed ?? null, taskCompleted: d.taskCompleted ?? null,
        stage: now.currentStage, tasks: `${now.completedTasks}/${now.totalTasks}`,
        aiCalls: (() => { try { return JSON.parse(now.stageResults || '{}')?.runtimeStats?.aiCalls ?? null; } catch { return null; } })(),
      });
      if (d.taskCompleted || d.done) taskDone++;
      if (now.status === 'completed') { note('session-completed', {}); break; }
    } catch (e) {
      errs++;
      note('step-err', e.message.slice(0, 200));
      if (errs >= 4) { note('too-many-errors', {}); break; }
      await sleep(15 * 1000);
    }
  }
  return { steps, taskDone, errs, timeline };
}

async function bridgeToTeaching(sessionId) {
  const s0 = sess(sessionId);
  log(sessionId.slice(0, 8), `bridge begin: status=${s0.status} stage=${s0.currentStage} pathId=${String(s0.learningPathId).slice(0, 14)}`);
  // 1. 评审
  let review;
  try {
    review = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/review-path`, {}, 280000);
    log(sessionId.slice(0, 8), 'review: ' + JSON.stringify(review?.data?.decision || review?.data || {}).slice(0, 200));
  } catch (e) { log(sessionId.slice(0, 8), 'review-err(继续接受): ' + e.message.slice(0, 160)); }
  // 2. 接受（评审失败/modify 时 force 旁路）
  try {
    await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/accept-path`, { force: true }, 120000);
    log(sessionId.slice(0, 8), 'accepted');
  } catch (e) { log(sessionId.slice(0, 8), 'accept-err: ' + e.message.slice(0, 160)); return false; }
  // 3. 进教学
  try {
    await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/start-learning`, {}, 200000);
    const s = sess(sessionId);
    log(sessionId.slice(0, 8), `learning started: stage=${s.currentStage} tasks=${s.completedTasks}/${s.totalTasks}`);
    return s.currentStage === 'teaching';
  } catch (e) { log(sessionId.slice(0, 8), 'start-learning-err: ' + e.message.slice(0, 160)); return false; }
}

async function main() {
  await login();
  const arg = process.argv[2] || 'all';
  const maxSteps = Number(process.argv[3] || 20);
  let ids;
  if (arg === 'all') {
    ids = ['3559efad-df13-4a89-94ac-7a4f619ddfec', '8b973175-c450-4858-aa63-2466bd8d9da5', 'e90b5917-eed0-42bb-a3fb-cd43eee98a73'];
  } else ids = arg.split(',');
  ids = ids.filter(id => { const s = sess(id); return s && !['completed', 'abandoned'].includes(s.status); });
  log('main', 'bridging sessions: ' + ids.map(i => i.slice(0, 8)).join(','));
  // 先串行把 3 个会话桥进教学（评审有 LLM，逐个来；进入教学后再并发上课）
  const ok = [];
  for (const id of ids) { if (await bridgeToTeaching(id)) ok.push(id); }
  log('main', 'bridged: ' + ok.map(i => i.slice(0, 8)).join(','));
  // 并发上课（并发=3）
  const results = await Promise.all(ok.map(id => driveTeaching(id, maxSteps).then(r => ({ id, ...r }))));
  for (const r of results) {
    fs.writeFileSync(path.join(OUT_DIR, `teach-${r.id.slice(0, 8)}.json`), JSON.stringify(r, null, 2));
  }
  log('main', 'done: ' + JSON.stringify(results.map(r => ({ id: r.id.slice(0, 8), steps: r.steps, taskDone: r.taskDone, errs: r.errs }))));
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
