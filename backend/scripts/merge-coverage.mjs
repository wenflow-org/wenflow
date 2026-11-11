#!/usr/bin/env node
/**
 * CI coverage 分片合并 + 全局阈值验收（quality-check.yml tests 矩阵分片的配套）。
 *
 * 用法：node scripts/merge-coverage.mjs <shard-coverage-final.json> [...more]
 *   分片产物路径通常形如 artifacts/backend-coverage-shard-1/coverage-final.json
 *
 * 合并语义：istanbul 计数器按文件求和（istanbul-lib-coverage map.merge）。
 * 某文件的测试只落在其中一个分片时，其它分片对该文件为零计数，求和后即真实
 * 全局覆盖——与全量单进程跑（jest --runInBand --coverage）的阈值分母等价。
 *
 * 阈值来源：jest.config.js 的 coverageThreshold.global（45/33/43/45），
 * 用 require 直接读取同一份配置，防止两处口径漂移。任一指标低于阈值 → 退出码 1。
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (args.length === 0) {
  console.error('[coverage-merge] 用法：merge-coverage.mjs <coverage-final.json> [...more]');
  process.exit(1);
}

const map = libCoverage.createCoverageMap({});
for (const file of args) {
  if (!existsSync(file)) {
    console.error(`[coverage-merge] 分片产物不存在：${file}`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(resolve(file), 'utf8'));
  map.merge(libCoverage.createCoverageMap(data));
}

const summary = libCoverage.createCoverageSummary();
for (const file of map.files()) {
  summary.merge(map.fileCoverageFor(file).toSummary());
}
const thresholds = createRequire(import.meta.url)(resolve(here, '../jest.config.js')).coverageThreshold.global;

const rows = [
  ['statements', 'statements'],
  ['branches', 'branches'],
  ['functions', 'functions'],
  ['lines', 'lines'],
];
let failed = false;
console.log('[coverage-merge] 分片数=' + args.length + '，合并文件数=' + map.files().length);
for (const [metric, label] of rows) {
  const pct = summary[metric]?.pct ?? 100;
  const threshold = thresholds[metric];
  const ok = pct >= threshold;
  if (!ok) failed = true;
  console.log(`  ${label.padEnd(11)} ${String(pct).padStart(6)}%  阈值 ${threshold}%  ${ok ? 'OK' : 'FAIL'}`);
}
if (failed) {
  console.error('[coverage-merge] 合并覆盖率低于防劣化阈值');
  process.exit(1);
}
console.log('[coverage-merge] PASS');
