#!/usr/bin/env node
/**
 * restart.mjs — 后端统一重启入口（2026-10-08 流程卫生；替代被杀软误判删除的 restart.ps1）。
 *
 * 职责：tsc 快检 → 杀指定端口进程 → ts-node --transpile-only 启动 →
 * 轮询 /readyz 直到就绪（默认 90s），失败退出码非零。
 * 用法：node backend/restart.mjs [--port=3011] [--skip-type-check]
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const hit = process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
  if (!hit) return d;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};

const PORT = Number(arg('port', 3001));
const SKIP_TYPE_CHECK = arg('skip-type-check', false) === true;

const log = (m) => console.log(`[restart] ${m}`);

// 1) 类型快检（--transpile-only 运行时不做类型检查，类型错误只等 CI 才炸）
if (!SKIP_TYPE_CHECK) {
  log('tsc --noEmit 快检…');
  const check = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json'], {
    cwd: HERE, stdio: 'inherit'
  });
  if (check.status !== 0) {
    console.error('[restart] 类型检查未过，取消重启（--skip-type-check 可跳过）');
    process.exit(1);
  }
}

// 2) 杀旧进程（按监听端口找 PID）
function findListenerPid(port) {
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
  for (const line of (out.stdout || '').split('\n')) {
    if (line.includes(`:${port}`) && line.includes('LISTENING')) {
      const pid = Number(line.trim().split(/\s+/).pop());
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  }
  return null;
}
const oldPid = findListenerPid(PORT);
if (oldPid) {
  log(`停止旧进程 PID=${oldPid} (port ${PORT})`);
  spawnSync('taskkill', ['/PID', String(oldPid), '/F'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2000));
}

// 3) 启动（独立进程；PORT 必须显式传给子进程——index.ts 读 process.env.PORT，缺省 3001）
const logFile = path.join(HERE, 'logs', `backend-${PORT}.log`);
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const out = fs.openSync(logFile, 'a');
const err = fs.openSync(`${logFile}.err`, 'a');
const child = spawn(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/index.ts'], {
  cwd: HERE,
  env: { ...process.env, PORT: String(PORT) },
  detached: true,
  stdio: ['ignore', out, err]
});
child.unref();
log(`已启动 PID=${child.pid}，日志 ${logFile}`);

// 4) readyz 轮询
log('等待 /readyz（最长 90s）…');
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const ready = await fetch(`http://127.0.0.1:${PORT}/readyz`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok).catch(() => false);
  if (ready) {
    log(`就绪：http://127.0.0.1:${PORT} （日志 ${logFile}）`);
    process.exit(0);
  }
}
console.error(`[restart] 超时未就绪——查看 ${logFile} / ${logFile}.err`);
process.exit(1);
