// 多范式演进效果测试驱动：goal→path 全自动单格执行
// 用法：
//   node scripts/paradigm-eval/drive.mjs cell <personaId> <runIndex>   # 跑单格
//   node scripts/paradigm-eval/drive.mjs all                            # 顺序跑全矩阵（断点续跑）
//   node scripts/paradigm-eval/drive.mjs status                         # 列出各格状态
// 依赖：后端跑在 127.0.0.1:3001；backend/.env 提供 INIT_ADMIN_*（未用）与探针账号自注册。
// 约束：本脚本只读 DB（node:sqlite readOnly），所有变更走 HTTP；断点状态落 results/。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = 'http://127.0.0.1:3001';
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const RESULTS = path.join(__dirname, 'results');
const PASSWORD = 'ParadigmEval2026';
const GEN_TIMEOUT_MS = 8 * 60 * 1000;

const personas = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-personas.json'), 'utf8')).personas;
const byId = id => personas.find(p => p.personaId === id);

let cookie = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + m);

function readEnv() {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  return Object.fromEntries(['INIT_ADMIN_NAME', 'INIT_ADMIN_PASSWORD', 'AI_API_URL', 'AI_API_KEY', 'AI_MODEL'].map(k => [k, get(k)]));
}

async function api(method, urlPath, bodyObj, { retries = 4, timeout = 600000 } = {}) {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(BASE + urlPath, { method, headers, body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined, signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
      // 422 恢复信封不是错误：交调用方处理
      if (res.status === 422) return { status: 422, json };
      if (!res.ok || json?.success === false) {
        lastErr = (json?.error?.message || json?.error || text).slice(0, 200);
        if (res.status === 409 || res.status === 429 || res.status >= 500) {
          await sleep(15000 * (attempt + 1));
          continue;
        }
        // 401：重新登录一次再试
        if (res.status === 401 && attempt === 0) { await loginAs(cookie.split('=')[0] ? undefined : null); continue; }
        throw new Error(method + ' ' + urlPath + ': ' + lastErr);
      }
      return { status: res.status, json };
    } catch (e) {
      if (e.name === 'TimeoutError') throw new Error(method + ' ' + urlPath + ' timeout');
      lastErr = (e.cause?.code ? e.cause.code + ' ' : '') + e.message;
      await sleep(10000 * (attempt + 1));
    }
  }
  throw new Error(method + ' ' + urlPath + ' failed: ' + lastErr);
}

async function loginAs(name, password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name, password, remember: true }),
  });
  const j = await res.json();
  if (!j.success) throw new Error('probe login failed: ' + JSON.stringify(j).slice(0, 150));
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
}

async function ensureProbeUser(personaId) {
  const name = 'pe-' + personaId;
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name, password: PASSWORD, remember: true }),
  });
  // 201 新建 / 400 已存在（幂等）
  await loginAs(name, PASSWORD);
  return { name, existed: reg.status !== 201 };
}

/** v1.3 带文件格：先把 fixtures 上传到用户资料库（multipart，字段名 file），返回材料 id 列表。 */
async function uploadFixtures(persona) {
  const ids = [];
  for (const up of persona.uploads || []) {
    const filePath = path.join(__dirname, 'fixtures', up.fixture);
    const buf = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('file', new Blob([buf]), up.fixture);
    const res = await fetch(BASE + '/api/materials', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost:5173' },
      body: form,
    });
    const j = await res.json().catch(() => ({}));
    const id = j?.data?.id || j?.data?.materialId || j?.data?.record?.id || null;
    log(`upload ${up.fixture} -> ${res.status}${id ? ' id=' + String(id).slice(0, 18) : ' body=' + JSON.stringify(j).slice(0, 120)}`);
    if (id) ids.push(String(id));
  }
  return ids;
}

function statePath(personaId, run) { return path.join(RESULTS, `${personaId}-r${run}.json`); }
function loadState(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }
function saveState(p, st) { fs.writeFileSync(p, JSON.stringify(st, null, 1)); }

async function driveCell(personaId, runIndex) {
  const persona = byId(personaId);
  if (!persona) throw new Error('unknown persona ' + personaId);
  fs.mkdirSync(RESULTS, { recursive: true });
  const sp = statePath(personaId, runIndex);
  let st = loadState(sp) || {
    personaId, run: runIndex, status: 'driving', startedAt: Date.now(),
    conversationId: null, rounds: 0, resistances: 0, confirmedAt: null,
    pathId: null, transcript: [], proposal: null, keyStages: null,
    path: null, generationLifecycle: null, errors: [],
  };

  await ensureProbeUser(personaId);

  // ---- 带文件格：先上传 fixtures（幂等：只在会话首次驱动时传一次） ----
  if ((persona.uploads || []).length && !st.uploadedMaterialIds) {
    st.uploadedMaterialIds = await uploadFixtures(persona);
    saveState(sp, st);
  }

  // ---- 会话阶段 ----
  if (!st.conversationId) {
    const r = await api('POST', '/api/goal-conversation/start', { input: { text: persona.opening } });
    const d = r.json.data;
    st.conversationId = d.internal.core.conversationId;
    st.rounds = 1;
    st.transcript.push({ role: 'user', text: persona.opening }, { role: 'ai', text: d.userVisible });
    if (d.internal.core.stage === 'proposing') st.stage = 'proposing';
    saveState(sp, st);
    log(`${personaId}#${runIndex} started, stage=${d.internal.core.stage}`);
  }

  const fu = [...(persona.followUps || [])];
  let fuIdx = st.followUpIdx || 0;
  fuIdx && fu.splice(0, fuIdx);
  let guard = 12;
  while (st.status === 'driving' && guard-- > 0) {
    const snap = await api('GET', '/api/goal-conversation/' + st.conversationId);
    const core = snap.json?.data?.internal?.core || {};
    if (core.stage === 'completed' || (core.learningPath && core.learningPath.id)) {
      st.pathId = core.learningPath?.id || st.pathId;
      break;
    }
    if (core.stage === 'proposing') {
      // 有异议脚本的人设（不限 mastery）：首次 proposing 注入一次异议，其后确认。
      // resistanceAtProposal / objectionAtProposal 等价（v1.2 起 change-sql 用后者表"砍阶段"异议）
      const objectionText = persona.resistanceAtProposal || persona.objectionAtProposal;
      if (st.resistances < 1 && objectionText) {
        st.resistances = 1;
        const text = objectionText;
        const r = await api('POST', `/api/goal-conversation/${st.conversationId}/reply`, { input: { text } });
        st.rounds++;
        st.transcript.push({ role: 'user', text }, { role: 'ai', text: r.json?.data?.userVisible || '' });
        if (r.status === 422 && r.json?.data) { /* 恢复信封：本轮已消耗 */ }
        saveState(sp, st);
        log(`${personaId}#${runIndex} resistance injected @proposing`);
        continue;
      }
      const text = '确认并生成路径';
      const r = await api('POST', `/api/goal-conversation/${st.conversationId}/reply`, { input: { text }, confirmProposal: true });
      st.rounds++;
      const d = r.json?.data || r.json?.data?.data;
      const c = d?.internal?.core || {};
      st.confirmedAt = Date.now();
      st.proposal = d?.internal?.ext?.goalConversation?.confirmedProposal || null;
      st.keyStages = st.proposal?.key_stages || null;
      if (c.learningPath?.id) st.pathId = c.learningPath.id;
      st.transcript.push({ role: 'user', text }, { role: 'ai', text: d?.userVisible || (r.json?.error || '') });
      st.status = st.pathId ? 'awaiting-path' : 'driving';
      saveState(sp, st);
      log(`${personaId}#${runIndex} confirmed, pathId=${st.pathId || 'MISSING'}`);
      continue;
    }
    // understanding（或其他）：按脚本续答
    const isResistance = fuIdx === 0 && !!persona.resistanceAtProposal;
    const text = (fu.length ? fu.shift() : '') || '就按你的思路来，给我出方案吧。';
    fuIdx++;
    st.followUpIdx = fuIdx;
    const r = await api('POST', `/api/goal-conversation/${st.conversationId}/reply`, { input: { text } });
    st.rounds++;
    if (r.status === 422) {
      st.transcript.push({ role: 'user', text }, { role: 'ai', text: '[422 结构化输出失败，恢复信封]' });
      const rec = r.json?.data?.internal?.core;
      if (rec?.stage === 'proposing') { saveState(sp, st); continue; }
    } else {
      const d = r.json?.data || {};
      st.transcript.push({ role: 'user', text }, { role: 'ai', text: d.userVisible || '' });
      const c = d.internal?.core || {};
      if (c.conversationId) st.conversationId = c.conversationId;
    }
    saveState(sp, st);
    log(`${personaId}#${runIndex} round ${st.rounds} (${isResistance ? 'resist' : 'followup'}) sent`);
  }

  // ---- 生成等待阶段 ----
  if (st.status === 'awaiting-path' && st.pathId) {
    const deadline = Date.now() + GEN_TIMEOUT_MS;
    let failGrace = 0; // 2026-09-27：生成器有自动重试（attempt1 failed → attempt2 succeeded），
    // 首次 failed 只记账，连续 4 次（≈1min）仍 failed 才判死——避免把重试中的运行误判为 failed-gen
    while (Date.now() < deadline) {
      const g = await api('GET', `/api/learning/paths/${st.pathId}/generation-status`);
      const lc = g.json?.data?.lifecycle || '';
      st.generationLifecycle = lc;
      if (lc === 'ready') break;
      if (String(lc).includes('failed')) {
        failGrace += 1;
        if (failGrace >= 4) { st.status = 'failed-gen'; break; }
      } else failGrace = 0;
      await sleep(15000);
    }
    if (st.status === 'awaiting-path') {
      const detail = await api('GET', '/api/learning/paths/' + st.pathId);
      const d = detail.json?.data || {};
      st.path = {
        id: d.id, name: d.name || d.title, status: d.status, estimatedHours: d.estimatedHours,
        stages: (d.stages || d.milestones || []).map(s => ({
          stageNumber: s.stageNumber, title: s.title, goal: s.goal, estimatedHours: s.estimatedHours,
          subtasks: (s.subtasks || []).map(t => ({ title: t.title, taskType: t.taskType, estimatedMinutes: t.estimatedMinutes, acceptanceCriteria: t.acceptanceCriteria, icapLevel: t.icapLevel })),
        })),
      };
      st.status = 'done';
      st.finishedAt = Date.now();
      saveState(sp, st);
      log(`${personaId}#${runIndex} DONE: ${st.path.name} (${st.path.stages?.length} stages)`);
    } else {
      saveState(sp, st);
    }
  }
  return st;
}

async function runAll() {
  const cells = [];
  for (const p of personas) for (let r = 1; r <= (p.repeat || 1); r++) cells.push([p.personaId, r]);
  for (const [id, r] of cells) {
    const sp = statePath(id, r);
    const st = loadState(sp);
    if (st && (st.status === 'done')) { log(`skip ${id}#${r} (done)`); continue; }
    if (st && st.status === 'failed-gen') { log(`skip ${id}#${r} (failed-gen, 单格重跑删除状态文件)`); continue; }
    try { await driveCell(id, r); } catch (e) { log(`ERROR ${id}#${r}: ${e.message}`); }
    await sleep(5000);
  }
}

function status() {
  for (const p of personas) for (let r = 1; r <= (p.repeat || 1); r++) {
    const st = loadState(statePath(p.personaId, r));
    console.log(p.personaId.padEnd(14), 'r' + r, st ? `${st.status} rounds=${st.rounds} path=${st.pathId ? 'Y' : 'N'}` : '-');
  }
}

// ---- 入口 ----
const env = readEnv();
const cmd = process.argv[2] || 'status';
if (cmd === 'cell') {
  await loginAs('pe-' + process.argv[3], PASSWORD).catch(async () => {
    // 账号可能不存在：注册后重登
    const name = 'pe-' + process.argv[3];
    await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ name, password: PASSWORD, remember: true }) });
    await loginAs(name, PASSWORD);
  });
  await driveCell(process.argv[3], Number(process.argv[4] || 1));
} else if (cmd === 'all') {
  await runAll();
} else if (cmd === 'judge' || cmd === 'report') {
  console.error('judge/report 由 judge.mjs 执行：node scripts/paradigm-eval/judge.mjs');
} else {
  status();
}
