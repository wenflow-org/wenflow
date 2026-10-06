// measurement-verify 第二轮 · 序列课轨（seq）·「上一课的数据真的改变下一课吗？」
//
// 同一全新账号 seq-r2-a<rand> 连上 3 节课（同一条 path，目标文本固定）：
//   seq-a1 种弱点   正常上课；第一个检查点故意连续两次答错（种 attempts_exhausted 未掌握证据），
//                   其后检查点全部答对；讨完课 → finalize complete_task
//                   课后基线 out/seq-a1.after.json（memory_traces/knowledgeState/misconception_ledger/
//                   learner_projections+learning_metrics EWMA/prediction_records，只读）
//   seq-a2 看注入   同 path 下一任务开课。开课窗取证：prompt_call_logs（agentId=
//                   skill:teaching-opening-generator / skill:teaching-turn）userPayload 结构段——
//                   memoryWarmup 计划 / priorMisconceptions / lastLessonRecap / temporalGap / successBand；
//                   老师是否先带回课1错概念；全对 → finalize complete_task；
//                   课后对比 out/seq-a2.after.json（与 a1 逐项对照）
//   seq-a3 复习课   POST /api/ai-teaching/review/sessions {taskId}（路由 ai-teaching.routes.ts:100，mode=review，
//                   可挂已完成任务——task-completion.service.ts:78 注释「复习课本就作用于已完成任务」）。
//                   验证：①响应 mode='review'；②allowDegrade 通道（KnowledgeStateService.ts:24,38-43；
//                   调用点 teaching-turn-engine.ts:398-402 传 session.mode==='review'）——复习课里先答对让点
//                   升到 mastered，再故意答错，看 knowledgeState 是否真降级；③收尾 finalize complete_review
//                   （路由 :940；SessionFinalizationService.ts:84-125 collectReviewOutcomes → review:completed
//                   事件 → ReviewCompletedConsumer 写 learner_evidence + FSRS 回写 memory_traces）
//
// 纪律（继承第一轮铁律）：
//   - 只打 3011 验证实例；3001 旧实例不碰；零 git；不改 backend/src、frontend/src 与现存配置
//   - 回合间 sleep 6-8s；429/5xx/池化403 退避 30s×3
//   - DB 只读 node:sqlite（readOnly + busy_timeout=5000）；显式列名（teaching_sessions.messages 大列禁选，
//     消息走 teaching_session_messages 侧表）；参数绑定
//   - 写入只走产品 API；全新账号 seq-r2- 前缀，全程只开这一个账号
//   - 每课无论成败 finally 落盘 out/seq-a<n>.result.json；日志 out/seq-run.log；汇总 out/seq-summary.json
//
// 账号名注记（同第一轮 run-round1-api.mjs:167-170 实证）：auth.ts:147 USERNAME_PATTERN=/^[\p{L}\p{N}_-]+$/u
// 禁 @/.，任务书给的 seq-r2-a@test.local 形态不可注册；实际注册名 seq-r2-a<rand>，服务端按
// auth.service.ts:112 生成 <name>@wenflow.local 邮箱。
//
// 断点续跑：状态落 out/seq-r2-state.json（账号/路径/任务/各课会话 id）；--phase=a1|a2|a3|summary 只跑缺的相。
// 用法：cd backend && node scripts/measurement-verify/run-round2-seq.mjs [--phase=a2] [--force]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
const LOG_PATH = path.join(OUT_DIR, 'seq-run.log');
const SUMMARY_PATH = path.join(OUT_DIR, 'seq-summary.json');
const STATE_PATH = path.join(OUT_DIR, 'seq-r2-state.json');
const BASE = process.env.MV_BASE || 'http://127.0.0.1:3011';
const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'MvSeqR22026x';
const DB_PATH = path.resolve(__dirname, '../../prisma/dev.db');
const GOAL_TEXT = '我是初中二年级学生，想在两个月内系统掌握初中生物的「光合作用与呼吸作用」这部分，每天能学 30 分钟。请按这个目标帮我规划。';

const TURN_SLEEP_MS = 6000;
const BACKOFF_MS = 30000;
const MAX_RETRIES = 3;
const FINALIZE_POLL_MS = 10000;
const FINALIZE_POLL_CAP_MS = 780000;
const LESSON_GAP_MS = 10000; // 课间退火

// ── 预登记期望/禁止行（实跑前写死，来自任务书；不得随实跑结果改动）─────────────
const EXPECTED = {
  'seq-a1': [
    "checkpoint:attempt{outcome='attempts_exhausted',attempts=2}（第一个检查点，故意两次错答）",
    "checkpoint:result{passed=false} x2（同一 checkpointId）",
    'checkpoint:result{passed=true} >= 1（其后检查点全对，保正证据）',
  ],
  'seq-a2': [
    '课2 开课 prompt 含 recap/warmup 段（lastLessonRecap 或 memoryWarmup 结构段出现在 opening/teaching-turn userPayload）',
    'checkpoint:result{passed=true} >= 1（课2 正常答对）',
    'finalize settled（complete_task）',
  ],
  'seq-a3': [
    "开课响应 mode='review'（复习课真进复习模式）",
    'review:completed 或 FSRS 回写证据（memory_traces dueAt/stability/grade 变化）',
    '若答错则 mastery 下降（allowDegrade：knowledgeState 点降级或 memory_traces 走低）',
  ],
};
const FORBIDDEN = { 'seq-a1': [], 'seq-a2': [], 'seq-a3': [] };

// ── 基础设施 ─────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const log = (ctx, msg) => {
  const line = `[${new Date().toISOString()}]${ctx && ctx.id ? `[${ctx.id}]` : ''} ${msg}`;
  fs.appendFileSync(LOG_PATH, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => crypto.randomBytes(n).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, n).toLowerCase();
const clip = (s, n = 300) => String(s ?? '').slice(0, n);

const args = process.argv.slice(2);
const PHASE = (args.find((a) => a.startsWith('--phase=')) || '').split('=')[1] || '';
const FORCE = args.includes('--force');

// HTTP：429/5xx/池化403 退避 30s×3（同 R1 api()）
async function api(ctx, method, urlPath, body, opts = {}) {
  const { timeout = 300000, idempotencyKey = null, retries = MAX_RETRIES } = opts;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = { Cookie: ctx.cookie, Origin: ORIGIN };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const res = await fetch(BASE + urlPath, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      let json; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
      if (res.headers.get('set-cookie')) json.__setCookie = res.headers.get('set-cookie');
      const deterministicErr = /不允许跳过|不存在或已处理|缺少|无效|已存在|TASK_ALREADY_COMPLETED|已完成/i.test(text);
      const transient = (res.status === 429 || res.status >= 500
        || (res.status === 403 && /No active subscription|bad_response_status_code/i.test(text)))
        && !deterministicErr;
      if (!res.ok || json?.success === false) {
        lastErr = new Error(`${method} ${urlPath} -> HTTP ${res.status}: ${clip(text, 240)}`);
        log(ctx, `  api-err: ${lastErr.message}${transient ? ' [transient, backoff 30s]' : ''}`);
        if (transient && attempt < retries) { await sleep(BACKOFF_MS); continue; }
        throw lastErr;
      }
      return json;
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /fetch failed|ECONNRESET|socket hang up/i.test(String(e?.message))) {
        lastErr = new Error(`${method} ${urlPath} network: ${clip(e?.message || e, 160)}`);
        log(ctx, `  api-net: ${lastErr.message}`);
        if (attempt < retries) { await sleep(BACKOFF_MS); continue; }
        throw lastErr;
      }
      throw e;
    }
  }
  throw lastErr || new Error(`${method} ${urlPath} failed`);
}

// ── DB 只读（node:sqlite；显式列名；参数绑定）────────────────────────────
async function dbAll(sql, params = []) {
  for (let i = 0; i < 3; i++) {
    let db;
    try {
      db = new DatabaseSync(DB_PATH, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 5000');
      return db.prepare(sql).all(...params);
    } catch (e) {
      if (i === 2) throw e;
      await sleep(5000);
    } finally { try { db?.close(); } catch {} }
  }
  return [];
}
async function dbGet(sql, params = []) {
  const rows = await dbAll(sql, params);
  return rows[0] ?? null;
}

// FSRS-6 幂律遗忘曲线（内联 backend/src/services/memory/fsrs.ts:161-171 公式，纯只读重算）
function retrievability(fsrsStability, lastSeenAt, nowMs) {
  const S = Number(fsrsStability);
  const last = Number(lastSeenAt);
  if (!Number.isFinite(S) || S <= 0 || !Number.isFinite(last)) return null;
  const elapsedDays = Math.max(0, (nowMs - last) / 86400000);
  const FACTOR = 19 / 81, DECAY = -0.5;
  const r = Math.pow(1 + (FACTOR * elapsedDays) / S, DECAY);
  return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;
}

// 用户级全量快照（显式列名；messages 大列绝不选取）
async function snapshotUserState(userId, tag) {
  const nowMs = Date.now();
  const traces = await dbAll(
    `SELECT id,conceptKey,label,masteryScore,stability,fsrsStability,fsrsDifficulty,fsrsReps,fsrsLapses,ktMasteryEma,
            dueAt,lastSeenAt,extractionCount,decayFactor,intervalFactor,source,pathId,conceptId,createdAt,updatedAt
     FROM memory_traces WHERE userId = ? ORDER BY conceptKey`, [userId]);
  for (const t of traces) t.retrievabilityNow = retrievability(t.fsrsStability, t.lastSeenAt, nowMs);
  const sessions = await dbAll(
    `SELECT id,taskId,learningPathId,mode,status,subject,topic,startTime,endTime,duration,revision,knowledgeState,wrapup,updatedAt
     FROM teaching_sessions WHERE userId = ? ORDER BY startTime`, [userId]);
  for (const s of sessions) {
    try { s.knowledgeBoard = s.knowledgeState ? JSON.parse(s.knowledgeState) : null; } catch { s.knowledgeBoard = 'PARSE_FAIL'; }
    try { s.wrapupParsed = s.wrapup ? JSON.parse(s.wrapup) : null; } catch { s.wrapupParsed = 'PARSE_FAIL'; }
    delete s.knowledgeState; delete s.wrapup; // 大 JSON 已解析入子键，原串不再保留
    if (s.wrapupParsed && typeof s.wrapupParsed === 'object') {
      s.wrapupStateUpdate = s.wrapupParsed.stateUpdate ?? null;
    }
  }
  const ledger = await dbAll(
    `SELECT id,conceptKey,hypothesis,canonicalLabel,confidence,status,occurrenceCount,firstSeenAt,lastSeenAt,lastSessionId,createdAt
     FROM misconception_ledger WHERE userId = ? ORDER BY firstSeenAt`, [userId]);
  const projections = await dbAll(
    `SELECT projectionKey,scope,pathId,taskId,version,lastEventAt,generatedAt,payload
     FROM learner_projections WHERE userId = ? ORDER BY projectionKey`, [userId]);
  for (const p of projections) {
    try { p.payloadParsed = p.payload ? JSON.parse(p.payload) : null; } catch { p.payloadParsed = 'PARSE_FAIL'; }
    delete p.payload;
  }
  const metrics = await dbAll(
    `SELECT taskId,metricType,value,lss,ktl,lf,lsb,lssCurrent,ktlCurrent,lfCurrent,lsbCurrent,depth_score,lssHistory,recordedAt
     FROM learning_metrics WHERE userId = ? ORDER BY recordedAt`, [userId]);
  const predictions = await dbAll(
    `SELECT id,pathId,taskId,sessionId,stallRisk,predictedTone,suggestedDepth,focusConcepts,rationale,outcome,outcomeAt,createdAt
     FROM prediction_records WHERE userId = ? ORDER BY createdAt`, [userId]);
  const evidence = await dbAll(
    `SELECT id,evidenceType,eventId,evidenceKey,sessionId,taskId,pathId,payload,confidence,occurredAt
     FROM learner_evidence WHERE userId = ? ORDER BY occurredAt`, [userId]);
  for (const e of evidence) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
  return { tag, capturedAt: new Date().toISOString(), nowMs, userId, memoryTraces: traces, sessions, misconceptionLedger: ledger, learnerProjections: projections, learningMetrics: metrics, predictionRecords: predictions, evidence };
}

// ── prompt_call_logs 取证 ────────────────────────────────────────────────
// userPayload 为 JSON（首键 scenario），递归按 key 名摘结构段，值截断
function extractSections(obj, pathStr = '', out = [], depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return out;
  const WANT = ['memoryWarmup', 'priorMisconceptions', 'lastLessonRecap', 'temporalGap', 'successBand', 'warmupOutcomes'];
  for (const [k, v] of Object.entries(obj)) {
    const p = pathStr ? `${pathStr}.${k}` : k;
    if (WANT.includes(k)) {
      out.push({ key: k, path: p, value: JSON.parse(JSON.stringify(v ?? null, (kk, vv) => (typeof vv === 'string' && vv.length > 400 ? vv.slice(0, 400) + '…' : vv))) });
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      extractSections(v, p, out, depth + 1);
    } else if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      extractSections(v[0], `${p}[0]`, out, depth + 1);
    }
  }
  return out;
}
async function fetchPromptLogs(userId, sinceMs, untilMs) {
  const rows = await dbAll(
    `SELECT id,agentId,createdAt,success,userPayload FROM prompt_call_logs
     WHERE userId = ? AND createdAt >= ? AND createdAt <= ? ORDER BY createdAt ASC`, [userId, sinceMs, untilMs]);
  return rows.map((r) => {
    let payload = null;
    try { payload = r.userPayload ? JSON.parse(r.userPayload) : null; } catch {}
    const text = r.userPayload || '';
    return {
      id: r.id, agentId: r.agentId, createdAt: r.createdAt, success: r.success,
      payloadLen: text.length,
      sections: payload ? extractSections(payload) : [], // 全文不入盘，只留结构段
    };
  });
}
// 关键词命中（启发式：课1错概念题面 bigram 在课2 prompt/老师话术中的出现计数）
function keywordHits(haystack, tokens) {
  const hits = {};
  for (const t of tokens || []) {
    if (!t) continue;
    let n = 0, idx = 0;
    const h = String(haystack || '');
    while ((idx = h.indexOf(t, idx)) !== -1) { n++; idx += t.length; }
    if (n > 0) hits[t] = n;
  }
  return hits;
}
// 从题面取内容词（去常见虚词的 2-gram，取频次最高的前 8 个）
function questionTokens(question) {
  const stop = new Set(['下列', '说法', '正确', '关于', '什么', '哪种', '哪一', '这一', '的是', '我们', '老师', '下面', '选项', '判断', '错误', '不正']);
  const q = String(question || '').replace(/[*#>`~|。，、！？：；（）()\s]/g, '');
  const counts = new Map();
  for (let i = 0; i < q.length - 1; i++) {
    const bg = q.slice(i, i + 2);
    if (stop.has(bg)) continue;
    counts.set(bg, (counts.get(bg) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
}

// ── 账号 / 路径 / 开课（改造自 run-round1-api.mjs:166-246）─────────────────
async function ensureAccount(ctx, state) {
  if (state.account?.name) {
    const login = await api(ctx, 'POST', '/api/auth/login', { name: state.account.name, password: PASSWORD, remember: true }, { timeout: 60000 });
    ctx.cookie = (login.__setCookie || '').split(';')[0];
    if (!ctx.cookie) throw new Error('重登未返回 cookie');
    log(ctx, `复用账号 name=${state.account.name} userId=${state.account.userId}`);
    return state.account;
  }
  const name = `seq-r2-a${rand(5)}`;
  const reg = await api(ctx, 'POST', '/api/auth/register', { name, password: PASSWORD, remember: true }, { timeout: 60000 });
  const login = await api(ctx, 'POST', '/api/auth/login', { name, password: PASSWORD, remember: true }, { timeout: 60000 });
  ctx.cookie = (login.__setCookie || '').split(';')[0];
  if (!ctx.cookie) throw new Error('login 未返回 cookie');
  const d = reg?.data || {};
  const userId = d?.user?.id || d?.id || d?.userId || null;
  const email = d?.user?.email || d?.email || `${name}@wenflow.local`;
  state.account = { name, userId, email, registeredAt: new Date().toISOString() };
  log(ctx, `账号就绪 name=${name} userId=${userId} email=${email}`);
  return state.account;
}

async function generatePath(ctx, state) {
  if (state.pathId) { log(ctx, `复用 path=${state.pathId}`); return state.pathId; }
  const t0 = Date.now();
  const body = { description: GOAL_TEXT, subject: '生物', userProfile: { learningGoal: GOAL_TEXT, timePerDay: '30分钟' } };
  const r = await api(ctx, 'POST', '/api/learning/paths/generate', body, { timeout: 600000 });
  const d = r?.data || {};
  const pathId = d?.path?.id || d?.id || null;
  log(ctx, `路径生成完成 pathId=${pathId} 耗时=${Math.round((Date.now() - t0) / 1000)}s`);
  if (!pathId) throw new Error('paths/generate 响应中无 pathId: ' + clip(JSON.stringify(d), 300));
  state.pathId = pathId;
  return pathId;
}

// 轮询 detail 直至前 N 个任务出现（milestones[].subtasks，响应形状同 R1 pickFirstTask 实测）
async function waitForTasks(ctx, pathId, minCount, capMs = 12 * 60000) {
  const t0 = Date.now();
  let lastLog = 0;
  while (Date.now() - t0 < capMs) {
    const r = await api(ctx, 'GET', `/api/learning/paths/${pathId}`, undefined, { timeout: 60000, retries: 1 });
    const pd = r?.data || {};
    const groups = pd.milestones || pd.stages || [];
    const tasks = groups
      .flatMap((s) => (s.subtasks || []).map((t) => ({ id: t.id, title: t.title, status: t.status, taskType: t.taskType, stageNumber: s.stageNumber })))
      .filter((t) => t.stageNumber === 1);
    if (tasks.length >= minCount) {
      log(ctx, `任务就绪（前 ${minCount}）：${tasks.slice(0, minCount).map((t) => `${t.id}「${clip(t.title, 24)}」${t.status}`).join(' | ')}（等待 ${Math.round((Date.now() - t0) / 1000)}s）`);
      return tasks;
    }
    if (Date.now() - lastLog > 60000) {
      log(ctx, `  任务后台 stageDesign 生成中（当前 stage1 任务 ${tasks.length}/${minCount}），继续等待…`);
      lastLog = Date.now();
    }
    await sleep(20000);
  }
  throw new Error(`等待 ${Math.round(capMs / 60000)} 分钟 stage1 任务仍不足 ${minCount} 个`);
}

async function startSession(ctx, taskId, rec) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await api(ctx, 'POST', `/api/ai-teaching/tasks/${taskId}/session`, {}, { timeout: 300000, retries: 1 });
      const d = r?.data || {};
      if (d.mode === 'completed') throw new Error('任务已完成');
      if (!d.sessionId) throw new Error('开课响应无 sessionId: ' + clip(JSON.stringify(d), 200));
      ctx.revision = Number(d.revision ?? 0);
      log(ctx, `开课成功 session=${d.sessionId} mode=${d.mode} revision=${ctx.revision} welcome=${clip(d.welcomeMessage, 80)}`);
      rec.openResponse = { sessionId: d.sessionId, mode: d.mode ?? null, revision: d.revision ?? null, knowledgePoints: d.knowledgePoints ?? null, welcomeHead: clip(d.welcomeMessage, 300) };
      return d;
    } catch (e) {
      if (/准备中|备课|409|生成中/i.test(String(e?.message)) && i < 5) {
        log(ctx, `  备课未就绪，45s 后重试 ${i + 1}/6`);
        await sleep(45000);
        continue;
      }
      throw e;
    }
  }
  throw new Error('开课重试 6 次仍失败');
}

async function startReviewSession(ctx, taskId, rec) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await api(ctx, 'POST', '/api/ai-teaching/review/sessions', { taskId }, { timeout: 300000, retries: 1 });
      const d = r?.data || {};
      if (!d.sessionId) throw new Error('复习课响应无 sessionId: ' + clip(JSON.stringify(d), 200));
      ctx.revision = Number(d.revision ?? 0);
      log(ctx, `复习课开课成功 session=${d.sessionId} mode=${d.mode} revision=${ctx.revision}`);
      rec.openResponse = { sessionId: d.sessionId, mode: d.mode ?? null, revision: d.revision ?? null, knowledgePoints: d.knowledgePoints ?? null, welcomeHead: clip(d.welcomeMessage, 400), opening: d.opening ?? null, scene: d.scene ?? null, modeFieldNote: "开课响应 mode 为 SessionResumeMode（teaching-session-lifecycle.ts:542 恒 'new'），课堂模式看 DB teaching_sessions.mode（:347 mode: input.mode）与 scene.kind" };
      return d;
    } catch (e) {
      if (/准备中|备课|生成中/i.test(String(e?.message)) && i < 3) {
        log(ctx, `  备课未就绪，45s 后重试 ${i + 1}/4`);
        await sleep(45000);
        continue;
      }
      throw e;
    }
  }
  throw new Error('复习课开课重试 4 次仍失败');
}

// ── 课堂回合 / 检查点（同 R1）────────────────────────────────────────────
async function sendTurn(ctx, sessionId, message) {
  const r = await api(ctx, 'POST', `/api/ai-teaching/sessions/${sessionId}/messages`, { message, revision: ctx.revision });
  const d = r?.data || {};
  if (typeof d.revision === 'number') ctx.revision = d.revision;
  if (d.aiResponse) { ctx.prevTeacher = ctx.lastTeacher; ctx.lastTeacher = String(d.aiResponse); }
  return d;
}
async function currentPending(ctx, sessionId) {
  try {
    const det = await api(ctx, 'GET', `/api/ai-teaching/sessions/${sessionId}/detail`, undefined, { timeout: 60000, retries: 1 });
    return det?.data?.pendingCheckpoint || null;
  } catch (e) {
    log(ctx, `  detail 读取失败（按无 pending 处理）: ${clip(e?.message, 120)}`);
    return null;
  }
}
async function submitCp(ctx, sessionId, cpId, payload) {
  const r = await api(ctx, 'POST', `/api/ai-teaching/sessions/${sessionId}/checkpoints/${cpId}/submit`, { ...payload, revision: ctx.revision });
  const d = r?.data || {};
  if (typeof d.revision === 'number') ctx.revision = d.revision;
  return d;
}

// ── 作答策略（判定器契约同 R1：file:line 见 run-round1-api.mjs:20-24）────
const stripMarks = (s) => String(s ?? '').replace(/[*#>`~|]/g, '');
function bigrams(s) {
  const t = stripMarks(s);
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function overlap(a, b) {
  const A = bigrams(a); const B = bigrams(b);
  if (A.size === 0) return 0;
  let n = 0; A.forEach((x) => { if (B.has(x)) n++; });
  return n / A.size;
}
function splitSentences(s) {
  return stripMarks(s).split(/(?<=[。！？!?])/).map((x) => x.trim()).filter(Boolean);
}
const ctxLast = () => String(globalThis.__seqctx?.lastTeacher || '');
const ctxPrev = () => String(globalThis.__seqctx?.prevTeacher || '');
function buildEchoAnswer(cp) {
  const q = stripMarks(cp?.question || cp?.title || '');
  const sentences = splitSentences(ctxLast());
  const scored = sentences.map((s) => ({ s, score: overlap(s, q) })).sort((a, b) => b.score - a.score);
  const picked = []; let len = 0;
  for (const { s } of scored) {
    if (s.length < 6 || len + s.length > 560) continue;
    picked.push(s); len += s.length;
    if (picked.length >= 5) break;
  }
  if (picked.length === 0 && ctxLast()) picked.push(clip(ctxLast(), 400));
  return '我照老师刚才讲的复述一遍：' + picked.join('') + (picked.join('').trim().endsWith('。') ? '' : '。');
}
function buildDumpAnswer() {
  const last = ctxLast(); const prev = ctxPrev();
  return '我重新说一遍我的理解：' + clip(last, 400) + (prev ? '。前面老师还讲过：' + clip(prev, 200) : '');
}
const WRONG_SHORT_ANSWERS = [
  '这一题我还没想好。脑子里只有个大概印象，具体说法我记不准了，老师能再带我把这块捋一遍吗？',
  '这题我答不上来。刚才听的时候感觉是懂的，现在让自己说又讲不出个所以然，还是请老师再讲一遍吧。',
];
function rankOptions(cp) {
  const q = stripMarks(cp?.question || cp?.title || '');
  const taught = (ctxLast() + '。' + ctxPrev()).slice(-1200);
  const OUT_VERBS = /送出|放出|排出|呼出|释放|散失|输出|排出去/;
  const IN_VERBS = /吸进|吸入|吸收|摄入|用掉|消耗|进来|从土壤|从空气/;
  const outAsk = OUT_VERBS.test(q), inAsk = IN_VERBS.test(q);
  const opts = (cp?.options || []).map((o) => {
    const text = o.text || o.content || '';
    let score = overlap(text, q) + overlap(text, taught);
    if (outAsk && OUT_VERBS.test(text)) score += 0.9;
    if (outAsk && IN_VERBS.test(text)) score -= 0.9;
    if (inAsk && IN_VERBS.test(text)) score += 0.9;
    if (inAsk && OUT_VERBS.test(text)) score -= 0.9;
    return { id: o.id, text, score };
  });
  return opts.sort((a, b) => b.score - a.score);
}
async function confirmChatBeforeChoiceSubmit(ctx, sessionId, cp) {
  ctx.hintedOptionId = null;
  const message = '老师这道题我拿不准，您直接告诉我选哪个（回我一个字母就行，比如「选B」），再讲一遍为什么，我照着理解作答。';
  await sleep(TURN_SLEEP_MS);
  const d = await sendTurn(ctx, sessionId, message);
  const reply = String(d?.aiResponse || '');
  const ids = (cp.options || []).map((o) => String(o.id || '').trim().toUpperCase()).filter(Boolean);
  // 宽解析：选X / 答案X / 选X项 / 选项X / 独立字母 token
  let letter = '';
  const m1 = reply.match(/选[择取得是应]?\s*([A-Da-d])\b|答案\s*[:：是为]?\s*([A-Da-d])\b|选项\s*[:：]?\s*([A-Da-d])\b|([A-Da-d])\s*项/);
  if (m1) letter = (m1[1] || m1[2] || m1[3] || m1[4] || '').toUpperCase();
  if (!letter) {
    const m2 = reply.match(/\b([A-Da-d])\b/);
    if (m2) letter = m2[1].toUpperCase();
  }
  if (letter && ids.includes(letter)) {
    ctx.hintedOptionId = (cp.options || []).find((o) => String(o.id).trim().toUpperCase() === letter)?.id || null;
  }
  const sentences = splitSentences(reply);
  if (sentences.length > 1) ctx.lastTeacher = sentences.slice(1).join('');
  log(ctx, `  确认聊天已发，老师点名=${ctx.hintedOptionId || '(未识别)'}，回复头=${clip(reply, 80)}`);
  return d;
}
async function answerCheckpointRight(ctx, sessionId, cp, { strongFirst = false } = {}) {
  const cpId = cp.id;
  const log1 = [];
  if (cp.type !== 'short_answer' && !strongFirst) {
    try { await confirmChatBeforeChoiceSubmit(ctx, sessionId, cp); } catch (e) { log(ctx, `  确认聊天失败（继续作答）: ${clip(e?.message, 100)}`); }
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await sleep(TURN_SLEEP_MS + Math.floor(Math.random() * 2000));
    const strategy = strongFirst || attempt === 2 ? 'dump' : 'echo';
    let payload;
    if (cp.type === 'short_answer') payload = { answerText: strongFirst || attempt === 2 ? buildDumpAnswer() : buildEchoAnswer(cp) };
    else if (ctx.hintedOptionId) payload = { selectedOptionIds: [ctx.hintedOptionId] };
    else {
      const ranked = rankOptions(cp);
      if (ranked.length === 0) { log1.push({ attempt, strategy, error: '无选项' }); break; }
      const pick = cp.type === 'multi_choice'
        ? ranked.slice(0, 2).map((o) => o.id)
        : [ranked[Math.min(attempt - 1, ranked.length - 1)].id];
      payload = { selectedOptionIds: pick };
    }
    const d = await submitCp(ctx, sessionId, cpId, payload);
    const passed = d?.passed === true;
    log1.push({ attempt, strategy, passed, nextAction: d?.nextAction || null, feedback: clip(d?.feedback, 120) });
    log(ctx, `  作答提交#${attempt} [${strategy}] passed=${passed} nextAction=${d?.nextAction}`);
    if (passed) return { passed: true, submitLog: log1 };
    if (strongFirst) break;
  }
  return { passed: false, submitLog: log1 };
}

// 故意答错（两次）：短答用与要点无关的自然话术；选择题取重叠度升序最不像对的，
// 仅 2 个选项时同一最差选项交两次（防第 2 发踩中正确项）。
async function deliberatelyFail(ctx, sessionId, cp, rec, tag) {
  const wrongPayloads = [];
  if (cp.type === 'short_answer') {
    wrongPayloads.push({ answerText: WRONG_SHORT_ANSWERS[0] }, { answerText: WRONG_SHORT_ANSWERS[1] });
  } else {
    const rankedAsc = rankOptions(cp).slice().reverse();
    if (rankedAsc.length >= 3) wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] }, { selectedOptionIds: [rankedAsc[1].id] });
    else {
      if (rankedAsc.length >= 1) wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] });
      if (rankedAsc.length >= 2) wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] }); // 2 选项：同一最差选项×2
    }
  }
  const exp = { phase: tag, checkpointId: cp.id, type: cp.type, question: clip(cp.question || cp.title, 160), attempts: [] };
  for (let a = 0; a < Math.min(2, wrongPayloads.length); a++) {
    await sleep(TURN_SLEEP_MS);
    const payload = wrongPayloads[a];
    const d = await submitCp(ctx, sessionId, cp.id, payload);
    const row = { attempt: a + 1, payloadKind: payload.answerText ? 'answerText' : 'selectedOptionIds', payloadExcerpt: payload.answerText ? clip(payload.answerText, 60) : payload.selectedOptionIds, passed: d?.passed === true, nextAction: d?.nextAction || null, feedbackHead: clip(d?.feedback, 100) };
    exp.attempts.push(row);
    log(ctx, `  故意错答#${a + 1} passed=${row.passed} nextAction=${row.nextAction}`);
    if (d?.passed === true) { exp.note = `第 ${a + 1} 次错答被误判对——本题做不了 cap 实验`; rec.checkpoints.push(exp); return { failed: false, exp }; }
  }
  const still = await currentPending(ctx, sessionId);
  exp.pendingAfterTwoWrongs = still?.id === cp.id ? 'still-pending' : 'consumed';
  log(ctx, `  两次错答后 pending=${exp.pendingAfterTwoWrongs}（期望 consumed=attempts_exhausted）`);
  rec.checkpoints.push(exp);
  return { failed: exp.pendingAfterTwoWrongs === 'consumed', exp };
}

async function clearPendingBeforeFinalize(ctx, sessionId) {
  for (let i = 0; i < 3; i++) {
    const pending = await currentPending(ctx, sessionId);
    if (!pending) return { cleaned: true, tries: i, log: [] };
    log(ctx, `  收尾前发现挂起检查点 ${pending.id}（${pending.type}），强答清理`);
    const log1 = [];
    let passed = false;
    for (let attempt = 1; attempt <= 2 && !passed; attempt++) {
      if (attempt > 1) await sleep(TURN_SLEEP_MS);
      let payload;
      if (pending.type === 'short_answer') {
        payload = { answerText: attempt === 1 ? buildDumpAnswer() : '我再把老师讲的重点原样背一遍：' + clip(ctxLast(), 450) + '。' + clip(ctxPrev(), 150) };
      } else {
        const ranked = rankOptions(pending);
        if (ranked.length === 0) break;
        if (pending.type === 'multi_choice') payload = { selectedOptionIds: ranked.slice(0, 2).map((o) => o.id) };
        else payload = { selectedOptionIds: [ranked[Math.min(attempt - 1, ranked.length - 1)].id] };
      }
      const d = await submitCp(ctx, sessionId, pending.id, payload);
      passed = d?.passed === true;
      log1.push({ checkpointId: pending.id, attempt, passed });
      log(ctx, `  清理提交#${attempt} passed=${passed}`);
    }
    return { cleaned: passed, tries: i + log1.length, log: log1 };
  }
  return { cleaned: true, tries: 3, log: [] };
}

async function finalizeAndSettle(ctx, sessionId, action, reason) {
  const key = `mv-seq-r2-${ctx.id}-${rand(8)}`;
  const body = { action, revision: ctx.revision, actualMinutes: 25, subjectiveDifficulty: 3 };
  if (reason) body.reason = reason;
  const post = await api(ctx, 'POST', `/api/ai-teaching/sessions/${sessionId}/finalize`, body, { idempotencyKey: key, timeout: 300000 });
  const out = { idempotencyKey: key, postStatus: post?.data?.status || 'unknown' };
  log(ctx, `finalize 已提交 action=${action} key=${key} status=${out.postStatus}`);
  const deadline = Date.now() + FINALIZE_POLL_CAP_MS;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(FINALIZE_POLL_MS);
    try {
      last = await api(ctx, 'GET', `/api/ai-teaching/sessions/${sessionId}/finalization`, undefined, { timeout: 60000, retries: 1 });
    } catch (e) {
      out.pollErrors = out.pollErrors || [];
      out.pollErrors.push(clip(e?.message, 150));
      continue;
    }
    const st = String(last?.data?.status || '');
    if (st && !['processing', 'pending'].includes(st)) break;
  }
  out.finalStatus = String(last?.data?.status || 'poll-timeout');
  const fd = last?.data || {};
  out.endSummaryAsIs = {
    status: fd.status ?? null,
    topicSummaryLen: String(fd.summary?.topicSummary || '').length,
    actionPlanLen: Array.isArray(fd.actionPlan) ? fd.actionPlan.length : null,
    taskCompletion: fd.finalization?.taskCompletion || fd.taskCompletion || null,
    reviewCompletion: fd.finalization?.reviewCompletion || fd.reviewCompletion || null,
  };
  log(ctx, `finalization settled: status=${out.finalStatus}`);
  return out;
}

// 课堂推进至检查点（回应合带检查点立即返回）
// 学生驾驶器 v2（首跑教训 2026-10-06：任务漂到「无机物/有机物」题族时，固定光合/呼吸话术
// 与课题错位 → understanding 崩到 0.1、12 轮无检查点。R1 实证出题门 understanding≥0.6，
// 过门靠答对老师当前的问题，故话术按老师上条消息的主题自适应分库。）
const BANK_ORGANIC = [
  '我先猜：米饭应该算有机物——它来自水稻，是生命产出的、含碳的；二氧化碳虽然跟生命活动关系密切，但课本里它归无机物。我理解得对吗？',
  '我总结一下判断方法：含碳的、跟生命活动有关的（糖类、蛋白质、油脂这类，像米饭、牛奶、鸡蛋）是有机物；水、无机盐、二氧化碳、氧气这些是无机物。这样分对吗？',
  '我再交一个自己的观察：面包放久了会长霉，霉菌把面包分解掉——面包是有机物所以能被生命分解利用，石块就不会被分解。所以「能不能被生命分解利用」也是一条判断线索？',
  '燃烧法我是这么理解的：有机物燃烧后会生成二氧化碳和水，说明它含碳；无机物一般烧不出这个。所以鉴别一块东西是不是有机物，可以用燃烧的办法。对吗？',
  '把这条线接到光合作用上：光合作用把无机物（二氧化碳和水）合成有机物（淀粉等），呼吸作用再把有机物分解回二氧化碳和水——两个过程正好是无机物和有机物的相互转化。我理解得对吗？',
];
const BANK_PHOTOSYNTHESIS = [
  '我先复述一遍：绿色植物通过光能，在叶绿体里把二氧化碳和水合成储存能量的有机物（比如淀粉），并释放出氧气。原料是二氧化碳和水，条件是光和叶绿体，产物是有机物和氧气。我理解得对吗？',
  '我交一个自己的观察：我见过阳台的绿萝，放窗边就长得旺，挪到背光处就发黄。我当时的解释是：有光的时候它在「攒」东西（制造养分），没光就只能「耗」。这样理解对吗？',
  '我再补一个：绿豆芽不见光是黄白色的，见光后变绿开始长。所以有没有光，决定的是「造」这一半能不能发生，对吗？',
  '我用一句话总结：光下面「造>耗」植物就长；黑暗里只有「耗」。所以地窖里的菜放几天会蔫——一直在耗，没在造。对吗？',
];
const BANK_RESPIRATION = [
  '呼吸作用我这么理解：细胞利用氧气，把有机物分解成二氧化碳和水，同时释放出能量供生命活动利用，场所主要在线粒体。它不分白天黑夜都在进行。我理解得对吗？',
  '我把两个过程连起来看：光合作用制造有机物、储存能量；呼吸作用分解有机物、释放能量，两者相互依存。这样理解可以吗？',
];
const BANK_CELL = [
  '我答这个小问题：根埋在土里见不到光，所以根细胞里**没有**叶绿体；叶绿体在能见到光、会发绿的地方，比如叶肉细胞。线粒体不管见不见光都有，根细胞里也有。我理解得对吗？',
  '规律我用一句话记：能见到光、会发绿的地方才有叶绿体；见不到光的地方就没有。所以叶子有、根没有，茎见光的部分有。对吗？',
  '上节我就在这儿卡过：我把「哪里有叶绿体」和「光合怎么进行」混在一起了。现在分开记——叶绿体是场所（见光的细胞才有），光合是过程（在场所里进行）。对吗？',
];
function pickBank(text) {
  const t = String(text || '');
  // 细胞结构题族最具体（叶绿体/线粒体/细胞结构词面出现即优先），其余按命中数
  if ((t.match(/叶绿体|线粒体|细胞/g) || []).length >= 2) return 'cell';
  const score = {
    organic: (t.match(/有机物|无机物|米饭|牛奶|面包|食物|燃烧/g) || []).length,
    photosynthesis: (t.match(/光合|光能|叶绿体|淀粉|光照/g) || []).length,
    respiration: (t.match(/呼吸|线粒体|分解|释放能量|氧气/g) || []).length,
  };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : 'echo';
}
function nextStudentMessage(ctx, turnNo) {
  if (turnNo === 1) return '老师好，我开始学这个任务了。这部分我课前瞄过一眼但没把握，您带我把这块过一遍吧，我有不懂的马上问您。';
  const bankName = pickBank(ctxLast() + '。' + ctxPrev());
  let msg;
  if (bankName === 'organic') msg = BANK_ORGANIC[(turnNo - 2) % BANK_ORGANIC.length];
  else if (bankName === 'photosynthesis') msg = BANK_PHOTOSYNTHESIS[(turnNo - 2) % BANK_PHOTOSYNTHESIS.length];
  else if (bankName === 'respiration') msg = BANK_RESPIRATION[(turnNo - 2) % BANK_RESPIRATION.length];
  else if (bankName === 'cell') msg = BANK_CELL[(turnNo - 2) % BANK_CELL.length];
  else {
    // 兜底：复述老师上条讲解（R1 实证的 echo 策略）
    const sentences = splitSentences(ctxLast());
    const picked = []; let len = 0;
    for (const s of sentences) {
      if (s.length >= 8 && len + s.length <= 240) { picked.push(s); len += s.length; }
      if (picked.length >= 2) break;
    }
    msg = picked.length
      ? '我跟着老师复述一遍我理解的重点：' + picked.join('') + (picked.join('').trim().endsWith('。') ? '' : '。') + '这样理解对吗？'
      : '老师您考考我吧，我想检验一下这部分掌握得怎么样。';
  }
  // 第 4 轮起每 3 轮夹一次「邀考」，催检查点出现
  if (turnNo >= 4 && (turnNo - 4) % 3 === 0) msg += ' 对了老师，您出个题考考我吧，我想检验一下这块掌握得怎么样。';
  return msg;
}
function studentSay(ctx, salt) { return nextStudentMessage(ctx, Math.abs(salt) + 2); }
async function driveUntilCheckpoint(ctx, sessionId, rec, { maxTurns = 12 } = {}) {
  for (let t = 1; t <= maxTurns; t++) {
    const message = nextStudentMessage(ctx, t);
    await sleep(TURN_SLEEP_MS + Math.floor(Math.random() * 2000));
    const d = await sendTurn(ctx, sessionId, message);
    const entry = {
      turn: t, student: message,
      understanding: d?.analysis?.understanding ?? null,
      aiHead: clip(d?.aiResponse, 200),
      checkpoint: d?.checkpoint ? { id: d.checkpoint.id, type: d.checkpoint.type, allowSkip: d.checkpoint.allowSkip, question: clip(d.checkpoint.question || d.checkpoint.title, 160), options: (d.checkpoint.options || []).map((o) => ({ id: o.id, text: clip(o.text || o.content, 80) })) } : null,
      isCompletion: d?.isCompletion === true,
      revision: ctx.revision,
    };
    rec.turns.push(entry);
    log(ctx, `turn${t}: understanding=${entry.understanding} ckpt=${entry.checkpoint ? `${entry.checkpoint.type}` : 'N'} isCompletion=${entry.isCompletion}`);
    let pending = d?.checkpoint || null;
    if (!pending) pending = await currentPending(ctx, sessionId);
    if (pending) {
      rec.pendingAt = { turn: t, checkpoint: { id: pending.id, type: pending.type, allowSkip: pending.allowSkip, question: clip(pending.question || pending.title, 200), options: (pending.options || []).map((o) => ({ id: o.id, text: clip(o.text || o.content, 80) })) } };
      return pending;
    }
  }
  return null;
}
// best-effort 关课（失败/中断路径用，写只经产品 API）：取权威 revision 后 finalize end_only
async function closeSessionBestEffort(ctx, sessionId, tag) {
  try {
    const det = await api(ctx, 'GET', `/api/ai-teaching/sessions/${sessionId}/detail`, undefined, { timeout: 60000, retries: 1 });
    const rev = det?.data?.revision ?? ctx.revision ?? 0;
    const r = await api(ctx, 'POST', `/api/ai-teaching/sessions/${sessionId}/finalize`,
      { action: 'end_only', revision: rev, reason: 'manual-end' },
      { idempotencyKey: `seq-r2-close-${tag}-${rand(6)}`, timeout: 120000, retries: 1 });
    log(ctx, `  关课（${tag}）end_only -> ${r?.data?.status || r?.status || '?'}`);
    return true;
  } catch (e) {
    log(ctx, `  关课失败（${tag}）: ${clip(e?.message, 120)}`);
    return false;
  }
}

// 课堂中检查点即时处置（答对）
async function answerPendingNow(ctx, sessionId, rec, tag, cpFromResponse) {
  const cp = cpFromResponse || (await currentPending(ctx, sessionId));
  if (!cp) return null;
  await sleep(TURN_SLEEP_MS);
  const r = await answerCheckpointRight(ctx, sessionId, cp, { strongFirst: false });
  rec.checkpoints.push({ phase: tag, checkpointId: cp.id, question: clip(cp.question || cp.title, 120), submitLog: r.submitLog });
  if (!r.passed) {
    rec.notes.push(`${tag}: 检查点 ${cp.id} 两次作答均判错（第 2 错=到顶强消，如实记录）`);
    log(ctx, `  ${tag}: 检查点 ${cp.id} 两次均错，已强消`);
  } else {
    log(ctx, `  ${tag}: 检查点 ${cp.id} 已答对`);
  }
  return cp;
}

// ── 证据行归类 ───────────────────────────────────────────────────────────
function classifyEvidence(evidenceRows) {
  const attempts = evidenceRows.filter((r) => r.evidenceType === 'checkpoint:attempt');
  const results = evidenceRows.filter((r) => r.evidenceType === 'checkpoint:result');
  const reviews = evidenceRows.filter((r) => r.evidenceType === 'review:completed' || r.evidenceType === 'review:warmup');
  return { attempts, results, reviews };
}

// ── 相位实现 ─────────────────────────────────────────────────────────────
async function phaseSetup(ctx, state) {
  await ensureAccount(ctx, state);
  await generatePath(ctx, state);
  saveState(state);
}

// 课1：种弱点
async function phaseA1(ctx, state) {
  const rec = {
    scenarioId: 'seq-a1', channel: 'api', startedAt: new Date().toISOString(), base: BASE, goalText: GOAL_TEXT,
    expectedRows: EXPECTED['seq-a1'], forbiddenRows: FORBIDDEN['seq-a1'],
    turns: [], checkpoints: [], notes: [], errors: [],
  };
  const t0 = Date.now();
  try {
    const tasks = state.tasks?.length >= 1 ? state.tasks : await waitForTasks(ctx, state.pathId, 2);
    state.tasks = tasks; saveState(state);
    const task = tasks[0];
    rec.taskId = task.id; rec.taskTitle = task.title;
    const started = await startSession(ctx, task.id, rec);
    rec.sessionId = started.sessionId;
    state.lesson1 = { taskId: task.id, sessionId: rec.sessionId, startedAt: rec.startedAt }; saveState(state);

    // 第一个检查点：故意两次错答（12 轮未出则再给 8 轮恢复——出题门 understanding≥0.6，
    // 自适应话术需要几轮跟上课题）
    let cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec);
    if (!cp) {
      log(ctx, '前 12 轮无检查点，恢复 8 轮（自适应话术库）');
      cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec, { maxTurns: 8 });
    }
    if (!cp) {
      await closeSessionBestEffort(ctx, rec.sessionId, 'a1-no-checkpoint');
      throw new Error('20 轮内未出现第一个检查点（恢复轮后仍无）——会话已 end_only 关闭');
    }
    rec.checkpoints.push({ phase: 'first-target', ...rec.pendingAt });
    rec.firstCheckpoint = { id: cp.id, type: cp.type, question: clip(cp.question || cp.title, 200) };
    rec.firstCheckpointTokens = questionTokens(cp.question || cp.title);
    log(ctx, `第一个检查点（种弱点目标）：${rec.firstCheckpoint.question}`);
    const fr = await deliberatelyFail(ctx, rec.sessionId, cp, rec, 'deliberate-fail-1');
    rec.deliberateFail = fr.exp;
    if (!fr.failed) {
      rec.notes.push('第一个检查点未能两次错答到顶（被误判对或仍挂起）——种弱点未按剧本落地，如实记录');
    }

    // 其后检查点全部答对 + 讨完课
    for (let t = 1; t <= 6; t++) {
      await sleep(TURN_SLEEP_MS);
      const message = t <= 4 ? studentSay(ctx, t + 10) : '老师，这一部分我感觉掌握得差不多了，帮我结算收尾这一节课吧，剩下的我课后自己练。';
      const d = await sendTurn(ctx, rec.sessionId, message);
      rec.turns.push({ turn: `post-fail-${t}`, student: message, aiHead: clip(d?.aiResponse, 150), checkpoint: d?.checkpoint ? { id: d.checkpoint.id, type: d.checkpoint.type } : null, isCompletion: d?.isCompletion === true });
      log(ctx, `post-fail turn${t}: ckpt=${d?.checkpoint ? 'Y' : 'N'} isCompletion=${d?.isCompletion}`);
      if (d?.checkpoint) await answerPendingNow(ctx, rec.sessionId, rec, `post-fail-turn${t}`, d.checkpoint);
    }
    const clean = await clearPendingBeforeFinalize(ctx, rec.sessionId);
    rec.pendingCleanup = clean;
    rec.finalize = await finalizeAndSettle(ctx, rec.sessionId, 'complete_task', 'task-completed');

    // 课内证据（本会话）
    rec.dbEvidence = await dbAll(
      `SELECT id,evidenceType,eventId,evidenceKey,sessionId,taskId,payload,confidence,occurredAt
       FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt`, [rec.sessionId]);
    for (const e of rec.dbEvidence) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
    rec.dbSession = await dbGet(
      `SELECT id,mode,status,revision,endTime,duration,startTime,knowledgeState,wrapup
       FROM teaching_sessions WHERE id = ?`, [rec.sessionId]);
    rec.status = evaluateA1(rec);
  } catch (e) {
    rec.status = 'failed';
    rec.fatal = clip(e?.message || e, 500);
    log(ctx, `FATAL[a1]: ${clip(e?.stack || e, 600)}`);
    if (rec.sessionId) await closeSessionBestEffort(ctx, rec.sessionId, 'a1-fatal');
    if (rec.sessionId) {
      try {
        rec.dbEvidence = rec.dbEvidence || await dbAll(
          `SELECT id,evidenceType,eventId,evidenceKey,sessionId,taskId,payload,confidence,occurredAt
           FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt`, [rec.sessionId]);
        for (const e of rec.dbEvidence) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
      } catch (e2) { rec.errors.push('post-mortem db read: ' + clip(e2?.message, 150)); }
    }
  } finally {
    rec.finishedAt = new Date().toISOString();
    rec.durationMs = Date.now() - t0;
    fs.writeFileSync(path.join(OUT_DIR, 'seq-a1.result.json'), JSON.stringify(rec, null, 1));
    log(ctx, `[done] seq-a1 status=${rec.status} duration=${Math.round(rec.durationMs / 1000)}s -> out/seq-a1.result.json`);
  }
  return rec;
}

function evaluateA1(rec) {
  const { attempts, results } = classifyEvidence(rec.dbEvidence || []);
  const firstId = rec.firstCheckpoint?.id || null;
  const checks = {};
  checks.exhaustedOnFirst = attempts.some((r) => r.payloadParsed.outcome === 'attempts_exhausted' && r.payloadParsed.attempts === 2 && (!firstId || r.payloadParsed.checkpointId === firstId));
  const falseFirst = results.filter((r) => r.payloadParsed.passed === false && (!firstId || r.payloadParsed.checkpointId === firstId));
  checks.falseResultsOnFirst = falseFirst.length;
  checks.judgedByOfFalse = [...new Set(falseFirst.map((r) => r.payloadParsed.judgedBy || null))];
  checks.passedResultsLater = results.filter((r) => r.payloadParsed.passed === true && (!firstId || r.payloadParsed.checkpointId !== firstId)).length;
  checks.finalizeSettled = rec.finalize?.finalStatus === 'completed';
  rec.actualRows = {
    checkpointAttempt: attempts.map((r) => ({ eventId: r.eventId, outcome: r.payloadParsed.outcome, attempts: r.payloadParsed.attempts, checkpointId: r.payloadParsed.checkpointId })),
    checkpointResult: results.map((r) => ({ eventId: r.eventId, checkpointId: r.payloadParsed.checkpointId, passed: r.payloadParsed.passed, judgedBy: r.payloadParsed.judgedBy })),
  };
  rec.verdicts = checks;
  return checks.exhaustedOnFirst && checks.falseResultsOnFirst >= 2 && checks.passedResultsLater >= 1 && checks.finalizeSettled ? 'done' : 'partial';
}

// 课1 课后基线
async function baselineAfterA1(ctx, state) {
  log(ctx, '采集课1课后基线 out/seq-a1.after.json');
  const snap = await snapshotUserState(state.account.userId, 'after-a1');
  // 课1 会话核对面
  const weak = [];
  const l1 = snap.sessions.find((s) => s.id === state.lesson1?.sessionId);
  if (l1?.knowledgeBoard && Array.isArray(l1.knowledgeBoard)) {
    for (const p of l1.knowledgeBoard) {
      if (p.status !== 'mastered') weak.push({ name: p.name, status: p.status, progress: p.progress });
    }
  }
  snap.lesson1WeakPoints = weak;
  snap.firstCheckpoint = { question: state.firstCheckpoint?.question || null, tokens: state.firstCheckpoint?.tokens || [] };
  fs.writeFileSync(path.join(OUT_DIR, 'seq-a1.after.json'), JSON.stringify(snap, null, 1));
  log(ctx, `基线落盘：memoryTraces=${snap.memoryTraces.length} ledger=${snap.misconceptionLedger.length} projections=${snap.learnerProjections.length} metrics=${snap.learningMetrics.length} predictions=${snap.predictionRecords.length} evidence=${snap.evidence.length}`);
  return snap;
}

// 课2：看注入
async function phaseA2(ctx, state) {
  const rec = {
    scenarioId: 'seq-a2', channel: 'api', startedAt: new Date().toISOString(), base: BASE, goalText: GOAL_TEXT,
    expectedRows: EXPECTED['seq-a2'], forbiddenRows: FORBIDDEN['seq-a2'],
    turns: [], checkpoints: [], notes: [], errors: [],
  };
  const t0 = Date.now();
  try {
    // 同 path 下一任务（stage1 第 2 个）
    const tasks = state.tasks?.length >= 2 ? state.tasks : await waitForTasks(ctx, state.pathId, 2);
    const task = tasks[1];
    rec.taskId = task.id; rec.taskTitle = task.title;
    rec.lesson1Link = { sessionId: state.lesson1?.sessionId || null, taskId: state.lesson1?.taskId || null, firstCheckpoint: state.firstCheckpoint || null };
    const startedAtMs = Date.now();
    const started = await startSession(ctx, task.id, rec);
    rec.sessionId = started.sessionId;
    state.lesson2 = { taskId: task.id, sessionId: rec.sessionId, startedAt: rec.startedAt }; saveState(state);

    // 开课窗取证：等 prompt 落库（telemetry-writer 异步）再读 opening+首回合的 prompt_call_logs
    await sleep(TURN_SLEEP_MS);
    // 首回合（学生开口）
    await sleep(TURN_SLEEP_MS);
    const msg1 = nextStudentMessage(ctx, 1);
    const d1 = await sendTurn(ctx, rec.sessionId, msg1);
    rec.turns.push({ turn: 1, student: msg1, aiHead: clip(d1?.aiResponse, 220), checkpoint: d1?.checkpoint ? { id: d1.checkpoint.id, type: d1.checkpoint.type } : null, understanding: d1?.analysis?.understanding ?? null });
    await sleep(8000); // 等 prompt_call_logs 异步落库
    const prompts = await fetchPromptLogs(state.account.userId, startedAtMs - 5000, Date.now());
    rec.openWindowPrompts = prompts.map((p) => ({ id: p.id, agentId: p.agentId, createdAt: p.createdAt, payloadLen: p.payloadLen, sections: p.sections }));
    // 结构段判定
    const hasSection = (key) => prompts.some((p) => p.sections.some((s) => s.key === key));
    rec.sectionPresence = {
      memoryWarmup: hasSection('memoryWarmup'),
      priorMisconceptions: hasSection('priorMisconceptions'),
      lastLessonRecap: hasSection('lastLessonRecap'),
      temporalGap: hasSection('temporalGap'),
      successBand: hasSection('successBand'),
    };
    log(ctx, `开课窗结构段：${JSON.stringify(rec.sectionPresence)}`);
    // 课1错概念关键词跨课命中（启发式 + 看板点名双口径）
    const tokens = state.firstCheckpoint?.tokens || [];
    const weakNames = (state.weakPointNames || []);
    const anchors = [...new Set([...weakNames, ...tokens])];
    const promptText = (await dbAll(
      `SELECT userPayload FROM prompt_call_logs WHERE userId = ? AND createdAt >= ? AND createdAt <= ?`,
      [state.account.userId, startedAtMs - 5000, Date.now()]
    )).map((r) => r.userPayload || '').join('\n');
    rec.oldConceptInPrompt = { anchors, promptHit: keywordHits(promptText, anchors) };
    // 老师是否先带回旧概念（welcome + 已有回合话术）
    const teacherText = [rec.openResponse?.welcomeHead, ...rec.turns.map((t) => t.aiHead)].join('\n');
    rec.oldConceptInTeacherTalk = { hit: keywordHits(teacherText, anchors), excerptHead: clip(teacherText, 300) };
    log(ctx, `课1错概念锚点命中 prompt=${JSON.stringify(rec.oldConceptInPrompt.promptHit)} 老师话术=${JSON.stringify(rec.oldConceptInTeacherTalk.hit)}`);

    // 首回合若带检查点，立即答对
    if (d1?.checkpoint) await answerPendingNow(ctx, rec.sessionId, rec, 'turn1', d1.checkpoint);

    // 继续课堂：全部答对 + 讨完课
    let cp = await currentPending(ctx, rec.sessionId);
    if (cp) await answerPendingNow(ctx, rec.sessionId, rec, 'post-open');
    for (let t = 2; t <= 9; t++) {
      await sleep(TURN_SLEEP_MS);
      const message = t <= 6 ? studentSay(ctx, t + 5) : '老师，这块我复习/掌握得差不多了，帮我结算收尾这一节课吧。';
      const d = await sendTurn(ctx, rec.sessionId, message);
      rec.turns.push({ turn: t, student: message, aiHead: clip(d?.aiResponse, 150), checkpoint: d?.checkpoint ? { id: d.checkpoint.id, type: d.checkpoint.type } : null, isCompletion: d?.isCompletion === true });
      log(ctx, `turn${t}: ckpt=${d?.checkpoint ? 'Y' : 'N'} isCompletion=${d?.isCompletion}`);
      if (d?.checkpoint) await answerPendingNow(ctx, rec.sessionId, rec, `turn${t}`, d.checkpoint);
    }
    const clean = await clearPendingBeforeFinalize(ctx, rec.sessionId);
    rec.pendingCleanup = clean;
    rec.finalize = await finalizeAndSettle(ctx, rec.sessionId, 'complete_task', 'task-completed');

    rec.dbEvidence = await dbAll(
      `SELECT id,evidenceType,eventId,evidenceKey,sessionId,taskId,payload,confidence,occurredAt
       FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt`, [rec.sessionId]);
    for (const e of rec.dbEvidence) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
    rec.dbSession = await dbGet(
      `SELECT id,mode,status,revision,endTime,duration,startTime,knowledgeState,wrapup
       FROM teaching_sessions WHERE id = ?`, [rec.sessionId]);
    rec.status = evaluateA2(rec);
  } catch (e) {
    rec.status = 'failed';
    rec.fatal = clip(e?.message || e, 500);
    log(ctx, `FATAL[a2]: ${clip(e?.stack || e, 600)}`);
    if (rec.sessionId) await closeSessionBestEffort(ctx, rec.sessionId, 'a2-fatal');
    if (rec.sessionId) {
      try {
        rec.dbEvidence = rec.dbEvidence || await dbAll(
          `SELECT id,evidenceType,eventId,evidenceKey,sessionId,taskId,payload,confidence,occurredAt
           FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt`, [rec.sessionId]);
        for (const e of rec.dbEvidence) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
      } catch (e2) { rec.errors.push('post-mortem db read: ' + clip(e2?.message, 150)); }
    }
  } finally {
    rec.finishedAt = new Date().toISOString();
    rec.durationMs = Date.now() - t0;
    fs.writeFileSync(path.join(OUT_DIR, 'seq-a2.result.json'), JSON.stringify(rec, null, 1));
    log(ctx, `[done] seq-a2 status=${rec.status} duration=${Math.round(rec.durationMs / 1000)}s -> out/seq-a2.result.json`);
  }
  return rec;
}

function evaluateA2(rec) {
  const { results } = classifyEvidence(rec.dbEvidence || []);
  const checks = {};
  checks.openPromptHasRecapOrWarmup = rec.sectionPresence?.lastLessonRecap === true || rec.sectionPresence?.memoryWarmup === true;
  checks.sectionPresence = rec.sectionPresence || null;
  checks.priorMisconceptionsInjected = rec.sectionPresence?.priorMisconceptions === true;
  checks.oldConceptAnchoredInPrompt = Object.keys(rec.oldConceptInPrompt?.promptHit || {}).length > 0;
  checks.teacherBroughtBackOldConcept = Object.keys(rec.oldConceptInTeacherTalk?.hit || {}).length > 0;
  checks.passedResults = results.filter((r) => r.payloadParsed.passed === true).length;
  checks.finalizeSettled = rec.finalize?.finalStatus === 'completed';
  rec.actualRows = {
    checkpointResult: (rec.dbEvidence || []).filter((r) => r.evidenceType === 'checkpoint:result').map((r) => ({ checkpointId: r.payloadParsed.checkpointId, passed: r.payloadParsed.passed, judgedBy: r.payloadParsed.judgedBy })),
    promptSections: rec.openWindowPrompts?.map((p) => ({ agentId: p.agentId, sections: p.sections.map((s) => s.key + '@' + s.path) })) || [],
  };
  rec.verdicts = checks;
  return checks.openPromptHasRecapOrWarmup && checks.passedResults >= 1 && checks.finalizeSettled ? 'done' : 'partial';
}

// 课2 课后对比取证
async function baselineAfterA2(ctx, state) {
  log(ctx, '采集课2课后对比 out/seq-a2.after.json');
  const snap = await snapshotUserState(state.account.userId, 'after-a2');
  const before = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'seq-a1.after.json'), 'utf8'));
  // 逐项对照：memory_traces 增量/变化
  const key = (t) => t.conceptKey;
  const b = new Map(before.memoryTraces.map((t) => [key(t), t]));
  const traceComparison = [];
  for (const t of snap.memoryTraces) {
    const prev = b.get(key(t));
    if (!prev) traceComparison.push({ conceptKey: t.conceptKey, change: 'new', masteryScore: t.masteryScore, dueAt: t.dueAt, fsrsStability: t.fsrsStability, ktMasteryEma: t.ktMasteryEma });
    else {
      const diff = {};
      for (const f of ['masteryScore', 'stability', 'fsrsStability', 'fsrsDifficulty', 'fsrsReps', 'fsrsLapses', 'ktMasteryEma', 'dueAt', 'lastSeenAt', 'extractionCount']) {
        if (String(prev[f]) !== String(t[f])) diff[f] = { a1: prev[f] ?? null, a2: t[f] ?? null };
      }
      if (Object.keys(diff).length > 0) traceComparison.push({ conceptKey: t.conceptKey, change: 'updated', diff });
    }
  }
  for (const t of before.memoryTraces) {
    if (!snap.memoryTraces.some((x) => key(x) === key(t))) traceComparison.push({ conceptKey: t.conceptKey, change: 'gone' });
  }
  // EWMA（learning_metrics 末次 vs 末次）
  const lastMetric = (m) => m && m.length ? m[m.length - 1] : null;
  const mA1 = lastMetric(before.learningMetrics); const mA2 = lastMetric(snap.learningMetrics);
  const ewmaDelta = mA1 && mA2 ? {
    a1: { lss: mA1.lss, ktl: mA1.ktl, lf: mA1.lf, lsb: mA1.lsb, recordedAt: mA1.recordedAt },
    a2: { lss: mA2.lss, ktl: mA2.ktl, lf: mA2.lf, lsb: mA2.lsb, recordedAt: mA2.recordedAt },
  } : { a1: mA1, a2: mA2 };
  const comparison = {
    note: 'a1.after → a2.after 逐项对照（同账号同 path，中间仅隔课2）',
    memoryTraces: traceComparison,
    ledgerCount: { a1: before.misconceptionLedger.length, a2: snap.misconceptionLedger.length },
    ledgerNew: snap.misconceptionLedger.filter((l) => !before.misconceptionLedger.some((x) => x.id === l.id)),
    predictionCount: { a1: before.predictionRecords.length, a2: snap.predictionRecords.length },
    predictionsNew: snap.predictionRecords.filter((p) => !before.predictionRecords.some((x) => x.id === p.id)),
    ewma: ewmaDelta,
    evidenceCount: { a1: before.evidence.length, a2: snap.evidence.length },
    sessionBoardA2: (snap.sessions.find((s) => s.id === state.lesson2?.sessionId) || {}).knowledgeBoard ?? null,
    lesson2WarmupItems: state.lesson2WarmupItems || null,
  };
  const out = { ...snap, comparison };
  fs.writeFileSync(path.join(OUT_DIR, 'seq-a2.after.json'), JSON.stringify(out, null, 1));
  log(ctx, `对比落盘：trace 变化 ${traceComparison.length} 条、ledger ${comparison.ledgerCount.a1}→${comparison.ledgerCount.a2}、prediction ${comparison.predictionCount.a1}→${comparison.predictionCount.a2}`);
  return out;
}

// 课3：复习课 + allowDegrade
async function phaseA3(ctx, state) {
  const rec = {
    scenarioId: 'seq-a3', channel: 'api', startedAt: new Date().toISOString(), base: BASE, goalText: GOAL_TEXT,
    expectedRows: EXPECTED['seq-a3'], forbiddenRows: FORBIDDEN['seq-a3'],
    turns: [], checkpoints: [], notes: [], errors: [],
  };
  const t0 = Date.now();
  try {
    // 复习课挂在课1任务（已完成任务——task-completion.service.ts:78 复习课本就作用于已完成任务）
    const taskId = state.lesson1?.taskId;
    if (!taskId) throw new Error('缺课1 taskId');
    rec.taskId = taskId;
    const startedAtMs = Date.now();
    await startReviewSession(ctx, taskId, rec);
    rec.sessionId = rec.openResponse?.sessionId;
    if (!rec.sessionId) throw new Error('复习课无 sessionId');
    state.lesson3 = { taskId, sessionId: rec.sessionId, startedAt: rec.startedAt }; saveState(state);
    // 开课种子板（DB）
    await sleep(4000);
    const sess0 = await dbGet('SELECT id,mode,status,knowledgeState FROM teaching_sessions WHERE id = ?', [rec.sessionId]);
    try { rec.seedBoard = sess0?.knowledgeState ? JSON.parse(sess0.knowledgeState) : null; } catch { rec.seedBoard = 'PARSE_FAIL'; }
    log(ctx, `复习课种子板：${JSON.stringify(rec.seedBoard)?.slice(0, 400)}`);
    rec.boardHistory = [{ at: new Date().toISOString(), when: 'after-open', board: rec.seedBoard }];

    // 推进：第一张检查点答对（把点在会话内抬起来）
    let cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec, { maxTurns: 10 });
    if (cp) {
      rec.checkpoints.push({ phase: 'review-first-answer-right', ...rec.pendingAt });
      await sleep(TURN_SLEEP_MS);
      const r1 = await answerCheckpointRight(ctx, rec.sessionId, cp, { strongFirst: false });
      rec.checkpoints.push({ phase: 'review-first-submit', checkpointId: cp.id, submitLog: r1.submitLog, passed: r1.passed });
      if (!r1.passed) rec.notes.push(`复习课第一张检查点 ${cp.id} 未答对——降级实验的「先抬升」半程证据弱化`);
    } else {
      rec.notes.push('复习课 10 轮内未出现检查点——主动点名师考以诱发');
    }

    // 主动邀考课1错概念（或看板最高点），诱出新检查点后故意答错
    const target = (state.weakPointNames || [])[0] || '光合作用与呼吸作用的原料和产物';
    await sleep(TURN_SLEEP_MS);
    const dinv = await sendTurn(ctx, rec.sessionId, `老师，趁热打铁你直接考我一题：关于「${target}」，我课前其实有点忘了，你出题看看我还记不记得。`);
    rec.turns.push({ turn: 'invite-quiz', student: `老师考我一题：${target}`, aiHead: clip(dinv?.aiResponse, 200), checkpoint: dinv?.checkpoint ? { id: dinv.checkpoint.id, type: dinv.checkpoint.type, question: clip(dinv.checkpoint.question || dinv.checkpoint.title, 160) } : null });
    let targetCp = dinv?.checkpoint || await currentPending(ctx, rec.sessionId);
    if (!targetCp) {
      for (let t = 1; t <= 4 && !targetCp; t++) {
        await sleep(TURN_SLEEP_MS);
        const d = await sendTurn(ctx, rec.sessionId, studentSay(ctx, t + 3));
        rec.turns.push({ turn: `wait-quiz-${t}`, aiHead: clip(d?.aiResponse, 150), checkpoint: d?.checkpoint ? { id: d.checkpoint.id } : null });
        targetCp = d?.checkpoint || await currentPending(ctx, rec.sessionId);
      }
    }
    // 记录答错前板（降级前基线）
    const sessMid = await dbGet('SELECT knowledgeState FROM teaching_sessions WHERE id = ?', [rec.sessionId]);
    let boardMid = null; try { boardMid = sessMid?.knowledgeState ? JSON.parse(sessMid.knowledgeState) : null; } catch {}
    rec.boardHistory.push({ at: new Date().toISOString(), when: 'before-deliberate-fail', board: boardMid });

    if (targetCp) {
      const fr = await deliberatelyFail(ctx, rec.sessionId, targetCp, rec, 'review-deliberate-fail');
      rec.deliberateFail = fr.exp;
      if (!fr.failed) rec.notes.push('复习课故意错答未到顶（被误判对或仍挂起）');
      // 错后 1-2 轮：给模型判定降级的机会
      await sleep(TURN_SLEEP_MS);
      const dAfter = await sendTurn(ctx, rec.sessionId, `这块我真的想不起来了，刚才那题我确实不会，老师再带我把「${target}」讲一遍吧。`);
      rec.turns.push({ turn: 'after-fail', student: '这块我真的想不起来了…再讲一遍', aiHead: clip(dAfter?.aiResponse, 200), checkpoint: dAfter?.checkpoint ? { id: dAfter.checkpoint.id } : null });
      if (dAfter?.checkpoint) await answerPendingNow(ctx, rec.sessionId, rec, 'after-fail', dAfter.checkpoint);
    } else {
      rec.notes.push('复习课未能诱发出可答错的检查点——allowDegrade 降级实验无法执行（如实记录）');
    }
    // 降级后板
    const sessPost = await dbGet('SELECT knowledgeState FROM teaching_sessions WHERE id = ?', [rec.sessionId]);
    let boardPost = null; try { boardPost = sessPost?.knowledgeState ? JSON.parse(sessPost.knowledgeState) : null; } catch {}
    rec.boardHistory.push({ at: new Date().toISOString(), when: 'after-deliberate-fail', board: boardPost });

    // 收尾：complete_review（产品行为 reason=manual-end，V2LearningPage.vue:1474-1476）
    const clean = await clearPendingBeforeFinalize(ctx, rec.sessionId);
    rec.pendingCleanup = clean;
    rec.finalize = await finalizeAndSettle(ctx, rec.sessionId, 'complete_review', 'manual-end');

    // review:completed 证据轮询（durable consumer 异步）
    let reviewEvidence = [];
    for (let i = 0; i < 9; i++) {
      await sleep(10000);
      reviewEvidence = await dbAll(
        `SELECT id,evidenceType,eventId,evidenceKey,payload,confidence,occurredAt
         FROM learner_evidence WHERE sessionId = ? AND evidenceType IN ('review:completed','review:warmup') ORDER BY occurredAt`, [rec.sessionId]);
      if (reviewEvidence.length > 0) break;
    }
    for (const e of reviewEvidence) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
    rec.reviewEvidence = reviewEvidence;
    rec.dbEvidence = await dbAll(
      `SELECT id,evidenceType,eventId,evidenceKey,payload,confidence,occurredAt
       FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt`, [rec.sessionId]);
    for (const e of rec.dbEvidence) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
    rec.dbSession = await dbGet(
      `SELECT id,mode,status,revision,endTime,duration,startTime,knowledgeState,wrapup
       FROM teaching_sessions WHERE id = ?`, [rec.sessionId]);
    try { rec.finalBoard = rec.dbSession?.knowledgeState ? JSON.parse(rec.dbSession.knowledgeState) : null; } catch { rec.finalBoard = 'PARSE_FAIL'; }
    rec.boardHistory.push({ at: new Date().toISOString(), when: 'after-finalize', board: rec.finalBoard });
    // memory_traces 终态（FSRS 回写对照在 summary 阶段做全量 before/after）
    rec.status = evaluateA3(rec, boardMid, boardPost);
  } catch (e) {
    rec.status = 'failed';
    rec.fatal = clip(e?.message || e, 500);
    log(ctx, `FATAL[a3]: ${clip(e?.stack || e, 600)}`);
    if (rec.sessionId) await closeSessionBestEffort(ctx, rec.sessionId, 'a3-fatal');
    if (rec.sessionId) {
      try {
        rec.dbEvidence = rec.dbEvidence || await dbAll(
          `SELECT id,evidenceType,eventId,evidenceKey,payload,confidence,occurredAt
           FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt`, [rec.sessionId]);
        for (const e of rec.dbEvidence) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
      } catch (e2) { rec.errors.push('post-mortem db read: ' + clip(e2?.message, 150)); }
    }
  } finally {
    rec.finishedAt = new Date().toISOString();
    rec.durationMs = Date.now() - t0;
    fs.writeFileSync(path.join(OUT_DIR, 'seq-a3.result.json'), JSON.stringify(rec, null, 1));
    log(ctx, `[done] seq-a3 status=${rec.status} duration=${Math.round(rec.durationMs / 1000)}s -> out/seq-a3.result.json`);
  }
  return rec;
}

function evaluateA3(rec, boardMid, boardPost) {
  const { results, reviews } = classifyEvidence(rec.dbEvidence || []);
  const checks = {};
  checks.openResponseModeAsIs = rec.openResponse?.mode ?? null;
  checks.reviewModeByDb = rec.dbSession?.mode === 'review';
  checks.sceneKind = rec.openResponse?.scene?.kind ?? null;
  // allowDegrade 降级判定：同一概念点，答错前 mastered（或高 progress）→ 答错后 status 降 / progress 降
  const boardOf = (b) => Array.isArray(b) ? b : (Array.isArray(b?.points) ? b.points : []);
  const degrade = [];
  const midMap = new Map(boardOf(boardMid).map((p) => [p.name, p]));
  for (const p of boardOf(boardPost)) {
    const prev = midMap.get(p.name);
    if (!prev) continue;
    const rank = { mastered: 3, learning: 2, review: 1, pending: 0 };
    const down = (rank[prev.status] ?? 0) > (rank[p.status] ?? 0) || (p.status === prev.status && Number(prev.progress) > Number(p.progress));
    if (down) degrade.push({ name: p.name, before: { status: prev.status, progress: prev.progress }, after: { status: p.status, progress: p.progress } });
  }
  checks.degradedPoints = degrade;
  checks.allowDegradeObserved = degrade.length > 0;
  checks.reviewEvidenceCount = reviews.length;
  checks.reviewEvidenceTypes = [...new Set(reviews.map((r) => r.evidenceType))];
  checks.finalizeSettled = rec.finalize?.finalStatus === 'completed';
  checks.wrongAnswerHappened = !!rec.deliberateFail && rec.deliberateFail.attempts?.some((a) => a.passed === false);
  rec.actualRows = {
    checkpointResult: results.map((r) => ({ checkpointId: r.payloadParsed.checkpointId, passed: r.payloadParsed.passed, judgedBy: r.payloadParsed.judgedBy })),
    checkpointAttempt: (rec.dbEvidence || []).filter((r) => r.evidenceType === 'checkpoint:attempt').map((r) => ({ outcome: r.payloadParsed.outcome, checkpointId: r.payloadParsed.checkpointId })),
    reviewEvidence: reviews.map((r) => ({ evidenceType: r.evidenceType, eventId: r.eventId, conceptKey: r.payloadParsed?.conceptKey || r.payloadParsed?.reviewItems?.map((x) => x.conceptKey) || null, rating: r.payloadParsed?.rating || r.payloadParsed?.reviewItems?.map((x) => x.rating) || null, occurredAt: r.occurredAt })),
    degradedPoints: degrade,
    boardTrail: (rec.boardHistory || []).map((h) => ({ when: h.when, board: h.board })),
  };
  rec.verdicts = checks;
  if (checks.reviewModeByDb && checks.finalizeSettled && (checks.reviewEvidenceCount > 0 || checks.allowDegradeObserved)) {
    return checks.wrongAnswerHappened ? (checks.allowDegradeObserved ? 'done' : 'partial') : 'partial';
  }
  return 'partial';
}

// ── 状态持久化（断点续跑）────────────────────────────────────────────────
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return s;
  } catch { return {}; }
}
function saveState(state) {
  const slim = { ...state };
  delete slim.ctxCookieNote;
  fs.writeFileSync(STATE_PATH, JSON.stringify(slim, null, 1));
}

// ── 主流程 ───────────────────────────────────────────────────────────────
async function main() {
  log(null, `=== measurement-verify 第二轮 序列课轨开始 === base=${BASE} phase=${PHASE || '(all)'} force=${FORCE}`);
  const state = loadState();
  const ctx = { id: 'seq', cookie: '', revision: 0, lastTeacher: '', prevTeacher: '' };
  globalThis.__seqctx = ctx;

  const want = (p) => !PHASE || PHASE === p;
  const results = { 'seq-a1': null, 'seq-a2': null, 'seq-a3': null };
  const readResult = (p) => {
    try { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, `seq-${p}.result.json`), 'utf8')); } catch { return null; }
  };

  if (want('a1')) {
    if (!FORCE && ['done', 'partial'].includes(readResult('a1')?.status)) {
      log(null, '[skip] seq-a1 已有结果');
    } else {
      await phaseSetup(ctx, state);
      results['seq-a1'] = await phaseA1(ctx, state);
      // 弱点锚点传递给 a2/a3
      const a1 = results['seq-a1'];
      state.firstCheckpoint = a1.firstCheckpoint ? { id: a1.firstCheckpoint.id, question: a1.firstCheckpoint.question, tokens: a1.firstCheckpointTokens } : null;
      const snap = await baselineAfterA1(ctx, state);
      state.weakPointNames = (snap.lesson1WeakPoints || []).map((w) => w.name);
      saveState(state);
      await sleep(LESSON_GAP_MS);
    }
  }
  results['seq-a1'] = results['seq-a1'] || readResult('a1');

  // 联动门：a2/a3 的实验设计依赖 a1 种下弱点（两次错答到顶）且课已收束（wrapup/记忆回写落库）。
  // a1 没种上就烧 a2/a3 的池子只会产出无效证据——直接停，summary 如实记 missing。
  const a1Rec = results['seq-a1'];
  const a1Planted = a1Rec?.deliberateFail?.pendingAfterTwoWrongs === 'consumed' && a1Rec?.finalize?.finalStatus === 'completed';
  if ((want('a2') || want('a3')) && !a1Planted && !readResult('a2') && !readResult('a3')) {
    log(null, `[gate] a1 未种下弱点（planted=${a1Planted}）——按纪律停跑 a2/a3，汇总只含 a1`);
  }

  if (want('a2') && (a1Planted || readResult('a2'))) {
    if (!FORCE && ['done', 'partial'].includes(readResult('a2')?.status)) {
      log(null, '[skip] seq-a2 已有结果');
    } else {
      await phaseSetup(ctx, state);
      results['seq-a2'] = await phaseA2(ctx, state);
      // 温故计划项转存（供 a2.after 对照）
      state.lesson2WarmupItems = (results['seq-a2'].openWindowPrompts || [])
        .flatMap((p) => p.sections.filter((s) => s.key === 'memoryWarmup').map((s) => s.value?.items || s.value))
        .flat() || null;
      await baselineAfterA2(ctx, state);
      saveState(state);
      await sleep(LESSON_GAP_MS);
    }
  }
  results['seq-a2'] = results['seq-a2'] || readResult('a2');

  const a2Rec = results['seq-a2'];
  const a2Settled = a2Rec?.finalize?.finalStatus === 'completed';
  if (want('a3') && a2Settled) {
    if (!FORCE && ['done', 'partial'].includes(readResult('a3')?.status)) {
      log(null, '[skip] seq-a3 已有结果');
    } else {
      await phaseSetup(ctx, state);
      // FSRS 回写对照的课前快照
      state.beforeA3Traces = (await snapshotUserState(state.account.userId, 'before-a3')).memoryTraces;
      saveState(state);
      results['seq-a3'] = await phaseA3(ctx, state);
      // FSRS 回写对照
      const afterTraces = (await snapshotUserState(state.account.userId, 'after-a3')).memoryTraces;
      const beforeMap = new Map((state.beforeA3Traces || []).map((t) => [t.conceptKey, t]));
      state.fsrsDelta = afterTraces.map((t) => {
        const b = beforeMap.get(t.conceptKey);
        if (!b) return { conceptKey: t.conceptKey, change: 'new', dueAt: t.dueAt, fsrsStability: t.fsrsStability, ktMasteryEma: t.ktMasteryEma, masteryScore: t.masteryScore };
        const diff = {};
        for (const f of ['masteryScore', 'stability', 'fsrsStability', 'fsrsDifficulty', 'fsrsReps', 'fsrsLapses', 'ktMasteryEma', 'dueAt', 'lastSeenAt', 'extractionCount']) {
          if (String(b[f]) !== String(t[f])) diff[f] = { before: b[f] ?? null, after: t[f] ?? null };
        }
        return Object.keys(diff).length ? { conceptKey: t.conceptKey, change: 'updated', diff } : null;
      }).filter(Boolean);
      saveState(state);
      const a3 = results['seq-a3'];
      fs.writeFileSync(path.join(OUT_DIR, 'seq-a3.result.json'), JSON.stringify({ ...a3, memoryTracesDelta: state.fsrsDelta }, null, 1));
    }
  }
  results['seq-a3'] = results['seq-a3'] || readResult('a3');

  // ── 汇总 ──
  const lessons = ['seq-a1', 'seq-a2', 'seq-a3'].map((id) => {
    const r = results[id];
    if (!r) return { scenarioId: id, channel: 'api', status: 'missing', expectedRows: EXPECTED[id], forbiddenRows: FORBIDDEN[id] };
    return {
      scenarioId: id, channel: 'api', status: r.status,
      userId: state.account?.userId || null, accountName: state.account?.name || null,
      sessionId: r.sessionId || null, taskId: r.taskId || null, pathId: state.pathId || null,
      expectedRows: r.expectedRows, forbiddenRows: r.forbiddenRows,
      actualRows: r.actualRows || null, verdicts: r.verdicts || null,
      fatal: r.fatal || null, notes: r.notes || [], durationMs: r.durationMs || null,
      resultFile: `seq-${id.slice(4)}.result.json`.replace('seq-', 'seq-'),
    };
  });
  // 跨课主问题的直接回答素材
  const crossLesson = {
    question: '上一课的数据真的改变下一课吗？',
    evidence: {
      a2OpenWindowSections: results['seq-a2']?.sectionPresence || null,
      a2OldConceptInPrompt: results['seq-a2']?.oldConceptInPrompt || null,
      a2OldConceptInTeacherTalk: results['seq-a2']?.oldConceptInTeacherTalk || null,
      a2ComparisonDigest: readDigest('seq-a2.after.json', ['comparison.ewma', 'comparison.ledgerCount', 'comparison.predictionCount']),
      a3Degrade: results['seq-a3']?.verdicts?.degradedPoints ?? null,
      a3ReviewEvidence: results['seq-a3']?.actualRows?.reviewEvidence ?? null,
      a3MemoryTracesDelta: state.fsrsDelta || null,
    },
  };
  const summary = {
    track: 'seq',
    generatedAt: new Date().toISOString(),
    base: BASE,
    instanceNote: '3011 验证实例；3001 旧实例未触碰；全程单账号 ' + (state.account?.name || '(未注册)'),
    account: state.account,
    pathId: state.pathId || null,
    goalText: GOAL_TEXT,
    accountNamingNote: '任务书 seq-r2-a@test.local 不可注册（auth.ts:147 USERNAME_PATTERN 禁 @/.），实注册 ' + (state.account?.name || '') + '，服务端邮箱 ' + (state.account?.email || ''),
    lessons,
    crossLesson,
    totals: {
      lessons: lessons.length,
      done: lessons.filter((l) => l.status === 'done').length,
      partial: lessons.filter((l) => l.status === 'partial').length,
      failed: lessons.filter((l) => l.status === 'failed').length,
      missing: lessons.filter((l) => l.status === 'missing').length,
    },
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 1));
  log(null, `=== 全部完成 === totals=${JSON.stringify(summary.totals)} summary=${SUMMARY_PATH}`);
}

function readDigest(file, paths) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
    const out = {};
    for (const p of paths) {
      const segs = p.split('.');
      let cur = j;
      for (const s of segs) { cur = cur?.[s]; if (cur === undefined) break; }
      out[p] = cur ?? null;
    }
    return out;
  } catch { return null; }
}

main().catch((e) => {
  log(null, `MAIN-FATAL: ${clip(e?.stack || e, 800)}`);
  process.exitCode = 1;
});
