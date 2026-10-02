#!/usr/bin/env node
/**
 * 导出 rw-* 路径为评审材料（每路径一个 md：阶段/课/分钟/类型）。
 * 用法：node dump-paths.mjs --since=<epochMs> --out=<dir> [--limit=N]（按创建时间倒序取最近 N 条）
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const since = Number(arg('since', '0'));
// 输出落 runs/<当日>/reviews/（NAMING.md）；文件名补 review_ 前缀与日期
// （2026-09-30 修：toTimeString 是时刻带冒号，Windows 文件名非法——learn-drive/learn-run 同病第 4 处）
const RUN_DATE = (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })();
const outDir = path.resolve(arg('out', path.join(ROOT, 'doc/local/runs', RUN_DATE, 'reviews')));
const limit = Number(arg('limit', '0'));

fs.mkdirSync(outDir, { recursive: true });
const db = new DatabaseSync(`file:${path.join(ROOT, 'backend/prisma/dev.db')}?mode=ro`, { readOnly: true });
let rows = db.prepare(`
  SELECT p.id, p.name, p.title, p.description, p.estimatedHours, p.createdAt, u.name AS userName
  FROM learning_paths p JOIN users u ON p.userId = u.id
  WHERE u.name LIKE 'pe-rw-%' AND p.createdAt > ?
  ORDER BY p.createdAt DESC
`).all(since);
if (limit > 0) rows = rows.slice(0, limit);

for (const p of rows) {
  const ms = db.prepare('SELECT id, stageNumber, title, goal, estimatedHours FROM milestones WHERE learningPathId=? ORDER BY stageNumber').all(p.id);
  let md = `# ${(p.title || p.name)}\n\n- 账号: ${p.userName} | 总估时: ${p.estimatedHours}h | 阶段: ${ms.length}\n`;
  if (p.description) md += `- 简介: ${p.description.slice(0, 300)}\n`;
  for (const m of ms) {
    const subs = db.prepare('SELECT title, taskType, estimatedMinutes FROM subtasks WHERE milestoneId=? ORDER BY "order"').all(m.id);
    md += `\n## M${m.stageNumber} ${m.title}（${m.estimatedHours}h）\n`;
    if (m.goal) md += `阶段目标: ${m.goal}\n`;
    subs.forEach((s, k) => { md += `${k + 1}. [${s.taskType || '?'} ${s.estimatedMinutes}min] ${s.title}\n`; });
  }
  const file = path.join(outDir, `review_path-${p.userName.replace('pe-', '')}_${RUN_DATE}.md`);
  fs.writeFileSync(file, md);
}
db.close();
console.log('dumped:', rows.length, '→', outDir);
