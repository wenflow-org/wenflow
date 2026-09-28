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
const CONC = Math.max(1, Math.min(4, Number(arg('concurrency', '2'))));
const TAG = arg('tag', 'wave');
const ids = (idsFile
  ? fs.readFileSync(path.resolve(HERE, idsFile), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  : idsArg.split(',').map((s) => s.trim()).filter(Boolean));
if (!ids.length) { console.error('no ids'); process.exit(1); }

const SUMMARY = path.join(RESULTS, `wave-${TAG}-summary.jsonl`);
fs.mkdirSync(RESULTS, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function stateFile(id) { return path.join(RESULTS, `${id}-r1.json`); }
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
    execFile('node', ['drive.mjs', 'cell', id, '1'], { cwd: HERE, timeout: 30 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 }, (err) => resolve(!err));
  });
  st = readState(id);
  const pathId = st?.pathId || null;
  const durSec = Math.round((Date.now() - t0) / 1000);
  record({ id, ok: ok && !!pathId, pathId, durSec, err: ok ? null : 'no-path-or-exit' });
  log(`${id} ${ok && pathId ? 'DONE' : 'FAIL'} pathId=${pathId || '-'} (${durSec}s)`);
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

const t0 = Date.now();
log(`wave ${TAG}: ${ids.length} cells, concurrency ${CONC}`);
await pool();
log(`wave ${TAG} complete in ${Math.round((Date.now() - t0) / 60000)}min`);
