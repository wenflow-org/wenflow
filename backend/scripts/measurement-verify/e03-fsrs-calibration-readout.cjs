#!/usr/bin/env node
/**
 * e03-fsrs-calibration-readout.cjs — E-03 / E-06 判据读数（2026-10-17）
 *
 * 判据取自 `doc/local/ISSUE-REGISTER-2026-10-17.md` §5：
 *   E-03：预测/实测比值偏离 1 超过 0.2，或校准曲线任一区间偏离对角线超过 0.15 → 成立
 *   E-06：至少覆盖 again/failed 象限 + 线上预测样本；缺象限即「不可用」
 *
 * 数据源（同 `forgetting-curve-readout.cjs`，避免换尺）：
 *   ① 温故配对样本：`scripts/measurement-verify/out/r4-cal-day*-<tag>*.json` 的
 *      `vls[].warmupPairs[]`（predictedRetentionAtAsOf vs actualRating）；
 *   ② 线上预测样本：`prediction_records`（stallRisk/predictedTone → outcome）。
 *
 * 纪元纪律（DATA-EPOCH-RESET-2026-10-08）：epoch-1 与 epoch-2 必须分开算，不得混池。
 * 本脚本按 tag 分组统计，并把「是否能算校准」的结论显式打印，不给跨纪元的合并数。
 *
 * 用法：
 *   node scripts/measurement-verify/e03-fsrs-calibration-readout.cjs
 *   node scripts/measurement-verify/e03-fsrs-calibration-readout.cjs --tag=epoch2
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const OUT = path.join(__dirname, 'out');
const DAY_MS = 86400000;
const TAG_ARG = process.argv.find((a) => a.startsWith('--tag=')) || '';
const TAG = TAG_ARG ? TAG_ARG.slice('--tag='.length) : '';

const BUCKETS = [
  { key: '0.0-0.3', lo: 0, hi: 0.3 },
  { key: '0.3-0.6', lo: 0.3, hi: 0.6 },
  { key: '0.6-0.85', lo: 0.6, hi: 0.85 },
  { key: '0.85-1.0', lo: 0.85, hi: 1.0001 },
];
const ELAPSED_BUCKETS = [
  { key: '0-1d', lo: 0, hi: 1 },
  { key: '1-2d', lo: 1, hi: 2 },
  { key: '2-4d', lo: 2, hi: 4 },
  { key: '4-7d', lo: 4, hi: 7 },
  { key: '7d+', lo: 7, hi: Number.POSITIVE_INFINITY },
];

function pct(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 收集某个 tag 分组下的配对样本（同 forgetting-curve-readout 的去重键）。 */
function loadPairs(tag) {
  const files = fs.readdirSync(OUT).filter((name) => {
    const match = /^r4-cal-day\d+(.*)\.json$/.exec(name);
    if (!match) return false;
    // 文件名形如 r4-cal-day10-epoch2a.json → 捕获组是 "-epoch2a"，tag 去掉前导 -
    const fileTag = (match[1] || '').replace(/^-/, '');
    if (!tag) return true;
    return fileTag.startsWith(tag);
  });
  const pairs = [];
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
    } catch {
      continue; // 半写/损坏文件跳过
    }
    for (const vl of json.vls || []) {
      const asOfMs = vl.window && vl.window.asOf
        ? Date.parse(vl.window.asOf)
        : (json.generatedAt ? Date.parse(json.generatedAt) : NaN);
      for (const pair of vl.warmupPairs || []) {
        const key = `${pair.conceptKey}|${pair.occurredAt}|${(pair.source && pair.source.teachingSessionId) || ''}`;
        const predicted = Number(pair.predictedRetentionAtAsOf);
        if (!Number.isFinite(predicted)) continue;
        const lastSeenMs = Date.parse(pair.predictedLastSeenAt);
        const elapsedDays = Number.isFinite(asOfMs) && Number.isFinite(lastSeenMs)
          ? (asOfMs - lastSeenMs) / DAY_MS
          : null;
        // 负间隔守卫（2026-10-17 实测）：386/1224 条样本 lastSeenAt 晚于 asOf（跨模拟日/双驱动
        // 并发写造成），FSRS 对负 elapsed 一律返回接近 1 的保留率——这些点会把「0.85-1.0 带」
        // 灌满并伪造出「预测偏乐观」。它们不是可用的校准观测，必须单列而非静默混入。
        const negativeElapsed = elapsedDays !== null && elapsedDays < 0;
        pairs.push({
          key,
          predicted: Math.max(0, Math.min(1, predicted)),
          rating: String(pair.actualRating || ''),
          status: String(pair.actualStatus || ''),
          elapsedDays,
          negativeElapsed,
          formulaPath: String(pair.predictedFormulaPath || ''),
          recalled: pair.actualRating && pair.actualRating !== 'again' ? 1 : 0,
        });
      }
    }
  }
  return { pairs, fileCount: files.length };
}

/**
 * 去重 + 选优（2026-10-17 修正）：同一 (conceptKey, occurredAt, teachingSessionId) 会在多个
 * 模拟日文件里复现。此前"先到先得"会把**首个出现在负间隔文件里的观测**锁死，导致同一条
 * 真实配对在后续日（间隔已正常）里被丢弃——实测 277 → 有效 180，而按最优观测选是 270。
 * 口径：同一 key 取「elapsed 非负且最大」的那条（最长间隔的观测最有校准价值）。
 */
function dedupePairs(pairs) {
  const best = new Map();
  for (const pair of pairs) {
    const existing = best.get(pair.key);
    if (!existing) {
      best.set(pair.key, pair);
      continue;
    }
    const better = pair.negativeElapsed
      ? false
      : existing.negativeElapsed || pair.elapsedDays > existing.elapsedDays;
    if (better) best.set(pair.key, pair);
  }
  return [...best.values()];
}

function reportCalibration(label, pairs) {
  console.log(`\n## ${label}`);
  const negative = pairs.filter((pair) => pair.negativeElapsed);
  const usable = pairs.filter((pair) => !pair.negativeElapsed);
  console.log(`去重后配对样本 ${pairs.length} 条｜负间隔（不可用，已剔除）${negative.length} 条｜有效 ${usable.length} 条`);
  if (negative.length) {
    const negPredicted = mean(negative.map((pair) => pair.predicted));
    console.log(
      `  负间隔样本预测均 ${pct(negPredicted, 3)}——FSRS 对负 elapsed 恒返回≈1，` +
        '这批若混入会把「0.85-1.0 带」灌成假乐观'
    );
  }
  if (!usable.length) {
    console.log('  → 无有效样本，无法读数');
    return null;
  }
  pairs = usable;

  const meanPredicted = mean(pairs.map((pair) => pair.predicted));
  const meanActual = mean(pairs.map((pair) => pair.recalled));
  const ratio = meanActual > 0 ? meanPredicted / meanActual : null;
  console.log(
    `全局：预测均 ${pct(meanPredicted, 3)}｜实测回忆率 ${pct(meanActual, 3)}` +
      `｜预测/实测 = ${ratio === null ? '-' : pct(ratio, 2)}（判据：偏离 1 超过 0.2 即成立偏悲观）`
  );

  const rows = [];
  let maxDeviation = 0;
  let maxDeviationBucket = null;
  // 小样本守卫：n<10 的带不参与「最大偏差」判定——否则单个预测 1.0/实测 0 的点
  // 会独占结论（2026-10-17 实测：0.85-1.0 带只剩 1 条，dev=-1 掩盖了真正的问题）。
  const MIN_BUCKET_N = 10;
  for (const bucket of BUCKETS) {
    const list = pairs.filter((pair) => pair.predicted >= bucket.lo && pair.predicted < bucket.hi);
    const predictedMean = mean(list.map((pair) => pair.predicted));
    const actual = mean(list.map((pair) => pair.recalled));
    const deviation = predictedMean !== null && actual !== null ? actual - predictedMean : null;
    if (deviation !== null && list.length >= MIN_BUCKET_N && Math.abs(deviation) > Math.abs(maxDeviation)) {
      maxDeviation = deviation;
      maxDeviationBucket = bucket.key;
    }
    rows.push({ bucket: bucket.key, n: list.length, predictedMean, actual, deviation });
  }
  console.log('  预测带         n   预测均   实测    偏差(实测−预测)');
  for (const row of rows) {
    console.log(
      `  ${row.bucket.padEnd(10)} ${String(row.n).padStart(4)}` +
        `   ${row.predictedMean === null ? '   -  ' : pct(row.predictedMean, 3).toString().padStart(5)}` +
        `   ${row.actual === null ? '   -  ' : pct(row.actual, 3).toString().padStart(5)}` +
        `   ${row.deviation === null ? '     -' : (row.deviation >= 0 ? '+' : '') + pct(row.deviation, 3)}`
    );
  }
  console.log(
    `  最大区间偏差（仅计 n>=${MIN_BUCKET_N} 的带）${maxDeviation >= 0 ? '+' : ''}${pct(maxDeviation, 3)}` +
      `（区间 ${maxDeviationBucket || '无有效带'}）｜判据：任一区间偏离对角线超过 0.15 即成立`
  );

  // 判别力：高预测带 vs 低预测带（沿用既有口径 0.6 为界），是「预测有方向性」的证据
  const high = pairs.filter((pair) => pair.predicted >= 0.6);
  const low = pairs.filter((pair) => pair.predicted < 0.6);
  const discrimination = high.length && low.length
    ? mean(high.map((pair) => pair.recalled)) - mean(low.map((pair) => pair.recalled))
    : null;
  console.log(`  判别力（>=0.6 带 − <0.6 带）= ${discrimination === null ? '-' : pct(discrimination, 2)}`);

  const ratings = {};
  for (const pair of pairs) ratings[pair.rating || '(空)'] = (ratings[pair.rating || '(空)'] || 0) + 1;
  console.log(`  评分象限分布：${JSON.stringify(ratings)}`);

  const elapsedRows = [];
  for (const bucket of ELAPSED_BUCKETS) {
    const list = pairs.filter((pair) => pair.elapsedDays !== null && pair.elapsedDays >= bucket.lo && pair.elapsedDays < bucket.hi);
    if (!list.length) {
      elapsedRows.push(`${bucket.key}: n=0`);
      continue;
    }
    elapsedRows.push(
      `${bucket.key}: n=${list.length} 预测均 ${pct(mean(list.map((pair) => pair.predicted)), 3)}` +
        ` 实测 ${pct(mean(list.map((pair) => pair.recalled)), 3)}`
    );
  }
  console.log(`  间隔分层：${elapsedRows.join('｜')}`);

  return { n: pairs.length, meanPredicted, meanActual, ratio, maxDeviation, maxDeviationBucket, discrimination, ratings, rows };
}

function onlinePredictions() {
  const db = new DatabaseSync(path.resolve(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000');
  const total = db.prepare('SELECT COUNT(*) n FROM prediction_records').get();
  const resolved = db.prepare("SELECT outcome, COUNT(*) n FROM prediction_records WHERE outcome IS NOT NULL GROUP BY outcome").all();
  const byUser = db.prepare(
    `SELECT u.name AS name, COUNT(*) n FROM prediction_records p JOIN users u ON u.id = p.userId
     WHERE p.outcome IS NOT NULL GROUP BY u.name ORDER BY n DESC LIMIT 8`
  ).all();
  db.close();
  const resolvedTotal = resolved.reduce((sum, row) => sum + Number(row.n), 0);
  console.log(`\n## 线上预测样本（prediction_records）`);
  console.log(`总数 ${total.n}｜已结算 ${resolvedTotal}｜分布 ${JSON.stringify(Object.fromEntries(resolved.map((row) => [row.outcome, row.n])))}`);
  console.log(`结算样本来源（前 8）：${byUser.map((row) => `${row.name}×${row.n}`).join('、') || '无'}`);
  return { total: total.n, resolvedTotal, outcomes: Object.fromEntries(resolved.map((row) => [row.outcome, row.n])) };
}

function main() {
  console.log('='.repeat(78));
  console.log(`E-03 / E-06 读数（tag=${TAG || 'all'}）`);
  console.log('判据 E-03：预测/实测比值偏离 1 超过 0.2，或校准区间偏离对角线超过 0.15');
  console.log('判据 E-06：需覆盖 again/failed 象限 + 线上预测样本；缺象限即「不可用」');
  console.log('='.repeat(78));

  const { pairs, fileCount } = loadPairs(TAG);
  console.log(`\n源文件 ${fileCount} 个（原始配对 ${pairs.length} 条，按 key 选最优观测去重）`);
  const result = reportCalibration(`样本组 tag=${TAG || '(全部)'}`, dedupePairs(pairs));

  const online = onlinePredictions();

  if (!result) return;
  const biasVerdict = result.ratio !== null && Math.abs(result.ratio - 1) > 0.2;
  const curveVerdict = Math.abs(result.maxDeviation) > 0.15;
  const hasAgain = (result.ratings.again || 0) > 0;
  const nBucketsWithSamples = result.rows.filter((row) => row.n >= 10).length;

  console.log(`\n## 判据结论`);
  console.log(`  E-03 偏悲观（比值口径）：${biasVerdict ? '成立' : '不成立'}（比值 ${result.ratio === null ? '-' : pct(result.ratio, 2)}）`);
  console.log(`  E-03 偏悲观（区间口径）：${curveVerdict ? '成立' : '不成立'}（最大偏差 ${pct(result.maxDeviation, 3)}）`);
  console.log(`  E-06 again 象限：${hasAgain ? `有（${result.ratings.again} 条）` : '缺'}`);
  console.log(`  E-06 样本量：${result.n} 对（拟合需千级）；有效区间（n>=10）${nBucketsWithSamples}/${BUCKETS.length}`);
  console.log(`  E-06 线上预测样本：${online.resolvedTotal} 条已结算`);
  const usable = result.n >= 1000 && nBucketsWithSamples === BUCKETS.length && online.resolvedTotal >= 100;
  console.log(
    `  → 校准曲线**${usable ? '可用' : '不可用'}**：` +
      (usable
        ? '样本量与象限覆盖满足最低要求'
        : `样本 ${result.n}/1000、有效区间 ${nBucketsWithSamples}/${BUCKETS.length}、线上 ${online.resolvedTotal}/100；按纪律只登记偏差，不调参`)
  );
}

main();
