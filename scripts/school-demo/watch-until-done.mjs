#!/usr/bin/env node
/** 轮询 learn 进度直到 18/18（或 learner 循环结束），然后导出课程表。
 * 用法: node scripts/school-demo/watch-until-done.mjs <pathId> <sessionId> [intervalSec] */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const pathId = process.argv[2];
const sessionId = process.argv[3];
const interval = Number(process.argv[4] || 60) * 1000;
const outDir = path.join(ROOT, 'data', 'newfeatures-test-2026-09-22');
const LOG = path.join(outDir, 'watch.log');
const log = (m) => fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`);

function counts() {
  const db = new DatabaseSync(DB);
  const ms = db.prepare(`select id from milestones where learningPathId='${pathId}'`).all();
  let done = 0, total = 0;
  for (const m of ms) for (const s of db.prepare(`select status from subtasks where milestoneId='${m.id}'`).all()) { total++; if (s.status === 'completed') done++; }
  const sess = db.prepare(`select currentStage,status from virtual_sessions where id='${sessionId}'`).get() || {};
  db.close();
  return { done, total, stage: sess.currentStage, status: sess.status };
}

log(`watch start path=${pathId} session=${sessionId} interval=${interval / 1000}s`);
let last = -1;
for (let i = 0; i < 400; i++) {
  const c = counts();
  if (c.done !== last) { log(`progress ${c.done}/${c.total} stage=${c.stage} status=${c.status}`); last = c.done; }
  if (c.done >= c.total || c.stage === 'completed' || c.status === 'completed') {
    log(`DONE ${c.done}/${c.total} stage=${c.stage}`);
    try {
      const out = execFileSync('node', [path.join(ROOT, 'scripts', 'school-demo', 'export-course.mjs'), pathId], { encoding: 'utf8' });
      log('export: ' + out.trim());
    } catch (e) { log('export failed: ' + e.message); }
    break;
  }
  await new Promise(r => setTimeout(r, interval));
}
log('watch exit');
