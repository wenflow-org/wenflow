#!/usr/bin/env node
/**
 * restart.mjs — 后端**唯一**启动入口（2026-10-08 流程卫生；2026-10-18 #80 收口旁路）。
 *
 * 职责：tsc 快检 → 杀指定端口进程 → ts-node --transpile-only 启动 → 轮询 /readyz 就绪。
 * 另外提供两个模式，替代过去手工做掉的两件事（#80）：
 *   --stop    停止该端口上的后端（替代 netstat 找 PID + taskkill）
 *   --status  报告该端口上的进程与 /readyz、/health 状态（替代"猜进程是不是旧的"）
 *
 * 端口解析顺序：--port > 环境变量 PORT > backend/.env 的 PORT > 3001。
 * 支持 `--port=3011` 与 `--port 3011` 两种写法（旧实现只认等号，空格写法会被当成
 * 布尔真而落到 3001，属于"以为重启了 3011、其实起来的是 3001"的隐患）。
 *
 * 用法：
 *   node backend/restart.mjs [--port=3011] [--skip-type-check] [--ready-timeout=180]
 *   node backend/restart.mjs --stop   [--port=3011]
 *   node backend/restart.mjs --status [--port=3011]
 *
 * 纪律（#80）：不要用 `ts-node src/index.ts` / `ts-node-dev` 裸启，也不要手工
 * taskkill 端口或 touch 文件触发 respawn——上面三个模式已经覆盖这些场景，
 * `npm run dev:entrypoints:check` 会扫出文档/脚本里的旁路写法。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 取参数：`--k=v`、`--k v`、`--k`（布尔）三种形态都认。 */
const arg = (k, d) => {
  const exact = process.argv.indexOf(`--${k}`);
  if (exact >= 0) {
    const next = process.argv[exact + 1];
    return next && !next.startsWith('--') ? next : true;
  }
  const prefixed = process.argv.find((a) => a.startsWith(`--${k}=`));
  return prefixed === undefined ? d : prefixed.slice(k.length + 3);
};

function readEnvPort() {
  try {
    const raw = fs.readFileSync(path.join(HERE, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const hit = /^\s*PORT\s*=\s*"?(\d+)"?\s*$/.exec(line);
      if (hit) return Number(hit[1]);
    }
  } catch {
    /* 没有 .env 时按默认端口 */
  }
  return null;
}

const portArg = arg('port', null);
const PORT = (() => {
  if (portArg !== null && portArg !== true) {
    const parsed = Number(portArg);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
    console.error(`[restart] --port 取值非法：${String(portArg)}`);
    process.exit(2);
  }
  const fromEnv = Number(process.env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return readEnvPort() ?? 3001;
})();

const SKIP_TYPE_CHECK = arg('skip-type-check', false) === true;
const MODE_STOP = arg('stop', false) === true;
const MODE_STATUS = arg('status', false) === true;

// 就绪窗口（秒）：本机冷启动要跑技能完成度诊断文件扫描、Token 成本缓存预热、管理端冷读预热等，
// 偶尔 90~100s 才就绪；窗口偏紧会对「其实已起来」的服务误报超时。默认抬到 180s，可用 --ready-timeout 覆盖。
const readyArg = arg('ready-timeout', 180);
const parsedReady = typeof readyArg === 'number' || typeof readyArg === 'string' ? Number(readyArg) : NaN;
const READY_TIMEOUT_SEC = Number.isFinite(parsedReady) && parsedReady > 0 ? parsedReady : 180;

const LOG_FILE = path.join(HERE, 'logs', `backend-${PORT}.log`);

const log = (m) => console.log(`[restart] ${m}`);

/** 按监听端口找 PID（Windows 用 netstat -ano；其他平台用 lsof）。 */
function findListenerPid(port) {
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of (out.stdout || '').split('\n')) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const pid = Number(line.trim().split(/\s+/).pop());
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
    }
    return null;
  }
  const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  const pid = Number((out.stdout || '').trim().split('\n')[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** 结束进程并等端口释放；返回是否成功。 */
async function stopListener(pid, port, { quiet = false } = {}) {
  if (!quiet) log(`停止旧进程 PID=${pid} (port ${port})`);
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return false;
    }
  }
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 300));
    if (findListenerPid(port) === null) return true;
  }
  return false;
}

async function probe(pathname, timeoutMs = 3000) {
  return fetch(`http://127.0.0.1:${PORT}${pathname}`, { signal: AbortSignal.timeout(timeoutMs) })
    .then(async (res) => ({ ok: res.ok, status: res.status, body: await res.text().catch(() => '') }))
    .catch(() => ({ ok: false, status: 0, body: '' }));
}

// ---------------------------------------------------------------- --status
if (MODE_STATUS) {
  const pid = findListenerPid(PORT);
  if (!pid) {
    console.log(`[restart] 端口 ${PORT} 无监听（后端未运行）`);
    process.exit(1);
  }
  const [ready, health] = await Promise.all([probe('/readyz'), probe('/health')]);
  console.log(`[restart] 端口 ${PORT} PID=${pid}`);
  console.log(`[restart]   /readyz  ${ready.ok ? 'OK' : `FAIL(${ready.status})`}`);
  console.log(`[restart]   /health  ${health.ok ? 'OK' : `FAIL(${health.status})`}`);
  console.log(`[restart]   日志     ${LOG_FILE}（${fs.existsSync(LOG_FILE) ? '存在' : '不存在'}）`);
  process.exit(ready.ok ? 0 : 1);
}

// ---------------------------------------------------------------- --stop
if (MODE_STOP) {
  const pid = findListenerPid(PORT);
  if (!pid) {
    log(`端口 ${PORT} 无监听，无需停止`);
    process.exit(0);
  }
  const stopped = await stopListener(pid, PORT);
  if (!stopped) {
    console.error(`[restart] PID=${pid} 未能释放端口 ${PORT}，请检查权限或手动确认`);
    process.exit(1);
  }
  log(`已停止（port ${PORT}）`);
  process.exit(0);
}

// ---------------------------------------------------------------- 默认：重启
// 1) 类型快检（--transpile-only 运行时不做类型检查，类型错误只等 CI 才炸）
//    配置必须与 CI check:quality → typecheck:backend 同源（tsconfig.build.json）：
//    用 tsconfig.json 会把 CI 明确排除的 src/scripts/** 也纳入，两个信号互相矛盾（#126）。
if (!SKIP_TYPE_CHECK) {
  log('tsc --noEmit 快检（tsconfig.build.json，与 CI typecheck 同源）…');
  const check = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.build.json'], {
    cwd: HERE, stdio: 'inherit'
  });
  if (check.status !== 0) {
    console.error('[restart] 类型检查未过（tsconfig.build.json，与 CI 同源），取消重启（--skip-type-check 可跳过）');
    process.exit(1);
  }
}

// 2) 杀旧进程（按监听端口找 PID）
const oldPid = findListenerPid(PORT);
if (oldPid) {
  await stopListener(oldPid, PORT);
}

// 3) 启动（独立进程；PORT 必须显式传给子进程——index.ts 读 process.env.PORT，缺省 3001）
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const out = fs.openSync(LOG_FILE, 'a');
const err = fs.openSync(`${LOG_FILE}.err`, 'a');
const child = spawn(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/index.ts'], {
  cwd: HERE,
  env: { ...process.env, PORT: String(PORT) },
  detached: true,
  stdio: ['ignore', out, err]
});
child.unref();
log(`已启动 PID=${child.pid}，日志 ${LOG_FILE}`);

// 4) readyz 轮询
log(`等待 /readyz（最长 ${READY_TIMEOUT_SEC}s）…`);
const deadline = Date.now() + READY_TIMEOUT_SEC * 1000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const ready = await probe('/readyz').then((r) => r.ok);
  if (ready) {
    log(`就绪：http://127.0.0.1:${PORT} （日志 ${LOG_FILE}）`);
    process.exit(0);
  }
}
console.error(`[restart] 超时未就绪——查看 ${LOG_FILE} / ${LOG_FILE}.err`);
process.exit(1);
