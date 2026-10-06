// 跨日推进驱动（第二轮 · advance 轨）
// 用法：
//   node ad-driver.mjs setup              —— 启钟（simulation-config）+ 复活（restart-learning）+ 状态盘点，不跑课
//   node ad-driver.mjs day1|day2|day3     —— 推进 1 个模拟日（runTasks=true）×6 VL + 当日取证 → out/ad-day<n>.json
//   node ad-driver.mjs day1 --vl=VL-1     —— 只推进指定 VL
// 纪律：
//   - 只打 3011；admin 走 fleet 共享 cookie（scripts/vlab-eval/admin-session.mjs）
//   - DB 只读（readOnly + busy_timeout=5000）；写操作只经产品 API（simulation-config/restart-learning/advance-day）
//   - 全局并发 ≤1 个 advance 请求在飞（本脚本天然串行）；请求间 sleep 8s；429/5xx/网络错退避 30s×3
//   - 跨日判定用 occurredAt/asOf 口径（模拟日窗口由 advance-day 响应 clock.simulatedNow 给出）
// 时钟口径：baseDate=2026-10-01（Thu）。默认课表周一~五 ⇒ 3 个可达上课日：
//   day1=2026-10-02(Fri) day2=2026-10-05(Mon，跨周末 gap=3) day3=2026-10-06(Tue)。
//   （P0 护栏 simulated-day.service.ts:455 禁止推进 dayStart 未到的日；当天日历日=10-06，故 10-07+ 不可达。）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..'); // repo root
const OUT = path.join(__dirname, 'out');
const LOG = path.join(OUT, 'ad-run.log');
fs.mkdirSync(OUT, { recursive: true });

const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3011');
const BASE_DATE = arg('basedate', '2026-10-01');

const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';

const ADMIN_MOD = pathToFileURL(path.join(ROOT, 'scripts', 'vlab-eval', 'admin-session.mjs')).href;
const { getAdminCookie, refreshAdminCookie } = await import(ADMIN_MOD);

// ---------- logging ----------
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

// ---------- DB（只读） ----------
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
function db() {
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  d.exec('PRAGMA busy_timeout = 5000');
  return d;
}

// 6 个 R1 VL（预检 r2-preflight-db2.cjs 实测 userId）
const VLS = {
  'VL-1': { userId: 'ee52b287-29b4-4d0b-9995-303f13322f8c' },
  'VL-B1': { userId: '0b27bb9e-afed-4a7a-9991-1dd404b6c4b5' },
  'VL-B2': { userId: '802c1a8a-423f-4e9c-aa15-68035cecede2' },
  'VL-B3': { userId: '7a3f3955-6f4e-4dbb-9f00-d92969cd019c' },
  'VL-B4': { userId: 'b78b4b66-dd38-4a7b-ab0f-23284c7b3847' },
  'VL-B5': { userId: '7099f596-8962-4ada-a10f-6dcc6c2d4578' },
};

function resolveTargets() {
  const only = arg('vl', null);
  const keys = only ? only.split(',') : Object.keys(VLS);
  const d = db();
  const uidList = Object.values(VLS).map((v) => v.userId);
  const ph = uidList.map(() => '?').join(',');
  const profiles = d.prepare(`SELECT id, userId FROM virtual_learner_profiles WHERE userId IN (${ph})`).all(...uidList);
  const pidByUser = Object.fromEntries(profiles.map((p) => [p.userId, p.id]));
  const out = [];
  for (const key of keys) {
    const v = VLS[key];
    if (!v) throw new Error(`未知 VL: ${key}`);
    const sess = d.prepare(`SELECT id, status, currentStage FROM virtual_sessions WHERE virtualProfileId = ? ORDER BY createdAt DESC LIMIT 1`).get(pidByUser[v.userId]);
    out.push({ key, ...v, profileId: pidByUser[v.userId], vsessionId: sess?.id || null, vsessionStatus: sess?.status || null, stage: sess?.currentStage || null });
  }
  d.close();
  return out;
}

// ---------- FSRS 镜像（口径 = backend/src/services/memory/fsrs.ts:161-174 与 fsrsStateFromLegacy:77-91） ----------
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

// ---------- SQL 快照（显式列名） ----------
const TRACE_COLS = 'conceptKey, label, masteryScore, stability, lastSeenAt, extractionCount, decayFactor, intervalFactor, dueAt, fsrsStability, fsrsDifficulty, fsrsReps, fsrsLapses, ktMasteryEma, source, pathId, updatedAt';
function snapshotTraces(d, userId) {
  const rows = d.prepare(`SELECT ${TRACE_COLS} FROM memory_traces WHERE userId = ? ORDER BY conceptKey`).all(userId);
  const map = {};
  for (const r of rows) map[r.conceptKey] = r;
  return { rows, map };
}
function traceDelta(preMap, postRows) {
  const changes = [];
  for (const post of postRows) {
    const pre = preMap[post.conceptKey];
    if (!pre) { changes.push({ conceptKey: post.conceptKey, kind: 'new', after: compactTrace(post) }); continue; }
    const diff = {};
    for (const f of ['masteryScore', 'stability', 'lastSeenAt', 'extractionCount', 'dueAt', 'fsrsStability', 'fsrsDifficulty', 'fsrsReps', 'fsrsLapses', 'ktMasteryEma', 'source', 'pathId']) {
      const a = pre[f] === undefined ? null : pre[f];
      const b = post[f] === undefined ? null : post[f];
      const an = fieldVal(f, a), bn = fieldVal(f, b);
      if (String(an) !== String(bn)) diff[f] = { before: an, after: bn };
    }
    if (Object.keys(diff).length) changes.push({ conceptKey: post.conceptKey, kind: 'changed', diff });
  }
  return changes;
}
const DATE_FIELDS = new Set(['lastSeenAt', 'dueAt', 'updatedAt']);
function normalizeTs(v) { return typeof v === 'number' ? new Date(v).toISOString() : v ?? null; }
function fieldVal(f, v) { return DATE_FIELDS.has(f) ? normalizeTs(v) : (v ?? null); }
function compactTrace(r) {
  return { label: r.label, masteryScore: r.masteryScore, stability: r.stability, lastSeenAt: normalizeTs(r.lastSeenAt), extractionCount: r.extractionCount, dueAt: normalizeTs(r.dueAt), fsrsStability: r.fsrsStability, fsrsDifficulty: r.fsrsDifficulty, fsrsReps: r.fsrsReps, fsrsLapses: r.fsrsLapses, ktMasteryEma: r.ktMasteryEma, source: r.source, pathId: r.pathId };
}
function decayReadings(rows, asOf) {
  const out = [];
  for (const r of rows) {
    if (!r.lastSeenAt) continue;
    const state = fsrsStateOfTrace(r);
    if (!state.lastReviewAt) continue;
    const at = new Date(asOf);
    const elapsedDays = Math.round(Math.max(0, (at.getTime() - state.lastReviewAt.getTime()) / DAY_MS) * 1000) / 1000;
    out.push({
      conceptKey: r.conceptKey, formulaPath: state.path, fsrsStability: state.stability, fsrsDifficulty: state.difficulty,
      lastSeenAt: state.lastReviewAt.toISOString(), elapsedDays, asOf,
      retrievability: Math.round(fsrsRetrievability(state, at) * 10000) / 10000,
      dueAt: normalizeTs(r.dueAt), due: r.dueAt != null && new Date(r.dueAt).getTime() <= at.getTime(),
      masteryScore: r.masteryScore, extractionCount: r.extractionCount, source: r.source,
    });
  }
  return out;
}
const SESS_COLS = 'id, status, mode, taskId, subject, topic, startTime, endTime, revision';
function snapshotSessions(d, userId) {
  const rows = d.prepare(`SELECT ${SESS_COLS} FROM teaching_sessions WHERE userId = ? ORDER BY startTime`).all(userId);
  const map = {};
  for (const r of rows) map[r.id] = r;
  return { rows, map };
}
function parseJsonSafe(text) { try { return JSON.parse(text); } catch { return null; } }
function warmupOfSession(d, sessionId) {
  const row = d.prepare('SELECT teachingState, wrapup, knowledgeState FROM teaching_sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  const ts = parseJsonSafe(row.teachingState) || {};
  const plan = ts?.sessionArtifacts?.memoryWarmup || null;
  const wrapup = parseJsonSafe(row.wrapup);
  return {
    memoryWarmup: plan ? {
      usedLoad: plan.usedLoad ?? null,
      items: (Array.isArray(plan.items) ? plan.items : []).map((it) => ({
        conceptKey: it.conceptKey ?? null, label: it.label ?? null,
        status: it.outcome?.status ?? it.status ?? null,
        progress: it.outcome?.progress ?? it.progress ?? null,
        askedAt: it.askedAt ?? null,
      })),
    } : null,
    hasWrapup: !!row.wrapup,
    wrapupKeys: wrapup ? Object.keys(wrapup) : [],
  };
}
function evidenceInWindow(d, userId, from, to) {
  return d.prepare(
    `SELECT id, eventId, evidenceKey, evidenceType, sessionId, taskId, pathId, confidence, occurredAt, payload
     FROM learner_evidence WHERE userId = ? AND occurredAt > ? AND occurredAt <= ? ORDER BY occurredAt`,
  ).all(userId, from, to);
}
function eventsInWindow(d, userId, from, to) {
  return d.prepare(
    `SELECT id, eventType, aggregateId, status, occurredAt, substr(payload, 1, 1200) AS payloadHead
     FROM domain_event_outbox WHERE userId = ? AND occurredAt > ? AND occurredAt <= ? ORDER BY occurredAt`,
  ).all(userId, from, to);
}
function msgCount(d, sessionId) {
  return d.prepare('SELECT COUNT(*) AS cnt FROM teaching_session_messages WHERE sessionId = ?').get(sessionId).cnt;
}

// ---------- HTTP ----------
let cookie = '';
async function ensureCookie() {
  cookie = await getAdminCookie(BASE, envGet);
  if (!cookie) throw new Error('admin cookie 获取失败');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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

// node:http 长连接（advance-day 内部跑整课，R1 实证 5-27 分钟/课；crossday.mjs 同款规避 undici 5min headersTimeout）
function apiLong(method, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method, agent: false,
      headers: {
        Cookie: cookie, Origin: 'http://localhost:5173',
        ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { const e = new Error('http timeout'); e.name = 'TimeoutError'; req.destroy(e); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ---------- VL 操作（全部产品 API） ----------
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
  return { http: r.status, ok: r.status === 200 && r.json?.success !== false, data: r.json?.data ?? null, error: r.json?.error ?? r.json?.raw ?? null };
}
// 403 等上游错会把 vsession 终态化为 failed（executeLearningStep 行为，R1 §12-5-⑤）——
// 重试前用产品 API 复活，否则 advance 永远吃「学习已停止（failed）」
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
  let lastExpectedDayIndex = null;
  for (let i = 1; i <= 4; i += 1) {
    // 重试前核对：若时钟已推进（上一发实际成功但响应丢失），不再重发
    if (i > 1) {
      const c = await getClock(vl);
      const idx = c.clock?.dayIndex;
      if (idx !== null && idx !== undefined && lastExpectedDayIndex !== null && idx > lastExpectedDayIndex) {
        attempts.push({ attempt: i, skipped: 'clock already advanced (response likely lost)', dayIndex: idx });
        break;
      }
      log(`  [${vl.key}] advance 重试 #${i}（此前: ${attempts.map((a) => a.http ?? a.error ?? a.skipped).join(';')}）`);
      await reviveIfFailed(vl);
    }
    let r;
    try {
      const before = await getClock(vl);
      lastExpectedDayIndex = before.clock?.dayIndex ?? null;
      r = await apiLong('POST', `/api/admin/virtual-learners/sessions/${vl.vsessionId}/advance-day`, { days: 1, runTasks: true }, 60 * 60 * 1000);
    } catch (e) {
      attempts.push({ attempt: i, error: `${e.name || 'Error'}: ${e.message}` });
      if (i < 4) { log(`  [${vl.key}] advance 网络错，30s 后重试`); await sleep(30000); continue; }
      break;
    }
    attempts.push({ attempt: i, http: r.status, success: r.json?.success, learning: r.json?.data?.learning ?? null, reverted: r.json?.data?.reverted, simulatedDay: r.json?.data?.simulatedDay });
    // 429/5xx，或 200 包裹的上游 provider 错误（R1 §13 实锤：DS 池 403「No active subscription」
    // 散布且同会话续跑即恢复）——仅在「日未被消耗」（reverted/dayIndex 未动）时重试，否则会烧掉下一天
    const learningErr = r.json?.data?.learning?.error;
    const notConsumed = r.json?.data?.reverted === true || r.json?.data?.learning?.started === false;
    const retryable = r.status === 429 || r.status >= 500 || (r.status === 200 && notConsumed && !!learningErr);
    if (!retryable) break;
    if (i < 4) { log(`  [${vl.key}] advance 可重试失败（http=${r.status} err=${String(learningErr || '').slice(0, 120)}），退避 30s`); await sleep(30000); }
  }
  return attempts;
}

// ---------- setup / day ----------
async function cmdSetup(targets) {
  await ensureCookie();
  for (const vl of targets) {
    log(`== [${vl.key}] user=${vl.userId} vsession=${vl.vsessionId} status=${vl.vsessionStatus} stage=${vl.stage}`);
    let c = await getClock(vl);
    log(`  clock: ${JSON.stringify(c.clock)} (http=${c.http})`);
    // 无条件显式落 baseDate（全局 dateSimulation 可能本来就开着——enabled 会解析成 true，
    // 但 baseDate 会默认落到会话创建日=10-06，导致 day1=10-07 被 P0 未来日护栏挡住）
    const en = await enableClock(vl);
    log(`  enableClock(baseDate=${BASE_DATE}): ${JSON.stringify(en)}`);
    c = await getClock(vl);
    log(`  clock after: ${JSON.stringify(c.clock)}`);
    if (!c.clock?.enabled) { log(`  !! 启钟失败，跳过该 VL`); continue; }
    if (c.clock?.baseDate !== BASE_DATE) { log(`  !! baseDate 未落成 ${BASE_DATE}，跳过该 VL`); continue; }
    if (vl.vsessionStatus === 'failed') {
      const rs = await restartLearning(vl);
      log(`  restartLearning: http=${rs.http} ok=${rs.ok} error=${JSON.stringify(rs.error)?.slice(0, 300)}`);
      if (rs.data?.teachingSessionId) log(`  新教学会话: ${rs.data.teachingSessionId}`);
    } else {
      log(`  vsession status=${vl.vsessionStatus}，无需复活`);
    }
    await sleep(8000);
  }
  log('setup 完成');
}

async function runDay(day, targets) {
  await ensureCookie();
  const result = { day, baseDate: BASE_DATE, generatedAt: new Date().toISOString(), vls: [] };
  const file = path.join(OUT, `ad-day${day}.json`);
  for (const vl of targets) {
    log(`== [day${day}] ${vl.key} vsession=${vl.vsessionId}`);
    const rec = { vlKey: vl.key, userId: vl.userId, profileId: vl.profileId, vsessionId: vl.vsessionId };
    const d = db();
    try {
      const preTraces = snapshotTraces(d, vl.userId);
      const preSessions = snapshotSessions(d, vl.userId);
      rec.preTraceCount = preTraces.rows.length;
      rec.preSessionCount = preSessions.rows.length;

      // 0) 时钟就绪（幂等，无条件显式落 baseDate——见 cmdSetup 注释）
      let c = await getClock(vl);
      rec.clockBefore = c.clock;
      const en = await enableClock(vl);
      rec.clockEnable = en;
      c = await getClock(vl);
      rec.clockBefore = c.clock;
      if (!c.clock?.enabled || c.clock?.baseDate !== BASE_DATE) { rec.fatal = `时钟未就绪: ${JSON.stringify(c.clock)}`; result.vls.push(rec); writeDay(file, result); continue; }

      // 1) 复活（failed → running）
      const d1 = db();
      let st = d1.prepare('SELECT status, currentStage FROM virtual_sessions WHERE id = ?').get(vl.vsessionId);
      d1.close();
      // 首发护栏：时钟已到达/越过本日目标 index（如上次运行响应丢失但服务端已推进）→ 不再 POST，防烧掉下一天
      // dayIndex 是「自 baseDate 起的日历偏移」，默认课表周一~五、baseDate=2026-10-01(Thu) 时
      // 三个上课日的 index = 1(Fri 10-02) / 4(Mon 10-05，跳过周末 2-3) / 5(Tue 10-06)
      const expectedIdx = { 1: 1, 2: 4, 3: 5 }[day];
      if ((c.clock?.dayIndex ?? 0) >= expectedIdx) {
        rec.advanceAttempts = [{ attempt: 1, skipped: `clock already at dayIndex ${c.clock.dayIndex} (>= expected ${expectedIdx})` }];
        log(`  advance: skipped（dayIndex 已 ${c.clock.dayIndex} ≥ 目标 ${expectedIdx}）`);
      } else {
        if (st && ['failed', 'abandoned'].includes(st.status)) {
          const rs = await restartLearning(vl);
          rec.restart = { http: rs.http, ok: rs.ok, error: rs.error ? String(rs.error).slice(0, 400) : null, teachingSessionId: rs.data?.teachingSessionId ?? null };
          log(`  restart: http=${rs.http} ok=${rs.ok}`);
          await sleep(8000);
        }

        // 2) 推进 1 个模拟日（runTasks=true，串行，全场唯一在飞请求）
        const attempts = await advanceDay(vl);
        rec.advanceAttempts = attempts;
        const okAttempt = attempts.find((a) => a.http === 200 && a.success !== false);
        log(`  advance: ${JSON.stringify(attempts)}`);
      }

      // 3) 取证（occurredAt/asOf 口径）
      const c2 = await getClock(vl);
      rec.clockAfter = c2.clock;
      const asOf = c2.clock?.simulatedNow ?? okAttempt?.simulatedDay ?? null;
      // asOf=日终 23:59:59.999；dayStart=asOf-86399999ms（+08 无 DST）
      const dayStart = asOf ? new Date(new Date(asOf).getTime() - 86399999).toISOString() : null;
      rec.window = { dayStart, asOf, simulatedDay: c2.clock ? `${BASE_DATE} + dayIndex ${c2.clock.dayIndex}` : null };
      log(`  window: [${dayStart} .. ${asOf}]`);

      const postTraces = snapshotTraces(d, vl.userId);
      const postSessions = snapshotSessions(d, vl.userId);
      rec.traceDelta = traceDelta(preTraces.map, postTraces.rows);
      rec.newSessions = postSessions.rows.filter((s) => !preSessions.map[s.id]).map((s) => ({
        ...s, startTime: normalizeTs(s.startTime), endTime: normalizeTs(s.endTime), msgCount: msgCount(d, s.id), ...warmupOfSession(d, s.id),
      }));
      // 当日窗口内的全部会话（含重启续跑的旧会话）
      rec.touchedSessions = postSessions.rows
        .filter((s) => (s.endTime ? new Date(s.endTime).getTime() : 0) > new Date(dayStart).getTime() || !preSessions.map[s.id])
        .map((s) => ({ id: s.id, status: s.status, taskId: s.taskId, topic: s.topic, startTime: normalizeTs(s.startTime), endTime: normalizeTs(s.endTime), revision: s.revision, msgCount: msgCount(d, s.id) }));

      const ev = evidenceInWindow(d, vl.userId, dayStart, asOf);
      rec.evidenceByType = Object.entries(ev.reduce((acc, e) => { acc[e.evidenceType] = (acc[e.evidenceType] || 0) + 1; return acc; }, {}));
      rec.reviewEvidence = ev.filter((e) => e.evidenceType === 'review:completed').map((e) => ({ ...e, payload: parseJsonSafe(e.payload) }));
      rec.otherEvidence = ev.filter((e) => e.evidenceType !== 'review:completed').slice(0, 30);
      rec.outboxEvents = eventsInWindow(d, vl.userId, dayStart, asOf);

      rec.decayReadings = asOf ? decayReadings(postTraces.rows, asOf) : [];

      // 4) 校准对：pre 日状态（=复习前预测状态）×当日 review:completed 实际 rating
      rec.calibrationPairs = [];
      for (const e of rec.reviewEvidence) {
        const p = e.payload || {};
        if (!p.conceptKey || !p.rating) continue;
        const pre = preTraces.map[p.conceptKey];
        let predicted = null, predNote = 'no-pre-trace';
        if (pre && pre.lastSeenAt) {
          const state = fsrsStateOfTrace(pre);
          if (state.lastReviewAt) {
            predicted = Math.round(fsrsRetrievability(state, new Date(e.occurredAt)) * 10000) / 10000;
            predNote = state.path;
          }
        }
        rec.calibrationPairs.push({ conceptKey: p.conceptKey, predictedRetriability: predicted, actualOutcome: p.rating, occurredAt: e.occurredAt, predNote, status: p.status ?? null, progress: p.progress ?? null, sessionId: e.sessionId });
      }

      // 5) 平台自己的记忆读数（GET memory，asOf=墙钟——如实记录）
      const mem = await apiJson('GET', `/api/admin/virtual-learners/${vl.profileId}/memory`);
      rec.platformMemory = mem.status === 200 ? {
        asOf: mem.json?.data?.asOf ?? null,
        counts: mem.json?.data?.counts ?? null,
        concepts: (mem.json?.data?.concepts || []).map((x) => ({ conceptKey: x.conceptKey, bucket: x.bucket, stabilityLabel: x.stabilityLabel ?? null, stabilityDays: x.stabilityDays ?? null, currentRetention: x.currentRetention ?? null, elapsedDays: x.elapsedDays ?? null, dueAt: x.dueAt ?? null })),
      } : { http: mem.status, error: mem.json?.error ?? null };

      log(`  traces ${rec.preTraceCount}→${postTraces.rows.length}（delta ${rec.traceDelta.length}），新会话 ${rec.newSessions.length}，review:completed ${rec.reviewEvidence.length}，校准对 ${rec.calibrationPairs.length}`);
    } catch (e) {
      rec.fatal = `${e.name || 'Error'}: ${e.message}`;
      log(`  !! ${rec.fatal}`);
    } finally {
      d.close();
    }
    result.vls.push(rec);
    writeDay(file, result);
    await sleep(8000);
  }
  writeDay(file, result);
  log(`day${day} 完成 → ${file}`);
}

function writeDay(file, result) {
  // 合并写：重跑个别 VL 时保留既有文件里其它 VL 的当日记录（同 vlKey 覆盖）
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

// ---------- main ----------
const cmd = process.argv[2];
const targets = resolveTargets();
log(`=== ad-driver ${cmd} base=${BASE} baseDate=${BASE_DATE} vls=${targets.map((t) => t.key).join(',')} ===`);
if (cmd === 'setup') await cmdSetup(targets);
else if (/^day[123]$/.test(cmd)) await runDay(Number(cmd.slice(3)), targets);
else { console.error('用法: node ad-driver.mjs setup|day1|day2|day3 [--vl=VL-1,...] [--base=...] [--basedate=YYYY-MM-DD]'); process.exit(1); }
