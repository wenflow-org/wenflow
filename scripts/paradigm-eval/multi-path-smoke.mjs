#!/usr/bin/env node
/**
 * 单用户多 path 横向冒烟：给已有路径的探针用户起第二条 goal 会话并确认生成，
 * 观测平台是否放行、列表/日程/统计口径如何处理多 path。
 *
 * 用法：node multi-path-smoke.mjs --user=pe-rw-life-13 --script=rw-wild-01 [--rounds=8]
 *   - --user   已有至少 1 条路径的探针账号（pe- 前缀可省）
 *   - --script real-goals-cases.json 里的人设 id，取其 opening/followUps 作为第二条目标
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BASE = 'http://127.0.0.1:3001';
const PASSWORD = 'ParadigmEval2026';
const GEN_TIMEOUT_MS = 8 * 60 * 1000;

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const userName = arg('user', 'pe-rw-life-13').replace(/^pe-/, 'pe-');
const scriptId = arg('script', 'rw-wild-01');
const MAX_ROUNDS = Number(arg('rounds', '10'));

const cases = JSON.parse(fs.readFileSync(path.join(HERE, 'real-goals-cases.json'), 'utf8')).cases;
const src = cases.find((c) => c.personaId === scriptId);
if (!src) { console.error('unknown script persona ' + scriptId); process.exit(1); }

let cookie = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);

async function api(method, urlPath, bodyObj, { retries = 3, timeout = 600000 } = {}) {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(BASE + urlPath, { method, headers, body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined, signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) } };
      if (res.status === 422) return { status: 422, json };
      if (!res.ok || json?.success === false) {
        const msg = (json?.error?.message || json?.error || text).slice(0, 200);
        if (res.status === 409 || res.status === 429 || res.status >= 500) { log(`  ${res.status} ${msg}（退避重试）`); await sleep(15000 * (attempt + 1)); continue; }
        throw new Error(`${method} ${urlPath}: ${res.status} ${msg}`);
      }
      return { status: res.status, json };
    } catch (e) {
      if (e.name === 'TimeoutError') throw new Error(`${method} ${urlPath} timeout`);
      if (attempt === retries - 1) throw e;
      await sleep(5000 * (attempt + 1));
    }
  }
}

async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: userName, password: PASSWORD, remember: true }),
  });
  const j = await res.json();
  if (!j.success) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 150));
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
}

const listPaths = async () => {
  const r = await api('GET', '/api/learning/paths');
  return (r.json?.data || []).map((p) => ({ id: p.id, name: p.name || p.title, status: p.status, hours: p.estimatedHours }));
};

await login();
log(`登录 ${userName} 成功`);
const before = await listPaths();
log(`现有路径 ${before.length} 条：`);
for (const p of before) log(`  - ${p.id} [${p.status}] ${p.name}（${p.hours ?? '?'}h）`);

// ---- 第二条目标：同用户、不同主题 ----
log(`以人设 ${scriptId} 的脚本开启第二条目标会话`);
const start = await api('POST', '/api/goal-conversation/start', { input: { text: src.opening } });
let convId = start.json?.data?.internal?.core?.conversationId;
let stage = start.json?.data?.internal?.core?.stage;
log(`会话 ${convId} 起始 stage=${stage}`);

const fu = [...(src.followUps || [])];
let rounds = 0;
while (rounds < MAX_ROUNDS) {
  const snap = await api('GET', '/api/goal-conversation/' + convId);
  const core = snap.json?.data?.internal?.core || {};
  stage = core.stage;
  if (core.stage === 'completed' || core.learningPath?.id) {
    log(`会话到达 completed，learningPath=${core.learningPath?.id || '(空)'}`);
    break;
  }
  if (core.stage === 'proposing') {
    const confirm = await api('POST', `/api/goal-conversation/${convId}/reply`, { input: { text: '确认并生成路径' }, confirmProposal: true });
    const d = confirm.json?.data || {};
    const c = d?.internal?.core || {};
    if (c.conversationId) convId = c.conversationId;
    if (c.learningPath?.id) { log(`确认后直接拿到 pathId=${c.learningPath.id}`); break; }
    log('已确认，等待路径落库…');
    break;
  }
  const text = fu.shift() || '就按你的思路来，给我出方案吧。';
  const r = await api('POST', `/api/goal-conversation/${convId}/reply`, { input: { text } });
  rounds++;
  const d = r.json?.data || {};
  const c = d.internal?.core || {};
  if (c.conversationId) convId = c.conversationId;
  if (c.learningPath?.id) { log(`round ${rounds} 后直接拿到 pathId=${c.learningPath.id}`); break; }
  log(`round ${rounds} stage=${stage} → ${c.stage || '?'}`);
}

// ---- 等生成 ----
const deadline = Date.now() + GEN_TIMEOUT_MS;
let newPath = null;
while (Date.now() < deadline) {
  const paths = await listPaths();
  newPath = paths.find((p) => !before.some((b) => b.id === p.id));
  if (newPath) break;
  await sleep(10000);
}
if (!newPath) {
  log('超时：未出现第二条路径');
  const paths = await listPaths();
  log('当前路径数：' + paths.length);
  process.exit(2);
}
log(`第二条路径出现：${newPath.id} [${newPath.status}] ${newPath.name}`);

// 等生成完成（stage_design_failed 有平台自恢复先例：K8s/行测两例 30-60s 内恢复，
// 故 failed 给 120s 宽限再判死）
const genDeadline = Date.now() + GEN_TIMEOUT_MS;
let failSince = null;
while (Date.now() < genDeadline) {
  const g = await api('GET', `/api/learning/paths/${newPath.id}/generation-status`);
  const lc = g.json?.data?.lifecycle || '';
  if (lc === 'ready') { log('第二条路径生成完成'); break; }
  if (String(lc).includes('failed')) {
    if (!failSince) { failSince = Date.now(); log(`生成报 failed（${lc}），给 120s 宽限等平台重试`); }
    if (Date.now() - failSince > 120000) { log('第二条路径生成失败: ' + lc); process.exit(3); }
  } else if (failSince) { failSince = null; log('平台重试恢复，继续等'); }
  await sleep(12000);
}

// ---- 多 path 横向口径 ----
const after = await listPaths();
log(`=== 多 path 观测：${userName} 现有 ${after.length} 条路径 ===`);
for (const p of after) log(`  - ${p.id} [${p.status}] ${p.name}（${p.hours ?? '?'}h）`);
for (const [label, ep] of [['今日日程', '/api/learning/schedule/today'], ['学习统计', '/api/learning/stats']]) {
  try {
    const r = await api('GET', ep);
    const text = JSON.stringify(r.json?.data || {}).slice(0, 300);
    log(`${label}（${ep}）：${text}`);
  } catch (e) { log(`${label}失败：${e.message}`); }
}
