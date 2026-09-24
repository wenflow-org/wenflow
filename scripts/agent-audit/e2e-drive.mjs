// E2E 驱动：3 个虚拟学习者并发（goal→path→teaching N 步），全程走 admin API
// 用法: node scripts/agent-audit/e2e-drive.mjs [preset1,preset2,preset3] [maxSteps]
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://127.0.0.1:3001';
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const PRESETS = (process.argv[2] || 'shop-owner-inventory,vocational-electrician-exam,student-geo-essay').split(',');
const MAX_TEACHING_STEPS = Number(process.argv[3] || 24);
const OUT_DIR = path.join(ROOT, 'scripts', 'agent-audit', 'results');
fs.mkdirSync(OUT_DIR, { recursive: true });

let cookie = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (k, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}][${k}] ${msg}`);
const dbRO = () => new DatabaseSync(DB_PATH, { readOnly: true });

async function login() {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('login failed: ' + (await res.text()).slice(0, 200));
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

function getSession(sessionId) {
  const db = dbRO();
  try {
    return db.prepare('SELECT id,status,currentStage,completedTasks,totalTasks,goalConversationId,learningPathId,currentTaskId,createdAt,updatedAt FROM virtual_sessions WHERE id=?').get(sessionId);
  } finally { db.close(); }
}

function getStageStats(sessionId) {
  const db = dbRO();
  try {
    const row = db.prepare('SELECT stageResults FROM virtual_sessions WHERE id=?').get(sessionId);
    if (!row) return null;
    const sr = JSON.parse(row.stageResults || '{}');
    return {
      runtimeStats: sr.runtimeStats?.aiCalls ?? null,
      autopilot: sr.autopilot ? { phase: sr.autopilot.phase, status: sr.autopilot.status, note: sr.autopilot.note } : null,
      goalStage: sr.goal ? { done: sr.goal.done, stage: sr.goal.stage, rounds: (sr.goal.messages || []).length } : null,
      pathReview: sr.path_review ? { decision: sr.path_review.decision } : null,
      teaching: sr.teaching ? { turns: sr.teaching.turnCount ?? sr.teaching.turns ?? null, lastTaskDone: sr.teaching.lastTaskCompleted ?? null } : null,
    };
  } catch (e) { return { parseError: e.message.slice(0, 80) }; }
  finally { db.close(); }
}

async function drivePreset(key) {
  const timeline = [];
  const note = (phase, detail) => { timeline.push({ t: new Date().toISOString(), phase, detail }); log(key, `[${phase}] ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 260)}`); };

  const db = dbRO();
  const profile = db.prepare('SELECT id, userId FROM virtual_learner_profiles WHERE presetKey=?').get(key);
  db.close();
  if (!profile) throw new Error('no profile for ' + key);
  note('profile', profile.id);

  // 1. 开会话（每个 preset 取第 0 个故事）
  const started = await api('POST', `/api/admin/virtual-learners/${profile.id}/start-session`, { storyIndex: 0 });
  const sessionId = started?.data?.id;
  note('session-started', sessionId);

  // 2. 逐阶段推进 goal → path，直到进入 teaching
  for (let round = 1; round <= 4; round++) {
    const s = getSession(sessionId);
    if (s.currentStage === 'teaching' || ['completed', 'failed'].includes(s.status)) { note('stage-reached', { stage: s.currentStage, status: s.status }); break; }
    note('autopilot-stage-begin', { round, stage: s.currentStage, status: s.status });
    try { await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/autopilot/start`, { target: 'stage' }, 60000); }
    catch (e) { note('autopilot-start-err', e.message.slice(0, 160)); }
    // 轮询等待阶段变化（最长 25 分钟）
    const t0 = Date.now();
    let last = s;
    while (Date.now() - t0 < 25 * 60 * 1000) {
      await sleep(20 * 1000);
      last = getSession(sessionId);
      const st = getStageStats(sessionId);
      if (last.currentStage !== s.currentStage || ['completed', 'failed'].includes(last.status)) {
        note('stage-changed', { from: s.currentStage, to: last.currentStage, status: last.status, stats: st });
        break;
      }
      if (round % 1 === 0 && (Date.now() - t0) % (120 * 1000) < 20 * 1000) note('stage-wait', { stage: last.currentStage, status: last.status, waitedMin: Math.round((Date.now() - t0) / 60000), stats: st });
    }
    if (last.status === 'failed') { note('failed', last); break; }
  }

  const sNow = getSession(sessionId);
  if (sNow.currentStage !== 'teaching') {
    note('never-reached-teaching', sNow);
    fs.writeFileSync(path.join(OUT_DIR, `drive-${key}.json`), JSON.stringify({ key, sessionId, timeline }, null, 2));
    return { key, sessionId, ok: false, timeline };
  }

  // 3. 教学阶段：逐回合驱动
  let steps = 0, taskCompletions = 0, errs = 0;
  const t0 = Date.now();
  while (steps < MAX_TEACHING_STEPS && Date.now() - t0 < 60 * 60 * 1000) {
    const s = getSession(sessionId);
    if (['completed', 'failed', 'abandoned'].includes(s.status)) { note('teaching-stop-session', s); break; }
    try {
      const r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/teaching-step`, {}, 280000);
      steps++;
      const d = r?.data || {};
      note('step', {
        i: steps, done: d.done ?? d.completed ?? null, taskDone: d.taskCompleted ?? null,
        stage: d.stage ?? null, closure: d.closure ?? d.closureDecision ?? null,
        currentTaskId: getSession(sessionId).currentTaskId?.slice(0, 8),
        completedTasks: getSession(sessionId).completedTasks + '/' + getSession(sessionId).totalTasks,
      });
      if (d.taskCompleted || d.done) taskCompletions++;
      if (getSession(sessionId).status === 'completed') { note('session-completed', {}); break; }
    } catch (e) {
      errs++;
      note('step-err', e.message.slice(0, 200));
      if (errs >= 4) { note('too-many-step-errors', {}); break; }
      await sleep(15 * 1000);
    }
  }
  const fin = getSession(sessionId);
  note('teaching-finished', { steps, taskCompletions, errs, status: fin.status, stage: fin.currentStage, completedTasks: `${fin.completedTasks}/${fin.totalTasks}`, stats: getStageStats(sessionId) });
  fs.writeFileSync(path.join(OUT_DIR, `drive-${key}.json`), JSON.stringify({ key, sessionId, ok: true, steps, taskCompletions, errs, final: fin, timeline }, null, 2));
  return { key, sessionId, ok: true, steps, taskCompletions };
}

async function main() {
  await login();
  log('main', 'logged in; presets: ' + PRESETS.join(', '));
  const t0 = Date.now();
  const results = await Promise.all(PRESETS.map(k => drivePreset(k).catch(e => { log(k, 'FATAL ' + e.message); return { key: k, ok: false, error: e.message }; })));
  log('main', `all done in ${Math.round((Date.now() - t0) / 60000)} min`);
  fs.writeFileSync(path.join(OUT_DIR, 'drive-summary.json'), JSON.stringify({ results, minutes: Math.round((Date.now() - t0) / 60000) }, null, 2));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
