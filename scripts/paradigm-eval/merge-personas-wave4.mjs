#!/usr/bin/env node
/** 第四波人设合并： personas-{school3,hard}.json → runs/20260929/inputs/ → real-goals-cases.json（追加+去重+校验）→ wave4 ids */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../doc/local/runs/20260929/inputs');
const FILES = ['persona_school_w3_20260929.json', 'persona_hard_w1_20260929.json'];

const main = JSON.parse(fs.readFileSync(path.join(HERE, 'real-goals-cases.json'), 'utf8'));
const existing = new Set(main.cases.map((c) => c.personaId));
const problems = [];
const added = [];

for (const f of FILES) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) { problems.push(`missing ${f}`); continue; }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { problems.push(`${f}: bad JSON`); continue; }
  for (const c of parsed.cases || []) {
    if (!c.personaId || !c.opening || !c.budget) { problems.push(`${f}: bad entry ${c.personaId || '?'}`); continue; }
    if (existing.has(c.personaId)) { problems.push(`${f}: dup ${c.personaId}`); continue; }
    const daily = Number(c.budget.dailyMinutes) || Number(c.budget.dailyHours) * 60;
    if (!Number.isFinite(daily) || daily <= 0) { problems.push(`${f}: ${c.personaId} no daily minutes`); continue; }
    const need = ['personaId', 'intentType', 'domain', 'opening', 'followUps', 'source', 'repeat'];
    const miss = need.filter((k) => c[k] === undefined);
    if (miss.length) { problems.push(`${f}: ${c.personaId} missing ${miss.join(',')}`); continue; }
    // 校内/硬约束类必须有 schoolAnchor（教材或考纲锚）
    if (/^rw-(school|hard)/.test(c.personaId) && !c.schoolAnchor) {
      problems.push(`${f}: ${c.personaId} missing schoolAnchor`);
      continue;
    }
    main.cases.push(c);
    existing.add(c.personaId);
    added.push(c.personaId);
  }
}

fs.writeFileSync(path.join(HERE, 'real-goals-cases.json'), JSON.stringify(main, null, 2) + '\n');
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results', 'wave4-ids.txt'), added.join('\n') + '\n');
console.log('added:', added.length, added.join(' '));
console.log('total cases:', main.cases.length);
if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'));
