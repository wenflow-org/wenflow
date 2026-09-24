// 修复验证：A) learningSignal 实注入  B) 跨日模拟衰减按模拟日生效
// 用法: node scripts/agent-audit/verify-fixes.mjs [presetKey]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://127.0.0.1:3001';
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const PRESET = process.argv[2] || 'vocational-electrician-exam';
const BASE_DATE = '2026-09-13';

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (tag, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}][${tag}] ${msg}`);
let cookie = '';

const api = async (method, p, body, timeoutMs = 280000) => {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; }
  return { status: res.status, j };
};
const dbRO = () => new DatabaseSync(DB, { readOnly: true });
const sess = id => { const db = dbRO(); try { return db.prepare('SELECT id,status,currentStage,completedTasks,totalTasks,userId,learningPathId FROM virtual_sessions WHERE id=?').get(id); } finally { db.close(); } };

/** 最近一条 teaching-turn 的 prompt 关键字段 */
function latestPrompt() {
  const db = dbRO();
  try {
    const r = db.prepare("SELECT userPayload, createdAt FROM prompt_call_logs WHERE agentId='skill:teaching-turn' AND success=1 ORDER BY createdAt DESC LIMIT 1").get();
    if (!r) return null;
    const p = JSON.parse(r.userPayload || '{}');
    const flat = JSON.stringify(p);
    // learningSignal 位于 payload 的 scenario 层（teaching-turn-shared.ts:93）
    const signal = p.scenario?.learningSignal ?? p.learningSignal ?? null;
    return {
      at: new Date(Number(r.createdAt)).toISOString().slice(11, 19),
      learningSignal: signal,
      lf: p.learner?.liveState?.lf ?? p.scenario?.learner?.liveState?.lf ?? null,
      lsb: p.learner?.liveState?.lsb ?? null,
      pacing: p.learner?.liveState?.recommendedPacing ?? null,
      approach: (flat.match(/"recommendedApproach":"([^"]{0,30})/) || [])[1] ?? null,
      diffReasons: (p.learner?.taskDifficulty ?? p.scenario?.learner?.taskDifficulty)?.reasons ?? null,
    };
  } finally { db.close(); }
}
/** 该用户 learning_metrics 最新 committed 行的 calculatedAt（模拟日/真墙钟） */
function latestMetric(userId) {
  const db = dbRO();
  try {
    const r = db.prepare("SELECT calculatedAt, lf, lsb, sourceKey FROM learning_metrics WHERE userId=? AND lss IS NOT NULL ORDER BY rowid DESC LIMIT 1").get(userId);
    return r ? { calc: new Date(Number(r.calculatedAt)).toISOString().slice(0, 16), lf: Number(r.lf).toFixed(2), src: String(r.sourceKey).slice(0, 26) } : null;
  } finally { db.close(); }
}

// ---------- 登录 ----------
{
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) { console.log('LOGIN FAILED'); process.exit(1); }
}

// ---------- 建会话 → goal → path → 桥接 → 教学 ----------
const db = dbRO();
const profile = db.prepare('SELECT id, userId FROM virtual_learner_profiles WHERE presetKey=?').get(PRESET);
db.close();
if (!profile) { console.log('no profile'); process.exit(1); }
const userLearningSignal = (() => {
  const d = dbRO();
  try {
    const r = d.prepare("SELECT collectedData FROM goal_conversations WHERE userId=? AND status='completed' ORDER BY createdAt DESC LIMIT 1").get(profile.userId);
    const m = (r?.collectedData || '').match(/"learning_signal"\s*:\s*"([^"]{1,100})"/);
    return m ? m[1] : null;
  } finally { d.close(); }
})();
log('A', `preset=${PRESET} user=${profile.userId.slice(0, 8)} goal.learning_signal=${userLearningSignal ? JSON.stringify(userLearningSignal.slice(0, 60)) : '(无)'}`);

const started = await api('POST', `/api/admin/virtual-learners/${profile.id}/start-session`, { storyIndex: 0 });
const sid = started.j?.data?.id;
log('A', 'session=' + sid);

// goal 阶段（autopilot stage）
await api('POST', `/api/admin/virtual-learners/sessions/${sid}/autopilot/start`, { target: 'stage' }, 60000);
let s = sess(sid);
const t0 = Date.now();
while (s.currentStage === 'goal' && Date.now() - t0 < 15 * 60 * 1000) { await sleep(15 * 1000); s = sess(sid); }
log('A', `goal→${s.currentStage} (${Math.round((Date.now() - t0) / 1000)}s)`);

// path 生成等待 + 桥接
const t1 = Date.now();
while (!s.learningPathId && Date.now() - t1 < 15 * 60 * 1000) { await sleep(15 * 1000); s = sess(sid); }
log('A', 'path=' + String(s.learningPathId).slice(0, 16));
try { await api('POST', `/api/admin/virtual-learners/sessions/${sid}/review-path`, {}, 280000); } catch (e) { log('A', 'review-err ' + e.message.slice(0, 100)); }
await api('POST', `/api/admin/virtual-learners/sessions/${sid}/accept-path`, { force: true }, 120000);
await api('POST', `/api/admin/virtual-learners/sessions/${sid}/start-learning`, {}, 200000);
s = sess(sid);
log('A', `stage=${s.currentStage} tasks=${s.completedTasks}/${s.totalTasks}`);

// 2 个教学步（任务 1 进入 active）
for (let i = 1; i <= 2; i++) {
  const r = await api('POST', `/api/admin/virtual-learners/sessions/${sid}/teaching-step`, {}, 280000);
  log('A', `step${i} ok=${r.status === 200} ${JSON.stringify(r.j?.data ?? r.j?.error ?? '').slice(0, 120)}`);
}
const pA = latestPrompt();
log('A', 'teaching prompt: ' + JSON.stringify(pA));
console.log(`\n>>> A 结论：learningSignal = ${JSON.stringify(pA?.learningSignal)} （goal 侧原值：${userLearningSignal ? '非空' : '空'}）`);

// ---------- B) 跨日模拟衰减 ----------
const s0 = await api('GET', '/api/admin/virtual-learners/settings');
const ds = s0.j?.data?.settings?.dateSimulation || {};
await api('PUT', '/api/admin/virtual-learners/settings', { dateSimulation: { ...ds, enabled: true, lessonsPerDay: 1 } });
await api('PUT', `/api/admin/virtual-learners/sessions/${sid}/simulation-config`, { simulationClock: { baseDate: BASE_DATE, enabled: true } });
log('B', `date sim on, baseDate=${BASE_DATE}`);

const trace = [];
for (let d = 1; d <= 2; d++) {
  const before = latestPrompt();
  const metricBefore = latestMetric(profile.userId);
  let r;
  try { r = await api('POST', `/api/admin/virtual-learners/sessions/${sid}/advance-day`, { days: 1, runTasks: true }, 280000); }
  catch (e) { log('B', 'advance-day err ' + e.message.slice(0, 120)); }
  log('B', `day${d}: ${r ? JSON.stringify(r.j?.data?.simulatedDay ?? r.j?.error ?? r.j).slice(0, 160) : '(timeout)'}`);
  await sleep(5000);
  const after = latestPrompt();
  const metricAfter = latestMetric(profile.userId);
  trace.push({ day: d, before, after, metricBefore, metricAfter });
  log('B', `day${d} prompt before=${JSON.stringify(before)}`);
  log('B', `day${d} prompt after =${JSON.stringify(after)}`);
  log('B', `day${d} metric  before=${JSON.stringify(metricBefore)} after=${JSON.stringify(metricAfter)}`);
}

await api('PUT', '/api/admin/virtual-learners/settings', { dateSimulation: { enabled: false, lessonsPerDay: 2 } });
log('B', 'settings restored');
fs.writeFileSync(path.join(ROOT, 'scripts', 'agent-audit', 'results', 'verify-fixes.json'), JSON.stringify({ preset: PRESET, sessionId: sid, userLearningSignal, learningSignalInPrompt: pA?.learningSignal, trace }, null, 2));
console.log('\n>>> 轨迹已写入 scripts/agent-audit/results/verify-fixes.json');
