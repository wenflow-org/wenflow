/* eslint-disable no-console -- 运维脚本：进度与统计走 stdout */
/**
 * 清理 KT 幽灵痕（2026-10-22 审计 P1-2 数据处置）。
 *
 * 定义：source='kt-estimate' 且 extractionCount=0 的 memory_traces——它们是 KT 估算
 * 落库时留下的占位行，没有真实提取证据。读侧已在 getDueTraces/fetchMasteredConcepts
 * 过滤（extractionCount>0），这些行不会再进入复习/画像；本脚本把它们从库里清掉，
 * 避免后续新增消费者再次误读。
 *
 * 安全边界：默认 dry-run；--apply 前把待删行整行备份到 outputs/kt-ghost-traces-<date>.json。
 * 只删 source='kt-estimate' AND extractionCount=0，不碰有证据的 KT 行。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../config/database';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const rows = await prisma.memory_traces.findMany({
    where: { source: 'kt-estimate', extractionCount: 0 },
    select: {
      id: true,
      userId: true,
      conceptKey: true,
      masteryScore: true,
      stability: true,
      dueAt: true,
      createdAt: true,
    },
  });
  const byUser: Record<string, number> = {};
  for (const row of rows) byUser[row.userId] = (byUser[row.userId] || 0) + 1;

  console.log(JSON.stringify({
    mode: hasFlag('apply') ? 'apply' : 'dry-run',
    ghosts: rows.length,
    byUser,
  }, null, 2));

  if (!hasFlag('apply') || rows.length === 0) {
    console.log('[cleanup-kt-ghost-traces] dry-run 结束（加 --apply 删除）');
    return;
  }

  // 备份固定落到仓库根 outputs/（gitignored）；不随运行目录漂到 backend/outputs。
  const outDir = path.resolve(__dirname, '../../../outputs');
  fs.mkdirSync(outDir, { recursive: true });
  const backupFile = path.join(outDir, `kt-ghost-traces-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rows, null, 2), 'utf8');

  const result = await prisma.memory_traces.deleteMany({
    where: { source: 'kt-estimate', extractionCount: 0 },
  });
  console.log(JSON.stringify({ deleted: result.count, attempted: rows.length, backupFile }, null, 2));
}

main()
  .catch((error) => {
    console.error('[cleanup-kt-ghost-traces] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
