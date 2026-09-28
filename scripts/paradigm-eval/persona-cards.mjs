#!/usr/bin/env node
/** 为评审子代理生成人设背景卡：从 real-goals-cases.json 取 opening/followUps/预算/来源 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(HERE, 'real-goals-cases.json'), 'utf8')).cases;
const ids = process.argv.slice(2).map((s) => s.replace(/^pe-/, '').replace(/^rw-/, 'rw-').replace(/^(school|career|exam|life|acad|wild)-/, 'rw-$1-'));
for (const id of ids) {
  const c = cases.find((x) => x.personaId === id);
  if (!c) { console.log(`### ${id}\n（未找到人设）\n`); continue; }
  const b = c.budget || {};
  const budgetStr = [b.horizon, b.horizonDays ? `≈${b.horizonDays}天` : '', b.dailyMinutes ? `每天${b.dailyMinutes}分钟` : '', b.expectedHours ? `期望${b.expectedHours}h` : ''].filter(Boolean).join('，');
  const anchor = c.schoolAnchor ? `教材/考纲锚：${JSON.stringify(c.schoolAnchor).slice(0, 200)}` : '';
  console.log(`### ${id}（${c.intentType || c.domain || '?'}）`);
  console.log(`开头原话：${c.opening}`);
  console.log(`预算：${budgetStr || '未声明'}${anchor ? '｜' + anchor : ''}`);
  console.log(`来源：${c.source?.ref || c.source || '无'}`);
  if (c.followUps?.length) console.log(`追问要点：${c.followUps.slice(0, 3).join(' / ').slice(0, 240)}`);
  console.log('');
}
