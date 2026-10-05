/**
 * 通宵监工（2026-10-03 00:00 → 09:00 +08）
 *
 * 用户指令：库存 243 全跑 path → 跑完的学习者上课（3 个一批）→ 期间评审会话可能重启后端，自愈续跑 → 09:00 收。
 *
 * 双轨：
 *   SWEEP：plain 驱动（无 --learn 无 --path-only）：开场→goal→path；learn/learn-done 格子自然跳过（上课轨拥有）。
 *          覆盖 a-f 批残留（8 stragglers + 47 未开场）与 ov-g1..g8（243 库存）。
 *   LEARN：--learn 驱动，并发 3，队列 = learn-done → learn → path-ready（先收尾、再续课、后开新课）。
 *
 * 韧性：发驱动前探活后端；驱动死掉下个 tick 依状态续跑；每 30min 给排队 path-ready 会话续 hold（刷新
 * updatedAt + 回收豁免，防「后端重启 + 2h 静默」误收）。软停 08:30（不再发新驱动），硬停 09:00（杀驱动），
 * 写 OVERNIGHT-TALLY 后退出。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVAL_DIR = path.join(ROOT, 'doc/local/runs/20261002/vl-evals');
const LOG = path.join(ROOT, '.tmp-batch/overnight-supervisor.log');
const BASE = 'http://127.0.0.1:3010';
const DEADLINE = new Date('2026-10-06T09:00:00+08:00');
const SOFT_STOP = new Date(DEADLINE.getTime() - 30 * 60 * 1000);
const TICK_MS = 60_000;
const HOLD_REFRESH_MS = 30 * 60 * 1000;
const MAX_SWEEP_DRIVERS = 3;
const MAX_PASSES = 6;

const log = (m) => { const line = `[${new Date().toISOString().slice(5, 19)}] ${m}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };
// pidfile：看门狗探活用
fs.writeFileSync(path.join(ROOT, '.tmp-batch/overnight-supervisor.pid'), String(process.pid));

const ID_MAP = { 'learn30ds': 'learn30-ds-ids.txt', 'learn30b-ds': 'learn30b-ds-ids.txt', 'learn30b-ag': 'learn30b-ag-ids.txt' };
const idsOf = (tag) => `.tmp-batch/${ID_MAP[tag] || `${tag}-ids.txt`}`;
const SWEEP_COHORTS = [
  ...['learn30ds', 'learn30b-ds', 'learn30b-ag', 'learn30c-ds', 'learn30c-ag', 'learn30d-ds', 'learn30d-ag', 'learn30e-ds', 'learn30e-ag', 'learn30f-ds', 'learn30f-ag', 'ov-g1', 'ov-g2', 'ov-g3', 'ov-g4', 'ov-g5', 'ov-g6', 'ov-g7', 'ov-g8'].map(tag => ({ tag, ids: idsOf(tag), conc: 6 }))
];
const LEARN_COHORTS = Object.keys(ID_MAP).concat(['learn30c-ds', 'learn30c-ag', 'learn30d-ds', 'learn30d-ag', 'learn30e-ds', 'learn30e-ag', 'learn30f-ds', 'learn30f-ag', 'ov-g1', 'ov-g2', 'ov-g3', 'ov-g4', 'ov-g5', 'ov-g6', 'ov-g7', 'ov-g8']);

const passes = {};
const running = new Map(); // tag -> pid
let holdRefreshAt = 0;
let learnRelaunchCooldownUntil = 0;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const envGet = (() => { const env = fs.readFileSync(path.join(ROOT, 'backend/.env'), 'utf8'); return (k) => (env.match(new RegExp('^' + k + '=(.*)\\r?$', 'm')) || [])[1]?.trim() || ''; })();

// admin cookie：fleet 共享文件（adminAuth 单会话互踢，2026-10-03 用户被登出实锤）。
// 缓存复用 + 401 时走 refreshAdminCookie（先认领别人刷新的 cookie，没有才自己登录）。
import { getAdminCookie, refreshAdminCookie } from './admin-session.mjs';
let adminCookieCache = '';
async function adminCookie(force = false) {
  const c = force ? await refreshAdminCookie(BASE, envGet, adminCookieCache) : await getAdminCookie(BASE, envGet);
  adminCookieCache = c;
  return c;
}

async function backendAlive() {
  try {
    let c = await adminCookie();
    let res = await fetch(BASE + '/api/admin/virtual-learners/settings', { headers: { Cookie: c }, signal: AbortSignal.timeout(8000) });
    if (res.status === 401) {
      c = await adminCookie(true);
      res = await fetch(BASE + '/api/admin/virtual-learners/settings', { headers: { Cookie: c }, signal: AbortSignal.timeout(8000) });
    }
    return res.ok;
  } catch { return false; }
}

/** 汇总所有 cohort 格子状态：{ pid: {phase, cohort} } */
function readStates() {
  const states = new Map();
  for (const tag of LEARN_COHORTS) {
    const idsFile = path.join(ROOT, idsOf(tag));
    if (!fs.existsSync(idsFile)) continue;
    for (const pid of fs.readFileSync(idsFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
      if (states.has(pid)) continue;
      let phase = 'start';
      try { phase = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, `vlstate-${pid}.json`), 'utf8')).phase || 'start'; } catch {}
      states.set(pid, { phase, cohort: tag });
    }
  }
  return states;
}

function launch(tag, idsFile, conc, mode) {
  const args = ['scripts/vlab-eval/run-vl-batch.mjs', `--ids-file=${idsFile}`, `--tag=${tag}`, '--base=' + BASE];
  if (mode === 'learn') args.push('--learn', `--lessons=2`, `--concurrency=${conc}`);
  else args.push('--skip-learn', `--concurrency=${conc}`);
  const child = spawn('node', args, { cwd: ROOT, env: { ...process.env, VL_RUN_DATE: '20261002' }, detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
  child.unref();
  running.set(tag, child.pid);
  log(`launch ${tag} (${mode}) pid=${child.pid} ids=${idsFile} conc=${conc}`);
}

/** 解除正式 pause 的教学会话（teaching.paused=true）——上课轨接手前清标志 */
async function resumePausedSessions(cookie) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync('D:/wenflow/wenflow/backend/prisma/dev.db', { readOnly: true });
  const rows = db.prepare("SELECT id FROM virtual_sessions WHERE status='running' AND currentStage='teaching'").all();
  let n = 0;
  for (const r of rows) {
    let paused = false;
    try { paused = JSON.parse(db.prepare('SELECT stageResults s FROM virtual_sessions WHERE id=?').get(r.id)?.s || '{}')?.teaching?.paused === true; } catch {}
    if (!paused) continue;
    try {
      const res = await fetch(`${BASE}/api/admin/virtual-learners/sessions/${r.id}/resume`, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost:5173' } });
      if (res.ok) n++;
    } catch {}
  }
  log(`解除 pause ${n} 个教学会话`);
}

async function refreshHolds(cookie, states) {
  // 给所有 path-ready 排队会话续 hold：写 stageResults 顺带刷新 updatedAt（双保险防误收）
  let n = 0;
  for (const [pid, st] of states) {
    if (st.phase !== 'path-ready' || !st.sessionId) continue;
    try {
      const res = await fetch(`${BASE}/api/admin/virtual-learners/sessions/${st.sessionId}/hold`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ reason: 'overnight learn-queue wait' })
      });
      if (res.ok) n++;
    } catch {}
  }
  log(`hold 续期 ${n} 个 path-ready 会话`);
}

function buildLearnQueue(states) {
  // 覆盖优先 v2（2026-10-04 18:30）：path-ready（新开首课）压过 learn（课中续走）。
  // 实测「课中」格子是死亡-复活沼泽，会把工位占满到 75min 超时，待开课的干瞪眼。
  // 新开课成功率高、立刻产出覆盖；沼泽格子殿后被 AIMD 顺带消化。
  // learn-done（待补第二课）默认不进队列。首课全覆盖后设 LESSON2_IN_QUEUE=1 重启监工补第二课。
  const rank = { 'path-ready': 0, 'learn': 1 };
  if (process.env.LESSON2_IN_QUEUE === '1') rank['learn-done'] = 2;
  const queue = [...states.entries()]
    .filter(([, s]) => s.phase in rank)
    .sort((a, b) => rank[a[1].phase] - rank[b[1].phase]);
  const file = path.join(ROOT, '.tmp-batch/overnight-learn-queue-ids.txt');
  fs.writeFileSync(file, queue.map(([pid]) => pid).join('\n') + (queue.length ? '\n' : ''));
  return { file, count: queue.length };
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

async function main() {
  log(`supervisor 启动，deadline=${DEADLINE.toISOString()} SOFT=${SOFT_STOP.toISOString()}`);
  // 启动时解除 pause（18 个）
  try {
    const cookie = await adminCookie();
    await resumePausedSessions(cookie);
  } catch {}

  while (true) {
    const now = new Date();
    if (now >= DEADLINE) break;
    try {
      // 清理已退出的驱动
      for (const [tag, pid] of running) if (!alive(pid)) { running.delete(tag); log(`driver ${tag} exited`); }

      const backendUp = await backendAlive();
      if (!backendUp) { log('后端不在线（可能评审会话重启中），30s 后重试'); await sleep(30_000); continue; }

      const states = readStates();
      const byPhase = {};
      for (const s of states.values()) byPhase[s.phase] = (byPhase[s.phase] || 0) + 1;
      if (states.size === 0) {
        const probe = path.join(ROOT, '.tmp-batch', idsOf('learn30c-ds'));
        log(`诊断: ROOT=${ROOT} | LEARN_COHORTS=${LEARN_COHORTS.length} | probe exists=${fs.existsSync(probe)} | cwd=${process.cwd()}`);
      }

      // 上课轨：队列非空且无 learn 驱动在跑 → 重排队列文件并启动（并发 3）
      const learnRunning = [...running.keys()].filter(t => t.startsWith('learn-'));
      const { file: queueFile, count: queueCount } = buildLearnQueue(states);
      if (!learnRunning.length && queueCount > 0 && now < SOFT_STOP && Date.now() > learnRelaunchCooldownUntil) {
        launch('learn-queue', path.relative(ROOT, queueFile), 14, 'learn');
      } else if (!learnRunning.length && queueCount === 0) {
        learnRelaunchCooldownUntil = Date.now() + 5 * 60_000; // 队列空：5 分钟冷却（等 sweep 产出新 path-ready）
      }

      // 清扫轨：goal/poll/start 残留的 cohort 依次驱动（≤3 并发）
      const sweepRunning = [...running.keys()].filter(t => t !== 'learn-queue');
      if (sweepRunning.length < MAX_SWEEP_DRIVERS && now < SOFT_STOP) {
        for (const c of SWEEP_COHORTS) {
          if (sweepRunning.length >= MAX_SWEEP_DRIVERS) break;
          if (running.has(c.tag)) continue;
          passes[c.tag] = passes[c.tag] || 0;
          if (passes[c.tag] >= MAX_PASSES) continue;
          const cohortStates = [...states.entries()].filter(([, s]) => s.cohort === c.tag);
          if (!cohortStates.length) continue;
          const needWork = cohortStates.some(([, s]) => ['start', 'goal-path', 'poll-path'].includes(s.phase));
          if (!needWork) continue;
          passes[c.tag] += 1;
          launch(c.tag, c.ids, c.conc, 'sweep');
          sweepRunning.push(c.tag);
        }
      }

      // hold 续期
      if (Date.now() - holdRefreshAt > HOLD_REFRESH_MS) {
        holdRefreshAt = Date.now();
        const cookie = await adminCookie().catch(() => null);
        if (cookie) {
          const withSessions = new Map();
          for (const [pid, s] of states) { const sid = getSessionId(pid); if (sid) withSessions.set(pid, { ...s, sessionId: sid }); }
          await refreshHolds(cookie, withSessions);
        }
      }

      log(`tick ${now.toISOString().slice(11, 19)} | 在跑:${[...running.keys()].join(',') || '无'} | 格子:${JSON.stringify(byPhase)} | 队列:${queueCount}`);
    } catch (e) {
      log(`tick 异常: ${e?.message || e}`);
    }
    await sleep(TICK_MS);
  }

  // 硬停：杀掉全部驱动
  for (const [tag, pid] of running) { try { process.kill(pid); log(`deadline 杀 ${tag}(${pid})`); } catch {} }
  await sleep(3000);
  const states = readStates();
  const byPhase = {};
  for (const s of states.values()) byPhase[s.phase] = (byPhase[s.phase] || 0) + 1;
  const tally = { deadline: DEADLINE.toISOString(), finishedAt: new Date().toISOString(), cells: states.size, byPhase, passes };
  fs.writeFileSync(path.join(EVAL_DIR, 'OVERNIGHT-TALLY.json'), JSON.stringify(tally, null, 1));
  log(`收工盘点: ${JSON.stringify(byPhase)} → OVERNIGHT-TALLY.json`);
}

// sessionId 索引（供 hold 续期）：从状态文件读
const sessionIdCache = new Map();
function getSessionId(pid) {
  if (sessionIdCache.has(pid)) return sessionIdCache.get(pid);
  try {
    const s = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, `vlstate-${pid}.json`), 'utf8'));
    sessionIdCache.set(pid, s.sessionId || null);
    return s.sessionId || null;
  } catch { return null; }
}

main().catch(e => { log(`supervisor 崩溃: ${e?.stack || e}`); process.exit(1); });
