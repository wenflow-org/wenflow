#!/usr/bin/env node
/**
 * batch-heartbeat.mjs — 跑批心跳（吞吐监控的活动信号）
 *
 * 背景：运营页的 20 rpm 下限只对「有批次在跑」有意义。虚拟会话之外的跑批
 * （真实账号 learn-drive、脚本批处理）不创建 virtual_sessions，吞吐页会把它判成空闲。
 * 跑批脚本在运行期间调用本助手，管理端就能区分「空闲」与「批次卡住」。
 *
 * 用法：
 *   INIT_ADMIN_NAME=... INIT_ADMIN_PASSWORD=... \
 *     node scripts/batch-heartbeat.mjs --run-id=nightly-1021 [--interval=30000] [--once]
 *
 * 环境变量（不写进源码）：
 *   WENFLOW_BASE          默认 http://127.0.0.1:3001
 *   INIT_ADMIN_NAME       管理员账号
 *   INIT_ADMIN_PASSWORD   管理员密码
 *
 * Ctrl+C 会调用 stop；未正常退出时，超过 5 分钟没有心跳的批次自动失效。
 */
const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [k, v = ''] = raw.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const BASE = process.env.WENFLOW_BASE || 'http://127.0.0.1:3001';
const ORIGIN = process.env.WENFLOW_ORIGIN || 'http://localhost:5173';
const RUN_ID = String(args.get('run-id') || process.env.BATCH_RUN_ID || '').trim();
const INTERVAL = Math.max(5_000, Number(args.get('interval') || 30_000) || 30_000);
const ONCE = args.has('once');

if (!RUN_ID) {
  console.error('缺少 --run-id（或 BATCH_RUN_ID）');
  process.exit(2);
}

function cookieFrom(response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie().join('; ')
    : (response.headers.get('set-cookie') || '');
  return raw.split(/,\s*(?=[^;]+=)/).map((part) => part.split(';')[0]).join('; ');
}

async function login() {
  const name = process.env.INIT_ADMIN_NAME;
  const password = process.env.INIT_ADMIN_PASSWORD;
  if (!name || !password) {
    throw new Error('缺少 INIT_ADMIN_NAME / INIT_ADMIN_PASSWORD（只从环境变量读取）');
  }
  const res = await fetch(`${BASE}/api/admin-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ name, password, remember: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(`管理员登录失败：HTTP ${res.status}`);
  const cookie = cookieFrom(res);
  if (!cookie) throw new Error('管理员登录未返回会话 Cookie');
  return cookie;
}

async function post(cookie, path) {
  const res = await fetch(`${BASE}/api/admin/ops/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
    body: JSON.stringify({ runId: RUN_ID }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(`HTTP ${res.status}: ${body?.error?.message || 'unknown'}`);
  return body.data;
}

async function main() {
  const cookie = await login();
  let stopped = false;
  const stop = async (signal) => {
    if (stopped) return;
    stopped = true;
    try {
      await post(cookie, 'batch-heartbeat/stop');
      console.log(`[heartbeat] ${signal} → 已停止 ${RUN_ID}`);
    } catch (error) {
      console.error(`[heartbeat] 停止失败：${error.message}`);
      process.exitCode = 1;
    }
  };
  process.on('SIGINT', () => { void stop('SIGINT').then(() => process.exit()); });
  process.on('SIGTERM', () => { void stop('SIGTERM').then(() => process.exit()); });
  /* Windows 的 child.kill('SIGINT') 不会触发信号处理器；父脚本用 stdin 发 stop 才能优雅注销。 */
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (String(chunk).includes('stop')) void stop('stdin').then(() => process.exit());
  });

  await post(cookie, 'batch-heartbeat');
  console.log(`[heartbeat] ${RUN_ID} 已开始（每 ${Math.round(INTERVAL / 1000)}s）`);
  if (ONCE) return;
  const timer = setInterval(() => {
    post(cookie, 'batch-heartbeat').catch((error) => console.error(`[heartbeat] 续跳失败：${error.message}`));
  }, INTERVAL);
  timer.unref();
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(`[heartbeat] ${error.message}`);
  process.exit(1);
});
