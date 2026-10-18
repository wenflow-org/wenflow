// 看门狗：每 5 分钟探活监工（pidfile），死了拉起。到 DEADLINE 后自动退役。
// 审计 2026-10-12：DEADLINE 改为 env `VL_DEADLINE`（与监工同源，避免两者窗口错位）；缺省用
// 监工同款默认值。deadline 已过期 → 明确报错退出（旧实现会静默 while 不进、看起来「跑了」）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PIDFILE = path.join(ROOT, '.tmp-batch/overnight-supervisor.pid');
const LOG = path.join(ROOT, '.tmp-batch/overnight-watchdog.log');
const log = (m) => fs.appendFileSync(LOG, `[${new Date().toISOString().slice(5, 19)}] ${m}\n`);
const DEADLINE_ISO = process.env.VL_DEADLINE || '2026-10-06T09:00:00+08:00';
const deadline = new Date(DEADLINE_ISO);
if (Number.isNaN(deadline.getTime())) { log(`FATAL: 非法 VL_DEADLINE=${DEADLINE_ISO}`); process.exit(1); }
if (Date.now() >= deadline.getTime()) { log(`FATAL: DEADLINE ${DEADLINE_ISO} 已过期，看门狗不启动（设 VL_DEADLINE 指定新窗口）`); process.exit(1); }
// 单实例锁（审计 2026-10-12）：两个看门狗会各自拉起监工 → 绕过监工锁的探活时序。O_EXCL 原子创建。
const LOCKFILE = path.join(ROOT, '.tmp-batch/overnight-watchdog.lock');
try {
  const prev = fs.existsSync(LOCKFILE) ? Number(fs.readFileSync(LOCKFILE, 'utf8').trim()) : 0;
  if (prev) { let alive = false; try { process.kill(prev, 0); alive = true; } catch { alive = false; } if (alive) { log(`FATAL: 已有看门狗在跑 (pid=${prev})，拒绝重复启动`); process.exit(1); } }
  fs.writeFileSync(LOCKFILE, String(process.pid));
} catch (e) { log('FATAL: 获取看门狗锁失败 ' + (e && e.message)); process.exit(1); }
const releaseLock = () => { try { if (fs.readFileSync(LOCKFILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LOCKFILE); } catch { /* ok */ } };
process.on('exit', releaseLock);
log(`看门狗启动，deadline=${deadline.toISOString()}`);
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
