/* eslint-disable no-console -- 只读审计 CLI */
/**
 * 路径结构审计（只读）：对存量路径重算「前置缺口 / 重复任务 / 课时偏差」。
 *
 * 用 `node:sqlite` 只读查询（与本仓其他审计脚本同口径），不经过 Prisma 关系加载，
 * 避免 SQLite + 复杂 include 的 query-engine panic。
 *
 * 用法：
 *   npx ts-node --transpile-only scripts/audit-path-structure.ts
 *   npx ts-node --transpile-only scripts/audit-path-structure.ts --scope=virtual --days=30
 *   npx ts-node --transpile-only scripts/audit-path-structure.ts --json=doc/local/path-audit.json
 */
import 'dotenv/config';
import * as fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { auditPathStructure } from '../src/services/learning/generation/path-structure-audit';

function arg(name: string, fallback: string | null = null): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const jparse = (value: unknown, fallback: unknown = null) => {
  try { return JSON.parse(String(value)); } catch { return fallback; }
};

async function main() {
  const scope = arg('scope', 'all');
  const days = Number(arg('days', '0')) || 0;
  const jsonPath = arg('json');
  const dbPath = resolve(arg('db', 'prisma/dev.db')!);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec('PRAGMA busy_timeout=30000');

  const since = days > 0 ? Date.now() - days * 86400000 : null;
  const scopeSql = scope === 'virtual' ? ' AND u.isVirtualLearner = 1' : '';
  const sinceSql = since ? ' AND p.createdAt >= ?' : '';
  const paths = db.prepare(
    `SELECT p.id, p.title, p.estimatedHours, p.aiPromptTemplate, p.createdAt, u.isVirtualLearner AS virtual
       FROM learning_paths p JOIN users u ON u.id = p.userId
      WHERE p.status IN ('active','completed') AND p.aiPromptTemplate IS NOT NULL
        ${scopeSql}${sinceSql}
      ORDER BY p.createdAt DESC`,
  ).all(...(since ? [since] : [])) as Array<Record<string, unknown>>;

  const rows: Array<Record<string, unknown>> = [];
  const totals = { paths: 0, pathsWithIssues: 0, prerequisiteGap: 0, duplicateTask: 0, budgetMismatch: 0, lateWithinStage: 0, lateCrossStage: 0 };
  for (const path of paths) {
    const pathId = String(path.id);
    const template = jparse(path.aiPromptTemplate, {}) as {
      budgetConservation?: { after?: unknown; delivery?: unknown };
      kcAnnotation?: unknown;
    };
    const conservation = template.budgetConservation || {};
    const milestones = db.prepare(
      'SELECT id, stageNumber FROM milestones WHERE learningPathId = ? ORDER BY "order", stageNumber',
    ).all(pathId) as Array<{ id: string; stageNumber: number }>;
    const tasks: Array<{ title: string; stageNumber: number; order: number }> = [];
    let totalMinutes = 0;
    for (const milestone of milestones) {
      const subtasks = db.prepare(
        'SELECT title, description, estimatedMinutes FROM subtasks WHERE milestoneId = ? ORDER BY "order"',
      ).all(milestone.id) as Array<{ title: string; description: string | null; estimatedMinutes: number | null }>;
      subtasks.forEach((task, index) => {
        tasks.push({
          title: String(task.title || ''),
          description: String(task.description || ''),
          stageNumber: milestone.stageNumber,
          order: index,
        });
        totalMinutes += Number(task.estimatedMinutes) || 0;
      });
    }
    const result = auditPathStructure({
      kcAnnotation: (template?.kcAnnotation as never) ?? null,
      tasks,
      totalMinutes,
      afterHours: Number(conservation.after) || null,
      delivery: typeof conservation.delivery === 'string' ? conservation.delivery : null,
    });
    totals.paths += 1;
    if (result.issues.length > 0) totals.pathsWithIssues += 1;
    totals.lateWithinStage += result.stats.lateWithinStage;
    totals.lateCrossStage += result.stats.lateCrossStage;
    for (const issue of result.issues) {
      if (issue.kind === 'prerequisite-gap') totals.prerequisiteGap += 1;
      if (issue.kind === 'duplicate-task') totals.duplicateTask += 1;
      if (issue.kind === 'budget-mismatch') totals.budgetMismatch += 1;
    }
    if (result.issues.length > 0) {
      rows.push({ pathId, title: path.title, virtual: Boolean(path.virtual), createdAt: path.createdAt, issues: result.issues, stats: result.stats });
    }
  }

  const rate = (n: number) => (totals.paths > 0 ? Number((n / totals.paths).toFixed(3)) : 0);
  console.log(`\n===== 路径结构审计（scope=${scope}${days ? `, days=${days}` : ''}）=====`);
  console.log(`路径=${totals.paths} 有问题=${totals.pathsWithIssues}（${rate(totals.pathsWithIssues)}）`);
  console.log(`- 前置缺口 ${totals.prerequisiteGap} 条（${rate(totals.prerequisiteGap)} 路径）`);
  console.log(`  - 同阶段内可重排 ${totals.lateWithinStage} 条；跨阶段 ${totals.lateCrossStage} 条`);
  console.log(`- 重复任务 ${totals.duplicateTask} 条（${rate(totals.duplicateTask)} 路径）`);
  console.log(`- 课时偏差 ${totals.budgetMismatch} 条（${rate(totals.budgetMismatch)} 路径）`);
  for (const row of rows.slice(0, 10)) {
    console.log(`\n[${row.pathId}] ${row.title}｜虚拟=${row.virtual}｜issues=${(row.issues as unknown[]).length}`);
    for (const issue of (row.issues as Array<{ kind: string; severity: string; detail: string }>).slice(0, 3)) {
      console.log(`  - ${issue.kind}/${issue.severity}: ${issue.detail}`);
    }
  }
  if (jsonPath) {
    fs.writeFileSync(resolve(jsonPath), JSON.stringify({ totals, rows }, null, 2), 'utf8');
    console.log(`\n[report] ${jsonPath}`);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('[audit-path-structure] 失败:', error);
  process.exit(1);
});
