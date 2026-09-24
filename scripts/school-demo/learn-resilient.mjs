#!/usr/bin/env node
/**
 * 韧性学习循环：跑某个学段的课，遇到上游失败/会话终态时自动 restart-learning 续跑，
 * 直到该课全部 subtask 完成或达到时间预算。
 * 用法: node scripts/school-demo/learn-resilient.mjs --band=senior [--budgetMin=180]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:3010';
const OUT = path.join(ROOT, 'data', 'newfeatures-test-2026-09-22');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || true] : [a, true]; }));
const BAND = String(args.band || 'senior');
const BUDGET_MIN = Number(args.budgetMin || 240);
const KEY = { primary: 'P1', junior: 'J1', senior: 'S1', college: 'C1' }[BAND];
const LOG = path.join(ROOT, 'logs', `${KEY}-resilient.log`);
const log = (m) => { const l = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, l + '\n'); console.log(l); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const g = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
const state = JSON.parse(fs.readFileSync(path.join(OUT, `${KEY}-state.json`), 'utf8'));
const SID = state.sessionId;

function progress() {
  const db = new DatabaseSync(DB, { timeout: 30000 });
  try {
    const sess = db.prepare(`select learningPathId,status,currentStage from virtual_sessions where id='${SID}'`).get() || {};
    const pid = sess.learningPathId;
    let done = 0, total = 0;
    if (pid) for (const m of db.prepare(`select id from milestones where learningPathId='${pid}'`).all())
      for (const s of db.prepare(`select status from subtasks where milestoneId='${m.id}'`).all()) { total++; if (s.status === 'completed') done++; }
    return { done, total, status: sess.status, stage: sess.currentStage, pid };
  } finally { db.close(); }
}

let cookie = null;
async function login() {
  const r = await fetch(`${BASE}/api/admin-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name: g('INIT_ADMIN_NAME'), password: g('INIT_ADMIN_PASSWORD'), remember: true }) });
  const m = (r.headers.get('set-cookie') || '').match(/wenflow_admin_token=[^;]+/);
  if (m) cookie = m[0];
}
async function post(p, body = {}) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 600000);
  try {
    const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:5173' }, body: JSON.stringify(body), signal: ctrl.signal });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, ok: r.ok, json: j, text: t };
  } catch (e) { return { status: 0, ok: false, error: String(e.message) }; } finally { clearTimeout(to); }
}

await login();
log(`START band=${BAND} sid=${SID} budget=${BUDGET_MIN}min`);
const deadline = Date.now() + BUDGET_MIN * 60 * 1000;
let restarts = 0, steps = 0, fails = 0;

let lastDone = -1;
while (Date.now() < deadline) {
  const p0 = progress();
  if (p0.total > 0 && p0.done >= p0.total) { log(`DONE ${p0.done}/${p0.total}`); break; }
  // 有实质进展则重置退避（避免成功后仍长时间等待）
  if (p0.done > lastDone) { if (lastDone >= 0) log(`progress ${lastDone} -> ${p0.done}/${p0.total}`); lastDone = p0.done; restarts = 0; }

  // 会话处于终态 → restart-learning 续跑（保留已完成进度），带指数退避避免抖动
  if (p0.status === 'failed' || p0.status === 'abandoned' || p0.status === 'paused') {
    const backoff = Math.min(30000 * Math.pow(2, Math.min(restarts, 4)), 300000); // 30s→60s→120s→240s→300s
    if (backoff > 30000) log(`waiting ${backoff / 1000}s before restart #${restarts + 1} (upstream degraded)`);
    await sleep(backoff);
    const r = await post(`/api/admin/virtual-learners/sessions/${SID}/restart-learning`, {});
    restarts++;
    log(`restart-learning #${restarts} (status=${p0.status}) -> ${r.status} ${String(r.text || '').slice(0, 80)}`);
    await sleep(8000); continue;
  }

  const r = await post(`/api/admin/virtual-learners/sessions/${SID}/teaching-step`, {});
  steps++;
  const d = r.json?.data || {};
  if (!r.ok || d.success === false) {
    fails++;
    if (fails % 5 === 0) log(`step ${steps}: fail (${r.status}) err=${String(d.error || r.error || '').slice(0, 90)}`);
    await sleep(2000 + Math.min(fails * 500, 10000));
    // 失败过多 → 尝试重启会话
    if (fails % 12 === 0) {
      const rr = await post(`/api/admin/virtual-learners/sessions/${SID}/restart-learning`, {});
      restarts++;
      log(`(fail-driven) restart-learning #${restarts} -> ${rr.status}`);
      await sleep(5000);
    }
    continue;
  }
  fails = 0;
  if (d.taskCompleted || steps % 10 === 0) {
    const p = progress();
    log(`step ${steps}: taskCompleted=${d.taskCompleted ?? '?'} | ${p.done}/${p.total} | restarts=${restarts}`);
  }
  await sleep(1200);
}
const p = progress();
log(`EXIT ${p.done}/${p.total} steps=${steps} restarts=${restarts}`);
