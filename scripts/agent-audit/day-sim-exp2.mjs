// 跨日模拟实验：baseDate 倒回过去，连续两个模拟日各跑一课，
// 对比第 2 天教学 prompt 的 lf 先验 —— 「按模拟日衰减」 vs 「按真实墙钟衰减」
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://127.0.0.1:3001';
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const SESSION = process.argv[2] || '3559efad-df13-4a89-94ac-7a4f619ddfec';
const BASE_DATE = process.argv[3] || '2026-09-13';
const DAYS = Number(process.argv[4] || 2);

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
let cookie = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const login = async () => {
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
};
const api = async (method, p, body, timeoutMs = 100000) => {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  return { status: res.status, j };
};
const dbSnap = () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const s = db.prepare('SELECT status, currentStage, completedTasks, totalTasks, updatedAt FROM virtual_sessions WHERE id=?').get(SESSION);
    const metrics = db.prepare("SELECT recordedAt, lss, ktl, lf, lsb, sourceKey FROM learning_metrics WHERE userId=(SELECT userId FROM virtual_sessions WHERE id=?) AND lss IS NOT NULL ORDER BY recordedAt DESC LIMIT 4").all(SESSION);
    return { s, metrics: metrics.map(m => ({ at: new Date(Number(m.recordedAt)).toISOString().slice(5, 16), lf: Number(m.lf).toFixed(2), lss: Number(m.lss).toFixed(2), src: String(m.sourceKey).slice(0, 24) })) };
  } finally { db.close(); }
};
const lastPromptSig = () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const r = db.prepare("SELECT userPayload, createdAt FROM prompt_call_logs WHERE agentId='skill:teaching-turn' AND success=1 ORDER BY createdAt DESC LIMIT 1").get();
    if (!r) return null;
    const p = JSON.parse(r.userPayload || '{}');
    const flat = JSON.stringify(p);
    const lf = p.learner?.liveState?.lf;
    const lsb = p.learner?.liveState?.lsb;
    const pacing = p.learner?.liveState?.recommendedPacing;
    const approach = flat.match(/"recommendedApproach":"([^"]{0,40})/) ?.[1];
    const diff = p.learner?.taskDifficulty;
    return { at: new Date(Number(r.createdAt)).toISOString().slice(5, 19), lf, lsb, pacing, approach, difficulty: diff ? { baseline: diff.baseline, adjusted: diff.adjusted, reasons: diff.reasons } : null };
  } finally { db.close(); }
};

await login();
if (!cookie) { console.log('LOGIN FAILED'); process.exit(1); }

// 0. 记录实验前状态
const before = dbSnap();
console.log('=== before ===');
console.log('session:', JSON.stringify(before.s));
console.log('metrics:', JSON.stringify(before.metrics));

// 1. lessonsPerDay -> 1（省时），dateSimulation on
const s0 = await api('GET', '/api/admin/virtual-learners/settings');
const ds = s0.j?.data?.settings?.dateSimulation || {};
await api('PUT', '/api/admin/virtual-learners/settings', { dateSimulation: { ...ds, enabled: true, lessonsPerDay: 1 } });
console.log('settings updated: enabled=true lessonsPerDay=1');

// 2. baseDate 倒回
const c0 = await api('PUT', `/api/admin/virtual-learners/sessions/${SESSION}/simulation-config`, { simulationClock: { baseDate: BASE_DATE, enabled: true } });
console.log('simulation-config:', c0.status, JSON.stringify(c0.j?.data ?? c0.j?.error ?? c0.j).slice(0, 200));

// 3. 连续推进 DAYS 个模拟日，各跑一课
for (let d = 1; d <= DAYS; d++) {
  console.log(`\n=== 模拟日 ${d}：advance-day +1 (runTasks) ===`);
  const t0 = Date.now();
  let r;
  try {
    r = await api('POST', `/api/admin/virtual-learners/sessions/${SESSION}/advance-day`, { days: 1, runTasks: true }, 280000);
  } catch (e) {
    console.log('advance-day fetch err (可能仍在后台跑):', e.message.slice(0, 120));
    // 轮询等待
    let stable = 0;
    while (Date.now() - t0 < 20 * 60 * 1000) {
      await sleep(30 * 1000);
      const snap = dbSnap();
      if (snap.s.updatedAt && Date.now() - Number(snap.s.updatedAt) > 90 * 1000) { stable++; if (stable >= 2) break; } else stable = 0;
    }
  }
  if (r) console.log('advance-day:', r.status, JSON.stringify(r.j?.data ?? r.j?.error ?? r.j).slice(0, 400));
  await sleep(5000);
  const after = dbSnap();
  console.log('after metrics:', JSON.stringify(after.metrics));
  console.log('session:', JSON.stringify(after.s));
  console.log('latest teaching prompt:', JSON.stringify(lastPromptSig()));
}

console.log('\n=== 期望对照 ===');
console.log('若按「1 个模拟日」衰减: lf_prior = 1.2 + (lf_day1 - 1.2) * 0.74');
console.log('若按「真实墙钟(约7天)」衰减: lf_prior = 1.2 + (lf_day1 - 1.2) * 0.74^7 ≈ 1.2 + (lf_day1-1.2)*0.12');
