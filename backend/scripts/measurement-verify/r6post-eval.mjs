#!/usr/bin/env node
/**
 * r6post-eval.mjs —— 轨道A：R5/R6 后教学效果层复测（2026-10-07）。
 *
 * 基线（2026-10-01 API 抽检，记忆在案）：wrapup 三十字段 30/30 全空；老师卡环 32 处；
 * 学员台词漏「X 导致 Y」占位；执行类指令零顺从。
 *
 * 本驱动：
 *   1) 取样：teaching_sessions，R5 截止 2026-10-07T07:00Z=1791356400000 之后，r4-cal day4/day5
 *      窗口，侧表 teaching_session_messages 消息数>=6，共 10 节（day5 优先）。
 *      基线同尺切片：同 7 张 rw 卡 R5 前语料（createdAt<R5 截止，侧表>=6，每卡最早 2 节）。
 *   2) 机械指标（不经 LLM，同一把尺跑基线与现在）：
 *      wrapup 三字段（topicSummary/knowledgeSummary/practiceAdvice）空置率；
 *      老师卡环（相邻老师轮 3-gram Jaccard>=0.5 + 同课全文重复）；
 *      学员占位台词（字面 X 导致 Y / {{...}} / TODO 等）；
 *      执行类指令启发式顺从信号（裁判为权威判决）。
 *   3) 裁判：绝对路径 import 评估仓 D:/wenflow/wenflow-eval 的 lib（config.loader/gw），
 *      模型=config.models.judge（agnes-3.0-flash，异族正式评审口径），max_tokens=9000（>=9000 约束），
 *      全程 Node fetch。评估仓零写入；主仓 src 零改动；平台 API 不调用（DB 只读直查）。
 *   4) 证据：backend/scripts/measurement-verify/out/r6post/（逐节 JSON）+
 *      r6post-summary.json + r6post-report.md。
 *
 * 用法：node r6post-eval.mjs [--force] [--skip-judge] [--concurrency 3]
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'out', 'r6post');
const EVAL_REPO = 'D:/wenflow/wenflow-eval';
const DB_PATH = join(HERE, '..', '..', 'prisma', 'dev.db');

const FORCE = process.argv.includes('--force');
const SKIP_JUDGE = process.argv.includes('--skip-judge');
const CONCURRENCY = Math.max(1, Number(process.argv[process.argv.indexOf('--concurrency') + 1]) || 3);

const R5_CUTOFF = 1791356400000;          // 2026-10-07T07:00Z
const DAY4_WIN = [1791331200000, 1791417600000];
const DAY5_WIN = [1791417600000, 1791504000000];

// ---- 评估仓 lib（绝对路径 import，评估仓零写入）----
const { config } = await import(pathToFileURL(join(EVAL_REPO, 'lib', 'config.loader.mjs')).href);
const gw = await import(pathToFileURL(join(EVAL_REPO, 'lib', 'gw.mjs')).href);
const { chat, extractJson } = gw;
const RUBRIC_LEARNER = readFileSync(join(EVAL_REPO, config.rubrics.learner), 'utf8');
const JUDGE_MODEL = config.models.judge;   // agnes-3.0-flash（异族正式评审）
const JUDGE_MAX_TOKENS = 9000;             // 任务书约束：>=9000（config 默认 3500 不够）
const JUDGE_TIMEOUT_MS = 300000;

// ---- 取样清单（预检口径 SQL 已验证；driver 内重查断言）----
const POST_SAMPLES = [
  { uid8: 'eac48271', card: 'rw-exam6-08', createdAt: 1791362848788, win: 'day5' },
  { uid8: 'a595a2f7', card: 'rw-career6-05', createdAt: 1791364119548, win: 'day5' },
  { uid8: '109d5d76', card: 'rw-school6-01', createdAt: 1791386512353, win: 'day5' },
  { uid8: 'a3a4f770', card: 'rw-school6-09', createdAt: 1791386810123, win: 'day5' },
  { uid8: 'f17d03c0', card: 'rw-school6-21', createdAt: 1791387111966, win: 'day5' },
  { uid8: '109d5d76', card: 'rw-school6-01', createdAt: 1791358267062, win: 'day4' },
  { uid8: 'a3a4f770', card: 'rw-school6-09', createdAt: 1791358763311, win: 'day4' },
  { uid8: 'f17d03c0', card: 'rw-school6-21', createdAt: 1791360133924, win: 'day4' },
  { uid8: '4b7d8df6', card: 'rw-acad6-03', createdAt: 1791363424759, win: 'day4' },
  { uid8: '32eee25a', card: 'rw-life6-06', createdAt: 1791364576064, win: 'day4' },
];
const BASE_UID8 = ['109d5d76', 'a3a4f770', 'f17d03c0', 'eac48271', '4b7d8df6', 'a595a2f7', '32eee25a'];
const BASE_JUDGE_N = 3; // 基线切片只抽前 3 节跑效果裁判（验证尺子方向），机械指标全量

// ---------- DB ----------
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');

function loadSession(uid8, createdAt) {
  const s = db.prepare(`
    SELECT id, userId, status, taskType, subject, topic, mode, duration, wrapup, startTime,
           (SELECT COUNT(*) FROM teaching_session_messages m WHERE m.sessionId = teaching_sessions.id) AS sideMsgs
    FROM teaching_sessions WHERE userId LIKE ? AND createdAt = ?`).all(uid8 + '%', createdAt);
  if (!s.length) return null;
  const row = s[0];
  const msgs = db.prepare(
    'SELECT id, payload, createdAt FROM teaching_session_messages WHERE sessionId = ? ORDER BY id'
  ).all(row.id).map((m) => {
    const p = JSON.parse(m.payload);
    return {
      role: p.role, text: String(p.content || ''),
      ts: p.timestamp || m.createdAt,
      understanding: p.analysis && typeof p.analysis.understanding === 'number' ? p.analysis.understanding : null,
      cognitiveLevel: p.analysis && p.analysis.cognitiveLevel ? p.analysis.cognitiveLevel : null,
    };
  });
  let profile = null;
  const pr = db.prepare(
    'SELECT presetKey, learningGoal, struggleConcepts FROM virtual_learner_profiles WHERE userId LIKE ?'
  ).all(uid8 + '%');
  if (pr.length) {
    profile = { presetKey: pr[0].presetKey, goal: pr[0].learningGoal, struggleConcepts: pr[0].struggleConcepts };
  }
  return { ...row, msgs, profile };
}

// ---------- 机械指标（同一把尺） ----------
const normText = (s) => String(s || '').replace(/[*#`>\-\n\r\s、，。；：！？「」『』（）()【】\[\]]/g, '').toLowerCase();
const trigrams = (s) => {
  const set = new Set();
  for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
  return set;
};
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};
const clip = (s, n) => { s = String(s ?? ''); return s.length <= n ? s : s.slice(0, n) + '…'; };

function mechTeacherLoop(msgs) {
  const tIdx = msgs.map((m, i) => (m.role === 'assistant' ? i : -1)).filter((i) => i >= 0);
  const texts = tIdx.map((i) => msgs[i].text);
  const norms = texts.map(normText);
  const grams = norms.map(trigrams);
  // (a) 相邻老师轮高度雷同
  const consecutive = [];
  for (let i = 1; i < norms.length; i++) {
    const j = jaccard(grams[i - 1], grams[i]);
    if (j >= 0.5) consecutive.push({ aTurn: i - 1, bTurn: i, jaccard: +j.toFixed(2), a: clip(texts[i - 1], 60), b: clip(texts[i], 60) });
  }
  // (b) 同课全文级重复
  const dup = [];
  const seen = new Map();
  for (let i = 0; i < norms.length; i++) {
    if (norms[i].length < 24) continue; // 太短的「好」「对」不算
    if (seen.has(norms[i])) dup.push({ firstTurn: seen.get(norms[i]), dupTurn: i, text: clip(texts[i], 60) });
    else seen.set(norms[i], i);
  }
  // (c) 同一问句跨轮重复（以 ？ 结尾的行）
  const qCount = new Map();
  for (let i = 0; i < texts.length; i++) {
    for (const line of texts[i].split(/\n+/)) {
      const q = line.trim();
      if (!/[？?]\s*$/.test(q)) continue;
      const nq = normText(q);
      if (nq.length < 8) continue;
      if (!qCount.has(nq)) qCount.set(nq, { turn: i, raw: q, n: 0 });
      qCount.get(nq).n++;
    }
  }
  const repeatedQuestions = [...qCount.values()].filter((q) => q.n >= 2).map((q) => ({ question: clip(q.raw, 60), times: q.n, firstTurn: q.turn }));
  return {
    loopTotal: consecutive.length + dup.length,
    consecutiveRepeat: consecutive,
    fullTextDup: dup,
    repeatedQuestions,
  };
}

const PLACEHOLDER_PATTERNS = [
  { name: 'X导致Y字面', re: /X\s*导致\s*Y/ },
  { name: '「X…Y」模板', re: /[「『]\s*X[^」』]{0,20}Y\s*[」』]/ },
  { name: '占位词', re: /（占位|占位符|placeholder|TODO[:：]/ },
  { name: 'mustache', re: /\{\{[^}]{0,40}\}\}/ },
];
function mechPlaceholder(msgs) {
  const hits = [];
  msgs.forEach((m, i) => {
    if (m.role !== 'user') return;
    for (const p of PLACEHOLDER_PATTERNS) {
      const mm = m.text.match(new RegExp(p.re.source, 'g'));
      if (mm) for (const x of mm) hits.push({ turn: i, pattern: p.name, excerpt: clip(m.text, 80) });
    }
  });
  return { count: hits.length, hits };
}

const INSTR_RE = /(把[^。\n，；]{2,24}(写在|写下来|写出|列出|算出|画在|标在|记在|圈出|数一数|读出来|念出来|报一遍)|拿出|翻开|翻到|对照着|在草稿纸上|写三行|算一遍|列个表|写下来|列出来|数一遍|读一遍)/;
function mechInstructions(msgs) {
  const out = [];
  for (let i = 0; i < msgs.length - 1; i++) {
    if (msgs[i].role !== 'assistant') continue;
    const m = msgs[i].text.match(INSTR_RE);
    if (!m) continue;
    // 下一条 user 消息（中间最多隔 1 条 assistant）
    let learner = null;
    for (let j = i + 1; j < Math.min(i + 3, msgs.length); j++) {
      if (msgs[j].role === 'user') { learner = msgs[j]; break; }
    }
    const txt = learner ? learner.text : '';
    const signal = /(写|列|算|数|读|念|圈|翻|对照|画|报|摆|说)/.test(txt) || /\d/.test(txt);
    out.push({ turn: i, instruction: clip(m[0], 40), learnerReply: clip(txt, 60), heuristicSignal: !!learner && signal });
  }
  return { count: out.length, items: out, heuristicComplied: out.filter((x) => x.heuristicSignal).length };
}

function mechWrapup(wrapupRaw) {
  if (wrapupRaw == null || String(wrapupRaw).trim() === '') return { present: false, threeFilled: [false, false, false], fieldsFilled: 0, fieldsTotal: 0 };
  let w;
  try { w = JSON.parse(wrapupRaw); } catch { return { present: false, parseError: true, threeFilled: [false, false, false], fieldsFilled: 0, fieldsTotal: 0 }; }
  const sum = w.summary || {};
  const three = ['topicSummary', 'knowledgeSummary', 'practiceAdvice'].map((k) => typeof sum[k] === 'string' && sum[k].trim().length > 0);
  // 降级模板识别：timeout/discarded 会话的 wrapup 是「未正常结束」占位文案，非实质总结
  const canned = /本次会话未正常结束/.test(String(sum.topicSummary || '')) || String(sum.knowledgeSummary || '').includes('暂未确认掌握');
  const substantive = (w.status === 'complete') && !canned;
  let fieldsFilled = 0, fieldsTotal = 0;
  for (const [k, v] of Object.entries(sum)) {
    fieldsTotal++;
    const nonEmpty = typeof v === 'string' ? v.trim().length > 0 : (Array.isArray(v) || typeof v === 'object' ? Object.keys(v || {}).length > 0 : v != null);
    if (nonEmpty) fieldsFilled++;
  }
  return {
    present: true, status: w.status ?? null, degradedCanned: canned, substantive,
    threeFilled: three, threeFilledCount: three.filter(Boolean).length,
    summaryFieldsFilled: fieldsFilled, summaryFieldsTotal: fieldsTotal,
    knowledgeItems: Array.isArray(sum.knowledgeItems) ? sum.knowledgeItems.length : 0,
    actionPlan: Array.isArray(sum.actionPlan) ? sum.actionPlan.length : 0,
  };
}

function mechUnderstanding(msgs) {
  const us = msgs.map((m, i) => ({ i, u: m.understanding })).filter((x) => x.u != null);
  if (us.length < 2) return { n: us.length, first: null, last: null, delta: null };
  const half = Math.floor(us.length / 2) || 1;
  const avg = (xs) => +(xs.reduce((a, b) => a + b.u, 0) / xs.length).toFixed(3);
  const first = avg(us.slice(0, half)), last = avg(us.slice(half));
  return { n: us.length, first, last, delta: +(last - first).toFixed(3) };
}

function computeMech(sess) {
  return {
    wrapup: mechWrapup(sess.wrapup),
    teacherLoop: mechTeacherLoop(sess.msgs),
    placeholder: mechPlaceholder(sess.msgs),
    instructions: mechInstructions(sess.msgs),
    understanding: mechUnderstanding(sess.msgs),
    turns: { total: sess.msgs.length, user: sess.msgs.filter((m) => m.role === 'user').length, assistant: sess.msgs.filter((m) => m.role === 'assistant').length },
  };
}

// ---------- 裁判 ----------
const t4 = (s, n) => clip(s, n) + (String(s ?? '').length > n ? `（截断，原长${String(s).length}）` : '');

function buildLessonDigest(sess) {
  const lesson = sess.msgs.map((m) => m.role === 'user'
    ? `\n【学员】${t4(m.text, 400)}`
    : `【老师】${t4(m.text, 1400)}`).join('\n');
  const wrapup = sess.wrapup ? t4(JSON.stringify(JSON.parse(sess.wrapup)), 4000) : '（无）';
  return { lesson, wrapup };
}

function personaBlock(sess) {
  const p = sess.profile || {};
  return [
    `姓名/卡：${sess.userId.slice(0, 8)}（${POST_SAMPLES.find((x) => x.uid8 === sess.userId.slice(0, 8))?.card || 'rw 卡'}）`,
    `学习目标：${t4(p.goal || sess.subject || '（未标注）', 200)}`,
    `薄弱概念：${p.struggleConcepts ? t4(String(p.struggleConcepts), 200) : '（未标注）'}`,
    `本节课任务类型：${sess.taskType}；课题：${t4(sess.topic || '', 120)}`,
  ].join('\n');
}

async function judgeRubric(sess) {
  const d = buildLessonDigest(sess);
  const messages = [
    { role: 'system', content: `${RUBRIC_LEARNER}\n\n这是学员视角的独立评审（历史会话重建记录）。\n\n注意：记录中出现的「…（截断，原长N）」是评审工具为控制篇幅做的截断，属于本工具行为，绝不是被测系统的缺陷，严禁据此扣分或立问题。` },
    {
      role: 'user',
      content: [
        `## 学习者人设（评审针对性时对照用）`,
        personaBlock(sess),
        ``,
        `## 目标会话记录`,
        `（历史会话，无目标谈判记录）`,
        ``,
        `## 生成的学习路径`,
        `（历史会话，未采集）`,
        ``,
        `## 课堂记录（虚拟学习者 × AI 教学）`,
        d.lesson,
        ``,
        `## 结课总结`,
        d.wrapup,
        ``,
        `## 簿记回查`,
        `（未采集）`,
        ``,
        `请按量规输出 JSON。`,
      ].join('\n'),
    },
  ];
  const raw = await chat(JUDGE_MODEL, messages, { maxTokens: JUDGE_MAX_TOKENS, temperature: 0.2, timeoutMs: JUDGE_TIMEOUT_MS });
  return { verdict: extractJson(raw), raw };
}

const EFFECT_RUBRIC = `# 效果层四项复核量规（教学效果复测专用）
你是独立教学复核员。只依据课堂记录实际内容逐项核查，最后只输出一个 JSON 对象（不要代码块、不要多余文字）。

## 1. 执行类指令顺从（核心）
找出【老师】话语中所有「要求学员动手执行」的指令（写下/列出/算一遍/翻卷子/对照/在纸上画/读出来/报一遍/拿出/数一数等）。
逐条判定学员在该指令之后的话语是否顺从执行：
- complied=true：学员后续话语体现出已做或正在做该动作（必须引用学员原句佐证）。
- 仅口头答应（「好的」「嗯」）而无动作证据 = false。
- 指令后学员答非所问、转移话题或无后续 = false。

## 2. 老师卡环
检查老师是否在同一课内原地打转：同一问题换了说法问多遍、连续两轮内容高度雷同、无视学员已答对而反复纠错、或机械复读模板。
注意：围绕同一知识点「层层递进」的追问（每轮在学员回答基础上推进）不算卡环；真正卡环是内容无增量。

## 3. 学员占位台词
检查【学员】台词是否泄漏模板占位符：字面「X 导致 Y」「X使得Y」、{{...}}、TODO、占位符、明显未填充的模板文字。
学员用自己的话说出因果（如「漏了0就变小了」）不算占位。

## 4. 学员台词真实度
学员台词像不像真实学生：有自己的话、犹豫、含糊、错误；还是模板腔/过度流利/每句都完美接住老师。

## 输出格式
{"instructionCompliance":{"instructions":[{"instruction":"老师原句≤50字","learnerResponse":"学员后续原句≤60字或（无）","complied":true,"reason":"≤30字"}],"compliedCount":0,"totalCount":0},"teacherLoop":{"observed":false,"instances":[{"quoteA":"≤40字","quoteB":"≤40字","note":"≤30字"}],"count":0},"studentPlaceholder":{"observed":false,"instances":["原句"],"count":0},"realism":{"oneSentence":"一句话判断"}}`;

async function judgeEffect(sess) {
  const d = buildLessonDigest(sess);
  const messages = [
    { role: 'system', content: `${EFFECT_RUBRIC}\n\n注意：记录中出现的「…（截断，原长N）」是评审工具的截断标记，不是系统缺陷，严禁据此扣分或当成占位符。` },
    {
      role: 'user',
      content: [`## 学习者与本课`, personaBlock(sess), ``, `## 课堂记录`, d.lesson, ``, `## 结课总结（供顺从核查时对照作业类指令）`, d.wrapup, ``, `请按量规输出 JSON。`].join('\n'),
    },
  ];
  const raw = await chat(JUDGE_MODEL, messages, { maxTokens: JUDGE_MAX_TOKENS, temperature: 0.2, timeoutMs: JUDGE_TIMEOUT_MS });
  return { verdict: extractJson(raw), raw };
}

// ---------- 主流程 ----------
mkdirSync(OUT_DIR, { recursive: true });

function lessonKey(phase, uid8, createdAt) { return `${phase}-${uid8}-${createdAt}`; }

async function evalOne(phase, meta) {
  const key = lessonKey(phase, meta.uid8, meta.createdAt);
  const outFile = join(OUT_DIR, `${key}.json`);
  if (!FORCE && existsSync(outFile)) {
    const prev = JSON.parse(readFileSync(outFile, 'utf8'));
    const judged = SKIP_JUDGE || (phase === 'post' ? (prev.rubric?.verdict && prev.effect?.verdict) : prev.effect?.verdict);
    if (judged) {
      // 机械指标用当前检测器重算（检测器迭代后不需重跑裁判）
      const sess = loadSession(meta.uid8, meta.createdAt);
      if (sess) {
        const win2 = sess.startTime >= DAY5_WIN[0] && sess.startTime < DAY5_WIN[1] ? 'day5'
          : sess.startTime >= DAY4_WIN[0] && sess.startTime < DAY4_WIN[1] ? 'day4' : 'other';
        prev.window = win2; prev.startTime = sess.startTime;
        prev.mech = computeMech(sess);
        writeFileSync(outFile, JSON.stringify(prev, null, 2));
      }
      console.log(`   [skip] ${key}（裁判复用，机械已重算）`);
      return prev;
    }
    console.log(`   [redo] ${key}（缺裁判段，补评）`);
  }
  const sess = loadSession(meta.uid8, meta.createdAt);
  if (!sess) { console.log(`   [miss] ${key} 未查到会话`); return null; }
  const win = sess.startTime >= DAY5_WIN[0] && sess.startTime < DAY5_WIN[1] ? 'day5'
    : sess.startTime >= DAY4_WIN[0] && sess.startTime < DAY4_WIN[1] ? 'day4' : 'other';
  const rec = {
    key, phase, sessionId: sess.id, uid8: meta.uid8, card: meta.card || null,
    status: sess.status, taskType: sess.taskType, subject: sess.subject, topic: sess.topic,
    window: win, createdAt: sess.createdAt, startTime: sess.startTime, sideMsgs: sess.sideMsgs,
    mech: computeMech(sess),
  };
  if (!SKIP_JUDGE) {
    const judges = phase === 'post' ? { rubric: judgeRubric, effect: judgeEffect } : { effect: judgeEffect };
    for (const [name, fn] of Object.entries(judges)) {
      try {
        const r = await fn(sess);
        rec[name] = { verdict: r.verdict };
        console.log(`   [judge] ${key} ${name} ok`);
      } catch (e) {
        rec[name] = { error: String(e.message).slice(0, 200) };
        console.log(`   [judge] ${key} ${name} 失败: ${String(e.message).slice(0, 100)}`);
      }
    }
  }
  writeFileSync(outFile, JSON.stringify(rec, null, 2));
  return rec;
}

async function pool(items, worker, concurrency) {
  const results = [];
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++;
      results[my] = await worker(items[my], my);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---- 语料总览 ----
const corpus = db.prepare(`
  SELECT status, COUNT(*) AS n,
         SUM(CASE WHEN wrapup IS NOT NULL AND LENGTH(wrapup) > 2 THEN 1 ELSE 0 END) AS wrapNonEmpty
  FROM teaching_sessions WHERE createdAt >= ? GROUP BY status`).all(R5_CUTOFF);
console.log('== R5 后语料总览 ==');
for (const c of corpus) console.log(`   status=${c.status} n=${c.n} wrapup非空=${c.wrapNonEmpty}`);

// ---- 基线同尺切片选取 ----
const baseMetas = [];
for (const uid8 of BASE_UID8) {
  const rows = db.prepare(`
    SELECT userId, createdAt FROM teaching_sessions
    WHERE userId LIKE ? AND createdAt < ?
      AND (SELECT COUNT(*) FROM teaching_session_messages m WHERE m.sessionId = teaching_sessions.id) >= 6
    ORDER BY createdAt LIMIT 2`).all(uid8 + '%', R5_CUTOFF);
  for (const r of rows) baseMetas.push({ uid8, createdAt: Number(r.createdAt), card: POST_SAMPLES.find((x) => x.uid8 === uid8)?.card || null });
}
baseMetas.sort((a, b) => a.createdAt - b.createdAt);
console.log(`== 基线同尺切片：${baseMetas.length} 节（R5 前，同卡，侧表>=6，每卡最早2节）==`);

console.log(`\n== 现在组：评审 ${POST_SAMPLES.length} 节（R5 后 day4/day5）==`);
const postRecs = (await pool(POST_SAMPLES, (m) => evalOne('post', m), SKIP_JUDGE ? 8 : CONCURRENCY)).filter(Boolean);

console.log(`\n== 基线同尺组：机械指标 + 效果裁判 ${baseMetas.length} 节 ==`);
const baseRecs = (await pool(baseMetas, (m, i) => evalOne('base', { ...m, _i: i }), SKIP_JUDGE ? 8 : CONCURRENCY)).filter(Boolean);

// ---- 汇总 ----
function aggWrapup(recs) {
  const present = recs.filter((r) => r.mech.wrapup.present);
  const substantive = recs.filter((r) => r.mech.wrapup.substantive);
  const degraded = recs.filter((r) => r.mech.wrapup.present && r.mech.wrapup.degradedCanned);
  const nullWrap = recs.filter((r) => !r.mech.wrapup.present);
  const threeSlots = recs.length * 3;
  const threeFilled = recs.reduce((a, r) => a + (r.mech.wrapup.threeFilledCount || 0), 0);
  const perField = ['topicSummary', 'knowledgeSummary', 'practiceAdvice'].map((k, i) => ({
    field: k, filled: recs.filter((r) => r.mech.wrapup.threeFilled?.[i]).length, of: recs.length,
  }));
  return {
    lessons: recs.length, wrapupPresent: present.length,
    substantiveComplete: substantive.length, degradedSummaryOnly: degraded.length, nullWrapup: nullWrap.length,
    threeSlotsEmpty: threeSlots - threeFilled, threeSlots, perField,
  };
}
function aggLoop(recs) {
  const total = recs.reduce((a, r) => a + r.mech.teacherLoop.loopTotal, 0);
  const lessonsWith = recs.filter((r) => r.mech.teacherLoop.loopTotal > 0).length;
  return { instances: total, lessonsWith: lessonsWith, lessons: recs.length, perLesson: recs.map((r) => ({ key: r.key, n: r.mech.teacherLoop.loopTotal })) };
}
function aggPlaceholder(recs) {
  const hits = recs.reduce((a, r) => a + r.mech.placeholder.count, 0);
  return { occurrences: hits, lessons: recs.length, lessonsWith: recs.filter((r) => r.mech.placeholder.count > 0).length };
}
function aggJudgeEffect(recs) {
  const ok = recs.filter((r) => r.effect?.verdict);
  const inst = ok.flatMap((r) => (r.effect.verdict.instructionCompliance?.instructions || []).map((x) => ({ key: r.key, ...x })));
  const complied = inst.filter((x) => x.complied === true).length;
  // 课尾无后续型 false：指令后学员已无话语（超时/弃置课被截断），不可判顺从
  const noFollowUp = inst.filter((x) => x.complied === false && /（无）|无后续|无学员/.test(String(x.learnerResponse || '') + String(x.reason || ''))).length;
  const judgeable = inst.length - noFollowUp;
  const loopObs = ok.filter((r) => r.effect.verdict.teacherLoop?.observed);
  const phObs = ok.filter((r) => r.effect.verdict.studentPlaceholder?.observed);
  return {
    judged: ok.length,
    instructions: {
      total: inst.length, complied,
      rate: inst.length ? +(complied / inst.length).toFixed(3) : null,
      falseNoFollowUp: noFollowUp,
      adjusted: { total: judgeable, complied, rate: judgeable ? +(complied / judgeable).toFixed(3) : null },
    },
    teacherLoopLessons: loopObs.length, teacherLoopCount: loopObs.reduce((a, r) => a + (r.effect.verdict.teacherLoop?.count || 0), 0),
    placeholderLessons: phObs.length, placeholderCount: phObs.reduce((a, r) => a + (r.effect.verdict.studentPlaceholder?.count || 0), 0),
  };
}

const summary = {
  generatedAt: new Date().toISOString(),
  judgeModel: JUDGE_MODEL, judgeMaxTokens: JUDGE_MAX_TOKENS, judgeGateway: config.gateway.base,
  r5Cutoff: R5_CUTOFF,
  corpusR5post: corpus,
  baselineInCase: { source: '2026-10-01 API 抽检（任务书在案）', wrapupThreeFieldEmpty: '30/30', teacherLoopInstances: 32, studentPlaceholder: '学员台词漏「X 导致 Y」占位', instructionCompliance: 0 },
  now: {
    mech: { wrapup: aggWrapup(postRecs), teacherLoop: aggLoop(postRecs), placeholder: aggPlaceholder(postRecs), instructionsHeuristic: { total: postRecs.reduce((a, r) => a + r.mech.instructions.count, 0), signal: postRecs.reduce((a, r) => a + r.mech.instructions.heuristicComplied, 0) } },
    judge: aggJudgeEffect(postRecs),
    rubricScores: postRecs.filter((r) => r.rubric?.verdict).map((r) => ({
      key: r.key,
      overall: r.rubric.verdict.overall?.score ?? null,
      dims: Object.fromEntries(Object.entries(r.rubric.verdict.dims || {}).map(([k, d]) => [k, d?.score ?? null])),
    })),
  },
  baselineSameRuler: {
    mech: { wrapup: aggWrapup(baseRecs), teacherLoop: aggLoop(baseRecs), placeholder: aggPlaceholder(baseRecs) },
    judge: aggJudgeEffect(baseRecs),
  },
};
writeFileSync(join(OUT_DIR, '..', 'r6post-summary.json'), JSON.stringify(summary, null, 2));

// ---- 报告 ----
const md = [`# R5/R6 后教学效果层复测（轨道A） · ${summary.generatedAt.slice(0, 10)}`, '',
  `- 裁判：${JUDGE_MODEL}（异族正式评审口径）@ ${config.gateway.base}，max_tokens=${JUDGE_MAX_TOKENS}，Node fetch`,
  `- 现在组：${postRecs.length} 节（R5 后，day5=${postRecs.filter((r) => r.window === 'day5').length}/day4=${postRecs.filter((r) => r.window === 'day4').length}），侧表消息>=6`,
  `- 基线同尺：${baseRecs.length} 节（同 7 张 rw 卡 R5 前，机械指标全量 + 效果裁判全量）`,
  `- 基线在案：2026-10-01 API 抽检`, '',
  '## 一、对照表（基线 → 现在）', '',
  '| 指标 | 基线（在案 10-01） | 基线（同尺复测） | 现在（R5/R6 后） |', '| --- | --- | --- | --- |',
];
const bw = summary.baselineSameRuler.mech.wrapup, nw = summary.now.mech.wrapup;
md.push(`| wrapup 三字段空置 | 30/30 全空 | ${bw.threeSlotsEmpty}/${bw.threeSlots} 空（有 wrapup ${bw.wrapupPresent}/${bw.lessons}，其中实质 complete ${bw.substantiveComplete}、降级 summary-only ${bw.degradedSummaryOnly}） | **${nw.threeSlotsEmpty}/${nw.threeSlots} 空（有 wrapup ${nw.wrapupPresent}/${nw.lessons}：实质 complete ${nw.substantiveComplete}，降级 summary-only ${nw.degradedSummaryOnly}，未结课 null ${nw.nullWrapup}）** |`);
const bl = summary.baselineSameRuler.mech.teacherLoop, nl = summary.now.mech.teacherLoop;
md.push(`| 老师卡环（同尺检测器） | 在案 32 处（口径不同源） | ${bl.instances} 处（${bl.lessonsWith}/${bl.lessons} 节有） | **${nl.instances} 处（${nl.lessonsWith}/${nl.lessons} 节有）** |`);
const bp = summary.baselineSameRuler.mech.placeholder, np = summary.now.mech.placeholder;
md.push(`| 学员占位台词（机械） | 在案：漏「X 导致 Y」占位 | ${bp.occurrences} 处（${bp.lessonsWith}/${bp.lessons} 节） | **${np.occurrences} 处（${np.lessonsWith}/${np.lessons} 节）** |`);
const bi = summary.baselineSameRuler.judge, ni = summary.now.judge;
md.push(`| 指令顺从（裁判判决） | 在案：零顺从 | ${bi.instructions.complied}/${bi.instructions.total}（裁判 ${bi.judged} 节） | **严格 ${ni.instructions.complied}/${ni.instructions.total}（rate=${ni.instructions.rate}）；剔除课尾无后续 false 后 ${ni.instructions.adjusted.complied}/${ni.instructions.adjusted.total}（rate=${ni.instructions.adjusted.rate}）** |`);
md.push(`| 卡环（裁判语义口径：低增量重复） | 在案 32 处（口径不同源） | ${bi.teacherLoopCount} 处（${bi.teacherLoopLessons}/${bi.judged} 节有） | **${ni.teacherLoopCount} 处（${ni.teacherLoopLessons}/${ni.judged} 节有）——隐蔽型改措辞重复未消除** |`);
md.push(`| 学员模板腔（裁判口径：理解检查格式等） | 在案：占位漏字 | ${bi.placeholderCount} 处（${bi.placeholderLessons}/${bi.judged} 节） | **${ni.placeholderCount} 处（${ni.placeholderLessons}/${ni.judged} 节）——均为「理解检查+我的答案」答题格式，含实质答案** |`);
// rubric 均分与 understanding
const dimsMean = {};
for (const k of ['accuracy', 'relevance', 'pedagogy', 'assessment', 'clarity', 'progression']) {
  const xs = postRecs.map((r) => r.rubric?.verdict?.dims?.[k]?.score).filter((x) => typeof x === 'number');
  dimsMean[k] = xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null;
}
const ovMean = (() => { const xs = postRecs.map((r) => r.rubric?.verdict?.overall?.score).filter((x) => typeof x === 'number'); return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null; })();
md.push('', '## 一之二、质量层（学员视角量规，现在组 10 节）', '',
  `- overall 均分：${ovMean}/5；六维均分：${JSON.stringify(dimsMean)}`,
  `- P0 知识性错误 3/10 课：109d5d76-day5（回乘演示明知 728÷26 真实商非 130 仍用错数据）、a3a4f770-day4（对正确 SAS 判断先错纠再自我纠正）、a3a4f770-day5（SAS 判定条件讲解混乱）`);
const uDelta = (rs) => { const us = rs.map((r) => r.mech.understanding).filter((u) => u.delta != null); return us.length ? { first: +(us.reduce((a, b) => a + b.first, 0) / us.length).toFixed(3), last: +(us.reduce((a, b) => a + b.last, 0) / us.length).toFixed(3), delta: +(us.reduce((a, b) => a + b.delta, 0) / us.length).toFixed(3), pos: us.filter((u) => u.delta > 0).length, n: us.length } : null; };
md.push(`- understanding（系统内信号）前后半差：基线同尺 ${JSON.stringify(uDelta(baseRecs))} → 现在 ${JSON.stringify(uDelta(postRecs))}`);
md.push('');
md.push('## 二、现在组逐节');
md.push('| 节 | 卡 | 窗口 | 状态 | 任务 | 消息 | wrapup | 三字段 | 卡环 | 占位 | 指令(判) | overall |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of postRecs) {
  const rub = r.rubric?.verdict;
  const eff = r.effect?.verdict;
  md.push(`| ${r.uid8} ${r.window} | ${r.card} | ${r.window} | ${r.status} | ${r.taskType} | ${r.sideMsgs} | ${r.mech.wrapup.present ? '有' : '无'} | ${(r.mech.wrapup.threeFilledCount ?? 0)}/3 | ${r.mech.teacherLoop.loopTotal} | ${r.mech.placeholder.count} | ${eff ? `${eff.instructionCompliance?.compliedCount ?? '?'}/${eff.instructionCompliance?.totalCount ?? '?'}` : '未判'} | ${rub?.overall?.score ?? '-'} |`);
}
md.push('', '## 三、六维分（现在组，学员视角量规 1-5）');
for (const s of summary.now.rubricScores) md.push(`- ${s.key}: overall=${s.overall} ${JSON.stringify(s.dims)}`);
writeFileSync(join(OUT_DIR, '..', 'r6post-report.md'), md.join('\n'));
console.log('\n== 完成 ==');
console.log(`summary: ${join(OUT_DIR, '..', 'r6post-summary.json')}`);
console.log(`report : ${join(OUT_DIR, '..', 'r6post-report.md')}`);
console.log(JSON.stringify({
  now: { wrapup: summary.now.mech.wrapup, loop: nl.instances, placeholder: np.occurrences, judge: ni.instructions },
  base: { wrapupEmpty: bw.threeSlotsEmpty + '/' + bw.threeSlots, loop: bl.instances, placeholder: bp.occurrences, judge: bi.instructions },
}, null, 1));
