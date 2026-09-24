#!/usr/bin/env node
/** 等待四门课全部完成（或 learn 链退出），导出四份课程表 + 资料引用校验。
 * 用法: node scripts/school-demo/watch-all.mjs [intervalSec] */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const OUT = path.join(ROOT, 'data', 'newfeatures-test-2026-09-22');
const LOG = path.join(OUT, 'watch-all.log');
const interval = Number(process.argv[2] || 120) * 1000;
const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; fs.appendFileSync(LOG, line + '\n'); console.log(line); };
const bands = { P1: '小学', J1: '初中', S1: '高中', C1: '大学' };

function snapshot() {
  const db = new DatabaseSync(DB);
  const out = {};
  for (const [run, label] of Object.entries(bands)) {
    let st; try { st = JSON.parse(fs.readFileSync(path.join(OUT, `${run}-state.json`), 'utf8')); } catch { out[label] = { done: 0, total: 0, stage: '-', status: '-' }; continue; }
    const sess = db.prepare(`select learningPathId,currentStage,status from virtual_sessions where id='${st.sessionId}'`).get() || {};
    const pid = sess.learningPathId;
    let done = 0, total = 0;
    if (pid) {
      for (const m of db.prepare(`select id from milestones where learningPathId='${pid}'`).all())
        for (const s of db.prepare(`select status from subtasks where milestoneId='${m.id}'`).all()) { total++; if (s.status === 'completed') done++; }
    }
    out[label] = { done, total, stage: sess.currentStage, status: sess.status, pathId: pid };
  }
  db.close();
  return out;
}

log('watch-all start');
for (let i = 0; i < 600; i++) {
  const snap = snapshot();
  const allDone = Object.values(snap).every(v => v.total > 0 && v.done >= v.total);
  log('progress ' + Object.entries(snap).map(([k, v]) => `${k} ${v.done}/${v.total}(${v.stage})`).join(' | '));
  if (allDone) { log('ALL DONE'); break; }
  await new Promise(r => setTimeout(r, interval));
}
log('导出课程表...');
for (const [run, label] of Object.entries(bands)) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(OUT, `${run}-state.json`), 'utf8'));
    const db = new DatabaseSync(DB);
    const pid = db.prepare(`select learningPathId from virtual_sessions where id='${st.sessionId}'`).get()?.learningPathId;
    db.close();
    if (pid) log(`${label}: ` + execFileSync('node', [path.join(ROOT, 'scripts', 'school-demo', 'export-course.mjs'), pid]).toString().trim());
  } catch (e) { log(`${label} export fail: ${e.message}`); }
}
log('校验资料引用:');
try { log(execFileSync('node', [path.join(ROOT, 'scripts', 'school-demo', 'verify-refs.mjs')]).toString().trim()); } catch (e) { log('verify fail: ' + e.message); }
log('watch-all exit');
