#!/usr/bin/env node
/** flip-processing.mjs — 把 failed-gen 且后端 stageDesign 仍在生成/已完成的 wave 格翻回 awaiting-path，
 *  让下一轮 waiter 续等（保住已完成的对话与生成，避免重聊产生双路径）。配合 repair-timeout-cells 用。 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const idPrefix = process.argv[2] || 'rw-'; // 默认全 rw-*；可传 rw- 限定
const db = new DatabaseSync(path.resolve(HERE, '../../backend/prisma/dev.db'), { readOnly: true });
let flipped = 0;
for (const f of fs.readdirSync(RESULTS)) {
  const m = f.match(/^(.+)-r([12])\.json$/);
  if (!m || !m[1].startsWith(idPrefix)) continue;
  const p = path.join(RESULTS, f);
  let s;
  try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  if (s.status !== 'failed-gen' || !s.pathId) continue;
  let gen = {};
  try {
    const row = db.prepare('SELECT aiPromptTemplate FROM learning_paths WHERE id=?').get(s.pathId);
    gen = (JSON.parse(row?.aiPromptTemplate || '{}') || {})._generation || {};
  } catch { continue; }
  if (gen.stageDesign === 'processing' || gen.stageDesign === 'succeeded') {
    s.status = 'awaiting-path';
    delete s.error;
    fs.writeFileSync(p, JSON.stringify(s, null, 1));
    flipped++;
  }
}
db.close();
console.log(`[${new Date().toISOString().slice(11, 19)}] flip-processing: ${flipped} 格翻回 awaiting-path`);
