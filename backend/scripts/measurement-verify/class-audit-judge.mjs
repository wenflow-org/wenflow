/* 完结课堂审计判分器（#84；2026-10-19 定版，judge v3 口径 / judgeVersion judge2:<hash>:…）。
 *
 * 背景与演进（doc/measurement/PLATFORM-MEASUREMENT-QUALITY-REPORT-2026-10-19.md §三）：
 *   单次 LLM 判读不稳——同 prompt 重判 Jaccard 仅 42.3%（30/109 翻转），且**缺检查点真值**时
 *   误报高发（v2 的 32 个 wrongAnswerPassed flag 里 78% 为「学员自由文本与更窄的检查点问题
 *   不一致」的上下文缺失型误报）。本版三层加固：
 *   1) 每条课堂独立判 K 次，逐 pattern 取多数（≥2）；
 *   2) 每个判 true 的 pattern 必须附**逐字引文**（evidence），引文在文本中找不到即降级为 false；
 *   3) 案例块注入**检查点真值**：checkpointHistory（题干/判分来源/结果/所选）+ learner_evidence
 *      明细（code 判分的「正确 X，作答 Y」）+ lastRuntimeEnvelope 的答案键原文；
 *      并明确「passed 且明细一致 → 不得凭自由文本判放行」「failed 后仍被肯定/总结称掌握 → 是放行」。
 *   judgeVersion（prompt 哈希 + 模型/温度/K）随每条 verdict 与 summary 落档，供协议登记。
 *
 * 用法（仓库根执行）：
 *   node backend/scripts/measurement-verify/class-audit-judge.mjs --selftest
 *   node backend/scripts/measurement-verify/class-audit-judge.mjs --limit=40 --conc=2 --out=doc/local/runs/class-audit
 *   node backend/scripts/measurement-verify/class-audit-judge.mjs --email-like=builtin_%   # 只判 preset 组
 * 环境：WENFLOW_AUDIT_KEY（必需，走网关）；WENFLOW_AUDIT_API 可覆盖端点；模型 --model= 可覆盖。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const arg = (name, fb = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fb;
};
const flag = (name) => process.argv.includes(`--${name}`);

const API = process.env.WENFLOW_AUDIT_API || 'https://newapi.wenflow.org/v1/chat/completions';
const KEY = process.env.WENFLOW_AUDIT_KEY || '';
const MODEL = arg('model', 'deepseek-v4.1-flash');
const K = Number(arg('k', 3));
const CONC = Number(arg('conc', 2));
const TEMPERATURE = Number(arg('temp', 0.2));
const LIMIT = Number(arg('limit', 0));
const EMAIL_LIKE = arg('email-like', null);
const SINCE = Number(arg('since', 0)); // epoch ms：只判该时刻之后创建的会话（护栏后批次对照用）
const BEFORE = Number(arg('before', 0)); // epoch ms：只判该时刻之前的会话（取同源基线用）
const MIN_MSGS = Number(arg('min-msgs', 8));
const SELFTEST = flag('selftest');
const DB = resolve(arg('db', join(REPO_ROOT, 'backend', 'prisma', 'dev.db')));
const OUT = resolve(arg('out', join(REPO_ROOT, 'doc', 'local', 'runs', 'class-audit', new Date().toISOString().slice(0, 10))));

if (!existsSync(DB)) { console.error(`✗ 读库不存在：${DB}`); process.exit(2); }
const db = new DatabaseSync(DB, { readOnly: true });
db.exec('PRAGMA busy_timeout=30000');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`[db] ${DB}`);

const jparse = (s, fb = null) => { try { return JSON.parse(s); } catch { return fb; } };
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…（截断）' : t; };

function readMessages(sid, rawJson) {
  const col = jparse(rawJson, null);
  if (Array.isArray(col) && col.length) {
    const msgs = col.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
    return { msgs, source: 'sessions.messages' };
  }
  const msgs = [];
  for (const r of db.prepare('SELECT payload FROM teaching_session_messages WHERE sessionId=? ORDER BY id').all(sid)) {
    const p = jparse(r.payload, null);
    if (!p || (p.role !== 'user' && p.role !== 'assistant')) continue;
    if (typeof p.content !== 'string' || !p.content.trim()) continue;
    msgs.push({ role: p.role, content: p.content });
  }
  return { msgs, source: 'session_messages' };
}

function buildCase(sid) {
  const s = db.prepare('SELECT id,subject,topic,duration,messages,knowledgeState,wrapup,teachingState FROM teaching_sessions WHERE id=?').get(sid);
  if (!s) return null;
  const { msgs, source } = readMessages(sid, s.messages);
  const head = 4, tail = 10;
  let idxs = [];
  if (msgs.length <= head + tail) idxs = msgs.map((_, i) => i);
  else {
    for (let i = 0; i < head; i++) idxs.push(i);
    const span = msgs.length - head - tail;
    const k = Math.max(1, Math.floor(span / 12));
    for (let i = head; i < head + span; i += k) idxs.push(i);
    idxs.push(...msgs.slice(msgs.length - tail).map((_, i) => msgs.length - tail + i));
  }
  const seen = new Set();
  const conv = idxs.filter((i) => !seen.has(i) && seen.add(i)).map((i) => {
    const m = msgs[i];
    return `${m.role === 'user' ? '学员' : '老师'}: ${clip(m.content, m.role === 'user' ? 500 : 350)}`;
  }).join('\n');
  const kp = jparse(s.knowledgeState, []) || [];
  const kpBlock = kp.map((p) => `- ${p.name}｜${p.status}｜${p.progress}%`).join('\n');
  const w = jparse(s.wrapup, null);
  const wBlock = w ? clip(JSON.stringify(w), 2200) : '（无结课总结）';
  // 检查点 ground truth（v3）：题干/正确答案/学员所选/判分来源——不含它时判分器会误判
  // 「学员自由文本与更窄的检查点问题不一致」为错答放行（2026-10-19 实证：C药 vs B药 的
  // 检查点选 C 是对的，但缺记录时被按任务级「最急=多巴胺」打成放行）。
  const st = jparse(s.teachingState, null);
  const history = Array.isArray(st?.checkpointHistory) ? st.checkpointHistory : [];
  const evRows = db.prepare("SELECT payload FROM learner_evidence WHERE sessionId=? AND evidenceType='checkpoint:result' ORDER BY createdAt").all(sid)
    .map((r) => jparse(r.payload, {}));
  const evById = new Map(evRows.map((e) => [e?.checkpointId, e]));
  const cpLines = history.map((h, i) => {
    const e = evById.get(h?.checkpointId) || {};
    const selected = Array.isArray(e?.selectedOptionIds) && e.selectedOptionIds.length ? e.selectedOptionIds.join('/') : '?';
    // 明细字段是 code 判分的真值载体：「选项集合不一致（正确 A，作答 B）」/「选项集合与答案键一致（A）」。
    return `cp${i + 1}｜${h?.type || e?.type || ''}｜问：${clip(h?.question || '', 180)}｜判分来源 ${h?.judgedBy || e?.judgedBy || '?'}｜结果 ${h?.passed !== false ? 'passed' : 'failed'}｜学员所选 ${selected}｜明细 ${clip(e?.detail || '', 90)}｜概念 ${h?.conceptName || ''}`;
  }).join('\n');
  // 最近一次发出的检查点原文——**只用于理解题干**；答案键不在此处呈现：
  // 键的权威载体是 learner_evidence 明细「选项集合不一致（正确 X，作答 Y）」/「与答案键一致（X）」。
  // 2026-10-19 实证：把 lastRuntimeEnvelope 的键误当成历史检查点的键，会把「所选=键」误判为放行
  // （post-guard 批 2/2 flag 均为该误报）——键必须与检查点身份绑定，明细已足够。
  const lastCp = st?.lastRuntimeEnvelope?.artifact?.control?.checkpoint || null;
  const lastCpLines = lastCp
    ? `最近一次发出的检查点（仅题面参考，答案键以明细为准）：${clip(lastCp.question, 200)}`
    : '';
  const cpBlock = history.length
    ? `【检查点判分记录（ground truth，判「错答放行」时以此为准；明细含 code 判分的「正确 X，作答 Y」）】\n${cpLines}${lastCpLines ? `\n${lastCpLines}` : ''}`
    : `【检查点判分记录】本轮无检查点（放行与否只看对话与总结）${lastCpLines ? `\n${lastCpLines}` : ''}`;
  return {
    sid, topic: s.topic, msgCount: msgs.length, msgSource: source,
    block: `课题：${s.topic}\n课堂时长：${s.duration ?? '?'} 分钟｜消息 ${msgs.length} 条\n\n【知识点最终掌握状态】\n${kpBlock || '（无）'}\n\n${cpBlock}\n\n【结课总结（wrapup）】\n${wBlock}\n\n【课堂对话节选（首4+均匀中段+末10，逐条截断）】\n${conv}`,
  };
}

const PATTERNS_TEXT = `patterns 字段逐项判定（true=存在该问题）：
- progressInflation 掌握度虚报：知识点标 mastered/高进度，但对话里学员没有无提示独立产出的证据
- loopStuck 循环卡壳：同一确认点/同一问题 3 轮以上未推进，老师重复同一套解释，没有换策略
- summaryMismatch 总结失真：结课总结把老师讲解记成学员产出、或与对话事实不符/遗漏最后未解决问题
- wrongAnswerPassed 错答放行：学员答错/答非所问被判为正确推进
- unclosedComplete 未答收口：老师抛出的问题学员未答，课堂却判完成`;

const PROMPT = (b) => `下面是一节已完结课堂的记录。检查这节课有没有问题。${PATTERNS_TEXT}
判定纪律：
- 只标真问题，不确定标 false；
- **每个判 true 的 pattern，必须给出至少 1 条逐字引文**（evidence 数组，从上面课堂记录里原样复制 ≤80 字的片段，不要改写）；给不出引文的判 false；
- wrongAnswerPassed 判定以下列顺序为准：① 检查点明细「选项集合不一致（正确 X，作答 Y）」而结果 passed → 放行（引该行）；② 明细「与答案键一致」的 passed 检查点，**不得**仅凭学员自由文本与任务级口径的差异判放行——除非你能引用检查点原文（题/选项/答案键）证明**答案键本身与事实不符**，此时记为放行并注明「答案键与事实不符」；③ 结果为 failed 的检查点：若老师在其后的回合或结课总结里仍称「答对了/走通了/已掌握」→ 是放行（引老师的原话）；④ 无检查点时，看老师是否把明确的错答称为正确并继续推进；
- problems 里每条一句话列出具体证据（最多 5 条），没问题给空数组。
输出 JSON：{"ok": true/false, "patterns": {"progressInflation":bool,"loopStuck":bool,"summaryMismatch":bool,"wrongAnswerPassed":bool,"unclosedComplete":bool}, "evidence": {"<每个 true 的 pattern>": ["逐字引文"]}, "problems": ["..."]}

${b}`;

const KEYS = ['progressInflation', 'loopStuck', 'summaryMismatch', 'wrongAnswerPassed', 'unclosedComplete'];
/** 口径修订号：改案例块/判定纪律等**非 prompt 文本**的语义时手工递增（哈希只覆盖 prompt 文本）。 */
const JUDGE_REV = 'v4.1';
const judgeVersion = (() => {
  const h = createHash('sha256').update(PATTERNS_TEXT + PROMPT('')).digest('hex').slice(0, 12);
  return `judge-${JUDGE_REV}:${h}:${MODEL}:t${TEMPERATURE}:k${K}`;
})();
console.log(`[judge] ${judgeVersion}`);

async function chat(body, timeoutMs = 300000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ac.signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`http ${r.status}`);
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}
function extractJson(s) {
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json');
  return JSON.parse(s.slice(a, b + 1));
}

/** 文本归一（用于引文核验）：去空白、统一省略号/弯引号。 */
const norm = (s) => String(s || '')
  .replace(/\s+/g, '')
  .replace(/…（截断）/g, '')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'");

/** 单次判读 + 引文核验：true 但无有效引文的 pattern 降为 false（记录 invalid）。 */
function validateVerdict(v, block) {
  const nb = norm(block);
  const patterns = {};
  const invalid = [];
  const evidence = (v && typeof v.evidence === 'object' && v.evidence) || {};
  for (const key of KEYS) {
    const raw = Boolean(v?.patterns?.[key]);
    if (!raw) { patterns[key] = false; continue; }
    const quotes = Array.isArray(evidence[key]) ? evidence[key].map((q) => norm(q)).filter((q) => q && q.length >= 4) : [];
    const okQuote = quotes.some((q) => nb.includes(q));
    if (okQuote) patterns[key] = true;
    else { patterns[key] = false; invalid.push(key); }
  }
  return { patterns, invalid, problems: Array.isArray(v?.problems) ? v.problems.slice(0, 5).map(String) : [] };
}

async function judgeSample(c) {
  for (let r = 0; r < 3; r++) {
    try {
      const j = await chat({ model: MODEL, messages: [{ role: 'user', content: PROMPT(c.block) }], max_tokens: 32000, temperature: TEMPERATURE });
      const raw = String(j?.choices?.[0]?.message?.content || '');
      if (!raw.trim()) { await sleep(2500); continue; }
      return validateVerdict(extractJson(raw), c.block);
    } catch (e) {
      if (/http (429|5\d\d)|aborted|fetch failed/i.test(String(e?.message || e)) && r < 2) { await sleep(10000 + r * 15000); continue; }
      return null;
    }
  }
  return null;
}

// ---------- 样本 ----------
const userFilter = EMAIL_LIKE ? ' AND u.email LIKE ?' : '';
const sinceFilter = SINCE > 0 ? ' AND s.createdAt > ?' : '';
const beforeFilter = BEFORE > 0 ? ' AND s.createdAt < ?' : '';
const sql = `SELECT s.id AS sid, s.userId AS uid, u.email AS email, s.subject AS subject, s.topic AS topic, s.createdAt AS createdAt,
    (SELECT COUNT(*) FROM teaching_session_messages m WHERE m.sessionId = s.id) AS msgRows
  FROM teaching_sessions s JOIN users u ON u.id = s.userId
  WHERE s.status='completed' AND s.wrapup IS NOT NULL AND s.wrapup NOT IN ('','null')${userFilter}${sinceFilter}${beforeFilter}
  ORDER BY s.createdAt`;
const params = [...(EMAIL_LIKE ? [EMAIL_LIKE] : []), ...(SINCE > 0 ? [SINCE] : []), ...(BEFORE > 0 ? [BEFORE] : [])];
const rows = params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
let cases = [];
for (const r of rows) {
  const c = buildCase(r.sid);
  if (!c || c.msgCount < MIN_MSGS || !c.block.includes('学员:')) continue;
  cases.push({ ...c, uid: r.uid, email: r.email, subject: r.subject, createdAt: r.createdAt, msgRows: r.msgRows });
}
if (LIMIT > 0 && cases.length > LIMIT) cases = cases.slice(0, LIMIT);
console.log(`[sample] 可判分 ${cases.length} 节${EMAIL_LIKE ? `（email like ${EMAIL_LIKE}）` : ''}｜K=${K}｜conc=${CONC}｜计划调用 ≈ ${cases.length * K}`);
if (SELFTEST) {
  const byEmail = {};
  for (const c of cases) byEmail[c.email] = (byEmail[c.email] || 0) + 1;
  console.log('[selftest] 分组：', Object.entries(byEmail).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log(`[selftest] judgeVersion=${judgeVersion}｜不调模型、不写盘`);
  process.exit(0);
}
if (!KEY) { console.error('✗ 缺 API key：设 WENFLOW_AUDIT_KEY'); process.exit(2); }

// ---------- 判分 ----------
mkdirSync(join(OUT, 'verdicts'), { recursive: true });
const results = [];
let done = 0;
{
  const q = [...cases];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (q.length) {
      const c = q.shift();
      const vf = join(OUT, 'verdicts', `${c.sid}.json`);
      if (existsSync(vf)) { results.push(jparse(readFileSync(vf, 'utf8'))); done++; continue; }
      const samples = await Promise.all(Array.from({ length: K }, () => judgeSample(c)));
      const valid = samples.filter(Boolean);
      const majority = {};
      const votes = {};
      for (const key of KEYS) {
        const yes = valid.filter((s) => s.patterns[key]).length;
        votes[key] = yes;
        majority[key] = valid.length > 0 && yes >= Math.max(2, Math.ceil(valid.length / 2));
      }
      const rec = {
        sid: c.sid, uid: c.uid, email: c.email, subject: c.subject, topic: c.topic, createdAt: c.createdAt,
        msgCount: c.msgCount, msgSource: c.msgSource,
        judgeVersion, samples: samples.length, validSamples: valid.length,
        votes, majority,
        problems: valid.flatMap((s) => s.problems).slice(0, 8),
        invalidPatterns: valid.flatMap((s) => s.invalid),
      };
      if (valid.length) writeFileSync(vf, JSON.stringify(rec, null, 1));
      results.push(rec);
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${cases.length} ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }));
}

// ---------- 汇总 ----------
const n = results.length;
const majorityRate = {};
for (const key of KEYS) majorityRate[key] = results.filter((r) => r.majority[key]).length;
const selfAgree = {};
for (const key of KEYS) {
  let agree = 0, judged = 0;
  for (const r of results) {
    if (!r.validSamples) continue;
    judged++;
    const yes = r.votes[key], v = r.validSamples;
    if (yes === v || yes === 0) agree++;
  }
  selfAgree[key] = judged ? agree / judged : 0;
}
const summary = {
  judgeVersion, db: DB, generatedAt: new Date().toISOString(),
  sessions: n, K, temperature: TEMPERATURE,
  majorityRate: Object.fromEntries(KEYS.map((k) => [k, { count: majorityRate[k], rate: Number((majorityRate[k] / Math.max(1, n)).toFixed(4)) }])),
  selfAgreement: Object.fromEntries(KEYS.map((k) => [k, Number(selfAgree[k].toFixed(4))])),
  evidenceInvalid: results.reduce((acc, r) => acc + r.invalidPatterns.length, 0),
  invalidSamples: results.filter((r) => !r.validSamples).length,
  byEmail: (() => {
    const m = {};
    for (const r of results) {
      const key = String(r.email || '').split('@')[1] || '?';
      m[key] = m[key] || { n: 0, wrongAnswerPassed: 0 };
      m[key].n++;
      if (r.majority.wrongAnswerPassed) m[key].wrongAnswerPassed++;
    }
    return m;
  })(),
};
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ ...summary, rows: results.map((r) => ({ sid: r.sid, email: r.email, majority: r.majority, votes: r.votes, validSamples: r.validSamples })) }, null, 1));
console.log('\n==== 完结课堂审计判分（judge v3 口径）汇总 ====');
console.log(`条数 ${n}｜judgeVersion ${judgeVersion}`);
for (const key of KEYS) {
  console.log(`  ${key}: majority ${summary.majorityRate[key].count}/${n} = ${(summary.majorityRate[key].rate * 100).toFixed(1)}%｜三样本一致率 ${(summary.selfAgreement[key] * 100).toFixed(1)}%`);
}
console.log(`证据引文无效而降级：${summary.evidenceInvalid} 处｜无有效样本：${summary.invalidSamples} 条`);
console.log('按域名分组：', JSON.stringify(summary.byEmail));
console.log(`\n产物 → ${OUT}`);
