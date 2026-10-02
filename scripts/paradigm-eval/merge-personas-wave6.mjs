#!/usr/bin/env node
/** 第六波人设合并：doc/local/runs/20261001/inputs/persona_*_w6_20261001.json → real-goals-cases.json
 *  （追加+去重+校验+备份）→ results/wave6-ids.txt。用法：node merge-personas-wave6.mjs [--dry] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../doc/local/runs/20261001/inputs');
const DRY = process.argv.includes('--dry');
const FILES = [
  'persona_school_w6_20261001.json',
  'persona_examacad_w6_20261001.json',
  'persona_careerlife_w6_20261001.json',
  'persona_intwild_w6_20261001.json',
];

const main = JSON.parse(fs.readFileSync(path.join(HERE, 'real-goals-cases.json'), 'utf8'));
const existing = new Set(main.cases.map((c) => c.personaId));
const problems = [];
const added = [];
const byTag = {};

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
    const isWild = /^rw-wild/.test(c.personaId); // wild 预算可残缺（durationWeeks/moneyCny 形态），只查 dailyMinutes
    if (!isWild && !(Number(c.budget.expectedHours) > 0)) { problems.push(`${f}: ${c.personaId} bad expectedHours`); continue; }
    if (!isWild && !(Number(c.budget.horizonDays) > 0)) { problems.push(`${f}: ${c.personaId} bad horizonDays`); continue; }
    if (!Array.isArray(c.followUps) || c.followUps.length !== 3 || c.followUps.some((t) => typeof t !== 'string' || !t.trim())) {
      problems.push(`${f}: ${c.personaId} followUps != 3 non-empty`); continue;
    }
    if (typeof c.opening !== 'string' || c.opening.length < 30 || c.opening.length > 600) {
      problems.push(`${f}: ${c.personaId} opening length ${String(c.opening || '').length}`); continue;
    }
    const need = ['personaId', 'intentType', 'domain', 'opening', 'followUps', 'source', 'repeat'];
    const miss = need.filter((k) => c[k] === undefined);
    if (miss.length) { problems.push(`${f}: ${c.personaId} missing ${miss.join(',')}`); continue; }
    if (/^rw-school/.test(c.personaId) && !c.schoolAnchor) {
      problems.push(`${f}: ${c.personaId} missing schoolAnchor`); continue;
    }
    if (!c.source?.ref || !String(c.source.ref).startsWith('http')) {
      problems.push(`${f}: ${c.personaId} source.ref not http`); continue;
    }
    main.cases.push(c);
    existing.add(c.personaId);
    added.push(c.personaId);
    const tag = f.match(/persona_([a-z]+)_w6/)?.[1] || 'misc';
    (byTag[tag] = byTag[tag] || []).push(c.personaId);
  }
}

if (DRY) {
  console.log(`[dry] 将追加 ${added.length} 条`);
  for (const [tag, ids] of Object.entries(byTag)) console.log(`  ${tag}: ${ids.length}`);
  if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'));
  process.exit(0);
}
fs.copyFileSync(path.join(HERE, 'real-goals-cases.json'), path.join(HERE, `real-goals-cases.backup-w6-${Date.now()}.json`));
fs.writeFileSync(path.join(HERE, 'real-goals-cases.json'), JSON.stringify(main, null, 2) + '\n');
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results', 'wave6-ids.txt'), added.join('\n') + '\n');
for (const [tag, ids] of Object.entries(byTag)) {
  fs.writeFileSync(path.join(HERE, 'results', `wave6-${tag}-ids.txt`), ids.join('\n') + '\n');
}
console.log('added:', added.length);
for (const [tag, ids] of Object.entries(byTag)) console.log(`  ${tag}: ${ids.length}`);
console.log('total cases:', main.cases.length);
if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'));
