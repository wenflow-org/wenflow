#!/usr/bin/env node
/**
 * 预制虚拟学习者不变量审计（#91 / P-67，只读）
 *
 * 定义侧：校验 `virtual-learners/presets.yaml`（键/覆盖轴/人物故事必填/预算/夹具/答案键禁入）；
 * 实例侧（`--with-db`）：校验 DB 中 source='builtin' 的实例与定义是否对齐（漏同步/孤儿/版本/哈希漂移）。
 *
 * 用法：cd backend && npx ts-node --transpile-only scripts/audit-preset-invariants.ts [--with-db] [--json]
 * 退出码：存在 error 级发现时为 1（可直接接 CI / preflight）。
 */
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../src/config/database';
import { BUILTIN_LEARNERS_FILE, loadBuiltinLearnerPresets } from '../src/virtual-lab/builtin-learners/loader';
import {
  buildInvariantReport,
  checkPresetInstances,
  checkPresetSet,
  type InvariantFinding,
} from '../src/virtual-lab/builtin-learners/preset-invariants';

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const WITH_DB = args.includes('--with-db');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function fixtureExists(relativeFile: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relativeFile));
}

function printGroup(title: string, findings: InvariantFinding[]): void {
  if (!findings.length) return;
  console.log(title);
  for (const item of findings) {
    console.log(`  [${item.severity}] ${item.code}${item.presetKey ? ` (${item.presetKey})` : ''} — ${item.message}`);
  }
}

async function main(): Promise<number> {
  const loaded = loadBuiltinLearnerPresets();
  const findings: InvariantFinding[] = [
    ...checkPresetSet(loaded.presets, { fixtureExists }),
  ];

  if (WITH_DB) {
    const instances = await prisma.virtual_learner_profiles.findMany({
      where: { source: 'builtin' },
      select: { presetKey: true, presetVersion: true, tags: true, profile: true },
    });
    findings.push(...checkPresetInstances(loaded.presets, instances));
  }

  const report = buildInvariantReport(loaded.presets, findings);

  if (AS_JSON) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      file: BUILTIN_LEARNERS_FILE,
      corpusVersion: loaded.version,
      loaderDiagnostics: loaded.diagnostics,
      withDb: WITH_DB,
      report,
    }, null, 2));
    return report.counts.error > 0 ? 1 : 0;
  }

  console.log(`[preset:invariants] ${BUILTIN_LEARNERS_FILE}（corpus v${loaded.version}，${report.presetCount} 条定义）`);
  if (loaded.diagnostics.length) {
    console.log(`  加载器告警 ${loaded.diagnostics.length} 条：`);
    for (const item of loaded.diagnostics) {
      console.log(`    ${item.code}${item.presetKey ? ` (${item.presetKey})` : ''} — ${item.message}`);
    }
  }
  console.log(`  sourceType：${JSON.stringify(report.coverage.sourceTypes)}`);
  console.log(`  goalType：${JSON.stringify(report.coverage.goalTypes)}`);
  console.log(`  availableTime：${JSON.stringify(report.coverage.availableTime)}`);
  console.log(`  轴覆盖：${JSON.stringify(report.coverage.axes)}`);

  printGroup('[error]', findings.filter((item) => item.severity === 'error'));
  printGroup('[warn]', findings.filter((item) => item.severity === 'warn'));
  printGroup('[info]', findings.filter((item) => item.severity === 'info'));
  console.log(
    `[preset:invariants] error ${report.counts.error} / warn ${report.counts.warn} / info ${report.counts.info}`
    + `${WITH_DB ? '（含定义↔实例）' : '（仅定义侧；加 --with-db 校验实例）'}`,
  );
  return report.counts.error > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('[preset:invariants] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
