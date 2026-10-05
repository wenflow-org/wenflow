#!/usr/bin/env node
/** run-vl-batch.mjs — VL 原生批量驱动（Phase 2/3）：goal→path（run-full）→ 轮询就绪 → 可选 learn 首课。
 * 教训内置：per-VL 状态文件续跑、瞬时退避、admin 登录重登、错峰启动、单摘要 jsonl。
 * 用法：node scripts/vlab-eval/run-vl-batch.mjs [--ids-file=results/wave6-ids.txt] [--limit=20] [--concurrency=10]
 *        [--learn] [--tag=w6vl] [--base=http://127.0.0.1:3010]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { adminLoginOnce, refreshAdminCookie } from './admin-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : (process.argv.includes(`--${k}`) ? true : d); };
const BASE = arg('base', 'http://127.0.0.1:3010');
const IDS_FILE = arg('ids-file', '');
const LIMIT = Number(arg('limit', '0'));
const CONC = Math.max(1, Number(arg('concurrency', '10')));
const LEARN = process.argv.includes('--learn');
// --lessons=N：每人上 N 节课就收（默认 1 = 首课）。N≥2 时 learn-done 收尾（wrapup 落库）后
// 继续 start-learning 推进下一任务，以 completedTasks 基线 +1 为第二课完课信号，wrapup 后终态。
const LESSONS = Math.max(1, Number(arg('lessons', '1')));
// --path-only：集中资源冲 path。hold 未开场格子（不再新开会话）、跳过 learn/learn-done（暂停授课），
// 已到 path-ready 的直接收格不开课。goal-path/poll-path 照常推进到 path 就绪。
const PATH_ONLY = process.argv.includes('--path-only');
// --skip-learn：清扫模式（开场→goal→path），但把 learn/learn-done 格子 hold 给上课轨
// （区别于 --path-only：start 格子照常开场跑 path——通宵库存清扫用）
const SKIP_LEARN = process.argv.includes('--skip-learn');
const TAG = arg('tag', 'vl');
const RUN_DATE = process.env.VL_RUN_DATE || (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })();
// 跨零点发射时按启动日分目录会丢状态（2026-10-03 00:00 教训）：VL_RUN_DATE=20261002 钉住旧目录续跑
const EVAL_DIR = path.join(ROOT, 'doc/local/runs', RUN_DATE, 'vl-evals');
fs.mkdirSync(EVAL_DIR, { recursive: true });
const SUMMARY = path.join(EVAL_DIR, `vl-${TAG}-summary.jsonl`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
const envGet = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
let cookie = '';
// fleet 共享 cookie（adminAuth 单会话互踢，2026-10-03 实锤死锁）：登录/认领走共享模块
async function adminLogin() {
  cookie = await adminLoginOnce(BASE, envGet);
  if (!cookie) throw new Error('admin 登录失败');
}
async function refreshLogin() {
  cookie = await refreshAdminCookie(BASE, envGet, cookie);
  if (!cookie) throw new Error('admin cookie 刷新失败');
}
/** node:http 直连（绕开 undici headersTimeout=300s：run-full 服务端跑完整个 goal 阶段才回
 *  响应头，远超 5 分钟，fetch 必死 "fetch failed"（UND_ERR_HEADERS_TIMEOUT）——2026-10-02 实证根因） */
function httpJson(method, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      // agent:false：每次全新连接。复用 keep-alive socket 会撞上服务端 5s 空闲关闭的
      // half-open 态（写成功但永无响应 → 挂到 10 分钟超时）——2026-10-02 深跑实测
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
        let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { const e = new Error('http request timeout'); e.name = 'TimeoutError'; req.destroy(e); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function api(method, urlPath, body, { retries = 8, timeout = 600000, netBudgetMs = 600000 } = {}) {
  let last = null;
  let respRetries = 0;
  let retries409 = 0;
  let netStart = 0;
  let netRetries = 0;
  for (;;) {
    try {
      const { status: resStatus, json } = await httpJson(method, urlPath, body, timeout);
      // 401 或「会话已吊销/过期」403（11 驱动同秒互踢登录所致）→ 重登续命；
      // 复用 respRetries 计数防无限循环
      if (resStatus === 401 || (resStatus === 403 && /吊销|过期/.test(String(json?.error?.message || json?.error || '')))) {
        if (++respRetries > retries) throw new Error(`${resStatus} 登录态失效且重登超限`);
        await refreshLogin();
        continue;
      }
      if (!resStatus || resStatus >= 400 || json?.success === false) {
        last = `${resStatus} ${String(json?.error?.message || json?.error || json?.raw || '').slice(0, 140)}`;
        if (resStatus === 409) {
          // 409=会话写锁被占（孤儿轮/相邻驱动）。与限流不同，这是「等就完事」的错：
          // 独立预算 20 次、退避封顶 48s（累计可容忍 ~13 分钟锁占用），别占用 429/5xx 的快速失败预算
          if (++retries409 > 20) throw new Error(last);
          await sleep(8000 * Math.min(retries409, 6));
          continue;
        }
        if (resStatus === 429 || resStatus >= 500) {
          if (++respRetries > retries) throw new Error(last);
          await sleep(8000 * respRetries);
          continue;
        }
        throw new Error(last);
      }
      return json;
    } catch (e) {
      const msg = e?.message || String(e);
      last = msg;
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        if (++respRetries > retries) throw new Error(last);
        await sleep(10000 * respRetries);
        continue;
      }
      // 网络层瞬断：按时间预算退避重试（预算内不占响应重试次数）；cause 记入 last 供取证
      const causeStr = (e?.cause?.code || '') + ' ' + (e?.cause?.message || '');
      if (/fetch failed|ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|socket|network|UND_ERR|ECONN/i.test(msg + ' ' + causeStr)) {
        const now = Date.now();
        if (!netStart) netStart = now;
        if (now - netStart < netBudgetMs) {
          netRetries++;
          last = `net#${netRetries} ${msg} cause=${e?.cause?.code || e?.cause?.message || '-'}`;
          await sleep(Math.min(30000, 8000 * netRetries) + Math.floor(Math.random() * 4000));
          continue;
        }
        last = `net-exhausted(${netRetries}) ${msg} cause=${e?.cause?.code || e?.cause?.message || '-'}`;
      }
      throw new Error(last);
    }
  }
}

// 目标清单：ids-file 的 personaId → VL profile（翻到空页为止拉全，tags 分段精确匹配）
await adminLogin();
const tagStrings = [];
for (let page = 1; page < 200; page++) {
  const list = await api('GET', `/api/admin/virtual-learners?page=${page}&pageSize=100`);
  const d = list.data || {};
  const items = d.profiles || [];
  for (const p of items) tagStrings.push({ id: p.id, tags: String(p.tags || '') });
  if (!items.length) break;
}
log(`VL 档案拉全: ${tagStrings.length} 条`);
const findByPersona = (pid) => tagStrings.find((t) => t.tags.split(',').map((s) => s.trim()).includes(pid));
let idsArg = [];
if (IDS_FILE) idsArg = fs.readFileSync(path.resolve(ROOT, IDS_FILE), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
else idsArg = tagStrings.map((t) => { const segs = t.tags.split(',').map((s) => s.trim()); return segs[1] || ''; }).filter(Boolean);
if (LIMIT > 0) idsArg = idsArg.slice(0, LIMIT);
log(`目标 ${idsArg.length} 个 VL，并发 ${CONC}${LEARN ? '（含 learn 首课）' : ''}`);

const record = (o) => fs.appendFileSync(SUMMARY, JSON.stringify(o) + '\n');
const statePath = (pid) => path.join(EVAL_DIR, `vlstate-${pid}.json`);
const loadState = (pid) => { try { return JSON.parse(fs.readFileSync(statePath(pid), 'utf8')); } catch { return null; } };
const saveState = (pid, st) => fs.writeFileSync(statePath(pid), JSON.stringify(st, null, 1));

async function runOne(pid) {
  const t0 = Date.now();
  const vl = findByPersona(pid);
  if (!vl) { record({ id: pid, ok: false, err: 'no-vl-profile' }); log(`${pid} 无对应 VL`); return; }
  let st = loadState(pid) || { pid, vlId: vl.id, phase: 'start' };
  // --path-only：三类格子直接 hold（不记结果，恢复期原样续跑）；path-ready 收格不开课
  if (PATH_ONLY && ['start', 'learn', 'learn-done'].includes(st.phase)) {
    log(`${pid} hold@${st.phase}（--path-only）`);
    return;
  }
  // --skip-learn：learn/learn-done hold 给上课轨，start 照常开场跑 path
  if (SKIP_LEARN && ['learn', 'learn-done'].includes(st.phase)) {
    log(`${pid} hold@${st.phase}（--skip-learn）`);
    return;
  }
  // 课额已满（上完目标节数）的格子终态短路：监工队列重发会反复把 learn-done 格子重进
  // finalize+wrapup+3min 轮询，上满两节后必须秒收（只补一条记录，不碰 API）
  if (LEARN && !PATH_ONLY && st.phase === 'learn-done' && st.lesson2Done && LESSONS >= 2) {
    record({ id: pid, ok: true, phase: 'learn-done-2', sessionId: st.sessionId, pathId: st.pathId, turns: st.turns2 || 0, durSec: 0 });
    return;
  }
  if (PATH_ONLY && st.phase === 'path-ready') {
    record({ id: pid, ok: true, phase: 'path-ready', pathOnly: true, sessionId: st.sessionId, pathId: st.pathId });
    return;
  }
  // 会话被回收（fast-stale abandon）自愈：探测到终止态 → 重置状态开新会话（最多 2 次）
  if (st.sessionId && st.restarts === undefined) st.restarts = 0;
  let attempt = 0;
  try {
    for (; attempt <= 2; attempt++) {
      try {
        await runPhase(pid, vl, st, t0);
        return;
      } catch (e) {
        const msg = String(e.message || e);
        const deadSession = /abandoned|已终止|会话.*(结束|不存在)|404/.test(msg);
        if (deadSession && attempt < 2) {
          log(`${pid} 会话失效（${msg.slice(0, 40)}），重开新会话 ${attempt + 1}/2`);
          st = { pid, vlId: vl.id, phase: 'start', restarts: (st.restarts || 0) + 1 };
          saveState(pid, st);
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    const msg = String(e.message || e);
    record({ id: pid, ok: false, phase: st.phase, err: msg.slice(0, 200) });
    log(`${pid} FAIL@${st.phase}: ${msg.slice(0, 100)}`);
    // 限流类失败立即反馈给 AIMD（降并发）；这类格多为"慢"而非"坏"，重跑成本低
    if (/429|rate_?limit|排队超时|RPM_QUEUE_TIMEOUT|retry.?budget|Too Many Requests/i.test(msg)) {
      rateLimitedFails++;
      const next = Math.max(CONC_MIN, targetConc - 2);
      if (next !== targetConc) { log(`AIMD 限流失败 → 降并发 ${targetConc}→${next}`); targetConc = next; }
    }
  }
}

async function runPhase(pid, vl, st, t0) {
    if (st.phase === 'start') {
      const s = await api('POST', `/api/admin/virtual-learners/${vl.id}/start-session`, { storyIndex: 0 });
      st.sessionId = s.data?.id || s.data?.sessionId; st.phase = 'goal-path';
      saveState(pid, st);
    }
    if (st.phase === 'goal-path') {
      try {
        await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/run-full`, { maxRounds: 30, maxMilestones: 10, continueOnTaskComplete: false, autoAdvanceToPath: true, autoAdvanceToLearning: false }, { timeout: 40 * 60 * 1000 });
      } catch (e) {
        // autoAdvanceToLearning:false 时 run-full 必然以「未能进入教学阶段（当前阶段：path）」收尾——
        // 那是"诚实停在 path"的状态标记（run-vl-one.js 同款处理），不是失败；其余错误照抛。
        const msg = String(e.message || e);
        // 「等待路径生成超时」= 服务端内部等待放弃，但路径生成任务仍在跑/稍后会就绪——
        // 转入 poll-path 慢轮询收尾（50 分钟耐心），不丢格（2026-10-02：60 格并发下该形态占比最高）
        if (/等待路径生成超时/.test(msg)) {
          log(`${pid} run-full 服务端等待超时 → 转 poll-path 慢轮询`);
        } else if (!/未能进入教学阶段/.test(msg)) throw e;
        else log(`${pid} run-full 止于 path 阶段（预期行为）`);
      }
      st.phase = 'poll-path'; saveState(pid, st);
    }
    if (st.phase === 'poll-path') {
      const deadline = Date.now() + 50 * 60 * 1000;
      let ready = false;
      let retried = 0;
      let lastStatus = '';
      while (Date.now() < deadline) {
        const ps = await api('GET', `/api/admin/virtual-learners/sessions/${st.sessionId}/path-status`, undefined, { timeout: 45000 });
        const d = ps.data || {};
        st.pathId = d.learningPathId || st.pathId;
        // 真实字段：data.status = learningPath.status（生成完成 = active）；milestones/stages 有内容即就绪
        lastStatus = String(d.status || '');
        const milestones = d.path?.milestones || d.path?.stages || [];
        if (lastStatus === 'active' || lastStatus === 'ready' || (Array.isArray(milestones) && milestones.length > 0) || d.path?.canStartLearning === true) { ready = true; break; }
        // 后端 harness 契约：pathGeneration 明确失败且允许重试 → 有界自愈（≤2 次）
        const pg = d.pathGeneration || null;
        if (pg && /failed/.test(String(pg.status || ''))) {
          if (pg.retryAllowed && retried < 2) {
            retried++;
            log(`${pid} path 生成失败（${String(pg.reason || '').slice(0, 40)}），自愈重试 ${retried}/2`);
            await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/retry-path-generation`, {}).catch(() => { });
            await sleep(15000);
            continue;
          }
          break;
        }
        await sleep(10000 + Math.floor(Math.random() * 4000));
      }
      // 会话被标记 abandoned 不丢资产：驱动被杀会连累会话标记，路径本体（learningPathId 指向）仍有效
      if (!ready && st.pathId) {
        const sp = await api('GET', `/api/admin/virtual-learners/sessions/${st.sessionId}`).catch(() => null);
        const sess = sp?.data?.session || sp?.data || {};
        if (sess.status === 'abandoned') { ready = true; log(`${pid} 会话已 abandoned 但路径资产有效，按就绪收`); }
      }
      if (!ready) { record({ id: pid, ok: false, phase: 'poll-path', err: `path 未就绪(status=${lastStatus})`, sessionId: st.sessionId }); log(`${pid} path 超时`); return; }
      st.phase = 'path-ready'; saveState(pid, st);
    }
    if (st.phase === 'path-ready' && (!LEARN || PATH_ONLY)) {
      record({ id: pid, ok: true, phase: 'path-ready', sessionId: st.sessionId, pathId: st.pathId, durSec: Math.round((Date.now() - t0) / 1000) });
      log(`${pid} path OK (${Math.round((Date.now() - t0) / 1000)}s)`);
      return;
    }
    if (st.phase === 'path-ready' && LEARN && !PATH_ONLY) {
      await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/start-learning`, {});
      st.phase = 'learn'; saveState(pid, st);
    }
    if (st.phase === 'learn') {
      // 75 分钟：实测带检查点门的首课 30 分钟不够（69 条消息仍在共同卡点攻坚）
      const deadline = Date.now() + 75 * 60 * 1000;
      let doneTurn = 0;
      let learnRestarted = 0;
      let stepRetries = 0;
      while (Date.now() < deadline) {
        let r;
        try {
          r = await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-step`, {}, { timeout: 300000 });
        } catch (e) {
          const emsg = String(e.message || e);
          // 「学习已停止/学习会话已停止或失败」= 会话本体已死。自愈：restart-learning 复活后
          // 继续走轮（≤2 次）；不死丢格（2026-10-02 爆发期掉格主形态之一）
          if (/已停止|已失败/.test(emsg) && learnRestarted < 2) {
            learnRestarted++;
            log(`${pid} 学习会话已停止 → restart-learning 自愈 ${learnRestarted}/2`);
            await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/restart-learning`, {}, { timeout: 120000 });
            await sleep(5000);
            continue;
          }
          // 模型抖动两形态（2026-10-04 实测占失败 80%+）：①上游偶发输出非 JSON（网关 200 但
          // skill 校验拒），②服务端模型重试链耗尽。实测多数只毁这一步、会话仍活着（6 样本 4 running）
          // → 原地重试 teaching-step（≤4 次），不动会话（restart-learning 会误杀活课）；连续失败
          // 会转成「已停止」走上面的复活分支。
          if (/valid JSON|retry budget exhausted/i.test(emsg) && stepRetries < 4) {
            stepRetries++;
            log(`${pid} 模型抖动（${/JSON/i.test(emsg) ? '非JSON输出' : '重试预算耗尽'}）→ 原地重试 ${stepRetries}/4`);
            await sleep(10000);
            continue;
          }
          throw e;
        }
        stepRetries = 0;
        const d = r.data || {};
        doneTurn++;
        const s = d.status || d.sessionStatus || d.phase || '';
        // 完课信号：teaching-step 响应的 taskCompleted/isPathCompleted（2026-10-02 实证：
        // 完课窗口只在下一 step finalize 前存在，读不到信号会永远错过 wrapup 窗口）
        const completedFirst = d.taskCompleted === true || d.isPathCompleted === true || d.completedTasks >= 1 || d.firstTaskCompleted === true || s === 'task-done' || s === 'completed';
        if (completedFirst) { st.phase = 'learn-done'; st.turns = doneTurn; saveState(pid, st); break; }
        if (s === 'failed') throw new Error('teaching step failed: ' + JSON.stringify(d).slice(0, 120));
        await sleep(2000);
      }
      if (st.phase !== 'learn-done') { record({ id: pid, ok: false, phase: 'learn', err: '首课未完成(超时)', sessionId: st.sessionId, turns: doneTurn }); log(`${pid} learn 超时`); return; }
    }
    if (st.phase === 'learn-done') {
      // 完课两段式（2026-10-02 实证）：step N 置 task_completion_pending（响应 taskCompleted=true），
      // step N+1 才 finalize（endSession→wrapup 生成→completeTask→推进）。少走这一步 = 授课会话
      // 永远 active、wrapup 永远不落库（旧批量 30/30 全空的真机制）。
      for (let f = 0; f < 2; f++) {
        try {
          const fd = await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-step`, {}, { timeout: 300000 });
          if (fd?.data?.taskCompleted === true) continue; // 连续完课（跨任务）再 finalize 一次
          break;
        } catch { break; }
      }
      await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/wrapup`, {}).catch(() => { });
      // wrapup 落库验证：收束 LLM 生成要 1-3 分钟；当前会话已归档时查历史最后一条
      let wrapupStatus = 'missing';
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
          if (w?.status) wrapupStatus = String(w.status);
        } catch { /* 轮询失败继续等 */ }
      }
      record({ id: pid, ok: true, phase: 'learn-done', sessionId: st.sessionId, pathId: st.pathId, turns: st.turns, wrapup: wrapupStatus, durSec: Math.round((Date.now() - t0) / 1000) });
      log(`${pid} learn 首课 OK (turns=${st.turns}, wrapup=${wrapupStatus})`);
      // --lessons≥2：wrapup 落库后再上一节。completedTasks 基线 +1 为完课信号；失败不重试
      // （写 lesson2Done 防止队列反复重进），格子保持 learn-done 终态，监工队列不会重排它。
      if (LESSONS >= 2 && !st.lesson2Done) {
        st.lesson2Done = true; saveState(pid, st);
        let ok2 = false, turns2 = 0;
        // 整体重试 ≤2 次：撞上会话 failed/停止（后端重启连锁）→ restart-learning 复活再开
        for (let attempt = 1; attempt <= 2 && !ok2; attempt++) {
          try {
            const sessRes = await api('GET', `/api/admin/virtual-learners/sessions/${st.sessionId}`, undefined, { timeout: 30000 });
            const sess = sessRes?.data?.session || sessRes?.data || {};
            const baseline = Number(sess.completedTasks || 0);
            try {
              await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/start-learning`, {});
            } catch (e) {
              const em = String(e.message || e);
              if (/已在学习|already/i.test(em)) { /* 已在课中，直接走轮 */ }
              else if (/已停止|已失败|重新开始学习/i.test(em)) {
                // 完课收尾或后端重启把学习相位停了：restart-learning 复活后重试一次
                log(`${pid} 第二课 start-learning 撞停止 → restart-learning 自愈（attempt ${attempt}）`);
                await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/restart-learning`, {}, { timeout: 120000 });
                await sleep(5000);
                await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/start-learning`, {});
              } else throw e;
            }
            const deadline2 = Date.now() + 75 * 60 * 1000;
            turns2 = 0; let restarted2 = 0, done2 = false, stepRetries2 = 0;
            while (Date.now() < deadline2) {
              let r2;
              try {
                r2 = await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-step`, {}, { timeout: 300000 });
              } catch (e) {
                const em2 = String(e.message || e);
                if (/已停止|已失败/.test(em2) && restarted2 < 2) {
                  restarted2++;
                  log(`${pid} 第二课会话已停止 → restart-learning 自愈 ${restarted2}/2`);
                  await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/restart-learning`, {}, { timeout: 120000 });
                  await sleep(5000);
                  continue;
                }
                if (/valid JSON|retry budget exhausted/i.test(em2) && stepRetries2 < 4) {
                  stepRetries2++;
                  log(`${pid} 第二课模型抖动 → 原地重试 ${stepRetries2}/4`);
                  await sleep(10000);
                  continue;
                }
                throw e;
              }
              stepRetries2 = 0;
              const d2 = r2.data || {};
              turns2++;
              const s2 = d2.status || d2.sessionStatus || d2.phase || '';
              if (Number(d2.completedTasks ?? -1) >= baseline + 1 || d2.taskCompleted === true || d2.isPathCompleted === true) { done2 = true; break; }
              if (s2 === 'failed') throw new Error('teaching step failed(2nd): ' + JSON.stringify(d2).slice(0, 120));
              await sleep(2000);
            }
            if (!done2) throw new Error('第二课未完成(超时)');
            for (let f = 0; f < 2; f++) {
              try {
                const fd = await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-step`, {}, { timeout: 300000 });
                if (fd?.data?.taskCompleted === true) continue;
                break;
              } catch { break; }
            }
            await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/wrapup`, {}).catch(() => { });
            ok2 = true;
          } catch (e) {
            if (attempt >= 2) {
              record({ id: pid, ok: false, phase: 'learn-2', err: String(e.message || e).slice(0, 200), sessionId: st.sessionId });
              log(`${pid} 第二课 FAIL: ${String(e.message || e).slice(0, 100)}`);
            } else {
              log(`${pid} 第二课 attempt${attempt} 失败重试: ${String(e.message || e).slice(0, 80)}`);
              await sleep(8000);
            }
          }
        }
        if (ok2) {
          st.turns2 = turns2; saveState(pid, st);
          record({ id: pid, ok: true, phase: 'learn-done-2', sessionId: st.sessionId, pathId: st.pathId, turns: turns2, durSec: Math.round((Date.now() - t0) / 1000) });
          log(`${pid} 第二课 OK (turns=${turns2})`);
        }
      }
      return;
    }
}

// ---- AIMD 自适应并发（P3）：后端 rpm 运行态做反馈 ----
// queued>0（后端令牌桶在排队）→ 立即降 2；限流类失败 → 立即降 2；
// 队列空且 90s 内无限流失败 → 缓升 1。上下界由 --concurrency 推导（0.5x ~ 1.7x）。
let cursor = 0, doneCount = 0, active = 0;
let targetConc = CONC;
const CONC_MIN = Math.max(1, Math.round(CONC * 0.5));
const CONC_MAX = Math.max(CONC, Math.round(CONC * 1.7));
let rateLimitedFails = 0;
let lastGrowAt = Date.now();
let stopping = false;

function aimdAdjust(rpmStats) {
  const queued = Number(rpmStats?.queued ?? 0);
  if (queued > 0) {
    const next = Math.max(CONC_MIN, targetConc - 2);
    if (next !== targetConc) { log(`AIMD 降并发 ${targetConc}→${next}（后端排队 ${queued}）`); targetConc = next; }
    return;
  }
  if (rateLimitedFails === 0 && Date.now() - lastGrowAt > 90000) {
    const next = Math.min(CONC_MAX, targetConc + 1);
    if (next !== targetConc) { log(`AIMD 升并发 ${targetConc}→${next}（队列空·无限流失败）`); targetConc = next; lastGrowAt = Date.now(); rateLimitedFails = 0; }
  }
}

const statsLoop = (async () => {
  while (!stopping) {
    try {
      const res = await api('GET', '/api/admin/virtual-learners/settings', undefined, { timeout: 20000 });
      const rpm = res.data?.data?.rpm || res.data?.rpm;
      if (rpm) aimdAdjust(rpm);
    } catch { /* stats 拉取失败不干预调度 */ }
    await sleep(30000);
  }
})();

const spawner = (async () => {
  while (cursor < idsArg.length) {
    if (active >= targetConc) { await sleep(800); continue; }
    await sleep(1500); // 启动错峰（替代原 workerIdx*3000 固定梯度）
    if (cursor >= idsArg.length || active >= targetConc) continue;
    const pid = idsArg[cursor++];
    active++;
    runOne(pid).catch(() => { }).finally(() => { active--; log(`progress ${++doneCount}/${idsArg.length}`); });
  }
})();
while (active > 0 || cursor < idsArg.length) await sleep(2000);
stopping = true;
await Promise.allSettled([spawner, statsLoop]);
log('批量完成');
