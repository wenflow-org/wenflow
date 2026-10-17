#!/usr/bin/env node
/**
 * 归档污染校准样本（2026-10-17）
 *
 * 背景：E-03/E-06 读数时发现两类样本污染判断：
 *  1) epoch-1 文件（文件名无 -epoch2 标记，生成于 2026-10-08 纪元重置前）。
 *     跨纪元混算违反 DATA-EPOCH-RESET-2026-10-08 的纪律，且旧预测口径已变。
 *  2) 负担隔 >50% 的 epoch-2 文件（2026-10-10 多驱动并发写坏，asOf 早于 lastSeenAt）。
 *     forgetting-curve-readout.cjs 没有负间隔守卫，直接吃这些样本会把预测值抬到 ≈1。
 *
 * 做法：移动到 out/ 下的子目录（读数脚本 readdirSync 非递归，自动移出读数路径），
 * 写 manifest 留证。不硬删。
 *
 * 用法：
 *   node scripts/measurement-verify/archive-stale-readouts.cjs            # dry-run
 *   node scripts/measurement-verify/archive-stale-readouts.cjs --apply    # 执行
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');
const EPOCH1_DIR = path.join(OUT_DIR, 'archive-20261017-epoch1');
const NEG_DIR = path.join(OUT_DIR, 'quarantine-20261017-negative-heavy');
const MANIFEST = path.join(OUT_DIR, 'ARCHIVE-MANIFEST-20261017.json');
const DAY_MS = 86400000;
const NEG_HEAVY = 0.5;

const apply = process.argv.includes('--apply');
const fileRe = /^r4-cal-day\d+.*\.json$/;

function inspect(file) {
  const raw = fs.readFileSync(path.join(OUT_DIR, file), 'utf8');
  const data = JSON.parse(raw);
  let pairs = 0;
  let negative = 0;
  for (const vl of data.vls || []) {
    const asOf = vl.window?.asOf ? Date.parse(vl.window.asOf) : NaN;
    for (const pair of vl.warmupPairs || []) {
      const elapsed = (asOf - Date.parse(pair.predictedLastSeenAt)) / DAY_MS;
      if (!Number.isFinite(elapsed)) continue;
      pairs += 1;
      if (elapsed < 0) negative += 1;
    }
  }
  return {
    file,
    epoch: /-epoch2/.test(file) ? 2 : 1,
    generatedAt: data.generatedAt || null,
    pairs,
    negative,
    negativeRatio: pairs ? Number((negative / pairs).toFixed(4)) : 0,
    bytes: fs.statSync(path.join(OUT_DIR, file)).size,
  };
}

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`out 目录不存在: ${OUT_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(OUT_DIR).filter((name) => fileRe.test(name));
  const rows = files.map(inspect);

  const epoch1 = rows.filter((row) => row.epoch === 1);
  const negativeHeavy = rows.filter(
    (row) => row.epoch === 2 && row.negativeRatio > NEG_HEAVY,
  );
  const keep = rows.filter(
    (row) => row.epoch === 2 && row.negativeRatio <= NEG_HEAVY,
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    rule: {
      epoch1: '文件名无 -epoch2 标记（纪元重置前生成）',
      negativeHeavy: `epoch-2 且负间隔占比 > ${NEG_HEAVY}`,
    },
    counts: {
      total: rows.length,
      archiveEpoch1: epoch1.length,
      quarantineNegativeHeavy: negativeHeavy.length,
      keep: keep.length,
    },
    keepPairs: keep.reduce((sum, row) => sum + row.pairs, 0),
    keepNegative: keep.reduce((sum, row) => sum + row.negative, 0),
    archiveEpoch1: epoch1,
    quarantineNegativeHeavy: negativeHeavy,
  };

  console.log(`模式: ${summary.mode}`);
  console.log(
    `总 ${rows.length} 文件 → epoch-1 ${epoch1.length} 归档 / 重度负间隔 ${negativeHeavy.length} 隔离 / 保留 ${keep.length}`,
  );
  console.log(
    `保留样本 ${summary.keepPairs} 对（负间隔 ${summary.keepNegative}，${((summary.keepNegative / summary.keepPairs) * 100 || 0).toFixed(1)}%）`,
  );
  for (const row of epoch1) {
    console.log(`  [epoch1] ${row.file} pairs=${row.pairs} neg=${row.negative}`);
  }
  for (const row of negativeHeavy) {
    console.log(
      `  [negative] ${row.file} pairs=${row.pairs} neg=${row.negative} (${(row.negativeRatio * 100).toFixed(0)}%)`,
    );
  }

  if (!apply) {
    console.log('\ndry-run 结束。加 --apply 执行移动。');
    return;
  }

  fs.mkdirSync(EPOCH1_DIR, { recursive: true });
  fs.mkdirSync(NEG_DIR, { recursive: true });
  for (const row of epoch1) {
    fs.renameSync(path.join(OUT_DIR, row.file), path.join(EPOCH1_DIR, row.file));
  }
  for (const row of negativeHeavy) {
    fs.renameSync(path.join(OUT_DIR, row.file), path.join(NEG_DIR, row.file));
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`\n已归档，manifest: ${MANIFEST}`);
}

main();
