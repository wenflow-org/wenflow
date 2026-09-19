/**
 * 用**基准（内置 preset）虚拟学习者**跑一轮完整流程（Goal → Path）。
 *
 * 与 `vl-batch-path.mjs` 的区别：
 * - 不创造学习者，而是打**平台固定评审语料**（`virtual-learners/presets.yaml` 同步进来的 14 个 preset）；
 * - 用每位学习者**自带的第一个故事**（手写语料，`storyIndex: 0`），不碰其它追加故事；
 * - 逐条 `start-session` → `run-full { autoAdvanceToPath: true }`，以 `data.pathGenerated` 判成败。
 *
 * 用法：node scripts/vl-preset-run.mjs [--concurrency=2] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.VLAB_BASE || 'http://127.0.0.1:3001';
const arg = (n, d = null) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : (process.argv.includes(`--${n}`) ? true : d); };
const CONCURRENCY = Math.max(1, Math.min(Number(arg('concurrency', 2)) || 2, 5));
const DRY = process.argv.includes('--dry-run');

// ---------- 基准学习者 + 现状 ----------
const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
const presets = db.prepare(
  `SELECT p.id AS profileId, p.userId, u.name, p.presetKey
     FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
    WHERE p.presetKey IS NOT NULL
    ORDER BY u.name`,
).all();
const q1 = (sql, p = []) => db.prepare(sql).get(...p);
const state = presets.map((r) => {
  const sessions = q1('SELECT COUNT(*) c FROM virtual_sessions WHERE userId=?', [r.userId])?.c || 0;
  const lp = q1('SELECT id, createdAt FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [r.userId]);
  return { ...r, sessions, pathId: lp?.id || null, pathCreatedAt: lp?.createdAt || null };
});
console.log(`基准学习者 ${presets.length} 人｜并发 ${CONCURRENCY}${DRY ? '（DRY RUN）' : ''}`);
if (DRY) {
  for (const s of state) console.log(`  ${String(s.name).padEnd(8)} ${String(s.presetKey).padEnd(32)} 会话=${s.sessions} 路径=${s.pathId ? 'Y(' + new Date(Number(s.pathCreatedAt)).toISOString().slice(5, 16) + ')' : 'N'}`);
  process.exit(0);
}
db.close();

// ---------- 登录 ----------
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const login = await fetch(`${BASE}/api/admin-auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (!cookie) { console.error('admin 登录失败'); process.exit(2); }
const H = { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' };
async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(900000) });
  const j = await res.json().catch(() => ({}));
  return j;
}

// ---------- 逐条跑 ----------
const out = new Array(state.length);
let cursor = 0;
const t0 = Date.now();
async function worker() {
  for (;;) {
    const i = cursor; cursor += 1;
    if (i >= state.length) return;
    const row = state[i];
    const t = Date.now();
    try {
      const detail = await api('GET', `/api/admin/virtual-learners/${row.profileId}`);
      const stories = detail?.data?.profile?.storyPool || detail?.data?.storyPool || [];
      if (!stories.length) { out[i] = { ...row, ok: false, error: '无故事' }; console.log(`  [${out.filter(Boolean).length}/${state.length}] ${row.name.padEnd(8)} ✗ 无故事`); continue; }
      const storyId = stories[0].id || stories[0].storyId;
      const started = await api('POST', `/api/admin/virtual-learners/${row.profileId}/start-session`, { storyId });
      const sessionId = started?.data?.id;
      if (!sessionId) { out[i] = { ...row, ok: false, error: 'start-session 失败: ' + String(started?.error || '').slice(0, 80) }; console.log(`  [${out.filter(Boolean).length}/${state.length}] ${row.name.padEnd(8)} ✗ start-session`); continue; }
      const res = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/run-full`, {
        maxRounds: 30, maxMilestones: 10, continueOnTaskComplete: false,
        autoAdvanceToPath: true, autoAdvanceToLearning: false,
      });
      const d = res?.data || {};
      out[i] = {
        ...row, ok: Boolean(d.pathGenerated), sessionId,
        goalRounds: d.goalRounds ?? null, finalStage: d.finalStage || null,
        seconds: Math.round((Date.now() - t) / 1000),
        error: d.error ? String(d.error).slice(0, 140) : null,
      };
      console.log(`  [${out.filter(Boolean).length}/${state.length}] ${row.name.padEnd(8)} ${out[i].ok ? '✓' : '✗'} stage=${out[i].finalStage || '-'} goal轮次=${out[i].goalRounds ?? '-'} ${out[i].seconds}s${out[i].error ? ' | ' + out[i].error : ''}`);
    } catch (e) {
      out[i] = { ...row, ok: false, seconds: Math.round((Date.now() - t) / 1000), error: String(e?.message || e).slice(0, 140) };
      console.log(`  [${out.filter(Boolean).length}/${state.length}] ${row.name.padEnd(8)} ✗ ${out[i].error}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, state.length) }, () => worker()));

// ---------- 落库后统计（只读；数据库偶发 disk I/O error，最多重试 3 次） ----------
let rows = out.map((r) => r && { ...r, pathId: null, milestones: 0, subtasks: 0, freshPath: false });
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    const db2 = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
    const q2 = (sql, p = []) => db2.prepare(sql).get(...p);
    rows = out.map((r) => {
      if (!r) return null;
      const lp = q2('SELECT id, createdAt FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [r.userId]);
      const ms = lp ? q2('SELECT COUNT(*) c FROM milestones WHERE learningPathId=?', [lp.id])?.c || 0 : 0;
      const st = lp ? q2('SELECT COUNT(*) c FROM subtasks s JOIN milestones m ON m.id=s.milestoneId WHERE m.learningPathId=?', [lp.id])?.c || 0 : 0;
      const fresh = lp && r.seconds != null ? Number(lp.createdAt) >= t0 : false;
      return { ...r, pathId: lp?.id || null, milestones: ms, subtasks: st, freshPath: fresh };
    });
    db2.close();
    break;
  } catch (e) {
    console.warn(`  统计读库失败（第 ${attempt} 次）：${String(e?.message || e).slice(0, 80)}`);
    await new Promise((res) => setTimeout(res, 1500 * attempt));
  }
}
const ok = rows.filter((r) => r?.ok).length;
const fresh = rows.filter((r) => r?.freshPath).length;
console.log(`\n===== 汇总（${((Date.now() - t0) / 1000).toFixed(0)}s）=====`);
console.log(`pathGenerated 成功 ${ok}/${rows.length}｜本次新生成了路径 ${fresh}/${rows.length}｜阶段合计 ${rows.reduce((a, r) => a + (r?.milestones || 0), 0)}｜任务合计 ${rows.reduce((a, r) => a + (r?.subtasks || 0), 0)}`);
const outDir = path.join(ROOT, 'backend', 'vlab-runs');
fs.mkdirSync(outDir, { recursive: true });
const f = path.join(outDir, `preset-run-${Date.now()}.json`);
fs.writeFileSync(f, JSON.stringify(rows, null, 2), 'utf8');
console.log(`明细: ${f}`);
