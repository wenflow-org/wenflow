// 看门狗：每 5 分钟探活监工（pidfile），死了拉起。08:50 后自动退役。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PIDFILE = path.join(ROOT, '.tmp-batch/overnight-supervisor.pid');
const LOG = path.join(ROOT, '.tmp-batch/overnight-watchdog.log');
const log = (m) => fs.appendFileSync(LOG, `[${new Date().toISOString().slice(5, 19)}] ${m}\n`);
const deadline = new Date('2026-10-03T08:50:00+08:00');
while (Date.now() < deadline.getTime()) {
  try {
    let alive = false;
    if (fs.existsSync(PIDFILE)) {
      const pid = Number(fs.readFileSync(PIDFILE, 'utf8').trim());
      try { process.kill(pid, 0); alive = true; } catch {}
    }
    if (!alive) {
      log('监工不在线 → 拉起');
      const child = spawn('node', ['scripts/vlab-eval/overnight-supervisor.mjs'], { cwd: ROOT, detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
      child.unref();
      fs.writeFileSync(PIDFILE, String(child.pid));
    }
  } catch (e) { log('探活异常: ' + (e?.message || e)); }
  await new Promise(r => setTimeout(r, 5 * 60_000));
}
log('到点退役');
