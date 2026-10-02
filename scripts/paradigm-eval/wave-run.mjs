#!/usr/bin/env node
/**
 * Wave 并发跑批器：按案例 id 清单并发执行 `drive.mjs cell <id> 1`，逐格落摘要供断点续跑。
 *
 * 用法：node wave-run.mjs --ids=rw-school-01,rw-school-02 [--concurrency=2] [--tag=wave1]
 *   - 跳过已有 done 状态的格子（断点续跑）；failed-gen 状态先删状态文件允许重试一次
 *   - 每格完成即追加 results/wave-<tag>-summary.jsonl：{ id, ok, pathId, durSec, err }
 *   - 并发度默认 2（RPM 18 服务端限流由网关执行，客户端不额外抢速）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

const idsArg = arg('ids', '');
const idsFile = arg('ids-file', '');
// 上限 32（2026-09-30 12:45 从 8 提、14:45 从 16 提：原 8 上限是池子 ~3-5 时代的遗产，会把
// --concurrency>8 静默降到 8——本夜"conc10/14 更慢"的错误结论就是这么来的。双池容量 ~48rpm，
// 用户 14:45 看后台 RPM 仍低，指名拉 20）
const CONC = Math.max(1, Math.min(32, Number(arg('concurrency', '2'))));
const TAG = arg('tag', 'wave');
const RUN = Number(arg('run', '1'));
// 停车编排（2026-09-30 用户设计）：goal 异步于生成——Phase A 全 worker 只聊天（聊到待确认/已确认即停），
// Phase B 确认过闸（同时在途生成 ≤ GEN_G，防 confirm 风暴：后端无生成限流），生成等待不占聊 worker。
const SPLIT = process.argv.includes('--split-gen');
const GEN_G = Math.max(1, Number(arg('gen-conc', '20')));
const ids = (idsFile
  ? fs.readFileSync(path.resolve(HERE, idsFile), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  : idsArg.split(',').map((s) => s.trim()).filter(Boolean));
if (!ids.length) { console.error('no ids'); process.exit(1); }

const SUMMARY = path.join(RESULTS, `wave-${TAG}-summary.jsonl`);
fs.mkdirSync(RESULTS, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function stateFile(id) { return path.join(RESULTS, `${id}-r${RUN}.json`); }
function readState(id) {
  try { return JSON.parse(fs.readFileSync(stateFile(id), 'utf8')); } catch { return null; }
}
function record(obj) { fs.appendFileSync(SUMMARY, JSON.stringify(obj) + '\n'); }

async function runCell(id) {
  const t0 = Date.now();
  let st = readState(id);
  if (st && st.status === 'done' && st.pathId) {
    record({ id, ok: true, pathId: st.pathId, skipped: 'done' });
    log(`${id} skip (done)`);
    return;
  }
  if (st && st.status === 'failed-gen') {
    fs.rmSync(stateFile(id), { force: true });
    log(`${id} cleared failed-gen state for retry`);
  }
  const ok = await new Promise((resolve) => {
    execFile('node', ['drive.mjs', 'cell', id, String(RUN)], { cwd: HERE, timeout: 30 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 }, (err) => resolve(!err));
  });
  st = readState(id);
  const pathId = st?.pathId || null;
  // 成功判据必须是 drive 侧终态（done = 生成就绪且有课）：
  // 早先只看 pathId 会把「骨架可用但零课」的失败格记成 DONE，虚高跑批成功率（wave4 实测 4/30）。
  const reallyDone = st?.status === 'done' && !!pathId;
  const durSec = Math.round((Date.now() - t0) / 1000);
  record({ id, ok: ok && reallyDone, pathId, durSec, status: st?.status || null, err: ok && !reallyDone ? 'not-done:' + (st?.status || 'unknown') : null });
  log(`${id} ${ok && reallyDone ? 'DONE' : 'FAIL'} pathId=${pathId || '-'} (${durSec}s) status=${st?.status || '-'}`);
}

async function pool() {
  let cursor = 0;
  let doneCount = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try { await runCell(id); } catch (e) { record({ id, ok: false, err: String(e).slice(0, 200) }); log(`${id} ERROR ${e.message}`); }
      doneCount++;
      log(`progress ${doneCount}/${ids.length}`);
    }
  });
  await Promise.all(workers);
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function spawnDrive(mode, id, timeoutMin = 90) {
  return new Promise((resolve) => {
    execFile('node', ['drive.mjs', mode, id, String(RUN)], { cwd: HERE, timeout: timeoutMin * 60 * 1000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, err: err ? String(err.message || err).slice(0, 200) : '', stderr: String(stderr || stdout || '').slice(-300) });
    });
  });
}
function recordCell(id, st, t0, extra = {}) {
  const durSec = Math.round((Date.now() - t0) / 1000);
  const pathId = st?.pathId || null;
  const reallyDone = st?.status === 'done' && !!pathId;
  record({ id, ok: reallyDone, pathId, durSec, status: st?.status || null, err: reallyDone ? null : 'not-done:' + (st?.status || 'unknown'), ...extra });
  log(`${id} ${reallyDone ? 'DONE' : 'FAIL'} pathId=${pathId || '-'} (${durSec}s) status=${st?.status || '-'}${extra.spawnErr ? ' spawnErr=' + String(extra.spawnErr).slice(0, 120) : ''}`);
}

/** --split-gen：Phase A 全员聊天 → Phase B 确认过闸（≤GEN_G 个在途生成位） */
async function poolSplit() {
  const parked = [];
  const cq = [];
  const t0 = Date.now();
  let cursor = 0, doneA = 0;
  await Promise.all(Array.from({ length: CONC }, async (workerIdx) => {
    // 错峰启动：28 个进程同秒齐发曾出现集体秒死（16:25 阵发，原因未定），拉开 2s/worker
    await sleepMs(workerIdx * 2000);
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const c0 = Date.now();
      try {
        const pre = readState(id);
        if (pre?.status === 'done' && pre.pathId) { recordCell(id, pre, c0, { skipped: 'done' }); log(`${id} skip (done)`); log(`talk ${++doneA}/${ids.length}`); continue; }
        // failed-gen 状态清障（旧 runCell 同款）：否则 cell-talk 对死状态空转、格子永远 FAIL 打转
        if (pre?.status === 'failed-gen') { fs.rmSync(stateFile(id), { force: true }); log(`${id} cleared failed-gen state for retry`); }
        const r = await spawnDrive('cell-talk', id);
        const st = readState(id);
        if (st?.status === 'done' && st.pathId) { recordCell(id, st, c0, { skipped: 'done' }); log(`${id} skip (done)`); }
        else if (st?.status === 'awaiting-path' && st.pathId) parked.push(id);
        else if (st?.status === 'ready-to-confirm') cq.push(id);
        else recordCell(id, st, c0, r.ok ? {} : { spawnErr: r.err + ' | ' + r.stderr });
      } catch (e) { record({ id, ok: false, err: String(e).slice(0, 200) }); log(`${id} ERROR ${e.message}`); }
      log(`talk ${++doneA}/${ids.length}`);
    }
  }));
  log(`phase A 完成: 已确认(parked)=${parked.length} 待确认(cq)=${cq.length}`);
  // Phase B：确认过闸。admit = 先 cell-confirm 拿 pathId（生成此刻在服务端 fire），再挂 cell 全模式 waiter 等就绪。
  const waiters = new Set();
  let admitted = parked.length;
  const admit = (id) => {
    const p = (async () => {
      const t1 = Date.now();
      const r1 = await spawnDrive('cell-confirm', id);
      const st = readState(id);
      if (st?.status !== 'awaiting-path' || !st.pathId) { recordCell(id, st, t1, r1.ok ? {} : { spawnErr: r1.err + ' | ' + r1.stderr }); return; }
      log(`${id} confirmed → 生成位 ${waiters.size}/${GEN_G}`);
      const r2 = await spawnDrive('cell', id);
      recordCell(id, readState(id), t1, r2.ok ? {} : { spawnErr: r2.err + ' | ' + r2.stderr });
    })().catch((e) => { record({ id, ok: false, err: String(e).slice(0, 200) }); log(`${id} ERROR ${e.message}`); });
    waiters.add(p);
    p.finally(() => waiters.delete(p));
  };
  for (const id of parked) admit(id); // A 段已确认的：直接挂 waiter
  while (cq.length || waiters.size) {
    while (cq.length && waiters.size < GEN_G) { admit(cq.shift()); admitted++; }
    await Promise.race([sleepMs(500), ...waiters]);
  }
  log(`phase B 完成: 生成位峰值内共确认 ${admitted} 格`);
}

const t0 = Date.now();
log(`wave ${TAG}: ${ids.length} cells, concurrency ${CONC}${SPLIT ? `, split-gen(生成位=${GEN_G})` : ''}`);
if (SPLIT) await poolSplit(); else await pool();
log(`wave ${TAG} complete in ${Math.round((Date.now() - t0) / 60000)}min`);
