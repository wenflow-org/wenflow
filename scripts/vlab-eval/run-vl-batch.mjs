#!/usr/bin/env node
/** run-vl-batch.mjs — VL 原生批量驱动（Phase 2/3）：goal→path（run-full）→ 轮询就绪 → 可选 learn 首课。
 * 教训内置：per-VL 状态文件续跑、瞬时退避、admin 登录重登、错峰启动、单摘要 jsonl。
 * 用法：node scripts/vlab-eval/run-vl-batch.mjs [--ids-file=results/wave6-ids.txt] [--limit=20] [--concurrency=10]
 *        [--conc-max=N] [--learn] [--tag=w6vl] [--base=http://127.0.0.1:3010]
 * --conc-max=N：AIMD 并发上限显式覆盖（默认=--concurrency 本身，R1 A38：上限不得越过操作者指定值）。
 * --selftest：跑纯函数断言（错误分类/重试决策/AIMD 界/path 任务就绪判定）后退出，不连后端不碰 fs；
 *   回归命令：node scripts/vlab-eval/test-run-vl-batch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { adminLoginOnce, refreshAdminCookie } from './admin-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (k, d) => { const hit = process.argv.find((a) => a.startsWith(`--${k}=`)); return hit ? hit.split('=').slice(1).join('=') : (process.argv.includes(`--${k}`) ? true : d); };

// ---- 纯函数：错误分类与重试决策（--selftest 判定面；三缺陷 R1 A8/A9/A38 修复的核心判定） ----

/** [F3-a / R1 A9] 200 包裹的上游错误分类。
 * 背景（R1 §13 / R2 §10-异常①实锤）：上游池 403「No active subscription found for this group」
 * 不以 HTTP 403 暴露，而是网关吃下后以 HTTP 200 + body 错误回传（B1 格一次即败实录
 * vl-r1b-summary.jsonl:1：「200 API request failed with status 403: {"error":{"message":
 * "No active subscription found for this group","type":"bad_response_status_code"…}」）——
 * 旧 api() 重试分类只认直连 429/5xx/409/超时，这类错误落在「立即抛」分支。
 * 返回 null（非上游包裹错误 → 维持立即抛，业务错不烧重试预算）；命中返回：
 *   { upstreamStatus, sub403, retryable }
 *   - sub403=true：池级订阅 403（已知形态）——api() 重试前先走 revive 钩子（R2 ad-driver.mjs
 *     advanceDay/reviveIfFailed:260-271 已验证修法：restart-learning 复活被终态化的会话再重发）；
 *   - retryable：上游 404（模型/资源不存在）重试无意义=false；上游 5xx/429/403 与无状态码的
 *     AUTH_INVALID 家族（R2 seq 轨实败形态）=true。 */
function classifyWrappedUpstream(msg) {
  const text = String(msg || '');
  const m = text.match(/API request failed with status (\d{3})/i);
  const family = m !== null || /bad_response_status_code|AUTH_INVALID|No active subscription/i.test(text);
  if (!family) return null;
  const upstreamStatus = m ? Number(m[1]) : 0;
  return {
    upstreamStatus,
    sub403: /No active subscription/i.test(text),
    retryable: m ? Number(m[1]) !== 404 : true,
  };
}

/** [F3-b / R1 A8] path-ready 竞态错误识别：start-learning 报「第一个里程碑没有可用任务」
 * = 阶段任务生成未就绪（simulation.learn-phase.ts:184-185 两种形态都自带"请稍后重试"语义），
 * 是可等待状态而非格死（B2 因此搁浅 38 分钟）。实败形态：vl-r1b-summary.jsonl:2、
 * vl-learn-queue-summary.jsonl:248/:569。 */
function isPathTasksNotReadyError(msg) {
  return /第一个里程碑没有可用任务/.test(String(msg || ''));
}

/** [F3-b] path 任务就绪状态（口径与后端 waitForPathReady 对齐：simulation.path-phase.ts:58-70
 * 「里程碑存在 ≠ 可启动。任务（subtasks）可能在里程碑写入后才插入……必须等到至少一个里程碑下
 * 有非 completed 的可启动任务」）。
 *   generating=任务尚未写入（继续等）；ready=存在非 completed 任务（可开课）；
 *   exhausted=任务已写入但全部 completed（开课必再败，早停不空等——实录形态
 *   vl-learn-queue-summary.jsonl:248「阶段任务已经准备完成，无需重试」）；unknown=响应异常（继续等）。 */
function pathTasksState(milestones) {
  if (!Array.isArray(milestones)) return 'unknown';
  let anySub = false;
  for (const m of milestones) {
    if (!Array.isArray(m?.subtasks)) continue;
    for (const t of m.subtasks) { anySub = true; if (String(t?.status || '') !== 'completed') return 'ready'; }
  }
  return anySub ? 'exhausted' : 'generating';
}

/** [F4 / FIX-REPORT §2 F3 边界] path 终态判定：learning_paths.status 落入终态 → 生成链已死、
 * 阶段任务永远不会写入，继续轮询只会空等满 10 分钟再抛同一个错（等待窗白烧，驱动格子被单格
 * 拖满等待上限）。实际写入面终态：failed（learning.service.ts:348-356/:409-417 生成失败回收）、
 * archived（learning-content.repo.ts:62-66 内容下线）；abandoned/cancelled 为防御性并入
 * （会话域同名词，路径域当前无写入点）。非终态（active/generating/空/异常响应）一律继续等。 */
function pathTerminalStatus(status) {
  return /^(failed|archived|abandoned|cancelled)$/.test(String(status || ''));
}

/** [F3-c / R1 A38] AIMD 并发界。上限默认=操作者指定的 --concurrency 本身（旧 max(CONC,1.7×)
 * 使实跑并发越过指定值 2→3，A38 实锤）；--conc-max=N 显式覆盖（可放大可收紧）；
 * 下限不越过上限（显式 conc-max < 0.5×CONC 时下限钳到上限）。 */
function concBounds(conc, concMaxExplicit) {
  const max = Number(concMaxExplicit) > 0 ? Number(concMaxExplicit) : conc;
  const min = Math.min(max, Math.max(1, Math.round(conc * 0.5)));
  return { min, max };
}

// --selftest：在任何 fs/网络副作用之前短路退出（纯函数声明提升可用）。退出码 0=全过。
if (process.argv.includes('--selftest')) {
  const cases = [];
  const t = (name, fn) => { try { fn(); cases.push([name, true, '']); } catch (e) { cases.push([name, false, e?.message || String(e)]); } };
  const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  // a) 200 包裹上游错误分类
  const b1msg = 'API request failed with status 403: {"error":{"message":"No active subscription found for this group","type":"bad_response_status_code","param":null}}';
  t('a·B1 实败形态(200 包裹 403 订阅)→retryable+sub403', () => eq(classifyWrappedUpstream(b1msg), { upstreamStatus: 403, sub403: true, retryable: true }, 'class'));
  t('a·200 包裹上游 500→retryable、无需复活', () => eq(classifyWrappedUpstream('API request failed with status 500: {"error":{"message":"upstream boom"}}'), { upstreamStatus: 500, sub403: false, retryable: true }, 'class'));
  t('a·200 包裹上游 404→不可重试', () => eq(classifyWrappedUpstream('API request failed with status 404: {"error":{"message":"model not found"}}').retryable, false, 'retryable'));
  t('a·AUTH_INVALID 家族(无状态码,R2 seq 形态)→retryable', () => eq(classifyWrappedUpstream('AUTH_INVALID: opening-generator failed').retryable, true, 'retryable'));
  t('a·业务竞态错不属上游家族→null(不烧重试预算)', () => eq(classifyWrappedUpstream('第一个里程碑没有可用任务（阶段设计未就绪：阶段任务仍在生成中，请稍后查看）'), null, 'class'));
  t('a·会话已停止不属上游家族→null(交给会话自愈分支)', () => eq(classifyWrappedUpstream('学习已停止（failed）'), null, 'class'));
  // b) path-ready 竞态识别 + 任务就绪判定
  t('b·竞态错·阶段设计未就绪(vl-r1b-02 实败形态)', () => eq(isPathTasksNotReadyError('200 第一个里程碑没有可用任务（阶段设计未就绪：阶段任务仍在生成中，请稍后查看）'), true, 'is'));
  t('b·竞态错·阶段任务生成中(重试已触发形态)', () => eq(isPathTasksNotReadyError('200 第一个里程碑没有可用任务（阶段任务生成中：已触发阶段设计重试 #4，请稍后重试）'), true, 'is'));
  t('b·非竞态·run-full 预期止步不误判', () => eq(isPathTasksNotReadyError('未能进入教学阶段（当前阶段：path）'), false, 'is'));
  t('b·非竞态·路径生成超时不误判', () => eq(isPathTasksNotReadyError('等待路径生成超时'), false, 'is'));
  t('b·任务状态·空里程碑=generating(继续等)', () => eq(pathTasksState([]), 'generating', 'state'));
  t('b·任务状态·里程碑在子任务未写入=generating', () => eq(pathTasksState([{ title: 'm1', subtasks: [] }]), 'generating', 'state'));
  t('b·任务状态·存在非 completed 任务=ready', () => eq(pathTasksState([{ subtasks: [{ status: 'completed' }, { status: 'pending' }] }]), 'ready', 'state'));
  t('b·任务状态·全部 completed=exhausted(早停不空等38分钟)', () => eq(pathTasksState([{ subtasks: [{ status: 'completed' }] }]), 'exhausted', 'state'));
  t('b·任务状态·响应异常=unknown(继续等)', () => eq(pathTasksState(undefined), 'unknown', 'state'));
  // c) AIMD 并发界
  t('c·conc=2 上限=2(旧 1.7× 越界到 3,R1 A38)', () => eq(concBounds(2), { min: 1, max: 2 }, 'bounds'));
  t('c·conc=10 上限=10(旧 17)', () => eq(concBounds(10), { min: 5, max: 10 }, 'bounds'));
  t('c·conc-max=3 显式放大上限', () => eq(concBounds(2, 3), { min: 1, max: 3 }, 'bounds'));
  t('c·conc-max=1 显式收紧·下限钳到上限', () => eq(concBounds(2, 1), { min: 1, max: 1 }, 'bounds'));
  t('c·conc-max=3 < 0.5×10·下限钳到 3', () => eq(concBounds(10, 3), { min: 3, max: 3 }, 'bounds'));
  t('c·conc-max 显式 0/缺省=上限即指定并发', () => eq(concBounds(6, 0), { min: 3, max: 6 }, 'bounds'));
  // d) [FIX-REPORT §5-11] path 终态判定：已终态 → 生成链已死，立即返回不空等 10 分钟
  t('d·failed=终态(生成失败回收→早停不空等)', () => eq(pathTerminalStatus('failed'), true, 'terminal'));
  t('d·archived=终态(内容下线→早停不空等)', () => eq(pathTerminalStatus('archived'), true, 'terminal'));
  t('d·abandoned=终态(防御性并入)', () => eq(pathTerminalStatus('abandoned'), true, 'terminal'));
  t('d·cancelled=终态(防御性并入)', () => eq(pathTerminalStatus('cancelled'), true, 'terminal'));
  t('d·active=非终态(任务仍可能写入,继续等)', () => eq(pathTerminalStatus('active'), false, 'terminal'));
  t('d·generating=非终态(继续等)', () => eq(pathTerminalStatus('generating'), false, 'terminal'));
  t('d·空/undefined/null=非终态(响应异常不误早停)', () => eq([pathTerminalStatus(''), pathTerminalStatus(undefined), pathTerminalStatus(null)], [false, false, false], 'terminal'));
  let fail = 0;
  for (const [name, ok, err] of cases) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + err}`); if (!ok) fail++; }
  console.log(`selftest: ${cases.length - fail}/${cases.length} passed`);
  process.exit(fail ? 1 : 0);
}

const BASE = arg('base', 'http://127.0.0.1:3010');
const IDS_FILE = arg('ids-file', '');
const LIMIT = Number(arg('limit', '0'));
const CONC = Math.max(1, Number(arg('concurrency', '10')));
// [F3-c] AIMD 上限显式覆盖（--conc-max=N）。裸 --conc-max（无=值）与非法值一律忽略回退默认
// （=CONC 本身），防 Number(true)=1 之类的隐式坑。
const CONC_MAX_EXPLICIT = /^[0-9]+$/.test(String(arg('conc-max', ''))) ? Number(arg('conc-max', '')) : 0;
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

async function api(method, urlPath, body, { retries = 8, timeout = 600000, netBudgetMs = 600000, revive = null } = {}) {
  let last = null;
  let respRetries = 0;
  let retries409 = 0;
  let revives = 0;
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
        const rawMsg = String(json?.error?.message || json?.error || json?.raw || '');
        last = `${resStatus} ${rawMsg.slice(0, 140)}`;
        if (resStatus === 409) {
          // 409=会话写锁被占（孤儿轮/相邻驱动）。与限流不同，这是「等就完事」的错：
          // 独立预算 20 次、退避封顶 48s（累计可容忍 ~13 分钟锁占用），别占用 429/5xx 的快速失败预算
          if (++retries409 > 20) throw new Error(last);
          await sleep(8000 * Math.min(retries409, 6));
          continue;
        }
        // [F3-a / R1 A9] 200 包裹的上游错误：网关吃下上游 4xx/5xx 后以 HTTP 200 回填错误体
        // （B1 格实败：403「No active subscription found for this group」以 200 返回，旧分类
        // 只认直连 429/5xx/409 → 一次即败）。上游 5xx/429/403/AUTH_INVALID → 与同名直连错误
        // 同预算退避重试；上游 404 不可重试直接抛；未命中上游家族的业务错维持「立即抛」不烧预算。
        if (resStatus >= 100 && resStatus < 400 && json?.success === false) {
          const cls = classifyWrappedUpstream(rawMsg);
          if (cls) {
            if (!cls.retryable) throw new Error(last);
            // 池级订阅 403 会把 vsession 终态化 failed（R2 §8：对 failed 重试只烧尽）——
            // 重发前先核对会话状态、failed/abandoned 才 restart-learning 复活
            //（R2 ad-driver.mjs advanceDay+reviveIfFailed 已验证修法，每调用至多 2 次）
            if (cls.sub403 && revive && revives < 2) { revives++; try { await revive(); } catch { /* 复活失败不阻断重试链 */ } }
            if (++respRetries > retries) throw new Error(last);
            await sleep(8000 * respRetries);
            continue;
          }
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
const _aimdBounds = concBounds(CONC, CONC_MAX_EXPLICIT);
log(`目标 ${idsArg.length} 个 VL，并发 ${Math.min(CONC, _aimdBounds.max)}${_aimdBounds.max !== CONC ? `（AIMD 界 [${_aimdBounds.min}, ${_aimdBounds.max}]，--conc-max 指定）` : ''}${LEARN ? '（含 learn 首课）' : ''}`);

const record = (o) => fs.appendFileSync(SUMMARY, JSON.stringify(o) + '\n');
const statePath = (pid) => path.join(EVAL_DIR, `vlstate-${pid}.json`);
const loadState = (pid) => { try { return JSON.parse(fs.readFileSync(statePath(pid), 'utf8')); } catch { return null; } };
const saveState = (pid, st) => fs.writeFileSync(statePath(pid), JSON.stringify(st, null, 1));

// [F3-a] 池级订阅 403 的复活钩子（R2 ad-driver.mjs reviveIfFailed:260-271 已验证修法搬移；
// 会话状态核对走产品 API 而非直查 DB——本脚本不持 sqlite 连接）：仅当 vsession 已被终态化
// （failed/abandoned）才 restart-learning，活会话不碰（防误杀活课，同 ad-driver 的先查后复活）。
async function reviveIfSessionDead(st) {
  const sp = await api('GET', `/api/admin/virtual-learners/sessions/${st.sessionId}`, undefined, { timeout: 30000 }).catch(() => null);
  const sess = sp?.data?.session || sp?.data || {};
  if (!['failed', 'abandoned'].includes(String(sess.status || ''))) return false;
  log(`会话已被终态化（${sess.status}）→ restart-learning 复活（sub403 重发前置）`);
  await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/restart-learning`, {}, { timeout: 120000 }).catch(() => { });
  await sleep(5000);
  return true;
}

// [F3-b / R1 A8] path-ready 竞态等待：轮询 path 详情等任务就绪再开课（上限 10 分钟，间隔 15s→60s 递增）。
// 详情端点 GET /api/admin/learning-content/paths/:id（learning-content.repo.ts:43-56：milestones[]
// 含 subtasks[]{status}；挂载 bootstrap/routers.ts:195）；就绪口径与后端 waitForPathReady 一致
// （simulation.path-phase.ts:58-70：里程碑存在 ≠ 可启动，须有非 completed 的可启动任务）。
// [F4] 轮询先查 path.status：已终态（failed/archived 等）→ 生成链已死、任务永不来，立即带原错
// 返回（返回非 'ready' 值，两处调用方保持 `!== 'ready'` → throw 原错语义），不再空等 10 分钟。
async function waitPathTasksReady(pid, st, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let gap = 15000;
  for (let k = 0; ; k++) {
    const pd = await api('GET', `/api/admin/learning-content/paths/${st.pathId}`, undefined, { timeout: 30000 }).catch(() => null);
    if (pathTerminalStatus(pd?.data?.status)) {
      const ts = String(pd.data.status);
      log(`${pid} path 已终态（${ts}）→ 生成链已死，早停不空等`);
      return `terminal:${ts}`;
    }
    const state = pathTasksState(pd?.data?.milestones);
    if (state === 'ready') { if (k > 0) log(`${pid} path 任务就绪（等待 ${k} 轮后）`); return 'ready'; }
    if (state === 'exhausted') { log(`${pid} path 任务已全部 completed（开课必再败，早停）`); return 'exhausted'; }
    if (Date.now() >= deadline) return 'timeout';
    if (k % 3 === 0) log(`${pid} path 任务未就绪（${state}）→ ${Math.round(gap / 1000)}s 后再查`);
    await sleep(gap);
    gap = Math.min(60000, gap + 10000);
  }
}

// [F3-b] start-learning 撞「第一个里程碑没有可用任务」从直接判格失败改为：轮询等任务就绪 → 重发开课。
async function startLearningWhenTasksReady(pid, st) {
  const url = `/api/admin/virtual-learners/sessions/${st.sessionId}/start-learning`;
  try {
    await api('POST', url, {}, { revive: () => reviveIfSessionDead(st) });
  } catch (e) {
    if (!isPathTasksNotReadyError(e?.message || e)) throw e;
    log(`${pid} start-learning 撞 path-ready 竞态 → 轮询等任务就绪（≤10min）`);
    if (!st.pathId || (await waitPathTasksReady(pid, st)) !== 'ready') throw e;
    await api('POST', url, {}, { revive: () => reviveIfSessionDead(st) });
  }
}

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
        await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/run-full`, { maxRounds: 30, maxMilestones: 10, continueOnTaskComplete: false, autoAdvanceToPath: true, autoAdvanceToLearning: false }, { timeout: 40 * 60 * 1000, revive: () => reviveIfSessionDead(st) });
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
      // [F3-b / R1 A8] 竞态感知开课：撞「第一个里程碑没有可用任务」→ 轮询等任务就绪 → 重发
      await startLearningWhenTasksReady(pid, st);
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
          r = await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-step`, {}, { timeout: 300000, revive: () => reviveIfSessionDead(st) });
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
              await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/start-learning`, {}, { revive: () => reviveIfSessionDead(st) });
            } catch (e) {
              const em = String(e.message || e);
              if (/已在学习|already/i.test(em)) { /* 已在课中，直接走轮 */ }
              else if (isPathTasksNotReadyError(em)) {
                // [F3-b] 第二课同样撞 path-ready 竞态（实录 vl-learn-queue-summary.jsonl:248/:555，
                // 旧分类下直接判格失败）：等任务就绪再重发，全部 completed 则早停抛原错
                log(`${pid} 第二课 start-learning 撞 path-ready 竞态 → 轮询等任务就绪`);
                if (!st.pathId || (await waitPathTasksReady(pid, st)) !== 'ready') throw e;
                await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/start-learning`, {}, { revive: () => reviveIfSessionDead(st) });
              }
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
                r2 = await api('POST', `/api/admin/virtual-learners/sessions/${st.sessionId}/teaching-step`, {}, { timeout: 300000, revive: () => reviveIfSessionDead(st) });
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
// 队列空且 90s 内无限流失败 → 缓升 1。
// [F3-c / R1 A38] 界：默认 [0.5×CONC, CONC]——上限=操作者 --concurrency 指定值本身
// （旧 max(CONC, 1.7×) 推导让实跑并发越过指定值 2→3，A38 实锤）；--conc-max=N 显式改界。
const { min: CONC_MIN, max: CONC_MAX } = concBounds(CONC, CONC_MAX_EXPLICIT);
let cursor = 0, doneCount = 0, active = 0;
let targetConc = Math.min(CONC, CONC_MAX);
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
