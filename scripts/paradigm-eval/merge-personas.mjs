#!/usr/bin/env node
/**
 * 合并 4 份挖掘产物 → real-goals-cases.json，并做驱动/留出分层切分。
 *
 * 用法：node merge-personas.mjs [--holdout=24]
 * - 读 doc/local/overnight-20260928/personas-{school,career,exam,life}.json
 * - schema 校验（personaId 唯一、opening 非空、budget 三件套），坏条目剔除并报告
 * - 留出集按 域组×意图×预算档 分层随机抽取并**冻结**：写 holdout-freeze.json（含抽取种子），
 *   后续修复轮禁止引用留出集内容作为修复依据
 * - 产出 results/wave1-holdout-ids.txt 与 results/wave1-driver-ids.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../doc/local/overnight-20260928');
const RESULTS = path.join(HERE, 'results');
const HOLDOUT_N = Number((process.argv.find((a) => a.startsWith('--holdout=')) || '').split('=')[1]) || 24;

const FILES = ['personas-school.json', 'personas-career.json', 'personas-exam.json', 'personas-life.json'];
const groupOf = (id) => id.startsWith('rw-school') ? 'school' : (id.startsWith('rw-career') || id.startsWith('rw-acad')) ? 'career' : id.startsWith('rw-exam') ? 'exam' : 'life';

function tierOf(b) {
  const h = Number(b && b.expectedHours);
  if (!Number.isFinite(h) || h <= 0) return 'unknown';
  if (h < 10) return 't1';
  if (h < 40) return 't2';
  if (h < 100) return 't3';
  return 't4';
}

const all = [];
const problems = [];
for (const f of FILES) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) { problems.push(`missing file: ${f}`); continue; }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { problems.push(`${f}: bad JSON ${e.message}`); continue; }
  for (const c of parsed.cases || []) {
    if (!c.personaId || !c.opening || !c.budget) {
      problems.push(`${f}: bad entry ${c.personaId || '(no-id)'}`);
      continue;
    }
    // 字段归一：代理用词不一（dailyMinutes / dailyHours+durationWeeks）→ 统一三件套
    const daily = Number(c.budget.dailyMinutes) || Number(c.budget.dailyHours) * 60;
    const dw = Number(c.budget.durationWeeks);
    if (!Number.isFinite(daily) || daily <= 0) {
      problems.push(`${f}: bad entry ${c.personaId || '(no-id)'} (no daily minutes)`);
      continue;
    }
    c.budget.dailyMinutes = Math.round(daily);
    if (Number.isFinite(dw) && dw > 0) {
      c.budget.horizonDays = c.budget.horizonDays || Math.round(dw * 7);
      if (!Number(c.budget.expectedHours)) {
        c.budget.expectedHours = Math.round((daily * dw * 7) / 60);
      }
    }
    if (all.some((x) => x.personaId === c.personaId)) { problems.push(`dup id ${c.personaId}`); continue; }
    all.push(c);
  }
}

if (!all.length) { console.error('no valid cases'); process.exit(1); }

// 分层随机：域组 × intentType × 预算档
const seed = crypto.randomBytes(8).toString('hex');
const rand = (function makeRand(seedStr) {
  let h = crypto.createHash('sha256').update(seedStr).digest().readUInt32LE(0);
  return () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 0xffffffff; };
})(seed);

const strata = new Map();
for (const c of all) {
  const key = `${groupOf(c.personaId)}|${c.intentType || 'vague'}|${tierOf(c.budget)}`;
  if (!strata.has(key)) strata.set(key, []);
  strata.get(key).push(c);
}
for (const arr of strata.values()) arr.sort(() => rand() - 0.5);

// 轮转抽留出：每层按比例抽，总量逼近 HOLDOUT_N
const holdout = [];
const driver = [];
const keys = [...strata.keys()];
let gi = 0;
while (holdout.length < HOLDOUT_N && keys.length) {
  const key = keys[gi % keys.length];
  const arr = strata.get(key);
  if (arr.length) holdout.push(arr.shift());
  if (!arr.length) { keys.splice(gi % keys.length, 1); continue; }
  gi++;
}
for (const arr of strata.values()) driver.push(...arr);

fs.writeFileSync(path.join(HERE, 'real-goals-cases.json'), JSON.stringify({ cases: all }, null, 1));
fs.writeFileSync(path.join(SRC, 'holdout-freeze.json'), JSON.stringify({
  frozenAt: new Date().toISOString(),
  seed,
  rule: '修复期间禁读禁改依据；仅用于修复后验证跑',
  ids: holdout.map((c) => c.personaId),
}, null, 1));
fs.writeFileSync(path.join(RESULTS, 'wave1-holdout-ids.txt'), holdout.map((c) => c.personaId).join('\n') + '\n');
fs.writeFileSync(path.join(RESULTS, 'wave1-driver-ids.txt'), driver.map((c) => c.personaId).join('\n') + '\n');

console.log(`merged=${all.length} holdout=${holdout.length} driver=${driver.length} seed=${seed}`);
if (problems.length) console.log('problems:\n' + problems.join('\n'));
console.log('holdout:', holdout.map((c) => c.personaId).join(','));
