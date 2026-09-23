/* eslint-disable no-console -- 一次性跑数 CLI */
/**
 * 续跑一个已存在的虚拟学习者会话（不重新生成路径）。
 *
 * 用途：`advance-day runTasks` 中途因上游模型抖动失败后，会话会被置为 `failed`/`abandoned`。
 * 本脚本先把学习阶段重启（`restart-learning`，保留 goal 与路径，从第一个未完成课程续传），
 * 再逐日推进 —— 路径与概念图不重算，只补课。
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/kc-resume-case.ts --session=<id> --days=2
 */
import 'dotenv/config';

try {
  // undici 默认 headersTimeout=300s，会把长教学回合在 300s 处掐断（表现为 fetch failed + 服务端 caller_abort）。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Agent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));
} catch { /* 无 undici 退化：长请求可能被 300s 掐断 */ }

const ORIGIN = 'http://localhost:5173';
const REQUEST_TIMEOUT_MS = 40 * 60_000;
const RETRY_BUDGET_MS = 40 * 60_000;
const NOT_READY_POLL_MS = 20_000;

const a = {
  baseUrl: (process.env.VIRTUAL_LAB_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, ''),
  adminName: process.env.E2E_ADMIN_NAME || process.env.INIT_ADMIN_NAME || 'admin',
  adminPassword: process.env.INIT_ADMIN_PASSWORD || '',
  session: '',
  days: 2,
  noRestart: false,
};
for (const arg of process.argv.slice(2)) {
  if (arg === '--no-restart') { a.noRestart = true; continue; }
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  const k = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
  const v = eq >= 0 ? arg.slice(eq + 1) : '';
  if (k === 'session') a.session = v.trim();
  else if (k === 'days') a.days = Math.max(1, Math.min(10, Number(v)));
  else if (k === 'base-url') a.baseUrl = v.replace(/\/+$/, '');
  else throw new Error(`未知参数：${arg}`);
}
if (!a.session) throw new Error('必须给 --session=<sessionId>');
if (!a.adminPassword) throw new Error('缺少 INIT_ADMIN_PASSWORD（或 E2E_ADMIN_PASSWORD）');

let cookie: string | null = null;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
function log(line: string) { console.log(`[${new Date().toISOString()}] ${line}`); }

async function login(): Promise<void> {
  const res = await fetch(`${a.baseUrl}/api/admin-auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ name: a.adminName, password: a.adminPassword, remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0] || null;
  if (!res.ok || !cookie) throw new Error(`登录失败 http=${res.status}`);
}

async function api(method: string, urlPath: string, body?: unknown) {
  try {
    const res = await fetch(`${a.baseUrl}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let parsed: Record<string, unknown> | null = null;
    try { parsed = asRecord(await res.json()); } catch { parsed = null; }
    return { status: res.status, body: parsed };
  } catch (e) {
    log(`  (网络异常：${(e as { code?: string }).code || (e as Error).message})`);
    return { status: 0, body: null as Record<string, unknown> | null };
  }
}

function stageOf(body: Record<string, unknown> | null) {
  const d = asRecord(body?.data);
  return { status: String(d.status ?? '?'), stage: String(d.currentStage ?? '?') };
}

async function advanceOneDay(day: number): Promise<boolean> {
  let notReadySince: number | null = null;
  let retrySince: number | null = null;
  for (;;) {
    const t0 = Date.now();
    const r = await api('POST', `/api/admin/virtual-learners/sessions/${a.session}/advance-day`, { days: 1, runTasks: true });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const d = asRecord(r.body?.data);
    const errMsg = JSON.stringify(asRecord(r.body?.error).message ?? r.body?.error ?? '').slice(0, 240);
    if (r.status === 200 && r.body?.success !== false) {
      const advanced = Array.isArray(d.advancedDayIndexes) ? d.advancedDayIndexes.length : 0;
      const learning = asRecord(d.learning);
      if (advanced === 0) {
        if (notReadySince === null) notReadySince = Date.now();
        if (Date.now() - notReadySince > RETRY_BUDGET_MS) { log(`    [day${day}] 未就绪超预算 ${errMsg}`); return false; }
        log(`    [day${day}] ${secs}s 未就绪（${errMsg}）→ ${NOT_READY_POLL_MS / 1000}s 后同日重试`);
        await sleep(NOT_READY_POLL_MS); continue;
      }
      log(`    [day${day}] ${secs}s ✅ simDay=${d.simulatedDay} 课次=${learning.chunks ?? '?'}${learning.error ? ` err=${String(learning.error).slice(0, 120)}` : ''}`);
      return true;
    }
    const retryable = r.status === 0 || r.status === 409 || r.status === 429 || r.status >= 500;
    if (!retryable) { log(`    [day${day}] ✖ http=${r.status} ${errMsg}`); return false; }
    if (retrySince === null) retrySince = Date.now();
    if (Date.now() - retrySince > RETRY_BUDGET_MS) { log(`    [day${day}] 可重试超预算 http=${r.status} ${errMsg}`); return false; }
    const wait = r.status === 429 ? 60_000 : Math.min(5000 * (2 ** Math.min(4, Math.floor((Date.now() - retrySince) / 20_000))), 90_000);
    log(`    [day${day}] ${secs}s 可重试（http=${r.status} ${errMsg}）→ 等 ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}

async function main() {
  await login();
  log(`已登录 ${a.baseUrl}`);

  const before = await api('GET', `/api/admin/virtual-learners/sessions/${a.session}`);
  const st = stageOf(before.body);
  log(`会话前置状态：${st.stage}/${st.status}`);

  if (!a.noRestart && (st.status !== 'running' || st.stage !== 'teaching')) {
    const r = await api('POST', `/api/admin/virtual-learners/sessions/${a.session}/restart-learning`, {});
    const d = asRecord(r.body?.data);
    log(`restart-learning http=${r.status} success=${d.success ?? r.body?.success} task=${d.selectedTaskId ?? '—'} err=${JSON.stringify(d.error ?? asRecord(r.body?.error).message ?? '').slice(0, 200)}`);
    if (r.status !== 200) return;
  }

  for (let day = 1; day <= a.days; day += 1) {
    log(`── day ${day}/${a.days} ──`);
    const ok = await advanceOneDay(day);
    const after = await api('GET', `/api/admin/virtual-learners/sessions/${a.session}`);
    const st2 = stageOf(after.body);
    log(`    day${day} 结果=${ok ? 'ok' : 'fail'} 会话=${st2.stage}/${st2.status}`);
    if (!ok) break;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
