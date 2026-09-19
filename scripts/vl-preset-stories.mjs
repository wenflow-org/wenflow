/**
 * 给**基准（内置 preset）虚拟学习者**追加 1 个新故事（**只驱动接口，不写库**）。
 *
 * 用途：验证"源头问题类型标注"（`goalSeed.primaryBlockType` / `recurrence` / `blockTypeEvidence`）。
 * 基准学习者的人设是**手写固定的**，比批量自造人设更独立、可复现，适合做基准样本。
 * 走 `POST /api/admin/virtual-learners/:id/draft-stories`（服务端用当前 ACTIVE 提示词生成并追加）。
 *
 * 用法：node scripts/vl-preset-stories.mjs [--concurrency=2] [--tags=] [--dry-run]
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

// ---------- 圈定基准学习者 ----------
const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
const presets = db.prepare(
  `SELECT p.id, p.userId, u.name, p.presetKey
     FROM virtual_learner_profiles p JOIN users u ON u.id = p.userId
    WHERE p.presetKey IS NOT NULL OR p.source = 'preset'
    ORDER BY u.name`,
).all();
db.close();
if (!presets.length) { console.error('没找到基准（preset）学习者'); process.exit(2); }
console.log(`基准学习者 ${presets.length} 人｜并发 ${CONCURRENCY}${DRY ? '（DRY RUN）' : ''}`);
if (DRY) { for (const p of presets) console.log('  -', p.name, p.presetKey); process.exit(0); }

// ---------- 登录 ----------
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const login = await fetch(`${BASE}/api/admin-auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (!cookie) { console.error('admin 登录失败'); process.exit(2); }
const H = { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' };

// ---------- 并发追加故事 ----------
const out = new Array(presets.length);
let cursor = 0;
const t0 = Date.now();
async function worker() {
  for (;;) {
    const i = cursor; cursor += 1;
    if (i >= presets.length) return;
    const p = presets[i];
    const t = Date.now();
    try {
      const res = await fetch(`${BASE}/api/admin/virtual-learners/${p.id}/draft-stories`, {
        method: 'POST', headers: H, body: JSON.stringify({}), signal: AbortSignal.timeout(600000),
      });
      const j = await res.json().catch(() => ({}));
      const g = j?.data?.story?.goalSeed || {};
      const ok = res.ok && j?.success !== false;
      out[i] = {
        name: p.name, presetKey: p.presetKey, ok,
        secs: Math.round((Date.now() - t) / 1000),
        title: j?.data?.story?.title || null,
        primaryBlockType: g.primaryBlockType || null,
        recurrence: g.recurrence || null,
        evidence: g.blockTypeEvidence || null,
        realProblem: g.realProblem || null,
        storyPoolCount: j?.data?.storyPoolCount ?? null,
        error: ok ? null : String(j?.error?.message || j?.error || `HTTP ${res.status}`).slice(0, 140),
      };
      console.log(`  [${out.filter(Boolean).length}/${presets.length}] ${p.name.padEnd(8)} ${ok ? `✓ ${String(out[i].primaryBlockType || '(无标注)').padEnd(20)} ${out[i].recurrence || '-'}` : '✗ ' + out[i].error}  ${out[i].secs}s`);
    } catch (e) {
      out[i] = { name: p.name, presetKey: p.presetKey, ok: false, secs: Math.round((Date.now() - t) / 1000), error: String(e?.message || e).slice(0, 140) };
      console.log(`  [${out.filter(Boolean).length}/${presets.length}] ${p.name.padEnd(8)} ✗ ${out[i].error}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, presets.length) }, () => worker()));

const ok = out.filter((r) => r?.ok).length;
const annotated = out.filter((r) => r?.primaryBlockType).length;
console.log(`\n===== 汇总（${((Date.now() - t0) / 1000).toFixed(0)}s）=====`);
console.log(`生成成功 ${ok}/${presets.length}｜带 primaryBlockType ${annotated}/${ok}`);
const dist = (k) => { const m = new Map(); for (const r of out) if (r?.[k]) m.set(r[k], (m.get(r[k]) || 0) + 1); return [...m.entries()].map(([a, b]) => `${a}=${b}`).join('  ') || '(无)'; };
console.log(`类型分布: ${dist('primaryBlockType')}`);
console.log(`周期分布: ${dist('recurrence')}`);
const outDir = path.join(ROOT, 'backend', 'vlab-runs');
fs.mkdirSync(outDir, { recursive: true });
const f = path.join(outDir, `preset-stories-${Date.now()}.json`);
fs.writeFileSync(f, JSON.stringify(out, null, 2), 'utf8');
console.log(`明细: ${f}`);
