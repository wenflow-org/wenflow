// 两个不同水平虚拟学习者：全新会话 → Goal 对话（新提示词）→ Path 生成 → 打印对话与路径。
// 用法：node scripts/vlab-eval/vl-goal-path.mjs --base=http://127.0.0.1:3011 --vls=<id1>,<id2>
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3011');
const OUT = path.join(ROOT, 'doc', 'local', 'runs', '20261014', 'vl-goal-path');
fs.mkdirSync(OUT, { recursive: true });
const log = (m) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(line); fs.appendFileSync(path.join(OUT, 'run.log'), line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULTS = {
  林然: '8b4a848b-661c-45fa-967d-104e6be14ddf',
  周雅: '4a3e9fe2-9f03-49c4-a130-163172930a89',
};
const idsArg = arg('vls', '');
const VL_IDS = idsArg ? idsArg.split(',') : Object.values(DEFAULTS);

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
let cookie = '';
const { adminLoginOnce, getAdminCookie } = await import(pathToFileURL(path.join(HERE, 'admin-session.mjs')).href);
const ensureCookie = async () => { cookie = (await getAdminCookie(BASE, envGet)) || (await adminLoginOnce(BASE, envGet)); if (!cookie) throw new Error('admin 登录失败'); };

function api(method, urlPath, body, timeoutMs = 120000) {
  const url = new URL(BASE + urlPath);
  const payload = body !== undefined ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
      timeout: timeoutMs }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, json: j, raw: text.slice(0, 300) }); });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function dumpFromDb(sessionId) {
  const db = new DatabaseSync(DB, { readOnly: true });
  const vs = db.prepare('SELECT id, goalConversationId, learningPathId, currentStage, status FROM virtual_sessions WHERE id = ?').get(sessionId);
  const out = { session: vs, goal: null, path: null };
  if (vs?.goalConversationId) {
    const g = db.prepare('SELECT id, stage, status, collectedData FROM goal_conversations WHERE id = ?').get(vs.goalConversationId);
    let msgs = []; try { msgs = JSON.parse(g?.messages || '[]'); } catch { /* */ }
    out.goal = { id: g?.id, stage: g?.stage, status: g?.status, messages: msgs.map((m) => ({ role: m.role || m.sender || '?', content: String(m.content || m.text || '') })) };
    const s = g?.collectedData || '';
    out.goal.timeFields = (s.match(/"(?:time_budget|time_per_session|timePerDay|timePerSession|sessionsLengthMin|availableTime|expected_time|time_horizon)"\s*:\s*("[^"]*"|null|\d+(?:\.\d+)?)/g) || []);
  }
  if (vs?.learningPathId) {
    const p = db.prepare('SELECT id, title, estimatedHours, status FROM learning_paths WHERE id = ?').get(vs.learningPathId);
    const ms = db.prepare('SELECT id, stageNumber, title FROM milestones WHERE learningPathId = ? ORDER BY stageNumber').all(vs.learningPathId);
    out.path = { ...p, milestones: ms.map((m) => ({ stageNumber: m.stageNumber, title: m.title, tasks: db.prepare('SELECT title, estimatedMinutes FROM subtasks WHERE milestoneId = ? ORDER BY "order"').all(m.id) })) };
  }
  db.close();
  return out;
}

async function runVl(vlId) {
  const prof = (() => { const db = new DatabaseSync(DB, { readOnly: true }); const r = db.prepare('SELECT profile, knowledgeLevel FROM virtual_learner_profiles WHERE id = ?').get(vlId); db.close(); return r; })();
  let name = vlId; try { name = JSON.parse(prof?.profile || '{}').nameHint || vlId; } catch { /* */ }
  log(`\n=== ${name} (${vlId}) level=${prof?.knowledgeLevel} ===`);
  const st = await api('POST', `/api/admin/virtual-learners/${vlId}/start-session`, { storyIndex: 0 });
  const sessionId = st.json?.data?.id || st.json?.data?.sessionId;
  if (!sessionId) throw new Error(`start-session 未返回会话: ${JSON.stringify(st.json).slice(0, 200)}`);
  log(`  新会话 ${sessionId}`);

  // run-full：goal 对话（VL 模拟器扮演学习者）→ 自动推进到 path
  try {
    const r = await api('POST', `/api/admin/virtual-learners/sessions/${sessionId}/run-full`,
      { maxRounds: 30, maxMilestones: 10, continueOnTaskComplete: false, autoAdvanceToPath: true, autoAdvanceToLearning: false },
      40 * 60 * 1000);
    log(`  run-full http=${r.status} ${(/未能进入教学阶段|path/.test(JSON.stringify(r.json)) ? '(止于 path，预期)' : '')} err=${String(r.json?.error || r.json?.data?.error || '').slice(0, 100)}`);
  } catch (e) { log(`  run-full 抛错（转轮询）: ${String(e.message).slice(0, 100)}`); }

  // 轮询 path 就绪
  const deadline = Date.now() + 50 * 60 * 1000; let ready = false;
  while (Date.now() < deadline) {
    try {
      const ps = await api('GET', `/api/admin/virtual-learners/sessions/${sessionId}/path-status`, undefined, 45000);
      const d = ps.json?.data || {};
      const ms = d.path?.milestones || d.path?.stages || [];
      if (d.learningPathId && (ms.length || String(d.status) === 'active')) { ready = true; break; }
      if (['archived', 'failed'].includes(String(d.status))) { log(`  path 终态 ${d.status}`); break; }
    } catch { /* */ }
    await sleep(15000);
  }
  log(`  path 就绪=${ready}`);

  const dump = dumpFromDb(sessionId);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(dump, null, 2), 'utf8');
  // 打印 Goal 对话
  log(`\n  --- Goal 对话（${dump.goal?.messages?.length || 0} 条, stage=${dump.goal?.stage}）---`);
  for (const m of dump.goal?.messages || []) log(`  [${m.role === 'assistant' || m.role === 'ai' ? 'AI' : 'VL'}] ${m.content.replace(/\s+/g, ' ').slice(0, 220)}`);
  log(`  时间字段: ${JSON.stringify(dump.goal?.timeFields || [])}`);
  // 打印 Path
  log(`\n  --- Path「${dump.path?.title}」 ${dump.path?.estimatedHours}h / ${dump.path?.milestones?.length} 里程碑 ---`);
  for (const m of dump.path?.milestones || []) {
    log(`   Stage ${m.stageNumber} ${m.title}`);
    for (const t of m.tasks) log(`      - ${String(t.title).slice(0, 46)} | ${t.estimatedMinutes}min`);
  }
  return { name, sessionId, pathId: dump.path?.id };
}

(async () => {
  await ensureCookie();
  const summary = [];
  for (const id of VL_IDS) summary.push(await runVl(id));
  log(`\n=== 完成 ===\n${JSON.stringify(summary, null, 1)}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
