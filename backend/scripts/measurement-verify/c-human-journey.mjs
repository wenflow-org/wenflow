// 轨道 C：真人新旅程驱动（取证批）——全新账号在 3011 走 注册→goal→path→首两节课
// 用法：
//   node c-human-journey.mjs setup           # 注册 + goal 对话（假同意探针 A/C）+ 等 path 生成 ready
//   node c-human-journey.mjs lesson <1|2>    # 跑第 n 节课（模型扮学生，完课→finalize→wrapup）
//   node c-human-journey.mjs forensics       # DB(readOnly) + API(只读) 取证汇总
// 状态/产物：out/c-human7-state.json、out/c-human7-lesson<N>.json、out/c-human7-forensics.json
// 纪律：只打 3011；除注册/课程必要写入外不手改数据；DB 只读 readOnly+busy_timeout+显式列名；
//       学生模型走 backend/.env 网关（不回显密钥）。
// 复用口径：goal/learn 的 API 语义照抄 scripts/paradigm-eval/drive.mjs 与 doc/local/tools/learn-run.mjs
//       （此处自包含重写——两个源脚本均未导出，不能 import）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://127.0.0.1:3011';
const NAME = 'c-human7-01';
const PASSWORD = 'HumanJourney2026';
const STATE_FILE = path.join(OUT, 'c-human7-state.json');

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (k, d = null) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : (process.argv.includes(`--${k}`) ? true : d); };

// ---- 全新人设（与 golden-personas/real-goals-cases 现有 554+34 格均不同域：吉他零基础→婚礼弹唱）----
const PERSONA = {
  personaId: NAME,
  opening: '我今年 28 岁，后端程序员，吉他完全零基础。三个月后好朋友结婚，我想在婚礼上自弹自唱一首完整的民谣，比如《平凡之路》。我现在连琴都还没有，谱也不识。每天下班能练 40 分钟，周末能练 1 小时。帮我做一个从零到能上台弹唱的计划。',
  followUps: [
    '还没买琴，打算这周末去买一把入门面单民谣琴。和弦一个都不会按，识谱只会简谱的哆来咪。',
    '唱歌还行，公司年会唱过一次没跑大调。主要是左手按弦和右手节奏完全不会，也没人教。',
    '婚礼大概在明年 1 月 10 号。到时候要能不看谱完整弹唱一首。中间没有别的演出安排。',
  ],
};

// ---- 学生模型（learn-run.mjs 同款：平台网关 + 角色保持硬规则；密钥只读不回显）----
const envText = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const AI_URL = envGet('AI_API_URL').replace(/\/+$/, '');
const AI_KEY = envGet('AI_API_KEY');
const AI_MODEL = 'deepseek-v4.1-flash';

const STUDENT_SYSTEM = [
  '你是一个正在上在线课的学生，只说你自己要说的话。',
  '人设：28 岁后端程序员，吉他零基础，目标三个月后在朋友婚礼上自弹自唱《平凡之路》。',
  '说话风格：口语、简短，一次一到两句，不用 Markdown，不用列表。',
  '',
  '硬规则（违反即失败）：',
  'A. 绝不谈「角色/扮演/对话状态/用户」这类元话题；',
  'B. 绝不复述老师的话，不写老师口吻的引导句——只回答、只报告；',
  'C. 老师让你做一步操作再回来报告时，直接报告做完后的具体结果（练习类：报告你按了几次、按响没有、闷了几根弦）；',
  'D. 老师提问必须正面回答；作为零基础新手，不会就照实说不会、说出你卡在哪；',
  'E. 绝不重复上一轮说过的话；',
  'F. 真实新手会犯错：和弦按不响、节奏不稳是常态，别把自己答成老师。',
].join('\n');

const META_PATTERNS = [
  /用户角色|扮演|对话状态|我们需要(判断|理解)|当前(对话|情况)|作为(一个)?(学生|AI|助手)/,
  /(?:^|[\s.!?])(?:The user|I should|As an? (?:AI|assistant|student|tutor)|Let me (?:analyze|think))/i,
];

async function gatewayChat(messages, { maxTokens = 1200, temperature = 0.7, timeoutMs = 240000, attempts = 2 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(AI_URL + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
        body: JSON.stringify({ model: AI_MODEL, messages, temperature, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await res.json().catch(() => ({}));
      const msg = j?.choices?.[0]?.message || {};
      const text = String(msg.content || '').trim() || String(msg.reasoning_content || '').trim();
      if (text) return text;
      lastErr = '空输出: ' + JSON.stringify(j).slice(0, 160);
    } catch (e) { lastErr = e?.message || String(e); }
    await sleep(3000 * (i + 1));
  }
  throw new Error('学生模型失败: ' + lastErr);
}

// ---- 平台 API（3011）----
let cookie = '';
async function api(method, urlPath, body, { retries = 4, timeoutMs = 300000, headers = {} } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(BASE + urlPath, {
        method,
        headers: { Cookie: cookie, Origin: 'http://localhost:5173', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 401 && i < retries) { await login(); continue; }
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
      if (!res.ok || json?.success === false) {
        last = `${res.status} ${String(json?.error?.message || json?.error || text).slice(0, 200)}`;
        if (res.status === 409 || res.status === 429 || res.status >= 500) { await sleep(12000 * (i + 1)); continue; }
        return { status: res.status, ok: false, json };
      }
      return { status: res.status, ok: true, json };
    } catch (e) {
      last = e?.message || String(e);
      await sleep(6000 * (i + 1));
    }
  }
  return { status: 0, ok: false, json: { error: { message: last } } };
}

async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: NAME, password: PASSWORD, remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const j = await res.json().catch(() => ({}));
  if (!cookie || j.success === false) throw new Error('登录失败 ' + JSON.stringify(j).slice(0, 160));
}

function loadState() { return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {}; }
function saveState(st) { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 1)); }

// ================================================================ setup
async function setup() {
  const st = loadState();
  const timeline = st.timeline || (st.timeline = []);

  // 1) 注册（产品 API；201 新建 / 409 已存在）
  if (!st.registeredAt) {
    const reg = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ name: NAME, password: PASSWORD, remember: true }),
    });
    const rj = await reg.json().catch(() => ({}));
    st.registeredAt = Date.now();
    st.registerStatus = reg.status;
    st.userId = rj?.data?.user?.id || rj?.data?.id || null;
    timeline.push({ t: new Date().toISOString(), step: 'register', status: reg.status, userId: st.userId });
    log(`register -> ${reg.status} userId=${st.userId}`);
    saveState(st);
  }
  await login();
  if (!st.userId) {
    // 注册响应没带 id 时从 me 端点取
    const me = await api('GET', '/api/auth/me');
    st.userId = me.json?.data?.user?.id || me.json?.data?.id || null;
    saveState(st);
  }

  // 2) goal 会话
  if (!st.conversationId) {
    const r = await api('POST', '/api/goal-conversation/start', { input: { text: PERSONA.opening } });
    const d = r.json?.data || {};
    const core = d.internal?.core || {};
    st.conversationId = core.conversationId || null;
    st.rounds = 1;
    st.goalTranscript = [{ role: 'user', text: PERSONA.opening }, { role: 'ai', text: d.userVisible || '' }];
    timeline.push({ t: new Date().toISOString(), step: 'goal-start', stage: core.stage, conversationId: st.conversationId });
    log(`goal start stage=${core.stage} conv=${st.conversationId}`);
    saveState(st);
  }

  // 3) 续答到 proposing（带 LLM 延迟，天然限速）
  let guard = 10;
  while (guard-- > 0) {
    const snap = await api('GET', '/api/goal-conversation/' + st.conversationId);
    const core = snap.json?.data?.internal?.core || {};
    if (core.stage === 'proposing' || core.stage === 'completed' || core.learningPath?.id) break;
    st.followUpIdx = st.followUpIdx || 0;
    const text = st.followUpIdx < PERSONA.followUps.length ? PERSONA.followUps[st.followUpIdx++] : '就按你的思路来，给我出方案吧。';
    const r = await api('POST', `/api/goal-conversation/${st.conversationId}/reply`, { input: { text } });
    st.rounds++;
    const d = r.json?.data || {};
    st.goalTranscript.push({ role: 'user', text }, { role: 'ai', text: d.userVisible || JSON.stringify(r.json?.error || '').slice(0, 120) });
    timeline.push({ t: new Date().toISOString(), step: 'goal-reply', round: st.rounds, stage: d.internal?.core?.stage || '?' });
    log(`goal round ${st.rounds} -> stage=${d.internal?.core?.stage || '?'}`);
    saveState(st);
  }

  const snap = await api('GET', '/api/goal-conversation/' + st.conversationId);
  const core = snap.json?.data?.internal?.core || {};
  log(`current stage=${core.stage}`);

  if (core.stage === 'proposing' && !st.probeC) {
    // 探针 A（修复精度面）：明确拒绝/犹豫文本，不带 confirmProposal —— 期待：不确认、stage 仍 proposing
    if (!st.probeA) {
      const refusal = '让我再想想吧，先别急着生成路径，我怕三个月来不及。';
      const ra = await api('POST', `/api/goal-conversation/${st.conversationId}/reply`, { input: { text: refusal } });
      st.rounds++;
      const raCore = ra.json?.data?.internal?.core || {};
      st.probeA = { sent: refusal, status: ra.status, stageAfter: raCore.stage || null, ai: String(ra.json?.data?.userVisible || '').slice(0, 400), flag: false };
      st.goalTranscript.push({ role: 'user', text: refusal }, { role: 'ai', text: st.probeA.ai });
      timeline.push({ t: new Date().toISOString(), step: 'probeA-refusal-no-flag', stageAfter: st.probeA.stageAfter });
      log(`probeA(no flag, refusal): stageAfter=${st.probeA.stageAfter} status=${ra.status}`);
      saveState(st);
      return st; // 拒绝后回 understanding 属预期，重新跑 setup 推回 proposing 再做探针 C
    }

    // 探针 C（任务书点名的假同意轨迹）：学习者未明说同意（仍是犹豫文本）却 confirmProposal:true
    const softNo = '再让我考虑一下，今天先不生成。';
    const rc = await api('POST', `/api/goal-conversation/${st.conversationId}/reply`, { input: { text: softNo }, confirmProposal: true });
    st.rounds++;
    const rcCore = rc.json?.data?.internal?.core || {};
    const rcData = rc.json?.data || {};
    st.probeC = {
      sent: softNo, flag: true, status: rc.status, stageAfter: rcCore.stage || null,
      pathId: rcCore.learningPath?.id || rcData?.learningPath?.id || null,
      ai: String(rcData.userVisible || '').slice(0, 400),
    };
    st.goalTranscript.push({ role: 'user', text: softNo }, { role: 'ai', text: st.probeC.ai });
    if (st.probeC.pathId) st.pathId = st.probeC.pathId;
    timeline.push({ t: new Date().toISOString(), step: 'probeC-refusal-with-flag', stageAfter: st.probeC.stageAfter, pathId: st.probeC.pathId });
    log(`probeC(flag+refusal): stageAfter=${st.probeC.stageAfter} pathId=${st.probeC.pathId}`);
    saveState(st);
  }

  // 4) pathId 兜底：快照/列表里找
  if (!st.pathId) {
    const s2 = await api('GET', '/api/goal-conversation/' + st.conversationId);
    st.pathId = s2.json?.data?.internal?.core?.learningPath?.id || null;
    if (!st.pathId) {
      const paths = await api('GET', '/api/learning/paths');
      st.pathId = (paths.json?.data || [])[0]?.id || null;
    }
    saveState(st);
  }
  if (!st.pathId) { log('NO PATH —— goal 未完成确认，停止'); console.log(JSON.stringify(st, null, 1)); return st; }

  // 5) 等生成 ready（drive.mjs 同款 lifecycle 口径，上限 20 分钟）
  if (!st.genReadyAt) {
    const deadline = Date.now() + 20 * 60 * 1000;
    let lc = '';
    while (Date.now() < deadline) {
      const g = await api('GET', `/api/learning/paths/${st.pathId}/generation-status`);
      lc = g.json?.data?.lifecycle || '';
      if (lc === 'ready') { st.genReadyAt = Date.now(); break; }
      if (String(lc).includes('failed')) { log('generation failed: ' + lc); break; }
      await sleep(10000);
    }
    timeline.push({ t: new Date().toISOString(), step: 'gen-wait', lifecycle: lc, ready: !!st.genReadyAt });
    log(`generation lifecycle=${lc} ready=${!!st.genReadyAt}`);
    saveState(st);
  }

  // 6) path 快照（阶段/课清单）
  if (!st.pathSnapshot) {
    const detail = await api('GET', '/api/learning/paths/' + st.pathId);
    const d = detail.json?.data || {};
    const stages = (d.stages || d.milestones || []).map((s) => ({
      stageNumber: s.stageNumber, title: s.title,
      subtasks: (s.subtasks || []).map((t) => ({ id: t.id, title: t.title, taskType: t.taskType, estimatedMinutes: t.estimatedMinutes })),
    }));
    st.pathSnapshot = { id: d.id, name: d.name || d.title, status: d.status, stages };
    saveState(st);
    log(`path: ${st.pathSnapshot.name} stages=${stages.length} tasks=${stages.reduce((n, s) => n + s.subtasks.length, 0)}`);
  }
  return st;
}

// ================================================================ lesson
async function runLesson(n) {
  const st = loadState();
  if (!st.pathSnapshot) throw new Error('先跑 setup');
  await login();
  const allTasks = st.pathSnapshot.stages.flatMap((s) => s.subtasks.map((t) => ({ ...t, stageNumber: s.stageNumber })));
  const done = st.completedTaskIds || (st.completedTaskIds = []);
  const task = allTasks.find((t) => !done.includes(t.id));
  if (!task) throw new Error('没有剩余任务');
  log(`lesson${n}: task=${task.id} S${task.stageNumber} ${String(task.title).slice(0, 40)}`);

  const rec = { n, taskId: task.id, stage: task.stageNumber, title: task.title, turns: [], startedAt: new Date().toISOString() };
  const start = await api('POST', `/api/ai-teaching/tasks/${task.id}/session`, {});
  const d0 = start.json?.data || {};
  rec.sessionId = d0.sessionId;
  rec.mode = d0.mode;
  rec.welcomeMessage = String(d0.welcomeMessage || '');
  rec.startRevision = d0.revision;
  if (d0.mode === 'completed') { rec.note = 'already completed'; fs.writeFileSync(path.join(OUT, `c-human7-lesson${n}.json`), JSON.stringify(rec, null, 1)); return rec; }
  log(`session=${rec.sessionId} mode=${d0.mode} welcome=${rec.welcomeMessage.slice(0, 80)}`);

  let revision = d0.revision;
  const history = [];
  let lastTeacher = rec.welcomeMessage.slice(0, 1200);
  let pendingCkpt = null;
  const MAX_TURNS = Number(arg('maxTurns', '16'));

  for (let i = 0; i < MAX_TURNS; i++) {
    const tStart = Date.now();
    let r;
    try {
      if (pendingCkpt) {
        const opts = pendingCkpt.options || [];
        const list = opts.map((o) => `${o.id}. ${o.content || o.text}`).join('\n');
        const raw = (await gatewayChat([
          { role: 'system', content: '你是刚上第一节吉他课的零基础新手。下面是一道选择题，凭新手直觉选一个，最后一行只写选项字母（A/B/C…），不要别的字。' },
          { role: 'user', content: `${pendingCkpt.question || ''}\n${list}` },
        ], { maxTokens: 600, temperature: 0.2 })).toUpperCase();
        const hit = opts.find((o) => raw.includes(String(o.id).toUpperCase()));
        const optId = hit ? hit.id : opts[0]?.id;
        r = await api('POST', `/api/ai-teaching/sessions/${rec.sessionId}/checkpoints/${pendingCkpt.id}/submit`, { selectedOptionIds: optId ? [optId] : undefined, revision });
        const d = r.json?.data || {};
        rec.turns.push({ n: i + 1, kind: 'checkpoint', student: `选择 ${optId}`, teacher: String(d.feedback || d.aiResponse || '').slice(0, 800), correct: d.correct ?? d.judgement?.correct ?? null, peer: peerOf(d) });
        lastTeacher = String(d.feedback || d.aiResponse || lastTeacher);
        if (r.json?.data?.revision) revision = r.json.data.revision;
        pendingCkpt = null;
      } else {
        const msgs = [
          { role: 'system', content: STUDENT_SYSTEM },
          ...history.slice(-6).map((h) => ({ role: h.role === 'student' ? 'user' : 'assistant', content: h.text })),
          { role: 'assistant', content: lastTeacher },
          { role: 'user', content: '（轮到你说下一句了）' },
        ];
        let say = (await gatewayChat(msgs)).slice(0, 400);
        if (META_PATTERNS.some((re) => re.test(say))) {
          say = await gatewayChat([
            { role: 'system', content: STUDENT_SYSTEM },
            { role: 'assistant', content: lastTeacher },
            { role: 'user', content: `你刚才那句谈了元话题：「${say.slice(0, 60)}」。重新说一句——只说你自己作为学生的回答，一到两句。` },
          ]);
        }
        r = await api('POST', `/api/ai-teaching/sessions/${rec.sessionId}/messages`, { message: say, revision });
        const d = r.json?.data || {};
        revision = d.revision ?? revision;
        const turn = {
          n: i + 1, kind: 'message', student: say,
          teacher: String(d.aiResponse || '').slice(0, 900),
          level: d.analysis?.cognitiveLevel, levelScore: d.analysis?.levelScore,
          kp: (d.knowledgePoints || []).map((k) => ({ key: k.key || k.conceptKey, label: k.label, status: k.status || k.masteryLevel })).slice(0, 6),
          checkpoint: d.checkpoint ? { id: d.checkpoint.id, question: String(d.checkpoint.question || d.checkpoint.title || '').slice(0, 300) } : null,
          shouldConfirmEnd: !!d.shouldConfirmEnd, isCompletion: !!d.isCompletion, endReason: d.endReason || null,
          peer: peerOf(d),
          revision,
        };
        rec.turns.push(turn);
        history.push({ role: 'student', text: say }, { role: 'teacher', text: String(d.aiResponse || '').slice(0, 800) });
        lastTeacher = String(d.aiResponse || '');
        if (turn.checkpoint) pendingCkpt = d.checkpoint;
        log(`  turn${i + 1} ${((Date.now() - tStart) / 1000).toFixed(0)}s level=${turn.level}/${turn.levelScore ?? '-'} kp=${turn.kp.length} ckpt=${turn.checkpoint ? 'Y' : 'N'} peer=${turn.peer.triggered ? 'Y' : 'N'} end=${turn.isCompletion ? 'C' : turn.shouldConfirmEnd ? 's' : '-'}`);

        // 伴学对话探针：首条伴学插话若带跟进问，学习者回一句（真人在伴学面板互动）
        if (turn.peer.triggered && !rec.peerReplied && (turn.peer.followUps || []).length) {
          rec.peerReplied = true;
          try {
            const pr = await api('POST', `/api/ai-teaching/sessions/${rec.sessionId}/peer/messages`, { message: '我先自己再试两遍，等下还不行再来问你。' });
            const pd = pr.json?.data || {};
            turn.peer.reply = { response: String(pd.peerResponse || '').slice(0, 400), strategy: pd.peerStrategy || null, followUps: (pd.peerFollowUpQuestions || []).slice(0, 3) };
            log(`  peer replied: strategy=${turn.peer.reply.strategy || '-'}`);
          } catch (e) { turn.peer.reply = { error: String(e).slice(0, 160) }; }
        }

        if (turn.isCompletion || turn.shouldConfirmEnd) {
          const key = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const fin = await api('POST', `/api/ai-teaching/sessions/${rec.sessionId}/finalize`, {
            action: 'complete_task', revision, actualMinutes: Number(task.estimatedMinutes) || 20,
          }, { timeoutMs: 300000, headers: { 'Idempotency-Key': key } });
          const fd = fin.json?.data || {};
          rec.finalize = {
            status: fin.status,
            taskCompletion: fd.finalization?.taskCompletion || fd.taskCompletion || null,
            wrapup: fd.wrapup || null,
            summaryTopic: String(fd.wrapup?.summary?.topicSummary || fd.summary?.topicSummary || ''),
            actionPlan: (fd.actionPlan || fd.wrapup?.summary?.actionPlan || []).slice(0, 6),
            keys: Object.keys(fd).join(','),
          };
          log(`  finalize status=${fin.status} topic=${rec.finalize.summaryTopic.slice(0, 60)}`);
          break;
        }
      }
    } catch (e) {
      rec.error = String(e?.message || e).slice(0, 240);
      log(`  turn${i + 1} ERR ${rec.error}`);
      break;
    }
    await sleep(2000);
  }

  // 兜底：若 16 轮未触发完课，主动 end + finalize(end_only)，仍拿 wrapup
  if (!rec.finalize) {
    try {
      const end = await api('POST', `/api/ai-teaching/sessions/${rec.sessionId}/end`, { revision });
      rec.endCalled = { status: end.status };
      const fin = await api('POST', `/api/ai-teaching/sessions/${rec.sessionId}/finalize`, { action: 'end_only', revision }, { timeoutMs: 300000, headers: { 'Idempotency-Key': `ch-e-${Date.now()}` } });
      const fd = fin.json?.data || {};
      rec.finalize = { status: fin.status, wrapup: fd.wrapup || null, summaryTopic: String(fd.wrapup?.summary?.topicSummary || fd.summary?.topicSummary || ''), keys: Object.keys(fd).join(',') };
      log(`  end+finalize(end_only) status=${fin.status}`);
    } catch (e) { rec.finalizeError = String(e?.message || e).slice(0, 200); }
  }
  // finalization 只读复查
  try {
    const f = await api('GET', `/api/ai-teaching/sessions/${rec.sessionId}/finalization`, undefined, { timeoutMs: 120000 });
    const ff = f.json?.data || {};
    rec.finalizationRecheck = {
      status: f.status,
      taskCompletion: ff.finalization?.taskCompletion || ff.taskCompletion || null,
      topicSummary: String(ff.summary?.topicSummary || '').slice(0, 300),
      practiceAdvice: String(ff.summary?.practiceAdvice || '').slice(0, 300),
      evaluation: ff.evaluation ? { ktl: ff.evaluation.sessionKtl, lss: ff.evaluation.sessionLss, lf: ff.evaluation.sessionLf, tiers: ff.evaluation.metricTiers || null } : null,
    };
  } catch (e) { rec.finalizationRecheck = { error: String(e).slice(0, 160) }; }

  rec.endedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `c-human7-lesson${n}.json`), JSON.stringify(rec, null, 1));
  if (rec.finalize?.taskCompletion === true || rec.finalize?.taskCompletion === 'completed' || rec.endCalled) (st.completedTaskIds ||= []).push(task.id);
  st[`lesson${n}SessionId`] = rec.sessionId;
  saveState(st);
  log(`lesson${n} DONE turns=${rec.turns.length} task=${task.id}`);
  return rec;
}

function peerOf(d) {
  return {
    triggered: !!d.peerTriggered,
    message: d.peerMessage ? String(d.peerMessage).slice(0, 400) : null,
    strategy: d.peerStrategy || null,
    followUps: (d.peerFollowUpQuestions || []).slice(0, 3),
  };
}

// ================================================================ forensics
async function forensics() {
  const st = loadState();
  const db = new DatabaseSync(path.join(ROOT, 'backend', 'prisma', 'dev.db'), { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  const out = { at: new Date().toISOString(), account: { name: NAME, userId: st.userId } };

  // goal 会话取证
  out.goal = db.prepare('SELECT id, status, stage, completedAt, learningPathId, revision, LENGTH(messages) AS messagesLen FROM goal_conversations WHERE id = ?').get(st.conversationId) || null;
  const goalMsgs = db.prepare('SELECT messages FROM goal_conversations WHERE id = ?').get(st.conversationId);
  if (goalMsgs?.messages) {
    let msgs; try { msgs = JSON.parse(goalMsgs.messages); } catch { msgs = []; }
    out.goalMessages = msgs.map((m) => ({ role: m.role, at: m.createdAt || m.at || null, text: String(m.content || '').slice(0, 220) }));
  }
  const cd = db.prepare('SELECT collectedData FROM goal_conversations WHERE id = ?').get(st.conversationId);
  if (cd?.collectedData) {
    try {
      const parsed = JSON.parse(cd.collectedData);
      out.goalCollected = { keys: Object.keys(parsed), proposal: parsed.confirmedProposal ? { keyStages: (parsed.confirmedProposal.key_stages || []).map((s) => s.title || s.stage || JSON.stringify(s).slice(0, 80)) } : null, confidence: parsed.confidence ?? null };
    } catch { out.goalCollected = { parseError: true }; }
  }

  // path
  out.path = db.prepare('SELECT id, name, status, createdAt FROM learning_paths WHERE id = ?').get(st.pathId) || null;

  // 课（显式列名）
  const sessIds = [st.lesson1SessionId, st.lesson2SessionId].filter(Boolean);
  out.sessions = sessIds.map((sid) => {
    const s = db.prepare('SELECT id, taskId, status, mode, wrapup, duration, startTime, endTime, createdAt FROM teaching_sessions WHERE id = ?').get(sid);
    if (!s) return { id: sid, missing: true };
    let wrapupParsed = null;
    if (s.wrapup) { try { const w = JSON.parse(s.wrapup); wrapupParsed = { status: w.status, summarySource: w.summarySource, topicSummary: String(w.summary?.topicSummary || ''), topicLen: String(w.summary?.topicSummary || '').length, knowledgeSummary: String(w.summary?.knowledgeSummary || ''), practiceAdvice: String(w.summary?.practiceAdvice || ''), actionPlan: (w.summary?.actionPlan || []).length, keyTakeaways: (w.summary?.keyTakeaways || []).length }; } catch { wrapupParsed = { parseError: true }; } }
    const msgCount = db.prepare('SELECT COUNT(*) AS n FROM teaching_session_messages WHERE sessionId = ?').get(sid)?.n ?? null;
    return { id: s.id, taskId: s.taskId, status: s.status, wrapupRawNull: s.wrapup == null, wrapup: wrapupParsed, duration: s.duration, messages: msgCount };
  });

  // 记忆落点（真人链路 = memory_traces；curator/virtual_learner_profiles 为虚拟学习者链路，预期无行）
  out.memoryTraces = db.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN fsrsStability IS NOT NULL THEN 1 ELSE 0 END) AS fsrsNative, SUM(CASE WHEN ktMasteryEma IS NOT NULL THEN 1 ELSE 0 END) AS ktEma FROM memory_traces WHERE userId = ?').get(st.userId) || null;
  out.memoryTraceRows = db.prepare('SELECT conceptKey, label, masteryScore, fsrsStability, fsrsDifficulty, ktMasteryEma, source, pathId FROM memory_traces WHERE userId = ? ORDER BY updatedAt DESC LIMIT 12').all(st.userId);
  out.vlp = db.prepare('SELECT id, source FROM virtual_learner_profiles WHERE userId = ?').get(st.userId) || null;
  out.user = db.prepare('SELECT id, name, email, role, isVirtualLearner, onboardingCompleted, createdAt FROM users WHERE id = ?').get(st.userId) || null;
  db.close();

  fs.writeFileSync(path.join(OUT, 'c-human7-forensics.json'), JSON.stringify(out, null, 1));
  log('forensics -> out/c-human7-forensics.json');
  console.log(JSON.stringify(out, null, 1));
  return out;
}

// ---- 入口 ----
const cmd = process.argv[2] || 'setup';
if (cmd === 'setup') await setup();
else if (cmd === 'lesson') await runLesson(Number(process.argv[3] || '1'));
else if (cmd === 'forensics') await forensics();
else console.error('usage: setup | lesson <1|2> | forensics');
