#!/usr/bin/env node
/**
 * learn 队列编排：对一批已生成 path 的人设逐格上真课（learn-drive.mjs），wave-run 范式。
 *
 * 用法：node learn-queue.mjs --ids-file=results/wave5-hold-ids.txt [--run=1] [--concurrency=4] [--tag=hold]
 *   - 每格先读 results/<id>-r<run>.json 拿 pathId；无状态文件或无 pathId 记 no-path 跳过
 *   - 幂等：今天的产物 lesson_<id>_<tag>_<date>.json 已存在 → skip（断点续跑）
 *   - 子进程 learn-drive.mjs 带 API_BASE（默认 3010，与 path 跑批同后端）
 *   - 终态判据不看出退出码（tq-night-run 教训：退出码 0≠课真上完）——读产物 JSON：
 *     turns>0 且（completion 或 endSummary 非空）才算 done
 *   - 逐格追加 results/learnq-<tag>-summary.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const RUNS = path.resolve(HERE, '../../doc/local/runs');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}
const localDate = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

const RUN = Number(arg('run', '1'));
const CONC = Math.max(1, Math.min(20, Number(arg('concurrency', '4'))));
// 批次模式（用户拍板：按 N 人一批，一批跑完再下一批；批间按 RPM 自适应伸缩）
const BATCH = Math.max(0, Number(arg('batch', '0')));
const BATCH_MAX = Math.max(BATCH, Number(arg('batch-max', '10')));
let batchFails = 0;
const TAG = arg('tag', 'run');
const IDS_FILE = arg('ids-file', '');
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3010';
const RUN_DATE = localDate();
const LESSON_DIR = path.join(RUNS, RUN_DATE, 'lessons');
const SUMMARY = path.join(RESULTS, `learnq-${TAG}-summary.jsonl`);

const ids = fs.readFileSync(path.resolve(HERE, IDS_FILE), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
if (!ids.length) { console.error('no ids'); process.exit(1); }
fs.mkdirSync(RESULTS, { recursive: true });

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const record = (obj) => fs.appendFileSync(SUMMARY, JSON.stringify(obj) + '\n');
const lessonFile = (id) => path.join(LESSON_DIR, `lesson_${id.replace(/^learn-/, '')}_${TAG}_${RUN_DATE}.json`);

/** 终态判据：课录存在、有回合、且走到了完课或结课结算（退出码不可信） */
function judgeLesson(id) {
  let j;
  try { j = JSON.parse(fs.readFileSync(lessonFile(id), 'utf8')); } catch { return { ok: false, why: 'no-artifact' }; }
  // mode=completed 的任务已完过课，秒回空记录是合法结果（不算失败，记 already-completed）
  if (j.note === 'task already completed') return { ok: true, why: 'already-completed', turns: 0 };
  const turns = (j.turns || []).length;
  const finished = !!(j.completion || (j.endSummary && (j.endSummary.topicSummary || j.endSummary.ended)));
  return { ok: turns > 0 && finished, why: turns === 0 ? 'zero-turns' : (finished ? 'done' : 'unfinished'), turns };
}

function planCell(id) {
  const sf = path.join(RESULTS, `${id}-r${RUN}.json`);
  let st = null;
  try { st = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch { return { skip: 'no-state' }; }
  if (st.status !== 'done' || !st.pathId) return { skip: 'cell-not-done(' + (st.status || 'null') + ')' };
  if (fs.existsSync(lessonFile(id))) {
    const v = judgeLesson(id);
    if (v.ok) return { skip: 'lesson-done' };
    log(`${id} 旧产物不合格（${v.why}），重跑`);
  }
  return { pathId: st.pathId };
}

async function runCell(id) {
  const t0 = Date.now();
  const plan = planCell(id);
  if (plan.skip) { record({ id, ok: true, skipped: plan.skip, pathId: plan.pathId || null }); log(`${id} skip (${plan.skip})`); return; }
  await new Promise((resolve) => {
    execFile('node', ['learn-drive.mjs', id], {
      cwd: HERE, timeout: 45 * 60 * 1000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, API_BASE, LEARN_PATH_ID: plan.pathId, LEARN_TAG: TAG },
    }, (err) => resolve(!err));
  });
  const v = judgeLesson(id);
  if (!v.ok) batchFails++;
  record({ id, ok: v.ok, why: v.why, turns: v.turns, pathId: plan.pathId, durSec: Math.round((Date.now() - t0) / 1000) });
  log(`${id} ${v.ok ? 'DONE' : 'FAIL'} turns=${v.turns} why=${v.why}`);
}

async function rpmNow() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.resolve(HERE, '../../backend/prisma/dev.db'), { readOnly: true });
    const r = db.prepare('SELECT COUNT(*) n FROM llm_execution_attempts WHERE startedAt >= ?').get(Date.now() - 10 * 60 * 1000);
    db.close();
    return r.n / 10;
  } catch { return null; }
}

async function pool() {
  // 批次模式：N 人一批严格串批；批间按 RPM/失败自适应伸缩（用户：RPM 不高就尽量高）
  if (BATCH) {
    let size = BATCH;
    for (let i = 0; i < ids.length; i += size) {
      const chunk = ids.slice(i, i + size);
      batchFails = 0;
      log(`batch ${Math.floor(i / size) + 1}: ${chunk.length} 人（批次=${size}）`);
      await Promise.all(chunk.map((id) => runCell(id).catch((e) => { record({ id, ok: false, err: String(e).slice(0, 200) }); log(`${id} ERROR ${e.message}`); })));
      const rpm = await rpmNow();
      let next = size;
      if (batchFails > 0) next = Math.max(3, size - 1);
      else if (rpm !== null && rpm < 25 && size < BATCH_MAX) next = Math.min(BATCH_MAX, size + 2); // 扩批阈值 25：双池容量 ~48，19 也算「不高」（2026-10-01 用户拍板尽量拉高）
      if (next !== size) log(`batch 自适应: rpm=${rpm === null ? '?' : rpm.toFixed(1)} fails=${batchFails} → ${size}→${next}`);
      size = next;
    }
    return;
  }
  let cursor = 0, done = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try { await runCell(id); } catch (e) { record({ id, ok: false, err: String(e).slice(0, 200) }); log(`${id} ERROR ${e.message}`); }
      log(`progress ${++done}/${ids.length}`);
    }
  });
  await Promise.all(workers);
}

if (process.argv.includes('--plan')) {
  let run = 0, skip = 0;
  for (const id of ids) { const p = planCell(id); p.skip ? skip++ : run++; if (!p.skip) console.log('  will-run', id, p.pathId); }
  log(`plan: ${run} 格待跑, ${skip} 格跳过（并发 ${CONC}, tag=${TAG}, 后端 ${API_BASE}）`);
  process.exit(0);
}

const t0 = Date.now();
log(`learnq ${TAG}: ${ids.length} 格, 并发 ${CONC}, 后端 ${API_BASE}`);
await pool();
log(`learnq ${TAG} complete in ${Math.round((Date.now() - t0) / 60000)}min`);
