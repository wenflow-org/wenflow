// r4-cal-collect.mjs — R4 校准样本采集（跨日推进轨）
// 用法：
//   node r4-cal-collect.mjs probe                 —— 记录各目标当前时钟（推进前 baseDate），不写
//   node r4-cal-collect.mjs setup                 —— 显式落 baseDate=2026-10-01（会话级 simulation-config）
//   node r4-cal-collect.mjs day1|day2|day3        —— 推进 1 个模拟日（runTasks=true）+ 取证 → out/r4-cal-day<n>.json
//   node r4-cal-collect.mjs assemble              —— 汇总成对样本 → doc/local/runs/20261006/vl-evals/r4-calibration.json
// 纪律（与 ad-driver.mjs 同）：只打 3011；DB 只读（readOnly + busy_timeout）；写操作只经产品 API
//   （simulation-config / restart-learning / advance-day）；串行 + 请求间 sleep 8s。
// 口径：baseDate=2026-10-01(Thu)，默认课表周一~五 ⇒ 3 个可达上课日
//   day1=2026-10-02(Fri, dayIndex1) day2=2026-10-05(Mon, dayIndex4) day3=2026-10-06(Tue, dayIndex5)。
//   P0 护栏（simulated-day.service.ts:453-455）禁止推进 dayStart 未到的日；真实现在=2026-10-06，故 10-07+ 不可达。
// 成对样本口径：温故计划条目 teachingState.sessionArtifacts.memoryWarmup.items[]
//   预测 = item.retention（memory-trace.service.ts:50-73 fsrsRetentionOfTrace：有 fsrsStability 用 FSRS，
//          否则 fsrsStateFromLegacy 推导；与 ad-driver fsrsRetrievability 同式 FACTOR=19/81 DECAY=-0.5）
//   实际 = item.outcome.{status,progress}（ReviewCompletedConsumer.ts:60-72 mapReviewStatusToRating 同款映射）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(__dirname, 'out');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
// --tag：并行分组隔离（各组写自己的 day/log 文件，避免 writeDay 读-改-写并发丢更新；assemble 按 glob 合并）。
// 不传 tag 时保持旧文件名（单进程串行用法零变化）。
const TAG = arg('tag', '');
const SUFFIX = TAG ? `-${TAG}` : '';
// --replan：每日 advance 前无条件重建会话（温故计划生成时点校正；见 cmdDay 内注释）
const REPLAN = process.argv.includes('--replan');
const LOG = path.join(OUT, `r4-cal-run${SUFFIX}.log`);
const dayFile = (n) => path.join(OUT, `r4-cal-day${n}${SUFFIX}.json`);
fs.mkdirSync(OUT, { recursive: true });

const BASE = arg('base', 'http://127.0.0.1:3011');
const BASE_DATE = arg('basedate', '2026-10-01');

const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const ADMIN_MOD = pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href;
const { getAdminCookie, refreshAdminCookie } = await import(ADMIN_MOD);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
function db() { const d = new DatabaseSync(DB_PATH, { readOnly: true }); d.exec('PRAGMA busy_timeout = 5000'); return d; }

// R4 manifest 8 个新 VL（userIds）
const VLS = {
  'rw-school6-01': { userId: '109d5d76-41e7-4d3d-aac3-6f3b7ea6ee60' },
  'rw-school6-09': { userId: 'a3a4f770-655c-4c7f-b624-cfe7f7d9fa94' },
  'rw-school6-21': { userId: 'f17d03c0-c976-4986-933a-e0124f57cfec' },
  'rw-school6-28': { userId: '83f02d14-5b16-4ecf-8003-df3913ec439f' },
  'rw-exam6-08': { userId: 'eac48271-1275-4f8f-8a82-4429b389a4f3' },
  'rw-acad6-03': { userId: '4b7d8df6-a894-47d2-8bb6-bed2d54348f6' },
  'rw-career6-05': { userId: 'a595a2f7-c788-438a-8708-81b6c259b4a9' },
  'rw-life6-06': { userId: '32eee25a-2a0c-44b9-b1fe-45ee1262dbd3' },
};

function resolveTargets() {
  const only = arg('vl', null);
  const vlsFile = arg('vls-file', null);
  // --vls-file=<json>：[{key,userId}] 名单（VLS 之外的批次，如纪元 2 cohort；key 可含冒号 preset:xxx）
  const manual = vlsFile ? JSON.parse(fs.readFileSync(path.resolve(vlsFile), 'utf8')) : null;
  const keys = only ? only.split(',') : (manual ? manual.map((e) => e.key) : Object.keys(VLS));
  const d = db();
  const out = [];
  try {
    for (const key of keys) {
      const v = manual ? manual.find((e) => e.key === key) : VLS[key];
      if (!v) throw new Error(`未知 VL: ${key}${manual ? '（vls-file 内无此 key）' : ''}`);
      const prof = d.prepare('SELECT id FROM virtual_learner_profiles WHERE userId = ?').get(v.userId);
      const sess = d.prepare('SELECT id, status, currentStage, createdAt FROM virtual_sessions WHERE userId = ? ORDER BY createdAt DESC LIMIT 1').get(v.userId);
      const traceCount = d.prepare('SELECT COUNT(*) AS n FROM memory_traces WHERE userId = ?').get(v.userId).n;
      out.push({ key, userId: v.userId, profileId: prof?.id ?? null, vsessionId: sess?.id ?? null, vsessionStatus: sess?.status ?? null, stage: sess?.currentStage ?? null, createdAt: sess?.createdAt ?? null, traceCount });
    }
  } finally { d.close(); }
  return out;
}

// ---------- FSRS 镜像（口径 = memory-trace.service.ts:50-73 + fsrs.ts:77-91） ----------
const DAY_MS = 24 * 60 * 60 * 1000;
function fsrsStateOfTrace(row) {
  if (row.fsrsStability !== null && row.fsrsStability !== undefined) {
    return { stability: row.fsrsStability, difficulty: row.fsrsDifficulty ?? 5, reps: row.fsrsReps ?? row.extractionCount, lapses: row.fsrsLapses ?? 0, lastReviewAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null, path: 'fsrs' };
  }
  const m = Number.isFinite(row.masteryScore) ? Math.max(0.05, Math.min(1, row.masteryScore)) : 0.5;
  return { stability: Math.max(1, Math.round(m * 10)), difficulty: 5, reps: Number.isInteger(row.extractionCount) && row.extractionCount > 0 ? row.extractionCount : 0, lapses: 0, lastReviewAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null, path: 'legacy' };
}
function fsrsRetrievability(state, now) {
  if (!state || state.stability <= 0 || !state.lastReviewAt) return 0;
  const elapsed = Math.max(0, (now.getTime() - state.lastReviewAt.getTime()) / DAY_MS);
  const FACTOR = 19 / 81, DECAY = -0.5;
  const power = Math.pow(1 + (FACTOR * elapsed) / state.stability, DECAY);
  const r = Number.isFinite(power) ? power : 0;
  return Math.max(0, Math.min(1, r));
}
const TRACE_COLS = 'conceptKey, label, masteryScore, stability, lastSeenAt, extractionCount, dueAt, fsrsStability, fsrsDifficulty, fsrsReps, fsrsLapses, source, pathId';
function snapshotTraces(d, userId) {
  const rows = d.prepare(`SELECT ${TRACE_COLS} FROM memory_traces WHERE userId = ? ORDER BY conceptKey`).all(userId);
  const map = {};
  for (const r of rows) map[r.conceptKey] = r;
  return { rows, map };
}
function normalizeTs(v) { return typeof v === 'number' ? new Date(v).toISOString() : (v ?? null); }
function compactTrace(r) {
  return { masteryScore: r.masteryScore, stability: r.stability, lastSeenAt: normalizeTs(r.lastSeenAt), extractionCount: r.extractionCount, dueAt: normalizeTs(r.dueAt), fsrsStability: r.fsrsStability, fsrsDifficulty: r.fsrsDifficulty, fsrsReps: r.fsrsReps, fsrsLapses: r.fsrsLapses, source: r.source, pathId: r.pathId };
}
function parseJsonSafe(t) { try { return JSON.parse(t); } catch { return null; } }

// ---------- HTTP ----------
let cookie = '';
async function ensureCookie() { cookie = await getAdminCookie(BASE, envGet); if (!cookie) throw new Error('admin cookie 获取失败'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function apiJson(method, urlPath, body, timeoutMs = 30000, retried = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('client timeout')), timeoutMs);
  try {
    const res = await fetch(BASE + urlPath, {
      method, signal: ctrl.signal,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if ((res.status === 401 || res.status === 403) && !retried) {
      cookie = await refreshAdminCookie(BASE, envGet, cookie);
      return apiJson(method, urlPath, body, timeoutMs, true);
    }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
    return { status: res.status, json };
  } finally { clearTimeout(timer); }
}
function apiLong(method, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method, agent: false,
      headers: { Cookie: cookie, Origin: 'http://localhost:5173', ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; } resolve({ status: res.statusCode || 0, json }); });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { const e = new Error('http timeout'); e.name = 'TimeoutError'; req.destroy(e); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function getClock(vl) {
  const r = await apiJson('GET', `/api/admin/virtual-learners/sessions/${vl.vsessionId}/simulation-clock`);
  return { http: r.status, clock: r.json?.data ?? null, error: r.json?.error ?? null };
}
async function enableClock(vl) {
  const body = { simulationClock: { enabled: true, baseDate: BASE_DATE, autoAdvance: false } };
  const r = await apiJson('PUT', `/api/admin/virtual-learners/sessions/${vl.vsessionId}/simulation-config`, body, 30000);
  return { http: r.status, ok: r.status === 200 && r.json?.success !== false, error: r.json?.error ?? null };
}
async function restartLearning(vl) {
  const r = await apiJson('POST', `/api/admin/virtual-learners/sessions/${vl.vsessionId}/restart-learning`, {}, 300000);
  return { http: r.status, ok: r.status === 200 && r.json?.success !== false, error: r.json?.error ?? r.json?.raw ?? null };
}
async function reviveIfFailed(vl) {
  const d = db();
  let row = null;
  try { row = d.prepare('SELECT status FROM virtual_sessions WHERE id = ?').get(vl.vsessionId); } finally { d.close(); }
  if (row && ['failed', 'abandoned'].includes(row.status)) {
    const rs = await restartLearning(vl);
    log(`  [${vl.key}] 重试前复活: http=${rs.http} ok=${rs.ok} err=${String(rs.error || '').slice(0, 120)}`);
    await sleep(8000);
    return rs.ok;
  }
  return true;
}
async function advanceDay(vl) {
  const attempts = [];
  for (let i = 1; i <= 4; i += 1) {
    if (i > 1) { await reviveIfFailed(vl); log(`  [${vl.key}] advance 重试 #${i}`); }
    let r;
    try {
      const before = await getClock(vl);
      r = await apiLong('POST', `/api/admin/virtual-learners/sessions/${vl.vsessionId}/advance-day`, { days: 1, runTasks: true }, 60 * 60 * 1000);
    } catch (e) {
      attempts.push({ attempt: i, error: `${e.name || 'Error'}: ${e.message}` });
      if (i < 4) { log(`  [${vl.key}] advance 网络错，30s 后重试`); await sleep(30000); continue; }
      break;
    }
    attempts.push({ attempt: i, http: r.status, success: r.json?.success, learning: r.json?.data?.learning ?? null, reverted: r.json?.data?.reverted, simulatedDay: r.json?.data?.simulatedDay, advancedDayIndexes: r.json?.data?.advancedDayIndexes });
    const learningErr = r.json?.data?.learning?.error;
    const notConsumed = r.json?.data?.reverted === true || r.json?.data?.learning?.started === false;
    const retryable = r.status === 429 || r.status >= 500 || (r.status === 200 && notConsumed && !!learningErr);
    if (!retryable) break;
    if (i < 4) { log(`  [${vl.key}] advance 可重试失败（http=${r.status} err=${String(learningErr || '').slice(0, 120)}），退避 30s`); await sleep(30000); }
  }
  return attempts;
}

// ---------- 成对样本抽取（温故 outcome） ----------
const EXPECTED_IDX = { 1: 1, 2: 4, 3: 5 };
// --expected=1:3,2:4,…：标签→期望 dayIndex 覆盖（换 baseDate 时日历相位不同；advance-day 一跳到下一个上课日）
const EXPECTED_OVERRIDE = (() => {
  const s = arg('expected', '');
  if (!s) return null;
  const m = {};
  for (const p of s.split(',')) { const [k, v] = p.split(':'); m[Number(k)] = Number(v); }
  return m;
})();
function mapReviewStatusToRating(status, progress) {
  switch (status) {
    case 'mastered': return { rating: Number(progress) >= 100 ? 'easy' : 'good', masteryScore: Number(progress) >= 100 ? 0.9 : 0.85 };
    case 'learning': return { rating: 'hard', masteryScore: 0.5 };
    default: return { rating: 'again', masteryScore: 0.5 };
  }
}
function extractWarmupPairs(d, vl, day, window, preMap) {
  const rows = d.prepare(
    'SELECT id, taskId, topic, mode, status, startTime, endTime, teachingState FROM teaching_sessions WHERE userId = ? ORDER BY startTime'
  ).all(vl.userId);
  const pairs = [];
  const sessionDigest = [];
  for (const r of rows) {
    const ts = parseJsonSafe(r.teachingState) || {};
    const plan = ts?.sessionArtifacts?.memoryWarmup;
    if (!plan) continue;
    const items = Array.isArray(plan.items) ? plan.items : [];
    const settled = [];
    for (const it of items) {
      const oc = it.outcome;
      if (!oc || !oc.reviewedAt) continue;
      const pre = preMap[it.conceptKey] || null;
      const state = pre ? fsrsStateOfTrace(pre) : null;
      // 复算：平台注入时用 simulatedNowOr()；墙钟口径下 elapsed 与 lastSeenAt 之差
      const recomputedWallClock = state && state.lastReviewAt ? Math.round(fsrsRetrievability(state, new Date()) * 10000) / 10000 : null;
      const recomputedAsOf = state && state.lastReviewAt && window.asOf ? Math.round(fsrsRetrievability(state, new Date(window.asOf)) * 10000) / 10000 : null;
      const mapped = mapReviewStatusToRating(oc.status, oc.progress);
      settled.push({
        conceptKey: it.conceptKey,
        predictedRetention: it.retention ?? null,
        predictedRetentionRecomputed: recomputedWallClock,
        predictedRetentionAtAsOf: recomputedAsOf,
        predictedStability: state ? state.stability : null,
        predictedFormulaPath: state ? state.path : null,
        predictedDueAt: pre ? normalizeTs(pre.dueAt) : null,
        predictedLastSeenAt: pre ? normalizeTs(pre.lastSeenAt) : null,
        reason: it.reason ?? null,
        actualStatus: oc.status ?? null,
        actualProgress: oc.progress ?? null,
        actualRating: mapped.rating,
        actualMasteryScore: mapped.masteryScore,
        occurredAt: oc.reviewedAt,
        source: { vlKey: vl.key, userId: vl.userId, vsessionId: vl.vsessionId, teachingSessionId: r.id, taskId: r.taskId, topic: r.topic, sessionMode: r.mode, sessionStatus: r.status, day, window },
      });
    }
    if (items.length) sessionDigest.push({ id: r.id, topic: r.topic, mode: r.mode, status: r.status, startTime: normalizeTs(r.startTime), endTime: normalizeTs(r.endTime), warmupBudget: plan.budget ?? null, warmupItems: items.length, settled: settled.length, daily: plan.daily ?? null, itemKeys: items.map((i) => i.conceptKey), itemRetentions: items.map((i) => i.retention ?? null) });
    pairs.push(...settled);
  }
  return { pairs, sessionDigest };
}

// ---------- commands ----------
async function cmdProbe(targets) {
  const rec = { command: 'probe', base: BASE, targetBaseDate: BASE_DATE, generatedAt: new Date().toISOString(), vls: [] };
  for (const vl of targets) {
    const c = await getClock(vl);
    log(`[probe] ${vl.key} user=${vl.userId} vsession=${vl.vsessionId} status=${vl.vsessionStatus} stage=${vl.stage} traces=${vl.traceCount} clock=${JSON.stringify(c.clock)}`);
    rec.vls.push({ ...vl, clock: c.clock, http: c.http });
    await sleep(300);
  }
  fs.writeFileSync(path.join(OUT, 'r4-cal-probe.json'), JSON.stringify(rec, null, 1));
  log(`probe 完成 → out/r4-cal-probe.json`);
}

async function resetClock(vl, baseDate) {
  const r = await apiJson('POST', `/api/admin/virtual-learners/sessions/${vl.vsessionId}/simulation-clock/reset`, { baseDate }, 30000);
  return { http: r.status, ok: r.status === 200 && r.json?.success !== false, data: r.json?.data ?? null, error: r.json?.error ?? null };
}
async function cmdReset(targets) {
  await ensureCookie();
  const rec = { command: 'reset', base: BASE, targetBaseDate: BASE_DATE, generatedAt: new Date().toISOString(), vls: [] };
  for (const vl of targets) {
    const c0 = await getClock(vl);
    const rs = await resetClock(vl, BASE_DATE);
    const c1 = await getClock(vl);
    log(`[reset] ${vl.key} before=${JSON.stringify(c0.clock)} reset=${JSON.stringify(rs)} after=${JSON.stringify(c1.clock)}`);
    rec.vls.push({ ...vl, clockBefore: c0.clock, reset: rs, clockAfter: c1.clock });
    await sleep(3000);
  }
  fs.writeFileSync(path.join(OUT, 'r4-cal-reset.json'), JSON.stringify(rec, null, 1));
  log(`reset 完成 → out/r4-cal-reset.json`);
}

async function cmdRestart(targets) {
  await ensureCookie();
  const rec = { command: 'restart', base: BASE, targetBaseDate: BASE_DATE, generatedAt: new Date().toISOString(), vls: [] };
  for (const vl of targets) {
    const c0 = await getClock(vl);
    log(`[restart] ${vl.key} clockBefore=${JSON.stringify(c0.clock)}`);
    const rs = await restartLearning(vl);
    const entry = { ...vl, clockBefore: c0.clock, restart: { http: rs.http, ok: rs.ok, error: rs.error ? String(rs.error).slice(0, 300) : null } };
    if (rs.ok) {
      const d = db();
      try {
        const sess = d.prepare("SELECT id, status, taskId, topic, startTime, json_extract(teachingState,'$.sessionArtifacts.memoryWarmup') AS warmup FROM teaching_sessions WHERE userId = ? ORDER BY startTime DESC LIMIT 1").get(vl.userId);
        entry.newSession = sess ? { id: sess.id, status: sess.status, taskId: sess.taskId, topic: sess.topic, startTime: normalizeTs(sess.startTime), warmup: parseJsonSafe(sess.warmup) } : null;
      } finally { d.close(); }
      const items = entry.newSession?.warmup?.items || [];
      log(`[restart] ${vl.key} ok=${rs.ok} newSession=${entry.newSession?.id || null} warmupItems=${items.length} ${items.map((i) => i.conceptKey).join(' | ')}`);
    } else {
      log(`[restart] ${vl.key} FAILED http=${rs.http} err=${String(rs.error).slice(0, 200)}`);
    }
    rec.vls.push(entry);
    await sleep(8000);
  }
  fs.writeFileSync(path.join(OUT, 'r4-cal-restart.json'), JSON.stringify(rec, null, 1));
  log(`restart 完成 → out/r4-cal-restart.json`);
}

async function cmdSetup(targets) {
  await ensureCookie();
  const rec = { command: 'setup', base: BASE, targetBaseDate: BASE_DATE, generatedAt: new Date().toISOString(), vls: [] };
  for (const vl of targets) {
    const before = await getClock(vl);
    log(`[setup] ${vl.key} clockBefore=${JSON.stringify(before.clock)}`);
    const en = await enableClock(vl);
    const after = await getClock(vl);
    log(`[setup] ${vl.key} enableClock=${JSON.stringify(en)} clockAfter=${JSON.stringify(after.clock)}`);
    const entry = { ...vl, clockBefore: before.clock, clockAfter: after.clock, enableClock: en };
    if (after.clock?.enabled && after.clock?.baseDate === BASE_DATE && vl.vsessionStatus && ['failed', 'abandoned'].includes(vl.vsessionStatus)) {
      const rs = await restartLearning(vl);
      entry.restart = { http: rs.http, ok: rs.ok, error: rs.error ? String(rs.error).slice(0, 300) : null };
      log(`[setup] ${vl.key} restart=${JSON.stringify(entry.restart)}`);
    }
    rec.vls.push(entry);
    await sleep(8000);
  }
  fs.writeFileSync(path.join(OUT, 'r4-cal-setup.json'), JSON.stringify(rec, null, 1));
  log(`setup 完成 → out/r4-cal-setup.json`);
}

async function cmdDay(day, targets) {
  await ensureCookie();
  const result = { day, baseDate: BASE_DATE, generatedAt: new Date().toISOString(), tag: TAG || null, vls: [] };
  const file = dayFile(day);
  for (const vl of targets) {
    log(`== [day${day}] ${vl.key} vsession=${vl.vsessionId}`);
    const rec = { vlKey: vl.key, userId: vl.userId, profileId: vl.profileId, vsessionId: vl.vsessionId };
    const d = db();
    try {
      let c = await getClock(vl);
      rec.clockBefore = c.clock;
      if (!c.clock?.enabled || c.clock?.baseDate !== BASE_DATE) {
        rec.clockEnable = await enableClock(vl);
        c = await getClock(vl);
        rec.clockBefore = c.clock;
      }
      if (!c.clock?.enabled || c.clock?.baseDate !== BASE_DATE) { rec.fatal = `时钟未就绪: ${JSON.stringify(c.clock)}`; result.vls.push(rec); writeDay(file, result); continue; }

      const pre = snapshotTraces(d, vl.userId);
      rec.preTraceCount = pre.rows.length;
      rec.preTraces = Object.fromEntries(Object.entries(pre.map).map(([k, v]) => [k, compactTrace(v)]));

      const expectedIdx = EXPECTED_OVERRIDE && EXPECTED_OVERRIDE[day] !== undefined ? EXPECTED_OVERRIDE[day] : EXPECTED_IDX[day];
      if ((c.clock?.dayIndex ?? 0) >= expectedIdx) {
        rec.advanceAttempts = [{ attempt: 1, skipped: `clock already at dayIndex ${c.clock.dayIndex} (>= expected ${expectedIdx})` }];
        log(`  advance: skipped（dayIndex 已 ${c.clock.dayIndex} ≥ 目标 ${expectedIdx}）`);
      } else {
        const d1 = db();
        let st = null;
        try { st = d1.prepare('SELECT status FROM virtual_sessions WHERE id = ?').get(vl.vsessionId); } finally { d1.close(); }
        // --replan：每日 advance 前无条件重建会话——温故计划在 reserve（开课）时刻按当时模拟钟生成
        // （buildReviewPlan: dueAt<=simulatedNowOr()），失败会话的 restart 若发生在到期日之前，
        // 计划为空且整节沿用（pilot 3 人 0 对根因）；每日 replan 让计划总在「已越过到期日」的钟上生成。
        if (REPLAN) {
          const rp = await restartLearning(vl);
          rec.replan = { http: rp.http, ok: rp.ok, error: rp.error ? String(rp.error).slice(0, 400) : null, priorStatus: st?.status ?? null };
          log(`  replan(restart): http=${rp.http} ok=${rp.ok} prior=${st?.status ?? '-'}`);
          await sleep(8000);
        } else if (st && ['failed', 'abandoned'].includes(st.status)) {
          const rs = await restartLearning(vl);
          rec.restart = { http: rs.http, ok: rs.ok, error: rs.error ? String(rs.error).slice(0, 400) : null };
          log(`  restart: http=${rs.http} ok=${rs.ok}`);
          await sleep(8000);
        }
        rec.advanceAttempts = await advanceDay(vl);
        log(`  advance: ${JSON.stringify(rec.advanceAttempts)}`);
      }

      const c2 = await getClock(vl);
      rec.clockAfter = c2.clock;
      const asOf = c2.clock?.simulatedNow ?? null;
      const dayStart = asOf ? new Date(new Date(asOf).getTime() - 86399999).toISOString() : null;
      rec.window = { dayStart, asOf };
      log(`  window: [${dayStart} .. ${asOf}]`);

      const post = snapshotTraces(d, vl.userId);
      rec.postTraceCount = post.rows.length;
      const changed = [];
      for (const row of post.rows) {
        const b = pre.map[row.conceptKey];
        if (!b) { changed.push({ conceptKey: row.conceptKey, kind: 'new', after: compactTrace(row) }); continue; }
        const diff = {};
        for (const f of ['masteryScore', 'stability', 'lastSeenAt', 'extractionCount', 'dueAt', 'fsrsStability', 'fsrsReps']) {
          const av = normalizeTs(b[f]), bv = normalizeTs(row[f]);
          if (String(av) !== String(bv)) diff[f] = { before: av, after: bv };
        }
        if (Object.keys(diff).length) changed.push({ conceptKey: row.conceptKey, kind: 'changed', diff });
      }
      rec.traceDelta = changed;

      const ev = asOf ? extractWarmupPairs(d, vl, day, rec.window, pre.map) : { pairs: [], sessionDigest: [] };
      rec.warmupPairs = ev.pairs;
      rec.sessionDigest = ev.sessionDigest;
      log(`  traces ${rec.preTraceCount}→${rec.postTraceCount}（delta ${changed.length}），温故会话 ${ev.sessionDigest.length}，成对样本 ${ev.pairs.length}`);
    } catch (e) {
      rec.fatal = `${e.name || 'Error'}: ${e.message}`;
      log(`  !! ${rec.fatal}`);
    } finally { d.close(); }
    result.vls.push(rec);
    writeDay(file, result);
    await sleep(8000);
  }
  writeDay(file, result);
  log(`day${day} 完成 → ${file}`);
}

function writeDay(file, result) {
  let merged = result;
  try {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (prev && Array.isArray(prev.vls)) {
      const byKey = new Map(prev.vls.map((v) => [v.vlKey, v]));
      for (const v of result.vls) byKey.set(v.vlKey, v);
      merged = { ...result, vls: [...byKey.values()] };
    }
  } catch {}
  fs.writeFileSync(file, JSON.stringify(merged, null, 1));
}

// ---------- assemble ----------
/** 合并某天的全部产物文件（含并行分组 --tag 文件）：同一 vlKey 取「成对样本更多」者，平局取生成更晚者。 */
function readDayMerged(day) {
  let files = [];
  try { files = fs.readdirSync(OUT).filter((f) => new RegExp(`^r4-cal-day${day}(-[A-Za-z0-9_]+)?\\.json$`).test(f)); } catch { return null; }
  const byKey = new Map();
  let generatedAt = null;
  for (const f of files) {
    const j = readJson(path.join(OUT, f));
    if (!j || !Array.isArray(j.vls)) continue;
    if (j.generatedAt && (!generatedAt || j.generatedAt > generatedAt)) generatedAt = j.generatedAt;
    for (const v of j.vls) {
      const prev = byKey.get(v.vlKey);
      const prevPairs = (prev?.warmupPairs || []).length;
      const curPairs = (v.warmupPairs || []).length;
      if (!prev || curPairs > prevPairs || (curPairs === prevPairs && (v.clockAfter?.dayIndex ?? -1) > (prev.clockAfter?.dayIndex ?? -1))) {
        byKey.set(v.vlKey, v);
      }
    }
  }
  return byKey.size ? { day, generatedAt, files, vls: [...byKey.values()] } : null;
}
function cmdAssemble() {
  const outDir = path.join(ROOT, 'doc', 'local', 'runs', '20261006', 'vl-evals');
  fs.mkdirSync(outDir, { recursive: true });
  const probe = readJson(path.join(OUT, 'r4-cal-probe.json'));
  const setup = readJson(path.join(OUT, 'r4-cal-setup.json'));
  const dayNums = fs.readdirSync(OUT)
    .map((f) => (f.match(/^r4-cal-day(\d+)/) || [])[1])
    .filter(Boolean).map(Number);
  const days = [...new Set(dayNums)].sort((a, b) => a - b).map((n) => readDayMerged(n));
  const pairs = [];
  const daySummaries = [];
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    if (!day) continue;
    const ds = { day: i + 1, generatedAt: day.generatedAt, vls: [] };
    for (const v of day.vls || []) {
      const ps = v.warmupPairs || [];
      pairs.push(...ps);
      ds.vls.push({ vlKey: v.vlKey, fatal: v.fatal ?? null, clockAfter: v.clockAfter ? { baseDate: v.clockAfter.baseDate, dayIndex: v.clockAfter.dayIndex, simulatedNow: v.clockAfter.simulatedNow } : null, advanceAttempts: v.advanceAttempts ?? null, preTraceCount: v.preTraceCount ?? null, postTraceCount: v.postTraceCount ?? null, delta: (v.traceDelta || []).length, pairs: ps.length });
    }
    daySummaries.push(ds);
  }
  // 去重（同 conceptKey + occurredAt + teachingSessionId）
  const seen = new Set();
  const uniq = [];
  for (const p of pairs) {
    const k = `${p.conceptKey}|${p.occurredAt}|${p.source?.teachingSessionId}`;
    if (seen.has(k)) continue; seen.add(k); uniq.push(p);
  }
  const artifact = {
    round: 'R4',
    kind: 'vl-calibration-pairs',
    generatedAt: new Date().toISOString(),
    mechanism: 'ad-driver.mjs 跨日推进轨（3011）；温故 outcome 成对样本',
    baseDate: BASE_DATE,
    realNow: new Date().toISOString(),
    clockNote: '模拟钟为会话级（resolveSimulationClock: session > profile > global settings）；推进前各目标会话无 session 级 simulationClock，回退 baseDate=会话创建日 2026-10-06（probe 实录）；本轮显式落会话级 baseDate=2026-10-01，未改全局 dateSimulation。',
    predictedSource: 'memory_traces 状态经 fsrsRetentionOfTrace（memory-trace.service.ts:50-73）→ FSRS 幂律 R；VL 渠道 fsrsStability 全 null，故走 fsrsStateFromLegacy（S=round(mastery*10), D=5）。item.retention 为平台注入时的预测值。',
    actualSource: 'teachingState.sessionArtifacts.memoryWarmup.items[].outcome.{status,progress} → mapReviewStatusToRating（ReviewCompletedConsumer.ts:60-72）',
    pairsCount: uniq.length,
    distinctConcepts: new Set(uniq.map((p) => p.conceptKey)).size,
    predictedRange: uniq.length ? { min: Math.min(...uniq.map((p) => p.predictedRetention ?? 1)), max: Math.max(...uniq.map((p) => p.predictedRetention ?? 0)) } : null,
    actualDistribution: uniq.reduce((a, p) => { a[p.actualRating] = (a[p.actualRating] || 0) + 1; return a; }, {}),
    sources: uniq.map((p) => ({ conceptKey: p.conceptKey, vlKey: p.source?.vlKey, teachingSessionId: p.source?.teachingSessionId, vsessionId: p.source?.vsessionId, occurredAt: p.occurredAt, actualRating: p.actualRating })),
    pairs: uniq,
    daySummaries,
    probe: probe ? { generatedAt: probe.generatedAt, vls: probe.vls.map((v) => ({ key: v.key, vsessionId: v.vsessionId, clock: v.clock })) } : null,
    setup: setup ? { generatedAt: setup.generatedAt, vls: setup.vls.map((v) => ({ key: v.key, clockBefore: v.clockBefore, clockAfter: v.clockAfter, enableClock: v.enableClock, restart: v.restart })) } : null,
  };
  fs.writeFileSync(path.join(outDir, 'r4-calibration.json'), JSON.stringify(artifact, null, 1));
  console.log(`assemble 完成: pairs=${uniq.length} → ${path.join(outDir, 'r4-calibration.json')}`);
  console.log(JSON.stringify({ pairsCount: uniq.length, distinctConcepts: artifact.distinctConcepts, predictedRange: artifact.predictedRange, actualDistribution: artifact.actualDistribution }, null, 1));
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

// ---------- main ----------
const cmd = process.argv[2];
const targets = resolveTargets();
log(`=== r4-cal-collect ${cmd} base=${BASE} baseDate=${BASE_DATE} vls=${targets.map((t) => t.key).join(',')} ===`);
if (cmd === 'probe') await cmdProbe(targets);
else if (cmd === 'setup') await cmdSetup(targets);
else if (cmd === 'restart') await cmdRestart(targets);
else if (cmd === 'reset') await cmdReset(targets);
else if (/^day\d+$/.test(cmd)) await cmdDay(Number(cmd.slice(3)), targets);
else if (cmd === 'assemble') cmdAssemble();
else { console.error('用法: node r4-cal-collect.mjs probe|setup|day1..dayN [--vl=...] [--base=...] [--basedate=...]'); process.exit(1); }
