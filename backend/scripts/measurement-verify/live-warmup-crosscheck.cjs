#!/usr/bin/env node
/**
 * 实库 memoryWarmup 交叉核对（E-03 旁证）
 * 直接从 teaching_sessions.teachingState.sessionArtifacts.memoryWarmup.items 读
 * 「复习模块出题时的预测保持率」与「学习者实际作答结果」，与 out/ 历史样本读数互相印证。
 */
'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.resolve(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');
const rows = db.prepare('SELECT id, teachingState FROM teaching_sessions WHERE teachingState IS NOT NULL').all();

let n = 0;
let sumPredicted = 0;
let sumActual = 0;
const ratings = {};
const samples = [];

for (const row of rows) {
  let state;
  try {
    state = JSON.parse(row.teachingState);
  } catch {
    continue;
  }
  const items = state?.sessionArtifacts?.memoryWarmup?.items || [];
  for (const item of items) {
    const predicted = item.retention ?? item.predictedRetentionAtAsOf;
    const outcome = item.outcome ?? item.actualRating;
    if (typeof predicted !== 'number' || outcome == null) continue;
    // outcome 形态：{ status: 'mastered' | 'learning' | 'not-recalled', progress, reviewedAt }
    const status = typeof outcome === 'string' ? outcome : outcome.status;
    if (!status) continue;
    const actual = status === 'mastered' ? 1 : 0;
    n += 1;
    sumPredicted += predicted;
    sumActual += actual;
    ratings[status] = (ratings[status] || 0) + 1;
    if (samples.length < 5) samples.push({ predicted, status });
  }
}
db.close();

const meanPredicted = n ? sumPredicted / n : null;
const meanActual = n ? sumActual / n : null;
console.log('实库 memoryWarmup 交叉核对');
console.log(`  配对 ${n} 条｜预测均 ${meanPredicted === null ? '-' : meanPredicted.toFixed(3)}｜实测 ${meanActual === null ? '-' : meanActual.toFixed(3)}`);
console.log(`  预测/实测 ${meanPredicted && meanActual ? (meanPredicted / meanActual).toFixed(2) : '-'}｜评分 ${JSON.stringify(ratings)}`);
console.log(`  样例 ${JSON.stringify(samples)}`);
