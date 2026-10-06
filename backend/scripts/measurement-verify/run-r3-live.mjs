// measurement-verify 第三轮 · F1 活体复测（修复后 3011 实跑）
// 复用 run-round2-seq.mjs 的驱动函数（api/DB 只读/开课/回合/检查点/收束），单课单账号：
//   全新账号 f1-r3-<rand>（任务书给的 f1-r3-@test.local 含 @/. 不可注册——routes/auth.ts:147
//   USERNAME_PATTERN=/^[\p{L}\p{N}_-]+$/u；服务端按 auth 侧惯例生成 <name>@wenflow.local 邮箱）
//   固定目标（与 R2 逐字相同）→ 开课 stage1 任务[0] → 第一个检查点连答两错到顶 → 其后检查点全对
//   → 讨完课 finalize complete_task → 三验收：
//   V1 该检查点概念 knowledgeState 课末不是 mastered（修复=code 负证据阻断晋升，落 learning；
//      板点 evidenceSource 仅 mastered 点标注：llm/code/mixed）
//   V2 learner_evidence 的 checkpoint 行带概念归属键（cpt_<sha256前16>，source=derived）且无
//      concept-N 占位键（checkpoint-shared.ts:27 PLACEHOLDER_CONCEPT_KEY_PATTERN）
//   V3 prediction_records 该任务 outcome='struggled'（PredictionCalibrationService F4：checkpoint
//      负证据独立判据）
// 用法：cd backend && node scripts/measurement-verify/run-r3-live.mjs [--verify-only]
// 断点续跑：状态落 out/r3-f1.state.json；--verify-only 只对既有会话做 DB 验收（不烧课）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
// MV_TAG：并行实例标签（空=默认，向后兼容）。多实例并发跑时用它隔离 log/state/result，
// 否则同名文件互相覆盖、断点续跑会串账号。
const TAG = process.env.MV_TAG || '';
const LOG_PATH = path.join(OUT_DIR, `r3-run${TAG}.log`);
const STATE_PATH = path.join(OUT_DIR, `r3-f1${TAG}.state.json`);
const RESULT_PATH = path.join(OUT_DIR, `r3-f1${TAG}.result.json`);
const BASE = process.env.MV_BASE || 'http://127.0.0.1:3011';
// MV_ORIGIN：csrf 按实例 CORS_ORIGIN 白名单校验带 cookie 写请求——3011 白名单含 5174，
// 3001(.env) 含 5173；打哪个实例配哪个 Origin（默认 5174 不变）
const ORIGIN = process.env.MV_ORIGIN || 'http://localhost:5174';
const PASSWORD = 'MvF1R32026x';
const DB_PATH = path.resolve(__dirname, '../../prisma/dev.db');
const GOAL_TEXT = '我是初中二年级学生，想在两个月内系统掌握初中生物的「光合作用与呼吸作用」这部分，每天能学 30 分钟。请按这个目标帮我规划。';

const TURN_SLEEP_MS = 6000;
const BACKOFF_MS = 30000;
const MAX_RETRIES = 3;
const FINALIZE_POLL_MS = 10000;
const FINALIZE_POLL_CAP_MS = 780000;

fs.mkdirSync(OUT_DIR, { recursive: true });
const log = (ctx, msg) => {
  const line = `[${new Date().toISOString()}]${ctx && ctx.id ? `[${ctx.id}]` : ''} ${msg}`;
  fs.appendFileSync(LOG_PATH, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => crypto.randomBytes(n).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, n).toLowerCase();
const clip = (s, n = 300) => String(s ?? '').slice(0, n);

const VERIFY_ONLY = process.argv.includes('--verify-only');

// ── HTTP（同 run-round2-seq.mjs api()：429/5xx/池化403 退避 30s×3；anomalies 计数）─────────
const ANOMALIES = [];
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
        ANOMALIES.push({ at: new Date().toISOString(), kind: 'http', status: res.status, where: `${method} ${urlPath}`, detail: clip(text, 200), retried: transient && attempt < retries });
        log(ctx, `  api-err: ${lastErr.message}${transient ? ' [transient, backoff 30s]' : ''}`);
        if (transient && attempt < retries) { await sleep(BACKOFF_MS); continue; }
        throw lastErr;
      }
      return json;
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /fetch failed|ECONNRESET|socket hang up/i.test(String(e?.message))) {
        lastErr = new Error(`${method} ${urlPath} network: ${clip(e?.message || e, 160)}`);
        ANOMALIES.push({ at: new Date().toISOString(), kind: 'network', where: `${method} ${urlPath}`, detail: clip(e?.message || e, 160), retried: attempt < retries });
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

// ── 账号 / 路径 / 开课（同 run-round2-seq.mjs）────────────────────────────
async function ensureAccount(ctx, state) {
  if (state.account?.name) {
    const login = await api(ctx, 'POST', '/api/auth/login', { name: state.account.name, password: PASSWORD, remember: true }, { timeout: 60000 });
    ctx.cookie = (login.__setCookie || '').split(';')[0];
    if (!ctx.cookie) throw new Error('重登未返回 cookie');
    log(ctx, `复用账号 name=${state.account.name} userId=${state.account.userId}`);
    return state.account;
  }
  const name = `f1-r3-${rand(5)}`;
  const reg = await api(ctx, 'POST', '/api/auth/register', { name, password: PASSWORD, remember: true }, { timeout: 60000 });
  const login = await api(ctx, 'POST', '/api/auth/login', { name, password: PASSWORD, remember: true }, { timeout: 60000 });
  ctx.cookie = (login.__setCookie || '').split(';')[0];
  if (!ctx.cookie) throw new Error('login 未返回 cookie');
  const d = reg?.data || {};
  const userId = d?.user?.id || d?.id || d?.userId || null;
  const email = d?.user?.email || d?.email || `${name}@wenflow.local`;
  state.account = { name, userId, email, registeredAt: new Date().toISOString(), requestedName: 'f1-r3-@test.local', namingNote: '任务书名含 @/. 不可注册（routes/auth.ts:147 USERNAME_PATTERN 禁 @/.），实注册 f1-r3- 前缀名' };
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
      rec.openResponse = { sessionId: d.sessionId, mode: d.mode ?? null, revision: d.revision ?? null, welcomeHead: clip(d.welcomeMessage, 300) };
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

// ── 课堂回合 / 检查点（同 run-round2-seq.mjs）────────────────────────────
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

// 作答策略（同 run-round2-seq.mjs）
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
const ctxLast = () => String(globalThis.__r3ctx?.lastTeacher || '');
const ctxPrev = () => String(globalThis.__r3ctx?.prevTeacher || '');
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

// 故意答错两次（同 run-round2-seq.mjs deliberatelyFail）
async function deliberatelyFail(ctx, sessionId, cp, rec, tag) {
  const wrongPayloads = [];
  if (cp.type === 'short_answer') {
    wrongPayloads.push({ answerText: WRONG_SHORT_ANSWERS[0] }, { answerText: WRONG_SHORT_ANSWERS[1] });
  } else {
    const rankedAsc = rankOptions(cp).slice().reverse();
    if (rankedAsc.length >= 3) wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] }, { selectedOptionIds: [rankedAsc[1].id] });
    else {
      if (rankedAsc.length >= 1) wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] });
      if (rankedAsc.length >= 2) wrongPayloads.push({ selectedOptionIds: [rankedAsc[0].id] });
    }
  }
  const exp = { phase: tag, checkpointId: cp.id, type: cp.type, conceptName: cp.conceptName ?? null, conceptKey: cp.conceptKey ?? null, question: clip(cp.question || cp.title, 160), attempts: [] };
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

// 课堂推进至检查点（同 run-round2-seq.mjs；学生话术库同源）
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
      checkpoint: d?.checkpoint ? { id: d.checkpoint.id, type: d.checkpoint.type, conceptName: d.checkpoint.conceptName ?? null, conceptKey: d.checkpoint.conceptKey ?? null, conceptSource: d.checkpoint.conceptSource ?? null, question: clip(d.checkpoint.question || d.checkpoint.title, 160) } : null,
      isCompletion: d?.isCompletion === true,
      revision: ctx.revision,
    };
    rec.turns.push(entry);
    log(ctx, `turn${t}: understanding=${entry.understanding} ckpt=${entry.checkpoint ? `${entry.checkpoint.type}(concept=${entry.checkpoint.conceptName || '?'}/${entry.checkpoint.conceptKey || '?'})` : 'N'} isCompletion=${entry.isCompletion}`);
    let pending = d?.checkpoint || null;
    if (!pending) pending = await currentPending(ctx, sessionId);
    if (pending) {
      rec.pendingAt = { turn: t, checkpoint: { id: pending.id, type: pending.type, conceptName: pending.conceptName ?? null, conceptKey: pending.conceptKey ?? null, conceptSource: pending.conceptSource ?? null, question: clip(pending.question || pending.title, 200) } };
      return pending;
    }
  }
  return null;
}
async function closeSessionBestEffort(ctx, sessionId, tag) {
  try {
    const det = await api(ctx, 'GET', `/api/ai-teaching/sessions/${sessionId}/detail`, undefined, { timeout: 60000, retries: 1 });
    const rev = det?.data?.revision ?? ctx.revision ?? 0;
    const r = await api(ctx, 'POST', `/api/ai-teaching/sessions/${sessionId}/finalize`,
      { action: 'end_only', revision: rev, reason: 'manual-end' },
      { idempotencyKey: `r3-close-${tag}-${rand(6)}`, timeout: 120000, retries: 1 });
    log(ctx, `  关课（${tag}）end_only -> ${r?.data?.status || r?.status || '?'}`);
    return true;
  } catch (e) {
    log(ctx, `  关课失败（${tag}）: ${clip(e?.message, 120)}`);
    return false;
  }
}
async function answerPendingNow(ctx, sessionId, rec, tag, cpFromResponse) {
  const cp = cpFromResponse || (await currentPending(ctx, sessionId));
  if (!cp) return null;
  await sleep(TURN_SLEEP_MS);
  const r = await answerCheckpointRight(ctx, sessionId, cp, { strongFirst: false });
  rec.checkpoints.push({ phase: tag, checkpointId: cp.id, conceptName: cp.conceptName ?? null, conceptKey: cp.conceptKey ?? null, question: clip(cp.question || cp.title, 120), submitLog: r.submitLog });
  if (!r.passed) {
    rec.notes.push(`${tag}: 检查点 ${cp.id} 两次作答均判错（如实记录）`);
    log(ctx, `  ${tag}: 检查点 ${cp.id} 两次均错，已强消`);
  } else {
    log(ctx, `  ${tag}: 检查点 ${cp.id} 已答对`);
  }
  return cp;
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
  const key = `mv-r3-f1-${rand(8)}`;
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
  log(ctx, `finalization settled: status=${out.finalStatus}`);
  return out;
}

// ── 概念名归一（与 checkpoint-shared.ts normalizeConceptName 同口径）────────
const normName = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, '');
const PLACEHOLDER_RE = /^concept-\d+$/i;
const DERIVED_RE = /^cpt_[0-9a-f]{16}$/;

// ── 验收（DB 只读直查）───────────────────────────────────────────────────
async function verifyF1(ctx, state, rec) {
  const userId = state.account.userId;
  const sessionId = rec.sessionId;
  const taskId = rec.taskId;
  const out = { capturedAt: new Date().toISOString(), sessionId, taskId, userId };

  // 证据行（本会话 checkpoint 两类）
  const ev = await dbAll(
    `SELECT id,evidenceType,eventId,evidenceKey,sessionId,taskId,payload,confidence,occurredAt
     FROM learner_evidence WHERE sessionId = ? AND evidenceType IN ('checkpoint:attempt','checkpoint:result')
     ORDER BY occurredAt`, [sessionId]);
  for (const e of ev) { try { e.payloadParsed = JSON.parse(e.payload || '{}'); } catch { e.payloadParsed = {}; } delete e.payload; }
  out.checkpointEvidence = ev.map((e) => ({
    id: e.id, evidenceType: e.evidenceType, eventId: e.eventId, taskId: e.taskId, occurredAt: e.occurredAt,
    checkpointId: e.payloadParsed.checkpointId ?? null,
    conceptName: e.payloadParsed.conceptName ?? null,
    conceptKey: e.payloadParsed.conceptKey ?? null,
    conceptSource: e.payloadParsed.conceptSource ?? null,
    outcome: e.payloadParsed.outcome ?? null, attempts: e.payloadParsed.attempts ?? null,
    passed: e.payloadParsed.passed ?? null, judgedBy: e.payloadParsed.judgedBy ?? null,
  }));

  // 第一个检查点的归属：优先 checkpoint 响应/挂起对象带的概念归属；证据行兜底
  const firstCpId = rec.firstCheckpoint?.id || rec.deliberateFail?.checkpointId || null;
  const attributionFromResponse = {
    conceptName: rec.pendingAt?.checkpoint?.conceptName ?? rec.firstCheckpoint?.conceptName ?? null,
    conceptKey: rec.pendingAt?.checkpoint?.conceptKey ?? rec.firstCheckpoint?.conceptKey ?? null,
    conceptSource: rec.pendingAt?.checkpoint?.conceptSource ?? null,
  };
  // 注意：过滤后立即投影成与 out.checkpointEvidence 同形状（conceptKey 顶级字段），
  // 供下方 v2 计数直接消费（首轮实跑教训：拿原始行 r.conceptKey 计数恒 0）
  const firstEvRows = ev
    .filter((e) => e.payloadParsed.checkpointId === firstCpId)
    .map((e) => ({
      id: e.id, evidenceType: e.evidenceType, occurredAt: e.occurredAt,
      checkpointId: e.payloadParsed.checkpointId ?? null,
      conceptName: e.payloadParsed.conceptName ?? null,
      conceptKey: e.payloadParsed.conceptKey ?? null,
      conceptSource: e.payloadParsed.conceptSource ?? null,
      passed: e.payloadParsed.passed ?? null,
      judgedBy: e.payloadParsed.judgedBy ?? null,
      outcome: e.payloadParsed.outcome ?? null,
      attempts: e.payloadParsed.attempts ?? null,
    }));
  const attributionFromEvidence = {
    conceptName: firstEvRows.map((e) => e.conceptName).find(Boolean) ?? null,
    conceptKey: firstEvRows.map((e) => e.conceptKey).find(Boolean) ?? null,
  };
  out.firstCheckpoint = {
    id: firstCpId, type: rec.firstCheckpoint?.type ?? null, question: rec.firstCheckpoint?.question ?? null,
    attributionFromResponse, attributionFromEvidence,
    exhaustedRow: firstEvRows.filter((e) => e.evidenceType === 'checkpoint:attempt' && e.outcome === 'attempts_exhausted').map((e) => ({ id: e.id, conceptKey: e.conceptKey, attempts: e.attempts })),
    falseResultRows: firstEvRows.filter((e) => e.evidenceType === 'checkpoint:result' && e.passed === false).map((e) => ({ id: e.id, conceptKey: e.conceptKey, judgedBy: e.judgedBy })),
  };
  const resolvedConceptName = attributionFromEvidence.conceptName || attributionFromResponse.conceptName || null;
  const resolvedConceptKey = attributionFromEvidence.conceptKey || attributionFromResponse.conceptKey || null;
  out.resolvedAttribution = { conceptName: resolvedConceptName, conceptKey: resolvedConceptKey };

  // 课末会话板
  const sess = await dbGet(
    `SELECT id,mode,status,revision,endTime,duration,startTime,knowledgeState,wrapup FROM teaching_sessions WHERE id = ?`, [sessionId]);
  let board = null; try { board = sess?.knowledgeState ? JSON.parse(sess.knowledgeState) : null; } catch { board = 'PARSE_FAIL'; }
  out.finalBoard = board;
  const points = Array.isArray(board) ? board : (Array.isArray(board?.points) ? board.points : []);
  const matched = resolvedConceptName
    ? points.filter((p) => normName(p.name) === normName(resolvedConceptName))
    : [];
  out.matchedBoardPoints = matched;
  const cptStatus = matched.length ? matched[0].status : '(concept-not-on-board)';
  out.firstConceptBoardStatus = cptStatus;
  // derived 键回查 memory_traces（cpt_ 键是否落记忆层）
  out.memoryTraceByDerivedKey = resolvedConceptKey && DERIVED_RE.test(resolvedConceptKey)
    ? await dbGet(`SELECT conceptKey,label,masteryScore,stability,fsrsStability,fsrsReps,source,dueAt,lastSeenAt FROM memory_traces WHERE userId = ? AND conceptKey = ?`, [userId, resolvedConceptKey])
    : null;

  // V2：全部 checkpoint 行的归属键质量
  const allCkRows = out.checkpointEvidence;
  out.v2_detail = {
    rowsTotal: allCkRows.length,
    rowsWithDerivedKey: allCkRows.filter((r) => r.conceptKey && DERIVED_RE.test(r.conceptKey)).length,
    rowsWithPlaceholderKey: allCkRows.filter((r) => r.conceptKey && PLACEHOLDER_RE.test(r.conceptKey)).length,
    rowsWithoutKey: allCkRows.filter((r) => !r.conceptKey).length,
    firstCpRows: firstEvRows.length,
    firstCpRowsWithDerivedKey: firstEvRows.filter((r) => r.conceptKey && DERIVED_RE.test(r.conceptKey)).length,
  };
  // 误解台账占位检查（旁证 F1-c 改挂）
  out.misconceptionLedger = await dbAll(
    `SELECT id,conceptKey,canonicalLabel,status,confidence,firstSeenAt FROM misconception_ledger WHERE userId = ?`, [userId]);
  out.v2_ledgerPlaceholderKeys = out.misconceptionLedger.filter((l) => PLACEHOLDER_RE.test(l.conceptKey || '')).length;

  // V3：prediction_records 该任务 outcome（轮询等 backfill，最长 5 分钟）
  let preds = [];
  for (let i = 0; i < 10; i++) {
    preds = await dbAll(
      `SELECT id,pathId,taskId,sessionId,stallRisk,predictedTone,suggestedDepth,focusConcepts,rationale,outcome,outcomeAt,createdAt
       FROM prediction_records WHERE userId = ? AND taskId = ? ORDER BY createdAt`, [userId, taskId]);
    if (preds.some((p) => p.outcome)) break;
    await sleep(30000);
  }
  out.predictionRecords = preds;

  // ── 三判据 ──
  out.verdicts = {
    // V1：检查点概念课末不是 mastered（阻断晋升落 learning；mastered+evidenceSource 视为未阻断）
    v1_checkpointConceptNotMastered: matched.length > 0
      ? matched[0].status !== 'mastered'
      : false,
    v1_detail: matched.length
      ? { name: matched[0].name, status: matched[0].status, progress: matched[0].progress, evidenceSource: matched[0].evidenceSource ?? null }
      : { note: '按归属概念名未在课末板匹配到点', boardPointNames: points.map((p) => p.name) },
    // V2：第一个检查点的证据行带 cpt_ 派生键，且全部 checkpoint 行无 concept-N 占位
    v2_firstCpRowsHaveDerivedKey: firstEvRows.length > 0 && firstEvRows.every((r) => r.conceptKey && DERIVED_RE.test(r.conceptKey)),
    v2_noPlaceholderKeys: out.v2_detail.rowsWithPlaceholderKey === 0 && out.v2_ledgerPlaceholderKeys === 0,
    // V3：该任务 prediction outcome=struggled
    v3_predictionStruggled: preds.length > 0 && preds.every((p) => p.outcome === 'struggled'),
    v3_outcomes: preds.map((p) => ({ id: p.id, outcome: p.outcome, outcomeAt: p.outcomeAt, predictedTone: p.predictedTone })),
  };
  out.allPass = out.verdicts.v1_checkpointConceptNotMastered
    && out.verdicts.v2_firstCpRowsHaveDerivedKey && out.verdicts.v2_noPlaceholderKeys
    && out.verdicts.v3_predictionStruggled;
  return out;
}

// ── 主流程 ───────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));
}

async function main() {
  log({ id: 'f1' }, `=== R3 F1 活体复测开始 === base=${BASE} verifyOnly=${VERIFY_ONLY}`);
  const state = loadState();
  const ctx = { id: 'f1', cookie: '', revision: 0, lastTeacher: '', prevTeacher: '' };
  globalThis.__r3ctx = ctx;

  if (VERIFY_ONLY) {
    if (!state.account?.userId || !state.f1?.sessionId) throw new Error('--verify-only 需要已有 out/r3-f1.state.json（account/session）');
    const rec = { sessionId: state.f1.sessionId, taskId: state.f1.taskId, firstCheckpoint: state.f1.firstCheckpoint, pendingAt: state.f1.pendingAt, deliberateFail: state.f1.deliberateFail, checkpoints: state.f1.checkpoints || [], notes: [] };
    const verification = await verifyF1(ctx, state, rec);
    fs.writeFileSync(RESULT_PATH, JSON.stringify({ scenarioId: 'r3-f1', verifyOnly: true, anomalies: ANOMALIES, verification }, null, 1));
    log(null, `[done] verify-only → ${RESULT_PATH} verdicts=${JSON.stringify(verification.verdicts)}`);
    return;
  }

  const rec = {
    scenarioId: 'r3-f1', channel: 'api', startedAt: new Date().toISOString(), base: BASE, goalText: GOAL_TEXT,
    turns: [], checkpoints: [], notes: [], errors: [],
  };
  const t0 = Date.now();
  try {
    await ensureAccount(ctx, state);
    await generatePath(ctx, state);
    saveState(state);
    const tasks = await waitForTasks(ctx, state.pathId, 2);
    state.tasks = tasks; saveState(state);
    const task = tasks[0];
    rec.taskId = task.id; rec.taskTitle = task.title;
    const started = await startSession(ctx, task.id, rec);
    rec.sessionId = started.sessionId;
    state.f1 = { taskId: task.id, sessionId: rec.sessionId, startedAt: rec.startedAt };
    saveState(state);

    // 第一个检查点：连答两错到顶
    let cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec);
    if (!cp) {
      log(ctx, '前 12 轮无检查点，恢复 8 轮');
      cp = await driveUntilCheckpoint(ctx, rec.sessionId, rec, { maxTurns: 8 });
    }
    if (!cp) {
      await closeSessionBestEffort(ctx, rec.sessionId, 'f1-no-checkpoint');
      throw new Error('20 轮内未出现第一个检查点——会话已 end_only 关闭');
    }
    rec.checkpoints.push({ phase: 'first-target', ...rec.pendingAt });
    rec.firstCheckpoint = { id: cp.id, type: cp.type, conceptName: cp.conceptName ?? null, conceptKey: cp.conceptKey ?? null, conceptSource: cp.conceptSource ?? null, question: clip(cp.question || cp.title, 200) };
    state.f1.firstCheckpoint = rec.firstCheckpoint;
    state.f1.pendingAt = rec.pendingAt;
    saveState(state);
    log(ctx, `第一个检查点（种弱点目标）：${rec.firstCheckpoint.question} concept=${cp.conceptName || '?'}/${cp.conceptKey || '?'}`);
    const fr = await deliberatelyFail(ctx, rec.sessionId, cp, rec, 'deliberate-fail-1');
    rec.deliberateFail = fr.exp;
    state.f1.deliberateFail = rec.deliberateFail;
    saveState(state);
    if (!fr.failed) {
      rec.notes.push('第一个检查点未能两次错答到顶（被误判对或仍挂起）——cap 实验未按剧本落地，如实记录');
    }

    // 其后检查点全部答对 + 讨完课
    for (let t = 1; t <= 6; t++) {
      await sleep(TURN_SLEEP_MS);
      const message = t <= 4 ? studentSay(ctx, t + 10) : '老师，这一部分我感觉掌握得差不多了，帮我结算收尾这一节课吧，剩下的我课后自己练。';
      const d = await sendTurn(ctx, rec.sessionId, message);
      rec.turns.push({ turn: `post-fail-${t}`, student: message, aiHead: clip(d?.aiResponse, 150), checkpoint: d?.checkpoint ? { id: d.checkpoint.id, type: d.checkpoint.type, conceptName: d.checkpoint.conceptName ?? null, conceptKey: d.checkpoint.conceptKey ?? null } : null, isCompletion: d?.isCompletion === true });
      log(ctx, `post-fail turn${t}: ckpt=${d?.checkpoint ? 'Y' : 'N'} isCompletion=${d?.isCompletion}`);
      if (d?.checkpoint) await answerPendingNow(ctx, rec.sessionId, rec, `post-fail-turn${t}`, d.checkpoint);
    }
    const clean = await clearPendingBeforeFinalize(ctx, rec.sessionId);
    rec.pendingCleanup = clean;
    rec.finalize = await finalizeAndSettle(ctx, rec.sessionId, 'complete_task', 'task-completed');

    // 验收（DB 直查）
    rec.verification = await verifyF1(ctx, state, rec);
    rec.status = rec.verification.allPass ? 'done' : (rec.finalize?.finalStatus === 'completed' ? 'partial' : 'failed');
  } catch (e) {
    rec.status = 'failed';
    rec.fatal = clip(e?.message || e, 500);
    log(ctx, `FATAL[f1]: ${clip(e?.stack || e, 600)}`);
    if (rec.sessionId) await closeSessionBestEffort(ctx, rec.sessionId, 'f1-fatal');
  } finally {
    rec.finishedAt = new Date().toISOString();
    rec.durationMs = Date.now() - t0;
    rec.anomalies = ANOMALIES;
    fs.writeFileSync(RESULT_PATH, JSON.stringify(rec, null, 1));
    saveState(state);
    log(null, `[done] r3-f1 status=${rec.status} duration=${Math.round(rec.durationMs / 1000)}s → ${RESULT_PATH}`);
  }
}

main().catch((e) => {
  log(null, `MAIN-FATAL: ${clip(e?.stack || e, 800)}`);
  process.exitCode = 1;
});
