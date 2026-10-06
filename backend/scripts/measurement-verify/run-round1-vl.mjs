#!/usr/bin/env node
/** run-round1-vl.mjs — 教学测量第一轮·VL 渠道单课驱动（1 人 1 课）。
 * 机制照抄 scripts/vlab-eval/run-vl-batch.mjs（原脚本不动；该脚本 BASE 本就是 --base
 * 参数非硬编码，但批量版只认 ids-file 里的存量 personaId，不带 batch-create，故单写此驱动）：
 * batch-create 1 人 → start-session → run-full(goal→path) → poll-path → start-learning
 * → teaching-step 循环 → 两段式 finalize → wrapup → 轮询 wrapup 落库。
 * 铁律落实：
 *  - 只打 3011 验证实例（BASE 默认 http://127.0.0.1:3011，任务指定；node:http 直连绕 undici
 *    headersTimeout——run-vl-batch.mjs:51-53 同款根因注释）
 *  - admin 鉴权照抄 admin-session.mjs 协议（读共享 cookie 文件复用；今晚无并行驱动，
 *    本脚本不回写 cookie 文件——铁律 1 限定新文件只落 measurement-verify/** 与 doc/local/**）
 *  - 回合间 sleep 6s（铁律 4 的 5-10s 档）；429/5xx 退避 30s ×≤3（铁律 4）；
 *    409 会话写锁独立预算（run-vl-batch.mjs:104-110 同款「等就完事」语义）
 *  - 断点状态文件/日志只写 backend/scripts/measurement-verify/out/**
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : d; };
const BASE = arg('base', 'http://127.0.0.1:3011');
const NAME = arg('name', 'vl-r1-mid-01');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'vl-run.log');
const STATE = path.join(OUT, `vlstate-${NAME}.json`);
const SUMMARY = path.join(OUT, 'vl-run-summary.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
function log(m) {
  const line = `[${now().slice(11, 23)}] ${m}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

// ---- admin 鉴权（admin-session.mjs 同协议；cookie 文件只读复用、不回写）----
const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
const FLEET_COOKIE = path.join(ROOT, '.tmp-batch', 'admin-cookie.txt');
let cookie = '';
async function adminLogin() {
  try {
    const c = fs.readFileSync(FLEET_COOKIE, 'utf8').trim();
    if (c) { cookie = c; log('admin: 复用 fleet cookie（只读）'); }
  } catch { /* 无共享 cookie */ }
  if (cookie) {
    const probe = await httpJson('GET', '/api/admin/virtual-learners?page=1&limit=1', undefined, 20000).catch(() => null);
    if (probe && probe.status === 200) return;
    log('fleet cookie 失效，重登');
  }
  const res = await httpJson('POST', '/api/admin-auth/login', {
    name: envGet('INIT_ADMIN_NAME'), password: envGet('INIT_ADMIN_PASSWORD'), remember: true,
  }, 30000);
  const setCookie = res.headers?.['set-cookie'] || '';
  const c = String(setCookie).split(';')[0];
  if (!c) throw new Error(`admin 登录失败: ${res.status} ${JSON.stringify(res.json).slice(0, 120)}`);
  cookie = c;
  log('admin: 已登录（仅内存，不回写 cookie 文件）');
}

// ---- node:http 直连（run-vl-batch.mjs:53-84 同款：agent:false 绕 half-open）----
function httpJson(method, urlPath, body, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      agent: false,
      headers: {
        Cookie: cookie,
        Origin: 'http://localhost:5173',
        ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
        resolve({ status: res.statusCode || 0, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { const e = new Error('http request timeout'); e.name = 'TimeoutError'; req.destroy(e); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function api(method, urlPath, body, { retries = 3, timeout = 600000 } = {}) {
  let last = null;
  let retried429 = 0;
  let retries409 = 0;
  for (;;) {
    let resp;
    try {
      resp = await httpJson(method, urlPath, body, timeout);
    } catch (e) {
      const msg = String(e?.message || e);
      if (e?.name === 'TimeoutError') {
        last = `timeout ${urlPath}`;
        if (++retried429 > retries) throw new Error(last);
        await sleep(10000 * retried429);
        continue;
      }
      throw new Error(`net ${urlPath}: ${msg}`);
    }
    const { status: resStatus, json } = resp;
    if (resStatus === 401) {
      await adminLogin();
      continue;
    }
    if (!resStatus || resStatus >= 400 || json?.success === false) {
      last = `${resStatus} ${String(json?.error?.message || json?.error || json?.raw || '').slice(0, 160)}`;
      if (resStatus === 409) {
        // 409=会话写锁（run-vl-batch.mjs:104-110：独立预算，「等就完事」）
        if (++retries409 > 20) throw new Error(last);
        await sleep(8000 * Math.min(retries409, 6));
        continue;
      }
      if (resStatus === 429 || resStatus >= 500) {
        // 铁律 4：429/5xx 退避 30 秒重试至多 3 次
        if (++retried429 > retries) throw new Error(last);
        log(`429/5xx（${last.slice(0, 80)}）→ 退避 30s 重试 ${retried429}/${retries}`);
        await sleep(30000);
        continue;
      }
      const err = new Error(last);
      err.status = resStatus;
      throw err;
    }
    return json;
  }
}

const saveState = (st) => fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };

async function listAllProfileIds() {
  const ids = new Set();
  for (let page = 1; page < 100; page++) {
    const list = await api('GET', `/api/admin/virtual-learners?page=${page}&limit=100`);
    const items = (list.data || {}).profiles || [];
    for (const p of items) ids.add(p.id);
    if (items.length < 100) break;
  }
  return ids;
}

async function main() {
  log(`=== run-round1-vl start: BASE=${BASE} NAME=${NAME} ===`);
  if (!/^http:\/\/127\.0\.0\.1:3011$/.test(BASE)) log(`警告: BASE 非任务指定的 3011 验证实例（${BASE}）`);
  await adminLogin();
  const st = loadState() || { name: NAME, phase: 'create' };
  const t0 = Date.now();

  // ---- Phase create: batch-create 1 人（中等水平人设）----
  if (st.phase === 'create') {
    const before = await listAllProfileIds();
    log(`存量 VL 档案 ${before.size} 个（快照完成）`);
    const sub = await api('POST', '/api/admin/virtual-learners/batch-create', {
      rows: [{ name: NAME, storyCount: 1 }],
      cohort: '中等水平自学者：有一定基础，能听懂讲解，但综合应用时需要在指导下练习巩固，偶尔出错',
      note: 'measurement-r1-vl',
    });
    st.batchId = sub.data?.batchId;
    if (!st.batchId) throw new Error('batch-create 未返回 batchId: ' + JSON.stringify(sub).slice(0, 200));
    log(`batch-create 已提交 batchId=${st.batchId}`);
    // 轮询批任务（身份+故事 LLM 生成，2s/轮服务端节奏）
    const deadline = Date.now() + 20 * 60 * 1000;
    let job = null;
    while (Date.now() < deadline) {
      await sleep(5000);
      job = (await api('GET', `/api/admin/virtual-learners/batch-create/${st.batchId}`)).data || {};
      if (job.status === 'done' || job.status === 'error') break;
    }
    log(`批任务终态 status=${job?.status} created=${job?.created} failed=${JSON.stringify(job?.failed || []).slice(0, 120)}`);
    if (job?.status !== 'done') throw new Error('batch-create 未完成: ' + JSON.stringify(job).slice(0, 200));
    // 差集定位新 profile（users.name 会被 persona 生成改写，不能按名匹配）
    const after = await listAllProfileIds();
    const fresh = [...after].filter((id) => !before.has(id));
    if (fresh.length !== 1) throw new Error(`差集定位异常：新增 ${fresh.length} 个 ${JSON.stringify(fresh)}`);
    st.profileId = fresh[0];
    const detail = (await api('GET', `/api/admin/virtual-learners?page=1&limit=100`)).data?.profiles?.find((p) => p.id === st.profileId);
    st.userId = detail?.userId || null;
    st.userNameAtCreate = detail?.userName || null;
    // 中等水平：knowledgeLevel intermediate（batch-create 无此参、默认 beginner 会偏置 persona designer；
    // 仅改本 VL 自己的档案，符合任务「中等水平人设」）
    await api('PUT', `/api/admin/virtual-learners/${st.profileId}`, { knowledgeLevel: 'intermediate' });
    log(`新 VL 就位 profileId=${st.profileId} userId=${st.userId} userName=${st.userNameAtCreate} knowledgeLevel=intermediate`);
    st.phase = 'start'; saveState(st);
  }

  // ---- Phase start: 开场会话（frictionBudget=normal 受控错误中等档）----
  if (st.phase === 'start') {
    const s = await api('POST', `/api/admin/virtual-learners/${st.profileId}/start-session`, { storyIndex: 0, frictionBudget: 'normal' });
    st.sessionId = s.data?.id || s.data?.sessionId;
    if (!st.sessionId) throw new Error('start-session 未返回 sessionId: ' + JSON.stringify(s).slice(0, 200));
    log(`模拟会话已开 sessionId=${st.sessionId}`);
    st.phase = 'goal-path'; saveState(st);
  }

  // ---- Phase goal-path: run-full（goal→path；autoAdvanceToLearning:false 诚实停在 path）----
  if (st.phase === 'goal-path') {
    try {
      await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/run-full`,
        { maxRounds: 30, maxMilestones: 10, continueOnTaskComplete: false, autoAdvanceToPath: true, autoAdvanceToLearning: false },
        { timeout: 40 * 60 * 1000 });
    } catch (e) {
      const msg = String(e.message || e);
      // run-vl-batch.mjs:238-244 同款：这两类是预期形态不是失败
      if (/等待路径生成超时/.test(msg)) log('run-full 服务端等待超时 → 转 poll-path 慢轮询');
      else if (!/未能进入教学阶段/.test(msg)) throw e;
      else log('run-full 止于 path 阶段（预期行为）');
    }
    st.phase = 'poll-path'; saveState(st);
  }

  // ---- Phase poll-path: 轮询路径就绪 ----
  if (st.phase === 'poll-path') {
    const deadline = Date.now() + 50 * 60 * 1000;
    let ready = false;
    let retried = 0;
    let lastStatus = '';
    while (Date.now() < deadline) {
      const ps = await api('GET', `/api/admin/virtual-learners/sessions/${st.sessionId}/path-status`, undefined, { timeout: 45000 });
      const d = ps.data || {};
      st.pathId = d.learningPathId || st.pathId;
      lastStatus = String(d.status || '');
      const milestones = d.path?.milestones || d.path?.stages || [];
      if (lastStatus === 'active' || lastStatus === 'ready' || (Array.isArray(milestones) && milestones.length > 0) || d.path?.canStartLearning === true) { ready = true; break; }
      const pg = d.pathGeneration || null;
      if (pg && /failed/.test(String(pg.status || ''))) {
        if (pg.retryAllowed && retried < 2) {
          retried++;
          log(`path 生成失败（${String(pg.reason || '').slice(0, 60)}），自愈重试 ${retried}/2`);
          await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/retry-path-generation`, {}).catch(() => { });
          await sleep(15000);
          continue;
        }
        break;
      }
      await sleep(12000);
    }
    if (!ready) throw new Error(`path 未就绪(status=${lastStatus})`);
    log(`path 就绪 pathId=${st.pathId} status=${lastStatus}`);
    st.phase = 'learn-pending'; saveState(st);
  }

  // ---- Phase learn: start-learning + teaching-step 循环 ----
  if (st.phase === 'learn-pending') {
    await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/start-learning`, {});
    st.phase = 'learn'; saveState(st);
    log('start-learning 完成，进入授课循环');
  }
  if (st.phase === 'learn') {
    const deadline = Date.now() + 75 * 60 * 1000;
    let doneTurn = 0;
    let learnRestarted = 0;
    let stepRetries = 0;
    let completed = false;
    while (Date.now() < deadline) {
      let r;
      try {
        r = await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-step`, {}, { timeout: 300000 });
      } catch (e) {
        const emsg = String(e.message || e);
        if (/已停止|已失败/.test(emsg) && learnRestarted < 2) {
          learnRestarted++;
          log(`学习会话已停止 → restart-learning 自愈 ${learnRestarted}/2`);
          await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/restart-learning`, {}, { timeout: 120000 });
          await sleep(6000);
          continue;
        }
        if (/valid JSON|retry budget exhausted/i.test(emsg) && stepRetries < 4) {
          stepRetries++;
          log(`模型抖动 → 原地重试 ${stepRetries}/4`);
          await sleep(10000);
          continue;
        }
        throw e;
      }
      stepRetries = 0;
      doneTurn++;
      const d = r.data || {};
      const s = d.status || d.sessionStatus || d.phase || '';
      if (doneTurn % 5 === 0 || d.taskCompleted === true) {
        log(`teaching-step #${doneTurn} status=${s} completedTasks=${d.completedTasks} taskCompleted=${d.taskCompleted}`);
      }
      const completedFirst = d.taskCompleted === true || d.isPathCompleted === true || Number(d.completedTasks ?? 0) >= 1 || d.firstTaskCompleted === true || s === 'task-done' || s === 'completed';
      if (completedFirst) { completed = true; break; }
      if (s === 'failed') throw new Error('teaching step failed: ' + JSON.stringify(d).slice(0, 150));
      await sleep(6000); // 铁律 4：回合间 5-10s
    }
    if (!completed) throw new Error(`首课未完成(超时 turns=${doneTurn})`);
    st.phase = 'learn-done'; st.turns = doneTurn; saveState(st);
    log(`授课循环完成 turns=${doneTurn}（${Math.round((Date.now() - t0) / 1000)}s）`);
  }

  // ---- Phase learn-done: 两段式 finalize + wrapup + 轮询落库 ----
  if (st.phase === 'learn-done') {
    // run-vl-batch.mjs:340-349：step N 置 pending、step N+1 才 finalize；少走=wrapup 永不落库
    for (let f = 0; f < 2; f++) {
      try {
        const fd = await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-step`, {}, { timeout: 300000 });
        if (fd?.data?.taskCompleted === true) continue;
        break;
      } catch (e) { log(`finalize 步骤异常（收尾继续）: ${String(e.message || e).slice(0, 80)}`); break; }
    }
    await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/wrapup`, {}).catch((e) => log(`wrapup 调用异常（继续轮询）: ${String(e.message || e).slice(0, 80)}`));
    let wrapupStatus = 'missing';
    let wrapupSeen = null;
    for (let k = 0; k < 12 && wrapupStatus === 'missing'; k++) {
      await sleep(15000);
      try {
        const td = await api('GET', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-detail`, undefined, { timeout: 30000 });
        const dd = td.data || {};
        let w = dd.wrapup || null;
        if (!w && Array.isArray(dd.teachingSessionHistory) && dd.teachingSessionHistory.length) {
          const lastHist = dd.teachingSessionHistory[dd.teachingSessionHistory.length - 1];
          const hd = await api('GET', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-detail?teachingSessionId=${lastHist.teachingSessionId}`, undefined, { timeout: 30000 });
          w = hd.data?.wrapup || null;
        }
        if (w?.status) { wrapupStatus = String(w.status); wrapupSeen = w; }
      } catch { /* 轮询失败继续等 */ }
    }
    st.wrapupStatus = wrapupStatus;
    fs.writeFileSync(path.join(OUT, `vl-wrapup-${NAME}.json`), JSON.stringify(wrapupSeen, null, 1));
    log(`wrapup 状态=${wrapupStatus}（快照已存 out/vl-wrapup-${NAME}.json）`);
    const summary = {
      name: NAME, profileId: st.profileId, userId: st.userId, sessionId: st.sessionId,
      pathId: st.pathId || null, turns: st.turns || 0, wrapupStatus,
      durSec: Math.round((Date.now() - t0) / 1000), finishedAt: now(),
    };
    fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 1));
    log(`=== 完成: ${JSON.stringify(summary)} ===`);
  }
}

main().catch((e) => {
  log(`FATAL: ${String(e?.message || e)}`);
  process.exitCode = 1;
});
