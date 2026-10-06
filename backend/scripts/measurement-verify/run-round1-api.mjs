// measurement-verify 第一轮 · B 渠道（API 直接驾驶）· H1 四类检查点终局留痕真值受控实验
//
// 四场景串行（会话并发全场 ≤3，这里串行=1）：
//   S1-pass       第一个检查点一次答对 → 3+ 轮 → finalize complete_task
//                 期望 checkpoint:result(passed=true,judgedBy='code')≥1；禁现 checkpoint:attempt
//   S2-skip       第一个可跳过检查点 {skip:true} → 课堂继续 ≥1 轮 → finalize complete_task
//                 期望 checkpoint:attempt{outcome:'skipped'}；允许另有必答卡 checkpoint:result
//   S3-cap        同一检查点连续两次自然错答 → 到顶强消 → 2+ 轮 → finalize complete_task
//                 期望 checkpoint:attempt{outcome:'attempts_exhausted',attempts:2} + checkpoint:result(passed=false)×2
//   S4-unresolved 第一个检查点挂起不作答 → 直接 finalize complete_task → 轮询 settled
//                 期望 checkpoint:attempt{outcome:'unresolved'} + wrapup 落库（endSummary 空否原样记录）
//
// 纪律（测量工作流第一轮铁律）：
//   - 只打 3011 验证实例（含 H1，commit 92379a82）；3001 旧实例不碰
//   - 回合间 sleep 5-10s；429/5xx/池化403(No active subscription) 退避 30s 重试至多 3 次
//   - DB 直读 node:sqlite 只读 + busy_timeout=5000；SELECT 显式列名（teaching_sessions.messages 大列禁选）
//   - 全新测试账号：注册新号，禁碰存量用户/VL
//   - 每场景无论成败 finally 写 out/<ID>.result.json；全程日志 out/api-run.log；汇总 out/round1-api-summary.json
//
// 判定器依据（backend/src/services/ai-teaching/teaching-checkpoint.ts:181-227 judgeCheckpointAnswer）：
//   - 选择题：selectedOptionIds 与 correctOptionIds 归一化集合精确相等才 pass
//   - 简答：expectedKeywords 按「|」拆同义组，归一化（小写+去空白标点）后每组任一写法以子串出现，
//           全部组命中才 pass —— 故「必错=与要点无关的自然回答」「必对=复述老师讲解里的要点句」
//   - 无答案键 → null → 调用方退回模型派生（judgedBy='model-reference'，confidence 0.6）
//
// 用法：cd backend && node scripts/measurement-verify/run-round1-api.mjs [--only=S1-pass] [--force]
//   --only=<ID>   只跑指定场景（S1-pass/S2-skip/S3-cap/S4-unresolved）
//   --force       忽略已存在的结果文件强制重跑（默认 done/partial 的场景跳过，防重复烧池）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
const LOG_PATH = path.join(OUT_DIR, 'api-run.log');
const SUMMARY_PATH = path.join(OUT_DIR, 'round1-api-summary.json');
const BASE = process.env.MV_BASE || 'http://127.0.0.1:3011';
const ORIGIN = 'http://localhost:5174';
const PASSWORD = 'MvRound12026x';
const DB_PATH = path.resolve(__dirname, '../../prisma/dev.db');
const GOAL_TEXT = '我是初中二年级学生，想在两个月内系统掌握初中生物的「光合作用与呼吸作用」这部分，每天能学 30 分钟。请按这个目标帮我规划。';

const TURN_SLEEP_MS = 6000;           // 回合间基础 sleep（+0-2s 抖动 → 6-8s，落在 5-10s 纪律带内）
const BACKOFF_MS = 30000;             // 429/5xx 退避
const MAX_RETRIES = 3;                // 重试至多 3 次
const FINALIZE_POLL_MS = 10000;       // finalization 轮询间隔
const FINALIZE_POLL_CAP_MS = 780000;  // 轮询上限（wrapup LLM 硬帽 480s + 余量）

const SCENARIOS = ['S1-pass', 'S2-skip', 'S3-cap', 'S4-unresolved'];

// 预登记的期望/禁止行（实跑前写死——来自测量工作流第一轮任务书，不得随实跑结果改动）
const EXPECTED = {
  'S1-pass': ['checkpoint:result{passed=true,judgedBy=\'code\'} >= 1'],
  'S2-skip': ["checkpoint:attempt{outcome='skipped'}"],
  'S3-cap': ["checkpoint:attempt{outcome='attempts_exhausted',attempts=2}", 'checkpoint:result{passed=false} x2 (same checkpointId)'],
  'S4-unresolved': ["checkpoint:attempt{outcome='unresolved'}", 'wrapup 落库（teaching_sessions.wrapup 非空）'],
};
const FORBIDDEN = {
  'S1-pass': ['checkpoint:attempt（任何 outcome）'],
  'S2-skip': [],
  'S3-cap': [],
  'S4-unresolved': [],
};

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
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const FORCE = args.includes('--force');

// HTTP：429/5xx/池化403(No active subscription) 退避 30s×3；确定性业务错误不重试
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
      const deterministicErr = /不允许跳过|不存在或已处理|缺少|无效|已存在|TASK_ALREADY_COMPLETED/i.test(text);
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

// ── DB 只读（node:sqlite；显式列名，禁 SELECT *；参数绑定）────────────────

function dbOpen() {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}
async function dbEvidenceRows(sessionId) {
  for (let i = 0; i < 3; i++) {
    let db;
    try {
      db = dbOpen();
      return db.prepare(
        'SELECT id,evidenceType,eventId,evidenceKey,userId,sessionId,taskId,pathId,payload,confidence,occurredAt FROM learner_evidence WHERE sessionId = ? ORDER BY occurredAt'
      ).all(sessionId);
    } catch (e) {
      if (i === 2) throw e;
      await sleep(5000);
    } finally { try { db?.close(); } catch {} }
  }
  return [];
}
async function dbSessionRow(sessionId) {
  for (let i = 0; i < 3; i++) {
    let db;
    try {
      db = dbOpen();
      // 显式列名；messages 为大列已迁侧表，绝不选取
      return db.prepare(
        'SELECT id,status,revision,endTime,duration,startTime,wrapup FROM teaching_sessions WHERE id = ?'
      ).get(sessionId) || null;
    } catch (e) {
      if (i === 2) throw e;
      await sleep(5000);
    } finally { try { db?.close(); } catch {} }
  }
  return null;
}

// ── 账号 / 路径 / 开课 ───────────────────────────────────────────────────

async function registerAccount(ctx, prefix) {
  // 注意：用户名不能带 @/.（auth.ts:147 USERNAME_PATTERN=/^[\p{L}\p{N}_-]+$/u），
  // 故任务书里的 s1r1-***@test.local 形态不可行；邮箱由服务端生成为 <name>@wenflow.local
  // （auth.service.ts:112 email=`${name}@wenflow.local`）。此处用 s1r1-<rand> 形态注册全新账号。
  const name = `${prefix}-${rand(6)}`;
  const reg = await api(ctx, 'POST', '/api/auth/register', { name, password: PASSWORD, remember: true }, { timeout: 60000 });
  const login = await api(ctx, 'POST', '/api/auth/login', { name, password: PASSWORD, remember: true }, { timeout: 60000 });
  ctx.cookie = (login.__setCookie || '').split(';')[0];
  if (!ctx.cookie) throw new Error('login 未返回 cookie');
  const d = reg?.data || {};
  const userId = d?.user?.id || d?.id || d?.userId || null;
  const email = d?.user?.email || d?.email || null;
  log(ctx, `账号就绪 name=${name} userId=${userId} email=${email || '(响应未带，落库为 <name>@wenflow.local)'}`);
  return { name, userId, email };
}

async function generatePath(ctx) {
  const t0 = Date.now();
  const body = {
    description: GOAL_TEXT,
    subject: '生物',
    userProfile: { learningGoal: GOAL_TEXT, timePerDay: '30分钟' },
  };
  const r = await api(ctx, 'POST', '/api/learning/paths/generate', body, { timeout: 600000 });
  const d = r?.data || {};
  const pathId = d?.path?.id || d?.id || null;
  log(ctx, `路径生成完成 pathId=${pathId} 耗时=${Math.round((Date.now() - t0) / 1000)}s`);
  if (!pathId) throw new Error('paths/generate 响应中无 pathId: ' + clip(JSON.stringify(d), 300));
  return pathId;
}

async function pickFirstTask(ctx, pathId) {
  // 实测（2026-10-06 第一轮）：POST /paths/generate 同步只返回路径+里程碑，任务（subtasks）
  // 由后台 stageDesign 运行渐进生成（lp_1791217115433_bzgngrl：生成完成即查 milestones×4、
  // subtasks×0，path_generation_runs.phase='stageDesign' progress=75% 仍在跑）。
  // 故轮询 detail 直至首任务出现（20s 间隔、12 分钟上限）；
  // 响应形状 milestones[].subtasks[]（path-views.queries.ts:484-497 include），兼容 stages[] 旧形状。
  const t0 = Date.now();
  const cap = t0 + 12 * 60000;
  let lastLog = 0;
  while (Date.now() < cap) {
    const r = await api(ctx, 'GET', `/api/learning/paths/${pathId}`, undefined, { timeout: 60000, retries: 1 });
    const pd = r?.data || {};
    const groups = pd.milestones || pd.stages || [];
    const tasks = groups.flatMap((s) => (s.subtasks || []).map((t) => ({ ...t, stageNumber: s.stageNumber })));
    if (tasks.length > 0) {
      const task = tasks[0];
      log(ctx, `任务就绪 task=${task.id} S${task.stageNumber} ${clip(task.title, 40)}（等待 ${Math.round((Date.now() - t0) / 1000)}s）`);
      return task;
    }
    if (Date.now() - lastLog > 60000) {
      log(ctx, '  任务后台 stageDesign 生成中，继续等待…');
      lastLog = Date.now();
    }
    await sleep(20000);
  }
  throw new Error('等待 12 分钟仍无任务生成（stageDesign 未完成）');
}

async function startSession(ctx, taskId) {
  // 渐进式备课可能未完成：409/「准备中」→ 45s 后重试，至多 6 次（learn-drive 同范式 60s×3）
  for (let i = 0; i < 6; i++) {
    try {
      const r = await api(ctx, 'POST', `/api/ai-teaching/tasks/${taskId}/session`, {}, { timeout: 300000, retries: 1 });
      const d = r?.data || {};
      if (d.mode === 'completed') throw new Error('任务已完成（不该发生在全新路径）');
      if (!d.sessionId) throw new Error('开课响应无 sessionId: ' + clip(JSON.stringify(d), 200));
      ctx.revision = Number(d.revision ?? 0);
      log(ctx, `开课成功 session=${d.sessionId} revision=${ctx.revision} welcome=${clip(d.welcomeMessage, 60)}`);
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

// ── 课堂回合 / 检查点 ────────────────────────────────────────────────────

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

// ── 作答策略（判定器契约见文件头注释）────────────────────────────────────

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

// 必对策略一：复述老师最近一条讲解里与题干最相关的句子（要点词应刚被讲过）
function buildEchoAnswer(cp) {
  const q = stripMarks(cp?.question || cp?.title || '');
  const last = ctx_lastTeacherText();
  const sentences = splitSentences(last);
  const scored = sentences.map((s) => ({ s, score: overlap(s, q) })).sort((a, b) => b.score - a.score);
  const picked = []; let len = 0;
  for (const { s } of scored) {
    if (s.length < 6 || len + s.length > 560) continue;
    picked.push(s); len += s.length;
    if (picked.length >= 5) break;
  }
  if (picked.length === 0 && last) picked.push(clip(last, 400));
  return '我照老师刚才讲的复述一遍：' + picked.join('') + (picked.join('').trim().endsWith('。') ? '' : '。');
}
// 必对策略二（判错后的加强）：把老师最近两条讲解原话尽量完整用上（关键名词逐个覆盖）
function buildDumpAnswer() {
  const last = ctx_lastTeacherText();
  const prev = ctx_prevTeacherText();
  return '我重新说一遍我的理解：' + clip(last, 400) + (prev ? '。前面老师还讲过：' + clip(prev, 200) : '');
}
function ctx_lastTeacherText() { return String(globalThis.__r1ctx?.lastTeacher || ''); }
function ctx_prevTeacherText() { return String(globalThis.__r1ctx?.prevTeacher || ''); }

// 必错策略：与要点无关的自然回答（两句不同；不含学科名词，防误中 expectedKeywords）
const WRONG_SHORT_ANSWERS = [
  '这一题我还没想好。脑子里只有个大概印象，具体说法我记不准了，老师能再带我把这块捋一遍吗？',
  '这题我答不上来。刚才听的时候感觉是懂的，现在让自己说又讲不出个所以然，还是请老师再讲一遍吧。',
];

// 选择题：按与题干+最近两条老师讲解的双字组重叠度排序选项；
// 方向动词增强（S1 第五跑实证：「往外送出」类方向判别题，纯主题重叠会选反）
function rankOptions(cp) {
  const q = stripMarks(cp?.question || cp?.title || '');
  const taught = (ctx_lastTeacherText() + '。' + ctx_prevTeacherText()).slice(-1200);
  const OUT_VERBS = /送出|放出|排出|呼出|释放|散失|输出|排出去/;
  const IN_VERBS = /吸进|吸入|吸收|摄入|进来|从土壤|从空气/;
  const outAsk = OUT_VERBS.test(q);
  const inAsk = IN_VERBS.test(q);
  const opts = (cp?.options || []).map((o) => {
    const text = o.text || o.content || '';
    let score = overlap(text, q) + overlap(text, taught);
    if (outAsk && OUT_VERBS.test(text)) score += 0.9;
    if (outAsk && IN_VERBS.test(text)) score -= 0.9;
    if (inAsk && IN_VERBS.test(text)) score += 0.9;
    if (inAsk && OUT_VERBS.test(text)) score -= 0.9;
    return { id: o.id, text, score };
  });
  return opts.sort((a, b) => b.score - a.score); // 降序：[0]=最像对的
}

// 选择题提交前确认聊天（真实学生行为：拿不准就请老师直说该选哪项、为什么→照着理解作答）。
// 从老师回复中解析选项字母（「选B」等）作为提交依据——老师点名什么就交什么；
// 不产生任何 checkpoint:result（没有 submit），正式提交仍走代码裁决，测量不被改写。
async function confirmChatBeforeChoiceSubmit(ctx, sessionId, cp) {
  ctx.hintedOptionId = null;
  const message = '老师，这道题我实在拿不准，您直接告诉我该选哪一项、为什么，我就照着理解作答。';
  await sleep(TURN_SLEEP_MS);
  const d = await sendTurn(ctx, sessionId, message);
  const reply = String(d?.aiResponse || '');
  const ids = (cp.options || []).map((o) => String(o.id || '').trim().toUpperCase()).filter(Boolean);
  const m = reply.match(/选[择取得是应]?\s*([A-Za-z])\b|([A-Za-z])\s*[：:，。]/);
  const letter = (m && (m[1] || m[2]) || '').toUpperCase();
  if (letter && ids.includes(letter)) {
    ctx.hintedOptionId = (cp.options || []).find((o) => String(o.id).trim().toUpperCase() === letter)?.id || null;
  }
  const sentences = splitSentences(reply);
  if (sentences.length > 1) ctx.lastTeacher = sentences.slice(1).join(''); // 掐掉首句（含引述污染风险）
  log(ctx, `  确认聊天已发，老师点名=${ctx.hintedOptionId || '(未识别)'}，回复（掐首句后）：${clip(ctx.lastTeacher, 90)}`);
  return d;
}

// 尝试答对一道检查点：echo 起，判错则 dump 加强；同一 cpId 最多 2 次提交（第 2 次错=到顶强消）
// 返回 { passed, submitLog:[{attempt,strategy,passed,detail}], gaveUp }
async function answerCheckpointRight(ctx, sessionId, cp, { strongFirst = false } = {}) {
  const cpId = cp.id;
  const log1 = [];
  // 选择题先发确认聊天（老师回复即为本题讲解 → echo 语料就位）
  if (cp.type !== 'short_answer' && !strongFirst) {
    try { await confirmChatBeforeChoiceSubmit(ctx, sessionId, cp); } catch (e) { log(ctx, `  确认聊天失败（继续作答）: ${clip(e?.message, 100)}`); }
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await sleep(TURN_SLEEP_MS + Math.floor(Math.random() * 2000));
    const strategy = strongFirst || attempt === 2 ? 'dump(老师原话关键名词全量复述)' : 'echo(复述老师上条讲解要点句)';
    let payload;
    if (cp.type === 'short_answer') payload = { answerText: strongFirst || attempt === 2 ? buildDumpAnswer() : buildEchoAnswer(cp) };
    else {
      // 老师确认聊天中点名的选项优先（真实「听讲后作答」）；否则按重叠度排序，第2次换次优
      if (ctx.hintedOptionId) payload = { selectedOptionIds: [ctx.hintedOptionId] };
      else {
        const ranked = rankOptions(cp);
        if (ranked.length === 0) { log1.push({ attempt, strategy, error: '无选项' }); break; }
        const pick = cp.type === 'multi_choice'
          ? ranked.slice(0, 2).map((o) => o.id)
          : [ranked[Math.min(attempt - 1, ranked.length - 1)].id];
        payload = { selectedOptionIds: pick };
      }
    }
    const d = await submitCp(ctx, sessionId, cpId, payload);
    const passed = d?.passed === true;
    log1.push({ attempt, strategy, passed, nextAction: d?.nextAction || null, feedback: clip(d?.feedback, 120), revision: ctx.revision });
    log(ctx, `  作答提交#${attempt} [${strategy}] passed=${passed} nextAction=${d?.nextAction}`);
    if (passed) return { passed: true, submitLog: log1, gaveUp: false };
    if (strongFirst) break; // 强模式只提交一次（用于收尾清理，避免把错答次数烧到到顶强消）
  }
  return { passed: false, submitLog: log1, gaveUp: true };
}

// 收尾前清理挂起检查点（防 S1/S2/S3 混入 unexpected attempt 行）。
// 纪律：同一 cpId 全场最多 2 次提交（第 2 次错=到顶强消）——第一次用最强 dump 答案，
// 判错才第二次（dump 加强版）；再错即到顶强消，如实记录不隐瞒。
async function clearPendingBeforeFinalize(ctx, sessionId, scenarioId) {
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
        payload = { answerText: attempt === 1 ? buildDumpAnswer() : '我再把老师讲的重点原样背一遍：' + clip(ctx_lastTeacherText(), 450) + '。' + clip(ctx_prevTeacherText(), 150) };
      } else {
        const ranked = rankOptions(pending);
        if (ranked.length === 0) break;
        if (pending.type === 'multi_choice') payload = { selectedOptionIds: ranked.slice(0, 2).map((o) => o.id) };
        else payload = { selectedOptionIds: [ranked[Math.min(attempt - 1, ranked.length - 1)].id] }; // 单选第2次换次优选项
      }
      const d = await submitCp(ctx, sessionId, pending.id, payload);
      passed = d?.passed === true;
      log1.push({ checkpointId: pending.id, attempt, strategy: attempt === 1 ? 'dump' : 'dump-2', passed, feedback: clip(d?.feedback, 100) });
      log(ctx, `  清理提交#${attempt} passed=${passed}`);
    }
    return { cleaned: passed, tries: i + log1.length, log: log1 };
  }
  return { cleaned: true, tries: 3, log: [] };
}

async function finalizeAndSettle(ctx, sessionId, action) {
  const key = `mv-r1-${ctx.id}-${rand(8)}`;
  const post = await api(ctx, 'POST', `/api/ai-teaching/sessions/${sessionId}/finalize`,
    { action, revision: ctx.revision, reason: 'task-completed', actualMinutes: 25, subjectiveDifficulty: 3 },
    { idempotencyKey: key, timeout: 300000 });
  const out = {
    idempotencyKey: key,
    httpNote: '202=processing / 200=同步完成',
    postStatus: post?.data?.status || 'unknown',
    postKeys: Object.keys(post?.data || {}).join(','),
  };
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
  // endSummary 是否为空——历史疑点，原样记录（不是场景失败判据）
  const fd = last?.data || {};
  out.endSummaryAsIs = {
    status: fd.status ?? null,
    summaryKeys: fd.summary ? Object.keys(fd.summary).join(',') : null,
    topicSummaryLen: String(fd.summary?.topicSummary || '').length,
    topicSummaryHead: clip(fd.summary?.topicSummary, 200),
    practiceAdviceLen: String(fd.summary?.practiceAdvice || '').length,
    actionPlanLen: Array.isArray(fd.actionPlan) ? fd.actionPlan.length : null,
    taskCompletion: fd.finalization?.taskCompletion || fd.taskCompletion || null,
  };
  log(ctx, `finalization settled: status=${out.finalStatus} topicSummaryLen=${out.endSummaryAsIs.topicSummaryLen} actionPlan=${out.endSummaryAsIs.actionPlanLen}`);
  return out;
}

// ── 证据行归类与场景判定 ─────────────────────────────────────────────────

function classifyEvidence(rows) {
  const parsed = rows.map((r) => {
    let p = {}; try { p = JSON.parse(r.payload || '{}'); } catch {}
    return { id: r.id, evidenceType: r.evidenceType, eventId: r.eventId, evidenceKey: r.evidenceKey, confidence: r.confidence, occurredAt: r.occurredAt, payloadParsed: p };
  });
  return {
    attempts: parsed.filter((r) => r.evidenceType === 'checkpoint:attempt'),
    results: parsed.filter((r) => r.evidenceType === 'checkpoint:result'),
    anchors: parsed.filter((r) => r.evidenceType === 'anchor:result'),
    other: parsed.filter((r) => !['checkpoint:attempt', 'checkpoint:result', 'anchor:result'].includes(r.evidenceType)),
    all: parsed,
  };
}

// ── 学生话术 ─────────────────────────────────────────────────────────────

const STUDENT_SCRIPT = [
  '老师好！我想先把光合作用的基本过程搞清楚：原料、条件、场所、产物分别是什么？',
  '我先复述一遍：绿色植物通过光能，在叶绿体里把二氧化碳和水合成储存能量的有机物（比如淀粉），并释放出氧气。老师我理解得对吗？',
  '那呼吸作用呢？我理解是细胞利用氧气，把有机物分解成二氧化碳和水，同时释放出能量供生命活动利用。它和光合作用有什么区别和联系？',
  '我把两个过程连起来看：光合作用制造有机物、储存能量；呼吸作用分解有机物、释放能量，两者相互依存。这样理解可以吗？',
  '那实际应用呢？比如大棚种植为什么要增施二氧化碳（气肥）？',
  '明白了，理论联系实际就清楚多了，这块我心里有底了。',
  '老师，这一部分我感觉掌握得差不多了。',
];
const COMPLETION_INTENT = '我觉得这部分我已经掌握了，帮我结算收尾这一节课吧，剩下的我课后自己练。';

// 产出式学生话术：自带观察实例+自己的解释（S1 第三跑实证：老师若布置「写你见过的现象」
// 类任务，纯复述会被连续降台阶、understanding 跌到 0.1——学生必须真正完成任务）。
// 内容全部围绕光合/呼吸主线，对讲述型课题同样是高分应答。
const STUDENT_PRODUCTIVE = [
  '老师我先交自己的观察：我见过阳台的绿萝，放窗边就长得旺，挪到背光处就发黄。我当时的解释是：有光的时候它在「攒」东西（制造养分），没光就只能「耗」（分解消耗）。',
  '我再补一个：秋天楼下树的叶子黄了、掉了——我猜叶子里存的东西被分解运走了，这条线不需要光也能走；而春天长新叶要靠光才「造」得出来。',
  '我把我见过的和你讲的连起来：绿豆芽不见光是黄白色的（只在耗），见光后变绿开始长（开始造）。所以有没有光，决定的是「造」这一半能不能发生，对吗？',
  '那呼吸作用我这么理解：不管白天黑夜，细胞都在把有机物分解、放出能量供自己用；光合作用只有有光才造有机物。造和耗其实同时存在，只是比例不同。',
  '我用一句话总结：光下面「造>耗」植物就长；黑暗里只有「耗」。所以地窖里的菜放几天会蔫——一直在耗，没在造。',
];

// 自适应学生话术：跟着老师上条讲解复述（真实「跟得上」学生行为）。
// 依据：固定话术与课题错位时 understanding 卡 0.3-0.5 过不了 0.6 出题门（S1 第二跑实证，
// 首任务主题漂到「有机物/无机物分类」12 轮无检查点）；复述式应答实测 understanding 0.72-0.8。
const STUDENT_FRAMES = [
  '我跟着老师复述一遍我理解的重点：{ECHO}这样理解对吗？',
  '我用自己的话把刚才这段讲一遍：{ECHO}我说得对吗？',
  '老师我再确认一下，我理解的是：{ECHO}对吗？',
  '我把刚才的内容串一下：{ECHO}这个思路对吧？',
];
function studentSay(ctx, salt) {
  const last = ctx_lastTeacherText();
  const sentences = splitSentences(last);
  const picked = []; let len = 0;
  for (const s of sentences) {
    if (s.length >= 8 && len + s.length <= 240) { picked.push(s); len += s.length; }
    if (picked.length >= 2) break;
  }
  if (picked.length) {
    const echo = picked.join('');
    const frame = STUDENT_FRAMES[Math.abs(salt) % STUDENT_FRAMES.length];
    return frame.replace('{ECHO}', echo) + (echo.trim().endsWith('。') ? '' : '。');
  }
  return STUDENT_SCRIPT[Math.abs(salt) % STUDENT_SCRIPT.length];
}

async function driveUntilCheckpoint(ctx, sessionId, rec, { maxTurns = 12 } = {}) {
  for (let t = 1; t <= maxTurns; t++) {
    const message = t === 1 ? STUDENT_SCRIPT[0] : (t - 2 < STUDENT_PRODUCTIVE.length ? STUDENT_PRODUCTIVE[t - 2] : studentSay(ctx, t));
    await sleep(TURN_SLEEP_MS + Math.floor(Math.random() * 2000));
    const d = await sendTurn(ctx, sessionId, message);
    const entry = {
      turn: t, student: message,
      understanding: d?.analysis?.understanding ?? null,
      aiHead: clip(d?.aiResponse, 150),
      checkpoint: d?.checkpoint ? { id: d.checkpoint.id, type: d.checkpoint.type, allowSkip: d.checkpoint.allowSkip, question: clip(d.checkpoint.question || d.checkpoint.title, 120) } : null,
      isCompletion: d?.isCompletion === true,
      revision: ctx.revision,
    };
    rec.turns.push(entry);
    log(ctx, `turn${t}: understanding=${entry.understanding} ckpt=${entry.checkpoint ? `${entry.checkpoint.type}/allowSkip=${entry.checkpoint.allowSkip}` : 'N'} isCompletion=${entry.isCompletion}`);
    let pending = d?.checkpoint || null;
    if (!pending) {
      const det = await currentPending(ctx, sessionId);
      pending = det;
    }
    if (pending) { rec.pendingAt = { turn: t, checkpoint: { id: pending.id, type: pending.type, allowSkip: pending.allowSkip, question: clip(pending.question || pending.title, 160), options: (pending.options || []).map((o) => ({ id: o.id, text: clip(o.text, 80) })) } }; return pending; }
    if (entry.isCompletion) { rec.notes.push(`turn${t} 出现 isCompletion 但未见检查点——继续课堂`); }
  }
  return null;
}

// 课堂中检查点即时处置（S1/S2/S3 通用）：回应合携带 pending 检查点就立刻 echo→dump 作答，
// 不留到收尾——第一轮实证：挂 4 轮后老师话题已走远，dump 命不中答案键（S1 首跑教训）
async function answerPendingNow(ctx, sessionId, rec, tag, cpFromResponse) {
  const cp = cpFromResponse || (await currentPending(ctx, sessionId));
  if (!cp) return null;
  await sleep(TURN_SLEEP_MS);
  const r = await answerCheckpointRight(ctx, sessionId, cp, { strongFirst: false });
  rec.checkpoints.push({ phase: tag, checkpointId: cp.id, submitLog: r.submitLog });
  if (!r.passed) {
    rec.notes.push(`${tag}: 检查点 ${cp.id} 两次作答均判错（第 2 错=到顶强消，引擎行为）`);
    log(ctx, `  ${tag}: 检查点 ${cp.id} 两次均错，已强消`);
  } else {
    log(ctx, `  ${tag}: 检查点 ${cp.id} 已答对（提交 ${r.submitLog.length} 次）`);
  }
  return cp;
}

// ── 场景实现 ─────────────────────────────────────────────────────────────

async function setupLesson(ctx, rec, prefix) {
  rec.account = await registerAccount(ctx, prefix);
  rec.goalText = GOAL_TEXT;
  rec.pathId = await generatePath(ctx);
  const task = await pickFirstTask(ctx, rec.pathId);
  rec.taskId = task.id; rec.taskTitle = task.title; rec.stageNumber = task.stageNumber;
  const started = await startSession(ctx, rec.taskId);
  rec.sessionId = started.sessionId;
  rec.welcomeHead = clip(started.welcomeMessage, 120);
}

async function runS1(ctx, rec) {
  const cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec);
  if (!cp) throw new Error('12 轮内未出现第一个检查点');
  rec.checkpoints.push({ phase: 'first', ...rec.pendingAt });
  await sleep(TURN_SLEEP_MS);
  const r1 = await answerCheckpointRight(ctx, rec.sessionId, cp, { strongFirst: false });
  rec.checkpoints.push({ phase: 'first-submit', checkpointId: cp.id, submitLog: r1.submitLog });
  rec.firstTryPass = r1.submitLog.length === 1 && r1.submitLog[0].passed === true;
  if (!r1.passed) {
    // 判错后 pending 保留（除非已到顶强消）——检查 pending 是否还在；还在则说明两次都错（已强消或仍挂起）
    const still = await currentPending(ctx, rec.sessionId);
    if (still?.id === cp.id) throw new Error('第一个检查点两次作答均判错且仍挂起（echo+dump 均未命中答案键）——按任务书记 partial');
  }
  // 答对后再上 3+ 轮。策略：t1 低信号确认，t2-4 连发讨完课——尽快把课堂推进 wrapup 阶段
  // （shouldEmitCheckpoint 在 wrapup 阶段直接关门，checkpoint-shared.ts:90-91），
  // 抑制后续检查点产生（S1 第四跑实证：高分产出回答会引老师连出 2 张后续检查点，盲答风险高）。
  // 回应合若仍带出新检查点，立即现场作答（echo 加强版）。
  for (let t = 1; t <= 4; t++) {
    await sleep(TURN_SLEEP_MS);
    const message = t === 1 ? '好的，我记下了，这部分我懂了。' : COMPLETION_INTENT;
    const d = await sendTurn(ctx, rec.sessionId, message);
    rec.turns.push({ turn: `post-pass-${t}`, student: message, aiHead: clip(d?.aiResponse, 120), checkpoint: d?.checkpoint ? { id: d.checkpoint.id, allowSkip: d.checkpoint.allowSkip } : null, isCompletion: d?.isCompletion === true, revision: ctx.revision });
    log(ctx, `post-pass turn${t}: ckpt=${d?.checkpoint ? 'Y(' + d.checkpoint.id + ')' : 'N'} isCompletion=${d?.isCompletion}`);
    if (d?.checkpoint) await answerPendingNow(ctx, rec.sessionId, rec, `post-pass-turn${t}`, d.checkpoint);
  }
  // 收尾前清理可能的新挂起检查点（防混入 unresolved/unexpected attempt 行）
  const clean = await clearPendingBeforeFinalize(ctx, rec.sessionId, 'S1-pass');
  rec.pendingCleanup = clean;
  rec.finalize = await finalizeAndSettle(ctx, rec.sessionId, 'complete_task');
}

async function runS2(ctx, rec) {
  let cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec);
  if (!cp) throw new Error('12 轮内未出现第一个检查点');
  rec.checkpoints.push({ phase: 'first', ...rec.pendingAt });
  let skipped = null;
  let mandatoryResult = null;
  if (cp.allowSkip === true) {
    await sleep(TURN_SLEEP_MS);
    const d = await submitCp(ctx, rec.sessionId, cp.id, { skip: true });
    skipped = { checkpointId: cp.id, passed: d?.passed, feedback: clip(d?.feedback, 120), nextAction: d?.nextAction, revision: ctx.revision };
    log(ctx, `skip 提交完成: passed=${d?.passed} feedback=${clip(d?.feedback, 60)}`);
  } else {
    rec.notes.push(`第一个检查点 ${cp.id} allowSkip=${cp.allowSkip}（必答卡）——先答对，等下一张可跳过的`);
    await sleep(TURN_SLEEP_MS);
    const r1 = await answerCheckpointRight(ctx, rec.sessionId, cp, { strongFirst: false });
    mandatoryResult = { checkpointId: cp.id, submitLog: r1.submitLog, passed: r1.passed };
    if (!r1.passed) {
      const still = await currentPending(ctx, rec.sessionId);
      if (still?.id === cp.id) throw new Error('必答卡两次作答均判错且仍挂起');
    }
    // 继续课堂等下一张可跳过的（至多 8 轮）
    let found = null;
    for (let t = 1; t <= 8 && !found; t++) {
      await sleep(TURN_SLEEP_MS);
      const message = studentSay(ctx, t + 2);
      const d = await sendTurn(ctx, rec.sessionId, message);
      rec.turns.push({ turn: `wait-skip-${t}`, student: message, aiHead: clip(d?.aiResponse, 120), checkpoint: d?.checkpoint ? { id: d.checkpoint.id, allowSkip: d.checkpoint.allowSkip } : null, revision: ctx.revision });
      let pending = d?.checkpoint || (await currentPending(ctx, rec.sessionId));
      if (pending && pending.id !== cp.id) found = pending;
    }
    if (!found) throw new Error('后续 8 轮未再出现可跳过的检查点');
    cp = found;
    if (cp.allowSkip !== true) {
      rec.notes.push(`第二张检查点 ${cp.id} allowSkip=${cp.allowSkip}——仍非可跳过，按协议提交 skip 应被拒，如实记录`);
    }
    await sleep(TURN_SLEEP_MS);
    const d = await submitCp(ctx, rec.sessionId, cp.id, { skip: true }).catch((e) => ({ __err: clip(e?.message, 200) }));
    if (d?.__err) {
      skipped = { checkpointId: cp.id, error: d.__err, allowSkip: cp.allowSkip };
      rec.notes.push(`skip 被拒（allowSkip=${cp.allowSkip}）: ${d.__err}`);
      // 退路：答对这张，继续等可跳过的（至多再 6 轮）
      const r2 = await answerCheckpointRight(ctx, rec.sessionId, cp, { strongFirst: false });
      mandatoryResult = mandatoryResult || { checkpointId: cp.id, submitLog: r2.submitLog, passed: r2.passed };
      let found2 = null;
      for (let t = 1; t <= 6 && !found2; t++) {
        await sleep(TURN_SLEEP_MS);
        const d3 = await sendTurn(ctx, rec.sessionId, studentSay(ctx, t + 4));
        rec.turns.push({ turn: `wait-skip2-${t}`, aiHead: clip(d3?.aiResponse, 100), checkpoint: d3?.checkpoint ? { id: d3.checkpoint.id, allowSkip: d3.checkpoint.allowSkip } : null });
        const pending = d3?.checkpoint || (await currentPending(ctx, rec.sessionId));
        if (pending && pending.allowSkip === true) found2 = pending;
      }
      if (!found2) throw new Error('始终未出现 allowSkip=true 的检查点——S2 skip 用例无法执行（如实记录）');
      cp = found2;
      await sleep(TURN_SLEEP_MS);
      const d4 = await submitCp(ctx, rec.sessionId, cp.id, { skip: true });
      skipped = { checkpointId: cp.id, passed: d4?.passed, feedback: clip(d4?.feedback, 120), nextAction: d4?.nextAction };
    } else {
      skipped = { checkpointId: cp.id, passed: d?.passed, feedback: clip(d?.feedback, 120), nextAction: d?.nextAction, revision: ctx.revision };
    }
    log(ctx, `skip 提交完成（第 ${skipped.checkpointId === rec.checkpoints[0]?.checkpoint?.id ? 1 : 2} 张之后）: ${JSON.stringify(skipped).slice(0, 160)}`);
  }
  rec.skipped = skipped;
  rec.mandatoryResult = mandatoryResult;
  // 跳过后课堂须能继续（≥1 轮，这里上 2 轮留余量；回应合若带出新检查点，立即现场作答）
  for (let t = 1; t <= 2; t++) {
    await sleep(TURN_SLEEP_MS);
    const message = t === 1 ? '好的，跳过就跳过，这块我再自己看看书。那我们继续往下讲吧。' : '嗯，继续。';
    const d = await sendTurn(ctx, rec.sessionId, message);
    rec.turns.push({ turn: `post-skip-${t}`, student: message, aiHead: clip(d?.aiResponse, 150), isCompletion: d?.isCompletion === true, revision: ctx.revision });
    log(ctx, `post-skip turn${t}: aiLen=${String(d?.aiResponse || '').length}（课堂继续=${String(d?.aiResponse || '').length > 0 ? 'Y' : 'N'}）`);
    if (t === 1) rec.classContinuedAfterSkip = String(d?.aiResponse || '').length > 0;
    if (d?.checkpoint) await answerPendingNow(ctx, rec.sessionId, rec, `post-skip-turn${t}`, d.checkpoint);
  }
  const clean = await clearPendingBeforeFinalize(ctx, rec.sessionId, 'S2-skip');
  rec.pendingCleanup = clean;
  rec.finalize = await finalizeAndSettle(ctx, rec.sessionId, 'complete_task');
}

async function runS3(ctx, rec) {
  let cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec);
  if (!cp) throw new Error('12 轮内未出现第一个检查点');
  rec.capExperiments = [];
  let done = false;
  for (let roundIdx = 0; roundIdx < 3 && !done; roundIdx++) {
    rec.capExperiments.push({ checkpointId: cp.id, type: cp.type, round: roundIdx + 1, attempts: [] });
    const exp = rec.capExperiments[rec.capExperiments.length - 1];
    // 两次不同的自然错答
    const wrongPayloads = [];
    if (cp.type === 'short_answer') {
      wrongPayloads.push({ answerText: WRONG_SHORT_ANSWERS[0] }, { answerText: WRONG_SHORT_ANSWERS[1] });
    } else {
      const rankedAsc = rankOptions(cp).slice().reverse(); // 升序：最不像对的优先
      if (rankedAsc.length >= 2) {
        wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] }, { selectedOptionIds: [rankedAsc[1].id] });
      } else if (rankedAsc.length === 1) {
        wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] });
        rec.notes.push(`检查点 ${cp.id} 仅 1 个选项，第二次错答只能同选项——如实记录`);
        wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] });
      }
    }
    let bothWrong = true;
    for (let a = 0; a < Math.min(2, wrongPayloads.length); a++) {
      await sleep(TURN_SLEEP_MS);
      const payload = wrongPayloads[a];
      const d = await submitCp(ctx, rec.sessionId, cp.id, payload);
      const attemptRow = { attempt: a + 1, payloadKind: payload.answerText ? 'answerText' : 'selectedOptionIds', payloadExcerpt: payload.answerText ? clip(payload.answerText, 80) : payload.selectedOptionIds, passed: d?.passed === true, nextAction: d?.nextAction || null, feedbackHead: clip(d?.feedback, 100) };
      exp.attempts.push(attemptRow);
      log(ctx, `  错答提交#${a + 1} passed=${attemptRow.passed} nextAction=${attemptRow.nextAction}`);
      if (d?.passed === true) { bothWrong = false; exp.note = `第 ${a + 1} 次错答被误判对（选项盲猜命中/或要点意外命中）——本题无法做 cap 实验`; break; }
    }
    if (bothWrong) {
      const still = await currentPending(ctx, rec.sessionId);
      exp.pendingAfterTwoWrongs = still?.id === cp.id ? 'still-pending' : 'consumed';
      log(ctx, `  两次错答后 pending=${exp.pendingAfterTwoWrongs}（期望 consumed=到顶强消）`);
      if (exp.pendingAfterTwoWrongs === 'consumed') { done = true; rec.capCheckpointId = cp.id; break; }
      exp.note = '两次错答后 pending 仍在（未触发到顶强消）——H1 预期不符';
      // 换下一张检查点再试
      let next = null;
      for (let t = 1; t <= 6 && !next; t++) {
        await sleep(TURN_SLEEP_MS);
        const d = await sendTurn(ctx, rec.sessionId, studentSay(ctx, t + 3));
        rec.turns.push({ turn: `s3-wait-${roundIdx}-${t}`, aiHead: clip(d?.aiResponse, 100), checkpoint: d?.checkpoint ? { id: d.checkpoint.id } : null });
        const pending = d?.checkpoint || (await currentPending(ctx, rec.sessionId));
        if (pending && pending.id !== cp.id) next = pending;
      }
      if (!next) throw new Error('cap 实验失败且无后续检查点可再试');
      cp = next;
    } else {
      // 被判对了 → 等下一张再试
      let next = null;
      for (let t = 1; t <= 6 && !next; t++) {
        await sleep(TURN_SLEEP_MS);
        const d = await sendTurn(ctx, rec.sessionId, studentSay(ctx, t + 3));
        rec.turns.push({ turn: `s3-wait-${roundIdx}-${t}`, aiHead: clip(d?.aiResponse, 100), checkpoint: d?.checkpoint ? { id: d.checkpoint.id } : null });
        const pending = d?.checkpoint || (await currentPending(ctx, rec.sessionId));
        if (pending && pending.id !== cp.id) next = pending;
      }
      if (!next) throw new Error('错答被误判对且无后续检查点可再试');
      cp = next;
    }
  }
  if (!done) throw new Error('三个检查点上均未完成「两次错答→到顶强消」实验');
  // 强消后课堂继续 2+ 轮（上 3 轮；回应合若带出新检查点，立即现场作答）
  for (let t = 1; t <= 3; t++) {
    await sleep(TURN_SLEEP_MS);
    const message = t <= 2 ? studentSay(ctx, t) : COMPLETION_INTENT;
    const d = await sendTurn(ctx, rec.sessionId, message);
    rec.turns.push({ turn: `post-cap-${t}`, student: message, aiHead: clip(d?.aiResponse, 120), checkpoint: d?.checkpoint ? { id: d.checkpoint.id } : null, isCompletion: d?.isCompletion === true, revision: ctx.revision });
    log(ctx, `post-cap turn${t}: ckpt=${d?.checkpoint ? 'Y' : 'N'} isCompletion=${d?.isCompletion}`);
    if (d?.checkpoint) await answerPendingNow(ctx, rec.sessionId, rec, `post-cap-turn${t}`, d.checkpoint);
  }
  const clean = await clearPendingBeforeFinalize(ctx, rec.sessionId, 'S3-cap');
  rec.pendingCleanup = clean;
  rec.finalize = await finalizeAndSettle(ctx, rec.sessionId, 'complete_task');
}

async function runS4(ctx, rec) {
  const cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec);
  if (!cp) throw new Error('12 轮内未出现第一个检查点');
  rec.checkpoints.push({ phase: 'first-pending-not-answered', ...rec.pendingAt });
  // 确认 pending 仍在（不作答）
  const still = await currentPending(ctx, rec.sessionId);
  rec.pendingConfirmedBeforeFinalize = still?.id === cp.id;
  log(ctx, `pending 确认=${rec.pendingConfirmedBeforeFinalize}（cp=${cp.id}）——不作答，直接 finalize`);
  rec.finalize = await finalizeAndSettle(ctx, rec.sessionId, 'complete_task');
}

// ── 判定 ─────────────────────────────────────────────────────────────────

function evaluate(id, rec) {
  const ev = classifyEvidence(rec.dbEvidence || []);
  rec.actualRows = {
    checkpointAttempt: ev.attempts.map((r) => ({ eventId: r.eventId, outcome: r.payloadParsed.outcome, attempts: r.payloadParsed.attempts, checkpointId: r.payloadParsed.checkpointId, confidence: r.confidence })),
    checkpointResult: ev.results.map((r) => ({ eventId: r.eventId, checkpointId: r.payloadParsed.checkpointId, passed: r.payloadParsed.passed, judgedBy: r.payloadParsed.judgedBy, confidence: r.confidence })),
    anchorResult: ev.anchors.length,
    otherTypes: [...new Set(ev.other.map((r) => r.evidenceType))],
  };
  const checks = {};
  if (id === 'S1-pass') {
    checks.hasCodePassedResult = ev.results.some((r) => r.payloadParsed.passed === true && r.payloadParsed.judgedBy === 'code');
    checks.noAttemptRows = ev.attempts.length === 0;
    checks.finalizeSettled = rec.finalize?.finalStatus === 'completed';
    checks.firstTryPass = rec.firstTryPass === true;
    rec.verdicts = checks;
    if (checks.hasCodePassedResult && checks.noAttemptRows && checks.finalizeSettled) return checks.firstTryPass ? 'done' : 'partial';
    return 'partial';
  }
  if (id === 'S2-skip') {
    checks.hasSkippedAttempt = ev.attempts.some((r) => r.payloadParsed.outcome === 'skipped');
    checks.classContinued = rec.classContinuedAfterSkip === true;
    checks.finalizeSettled = rec.finalize?.finalStatus === 'completed';
    checks.unexpectedAttemptOutcomes = ev.attempts.filter((r) => r.payloadParsed.outcome !== 'skipped').map((r) => r.payloadParsed.outcome);
    rec.verdicts = checks;
    if (checks.hasSkippedAttempt && checks.classContinued && checks.finalizeSettled && checks.unexpectedAttemptOutcomes.length === 0) return 'done';
    if (checks.hasSkippedAttempt && checks.finalizeSettled) return 'partial';
    return 'partial';
  }
  if (id === 'S3-cap') {
    const capId = rec.capCheckpointId;
    checks.hasExhaustedAttempt = ev.attempts.some((r) => r.payloadParsed.outcome === 'attempts_exhausted' && r.payloadParsed.attempts === 2);
    checks.exhaustedOnCapCheckpoint = capId ? ev.attempts.some((r) => r.payloadParsed.outcome === 'attempts_exhausted' && r.payloadParsed.checkpointId === capId) : null;
    const falseResults = ev.results.filter((r) => r.payloadParsed.passed === false && (!capId || r.payloadParsed.checkpointId === capId));
    checks.falseResultCountOnCap = falseResults.length;
    checks.finalizeSettled = rec.finalize?.finalStatus === 'completed';
    rec.verdicts = checks;
    if (checks.hasExhaustedAttempt && checks.falseResultCountOnCap >= 2 && checks.finalizeSettled) return 'done';
    return 'partial';
  }
  if (id === 'S4-unresolved') {
    checks.hasUnresolvedAttempt = ev.attempts.some((r) => r.payloadParsed.outcome === 'unresolved');
    let wrapup = null;
    try { wrapup = rec.dbSession?.wrapup ? JSON.parse(rec.dbSession.wrapup) : null; } catch {}
    checks.wrapupLanded = Boolean(wrapup && (wrapup.status || wrapup.topicSummary || wrapup.summary));
    checks.wrapupStatus = wrapup?.status ?? null;
    checks.sessionStatus = rec.dbSession?.status ?? null;
    checks.finalizeSettled = rec.finalize?.finalStatus === 'completed';
    rec.verdicts = checks;
    rec.endSummaryAsIs = rec.finalize?.endSummaryAsIs || null;
    if (checks.hasUnresolvedAttempt && checks.wrapupLanded && checks.finalizeSettled) return 'done';
    return 'partial';
  }
  return 'partial';
}

// ── 主流程 ───────────────────────────────────────────────────────────────

const PREFIXES = { 'S1-pass': 's1r1', 'S2-skip': 's2r1', 'S3-cap': 's3r1', 'S4-unresolved': 's4r1' };
const RUNNERS = { 'S1-pass': runS1, 'S2-skip': runS2, 'S3-cap': runS3, 'S4-unresolved': runS4 };

async function runScenario(id) {
  const resultPath = path.join(OUT_DIR, `${id}.result.json`);
  if (!FORCE && fs.existsSync(resultPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      if (prev.status === 'done' || prev.status === 'partial') {
        log(null, `[skip] ${id} 已有 ${prev.status} 结果（--force 可重跑）`);
        return prev;
      }
    } catch {}
  }
  const ctx = { id, cookie: '', revision: 0, lastTeacher: '', prevTeacher: '' };
  globalThis.__r1ctx = ctx;
  const rec = {
    scenarioId: id, startedAt: new Date().toISOString(), base: BASE,
    goalText: GOAL_TEXT,
    expectedRows: EXPECTED[id], forbiddenRows: FORBIDDEN[id],
    account: null, pathId: null, taskId: null, sessionId: null,
    turns: [], checkpoints: [], notes: [], errors: [],
  };
  const t0 = Date.now();
  try {
    await setupLesson(ctx, rec, PREFIXES[id]);
    await RUNNERS[id](ctx, rec);
    rec.dbEvidence = await dbEvidenceRows(rec.sessionId);
    rec.dbSession = await dbSessionRow(rec.sessionId);
    rec.status = evaluate(id, rec);
  } catch (e) {
    rec.status = 'failed';
    rec.fatal = clip(e?.message || e, 500);
    log(ctx, `FATAL: ${clip(e?.stack || e, 500)}`);
    // 失败也要取证
    if (rec.sessionId) {
      try {
        rec.dbEvidence = rec.dbEvidence || await dbEvidenceRows(rec.sessionId);
        rec.dbSession = rec.dbSession || await dbSessionRow(rec.sessionId);
        if (!rec.actualRows) evaluate(id, rec);
      } catch (e2) { rec.errors.push('post-mortem db read: ' + clip(e2?.message, 150)); }
    }
  } finally {
    rec.finishedAt = new Date().toISOString();
    rec.durationMs = Date.now() - t0;
    try { fs.writeFileSync(resultPath, JSON.stringify(rec, null, 1)); } catch (e) { log(null, `结果落盘失败 ${resultPath}: ${e.message}`); }
    log(null, `[done] ${id} status=${rec.status} duration=${Math.round(rec.durationMs / 1000)}s -> ${resultPath}`);
  }
  return rec;
}

async function main() {
  log(null, `=== measurement-verify 第一轮 API 实跑开始 === base=${BASE} only=${ONLY || '(all)'} force=${FORCE}`);
  const targets = ONLY ? SCENARIOS.filter((s) => s === ONLY) : SCENARIOS;
  if (ONLY && targets.length === 0) throw new Error(`--only 无效场景: ${ONLY}`);
  const lessons = [];
  for (const id of targets) {
    const rec = await runScenario(id);
    lessons.push({
      scenarioId: id,
      status: rec.status,
      sessionId: rec.sessionId,
      userId: rec.account?.userId || rec.dbEvidence?.[0]?.userId || null,
      accountName: rec.account?.name || null,
      taskId: rec.taskId,
      pathId: rec.pathId,
      expectedRows: rec.expectedRows,
      forbiddenRows: rec.forbiddenRows,
      actualRows: rec.actualRows || null,
      verdicts: rec.verdicts || null,
      endSummaryAsIs: rec.endSummaryAsIs || rec.finalize?.endSummaryAsIs || null,
      fatal: rec.fatal || null,
      notes: rec.notes,
      durationMs: rec.durationMs,
      resultFile: `${id}.result.json`,
    });
    await sleep(8000); // 场景间退火
  }
  const summary = {
    track: 'measurement-round1-api',
    generatedAt: new Date().toISOString(),
    base: BASE,
    instanceNote: '3011 验证实例（含 H1，commit 92379a82）；3001 旧实例未触碰',
    accountNamingNote: '任务书要求 s1r1-***@test.local；auth.ts:147 USERNAME_PATTERN=/^[\\p{L}\\p{N}_-]+$/u 禁 @/.，注册名只能用 s1r1-<rand> 形态，服务端按 auth.service.ts:112 自动生成 <name>@wenflow.local 邮箱',
    lessons,
    totals: {
      scenarios: lessons.length,
      done: lessons.filter((l) => l.status === 'done').length,
      partial: lessons.filter((l) => l.status === 'partial').length,
      failed: lessons.filter((l) => l.status === 'failed').length,
    },
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 1));
  log(null, `=== 全部完成 === totals=${JSON.stringify(summary.totals)} summary=${SUMMARY_PATH}`);
}

main().catch((e) => {
  log(null, `MAIN-FATAL: ${clip(e?.stack || e, 800)}`);
  process.exitCode = 1;
});
