// 修复验证 v2（重启免疫：只用同步单步接口 + 重试）
// A) learningSignal 实注入   B) 跨日模拟衰减按模拟日生效
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://127.0.0.1:3001';
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const SESSION = process.argv[2] || null; // 复用已有会话（goal 阶段）
const BASE_DATE = '2026-09-13';

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (tag, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}][${tag}] ${msg}`);
let cookie = '';

const raw = async (method, p, body, timeoutMs = 150000) => {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; }
  return { status: res.status, j };
};
/** 带重试（进程重启/超时都不致命） */
const api = async (method, p, body, { tries = 4, timeoutMs = 150000, label = '' } = {}) => {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await raw(method, p, body, timeoutMs);
      if (r.status < 500) return r;
      log('retry', `${label || p} -> ${r.status} (${i}/${tries})`);
    } catch (e) { log('retry', `${label || p} err ${e.message.slice(0, 80)} (${i}/${tries})`); }
    await sleep(8000);
  }
  return { status: 0, j: { error: 'all retries failed' } };
};
const dbRO = () => new DatabaseSync(DB, { readOnly: true });
const sess = id => { const d = dbRO(); try { return d.prepare('SELECT id,status,currentStage,completedTasks,totalTasks,userId,learningPathId FROM virtual_sessions WHERE id=?').get(id); } finally { d.close(); } };

function latestPrompt() {
  const d = dbRO();
  try {
    const r = d.prepare("SELECT userPayload, createdAt FROM prompt_call_logs WHERE agentId='skill:teaching-turn' AND success=1 ORDER BY createdAt DESC LIMIT 1").get();
    if (!r) return null;
    const p = JSON.parse(r.userPayload || '{}');
    const flat = JSON.stringify(p);
    const sc = p.scenario || {};
    return {
      at: new Date(Number(r.createdAt)).toISOString().slice(11, 19),
      learningSignal: sc.learningSignal ?? p.learningSignal ?? null,
      lf: sc.learner?.liveState?.lf ?? p.learner?.liveState?.lf ?? null,
      lsb: sc.learner?.liveState?.lsb ?? p.learner?.liveState?.lsb ?? null,
      pacing: sc.learner?.liveState?.recommendedPacing ?? p.learner?.liveState?.recommendedPacing ?? null,
      approach: (flat.match(/"recommendedApproach":"([^"]{0,30})/) || [])[1] ?? null,
      diffReasons: (sc.learner?.taskDifficulty ?? p.learner?.taskDifficulty)?.reasons ?? null,
    };
  } finally { d.close(); }
}
function latestMetric(userId) {
  const d = dbRO();
  try {
    const r = d.prepare("SELECT calculatedAt, lf, lsb, sourceKey FROM learning_metrics WHERE userId=? AND lss IS NOT NULL ORDER BY rowid DESC LIMIT 1").get(userId);
    return r ? { calc: new Date(Number(r.calculatedAt)).toISOString().slice(0, 16), lf: Number(r.lf).toFixed(2), lsb: Number(r.lsb).toFixed(2), src: String(r.sourceKey).slice(0, 24) } : null;
  } finally { d.close(); }
}
function teacherStateTs(sessionId) {
  const d = dbRO();
  try {
    const r = d.prepare("SELECT teachingState FROM teaching_sessions WHERE id IN (SELECT id FROM teaching_sessions WHERE userId=(SELECT userId FROM virtual_sessions WHERE id=?)) AND status='active' ORDER BY startTime DESC LIMIT 1").get(sessionId);
    if (!r?.teachingState) return null;
    const ts = JSON.parse(r.teachingState);
    return { lf: ts.lf, lsb: ts.lsb, timestamp: ts.timestamp ? new Date(Number(ts.timestamp) || ts.timestamp).toISOString().slice(0, 16) : null };
  } catch { return null; } finally { d.close(); }
}

// ---- login ----
{
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) { console.log('LOGIN FAILED'); process.exit(1); }
}

let sid = SESSION;
if (!sid) {
  const d = dbRO();
  const profile = d.prepare("SELECT id, userId FROM virtual_learner_profiles WHERE presetKey='vocational-electrician-exam'").get();
  d.close();
  const started = await api('POST', `/api/admin/virtual-learners/${profile.id}/start-session`, { storyIndex: 0 }, { label: 'start-session' });
  sid = started.j?.data?.id;
}
log('init', 'session=' + sid);
let s = sess(sid);
log('init', `status=${s.status} stage=${s.currentStage} path=${String(s.learningPathId).slice(0, 14)}`);

// ---- 1. goal 阶段：同步单步推进 ----
for (let i = 0; i < 14 && sess(sid).currentStage === 'goal'; i++) {
  const r = await api('POST', `/api/admin/virtual-learners/sessions/${sid}/step`, {}, { label: `goal-step${i + 1}` });
  const cur = sess(sid);
  log('goal', `step${i + 1} http=${r.status} -> stage=${cur.currentStage} status=${cur.status}${r.j?.data?.goalReady ? ' goalReady' : ''}`);
  if (['failed', 'abandoned'].includes(cur.status)) break;
  await sleep(2000);
}

// ---- 2. path 就绪 + 桥接 ----
s = sess(sid);
if (!s.learningPathId) {
  await api('POST', `/api/admin/virtual-learners/sessions/${sid}/advance-path`, {}, { label: 'advance-path', timeoutMs: 200000 });
  for (let i = 0; i < 20 && !sess(sid).learningPathId; i++) { await sleep(15000); }
}
s = sess(sid);
log('path', `path=${String(s.learningPathId).slice(0, 16)} stage=${s.currentStage}`);
await api('POST', `/api/admin/virtual-learners/sessions/${sid}/review-path`, {}, { label: 'review-path', timeoutMs: 200000 });
await api('POST', `/api/admin/virtual-learners/sessions/${sid}/accept-path`, { force: true }, { label: 'accept-path' });
await api('POST', `/api/admin/virtual-learners/sessions/${sid}/start-learning`, {}, { label: 'start-learning', timeoutMs: 200000 });
s = sess(sid);
log('learn', `stage=${s.currentStage} tasks=${s.completedTasks}/${s.totalTasks}`);

// ---- 3. 教学 2 步 → 验证 A ----
for (let i = 1; i <= 2; i++) {
  const r = await api('POST', `/api/admin/virtual-learners/sessions/${sid}/teaching-step`, {}, { label: `teach-step${i}`, timeoutMs: 240000 });
  log('A', `step${i} http=${r.status} ${JSON.stringify(r.j?.data ?? r.j?.error ?? '').slice(0, 100)}`);
}
const pA = latestPrompt();
const user = sess(sid).userId;
log('A', 'prompt=' + JSON.stringify(pA));
console.log(`\n>>> A 结果：scenario.learningSignal = ${JSON.stringify(pA?.learningSignal)}`);

// ---- 4. 跨日模拟 ×2 → 验证 B ----
const s0 = await api('GET', '/api/admin/virtual-learners/settings', undefined, { label: 'get-settings' });
const ds = s0.j?.data?.settings?.dateSimulation || {};
await api('PUT', '/api/admin/virtual-learners/settings', { dateSimulation: { ...ds, enabled: true, lessonsPerDay: 1 } }, { label: 'put-settings' });
await api('PUT', `/api/admin/virtual-learners/sessions/${sid}/simulation-config`, { simulationClock: { baseDate: BASE_DATE, enabled: true } }, { label: 'sim-config' });
log('B', `date-sim on baseDate=${BASE_DATE}`);

const trace = [];
for (let d = 1; d <= 2; d++) {
  const before = { prompt: latestPrompt(), metric: latestMetric(user), teachingState: teacherStateTs(sid) };
  const r = await api('POST', `/api/admin/virtual-learners/sessions/${sid}/advance-day`, { days: 1, runTasks: true }, { label: `advance-day${d}`, tries: 3, timeoutMs: 260000 });
  log('B', `day${d} http=${r.status} ${JSON.stringify(r.j?.data?.simulatedDay ?? r.j?.error ?? r.j).slice(0, 140)}`);
  await sleep(5000);
  const after = { prompt: latestPrompt(), metric: latestMetric(user), teachingState: teacherStateTs(sid) };
  trace.push({ day: d, before, after });
  log('B', `day${d} before: ${JSON.stringify(before)}`);
  log('B', `day${d} after : ${JSON.stringify(after)}`);
}

await api('PUT', '/api/admin/virtual-learners/settings', { dateSimulation: { enabled: false, lessonsPerDay: 2 } }, { label: 'restore-settings' });
log('B', 'settings restored');
const out = { sessionId: sid, learningSignalInPrompt: pA?.learningSignal, trace };
fs.writeFileSync(path.join(ROOT, 'scripts', 'agent-audit', 'results', 'verify-fixes2.json'), JSON.stringify(out, null, 2));
console.log('\n>>> 写入 scripts/agent-audit/results/verify-fixes2.json');
