/**
 * 用**基准（内置 preset）虚拟学习者**跑一轮完整流程（Goal → Path）。
 *
 * 与 `vl-batch-path.mjs` 的区别：
 * - 不创造学习者，而是打**平台固定评审语料**（`virtual-learners/presets.yaml` 同步进来的 14 个 preset）；
 * - 用每位学习者**自带的第一个故事**（手写语料，`storyIndex: 0`）；
 * - **对提供方限流友好**：默认并发 1、每个学习者之间有间隔，失败按指数退避重试。
 *
 * 为什么需要退避：实测该网关（`platform_api_configs.apiUrl`）会返回 **429 / rate_limit**，
 * 而平台侧 `maxAttempts` 只有 1–2 次且无退避 ⇒ 一次 429 直接变成
 * `Provider request retry budget exhausted`。本脚本在**学习者粒度**上重试，绕开该弱点。
 *
 * 用法：
 *   node scripts/vl-preset-run.mjs [--concurrency=1] [--retries=3] [--backoff=60] [--gap=5] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.VLAB_BASE || 'http://127.0.0.1:3001';
const arg = (n, d = null) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : (process.argv.includes(`--${n}`) ? true : d); };
const CONCURRENCY = Math.max(1, Math.min(Number(arg('concurrency', 1)) || 1, 5));
const RETRIES = Math.max(1, Number(arg('retries', 3)) || 3);
const BACKOFF = Math.max(0, Number(arg('backoff', 60)) || 60);   // 秒，逐次翻倍
const GAP = Math.max(0, Number(arg('gap', 5)) || 5);             // 秒，学习者之间的间隔
const DRY = process.argv.includes('--dry-run');
/** 只跑指定学习者（逗号分隔的姓名或 presetKey），便于做"改动前后"对比验收。 */
const ONLY = String(arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 基准学习者 + 现状 ----------
const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
const presets = db.prepare(
  `SELECT p.id AS profileId, p.userId, u.name, p.presetKey
     FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
    WHERE p.presetKey IS NOT NULL
    ORDER BY u.name`,
).all();
const q1 = (sql, p = []) => db.prepare(sql).get(...p);
const stateAll = presets.map((r) => {
  const sessions = q1('SELECT COUNT(*) c FROM virtual_sessions WHERE userId=?', [r.userId])?.c || 0;
  const lp = q1('SELECT id, createdAt FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [r.userId]);
  return { ...r, sessions, pathId: lp?.id || null, pathCreatedAt: lp?.createdAt || null };
});
const state = ONLY.length
  ? stateAll.filter((s) => ONLY.includes(s.name) || ONLY.includes(s.presetKey))
  : stateAll;
if (ONLY.length) console.log(`--only 过滤：${state.map((s) => s.name).join('、') || '(无匹配)'}`);
console.log(`基准学习者 ${presets.length} 人｜并发 ${CONCURRENCY}｜每人最多重试 ${RETRIES} 次（退避 ${BACKOFF}s 起，翻倍）｜间隔 ${GAP}s${DRY ? '（DRY RUN）' : ''}`);
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
  return res.json().catch(() => ({}));
}

/** 跑一个学习者；可重试的失败（提供方/网络）由外层退避重试。 */
async function runOne(row) {
  const t = Date.now();
  const detail = await api('GET', `/api/admin/virtual-learners/${row.profileId}`);
  const stories = detail?.data?.profile?.storyPool || detail?.data?.storyPool || [];
  if (!stories.length) return { ...row, ok: false, fatal: true, error: '无故事' };
  const storyId = stories[0].id || stories[0].storyId;
  const started = await api('POST', `/api/admin/virtual-learners/${row.profileId}/start-session`, { storyId });
  const sessionId = started?.data?.id;
  if (!sessionId) return { ...row, ok: false, fatal: true, error: 'start-session 失败: ' + String(started?.error || '').slice(0, 80) };
  const res = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/run-full`, {
    maxRounds: 30, maxMilestones: 10, continueOnTaskComplete: false,
    autoAdvanceToPath: true, autoAdvanceToLearning: false,
  });
  const d = res?.data || {};
  const err = d.error ? String(d.error) : null;
  return {
    ...row, ok: Boolean(d.pathGenerated), sessionId,
    goalRounds: d.goalRounds ?? null, finalStage: d.finalStage || null,
    seconds: Math.round((Date.now() - t) / 1000), error: err ? err.slice(0, 140) : null,
    // 提供方/限流类失败 → 值得退避重试；业务类（如"未能进入教学阶段"）不算失败
    retryable: !d.pathGenerated && /retry budget exhausted|rate|限流|fetch failed|ECONN|timeout|502|503|504/i.test(err || ''),
  };
}

const out = new Array(state.length);
let cursor = 0;
const t0 = Date.now();
async function worker(wid) {
  for (;;) {
    const i = cursor; cursor += 1;
    if (i >= state.length) return;
    const row = state[i];
    let last = null;
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      const t = Date.now();
      try {
        last = await runOne(row);
      } catch (e) {
        last = { ...row, ok: false, seconds: Math.round((Date.now() - t) / 1000), error: String(e?.message || e).slice(0, 140), retryable: true };
      }
      console.log(`  [${out.filter(Boolean).length + 1}/${state.length}] ${row.name.padEnd(8)} ${last.ok ? '✓' : '✗'} stage=${last.finalStage || '-'} goal轮次=${last.goalRounds ?? '-'} ${last.seconds}s${last.error ? ' | ' + last.error : ''}${!last.ok && last.retryable && attempt < RETRIES ? `（第 ${attempt} 次，将退避重试）` : ''}`);
      if (last.ok || !last.retryable) break;
      if (attempt < RETRIES) await sleep(BACKOFF * 2 ** (attempt - 1) * 1000);
    }
    last.attempts = last.attempts || undefined;
    out[i] = last;
    if (GAP) await sleep(GAP * 1000);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, state.length) }, (_, k) => worker(k)));

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
    await sleep(1500 * attempt);
  }
}
const ok = rows.filter((r) => r?.ok).length;
const fresh = rows.filter((r) => r?.freshPath).length;
console.log(`\n===== 汇总（${((Date.now() - t0) / 1000).toFixed(0)}s）=====`);
console.log(`pathGenerated 成功 ${ok}/${rows.length}｜本次新生成路径 ${fresh}/${rows.length}｜阶段合计 ${rows.reduce((a, r) => a + (r?.milestones || 0), 0)}｜任务合计 ${rows.reduce((a, r) => a + (r?.subtasks || 0), 0)}`);
const failed = rows.filter((r) => r && !r.ok).map((r) => `${r.name}(${r.error})`);
if (failed.length) console.log(`仍失败 ${failed.length} 人：${failed.join('、')}`);
const outDir = path.join(ROOT, 'backend', 'vlab-runs');
fs.mkdirSync(outDir, { recursive: true });
const f = path.join(outDir, `preset-run-${Date.now()}.json`);
fs.writeFileSync(f, JSON.stringify(rows, null, 2), 'utf8');
console.log(`明细: ${f}`);
