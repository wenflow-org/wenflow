#!/usr/bin/env node
/**
 * 路径交付比审计（#55 / P-30，只读）
 *
 * 两个口径分开报（见 src/services/learning/delivery-ratio.ts 的说明）：
 * - 计划口径 `bc.after / target`：守恒层自己报的预算；
 * - 实际口径 `Σ(subtask.estimatedMinutes)/60 / target`：学习者实际被排到的课时。
 * 2026-10-18 实证两者差距巨大（CPA 240h 锚：计划 127.5h、实际 62.1h），只看计划口径会把
 * 「计划→实际」这一跳造成的交付塌方读成 0 条。
 *
 * 判据（issue #55）：`ratioActual < 0.6 且 ratioCap < 0.8` 记真缺口；真缺口率 > 40% 即成立。
 * 无预算锚（budgetConservation 为 null）的路径单独计数，不参与分母。
 *
 * 用法：cd backend && npx ts-node --transpile-only scripts/audit-delivery-ratio.ts [--limit 20] [--json]
 */
import prisma from '../src/config/database';
import {
  computeDeliveryRatio,
  detectShortfallDeclaration,
  summarizeDeliveryRatios,
  summarizeGapDeclarations,
  type DeliveryRatioRow,
  type ShortfallDeclaration,
} from '../src/services/learning/delivery-ratio';

const args = process.argv.slice(2);
const limitIndex = args.indexOf('--limit');
const SAMPLE_LIMIT = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 20 : 20;
const AS_JSON = args.includes('--json');

interface AuditRow {
  pathId: string;
  title: string | null;
  status: string;
  taskCount: number;
  ratio: DeliveryRatioRow;
  /** 缺口声明（真缺口才有意义）：path=路径级课时说明，stage=阶段级时间/容量说明 */
  declaration: ShortfallDeclaration;
}

async function main() {
  const paths = await prisma.learning_paths.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      description: true,
      aiPromptTemplate: true,
      milestones: {
        select: {
          id: true,
          description: true,
          subtasks: { select: { estimatedMinutes: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  let noTemplate = 0;
  let noAnchor = 0;
  let noTasks = 0;
  const rows: AuditRow[] = [];

  for (const path of paths) {
    if (!path.aiPromptTemplate) {
      noTemplate += 1;
      continue;
    }
    let conservation: Record<string, unknown> | null = null;
    try {
      const template = JSON.parse(path.aiPromptTemplate) as { budgetConservation?: Record<string, unknown> | null };
      conservation = template?.budgetConservation ?? null;
    } catch {
      conservation = null;
    }
    if (!conservation || !Number(conservation.target)) {
      noAnchor += 1;
      continue;
    }
    let minutes = 0;
    let taskCount = 0;
    for (const milestone of path.milestones) {
      for (const task of milestone.subtasks) {
        minutes += Number(task.estimatedMinutes) || 0;
        taskCount += 1;
      }
    }
    if (!taskCount) {
      noTasks += 1;
      continue;
    }
    const ratio = computeDeliveryRatio({
      targetHours: Number(conservation.target),
      capacityHours: conservation.capacitySum === undefined ? null : Number(conservation.capacitySum),
      plannedHours: conservation.after === undefined ? null : Number(conservation.after),
      deliveredHours: minutes / 60,
    });
    if (!ratio) {
      noAnchor += 1;
      continue;
    }
    // 声明分档：新生成路径读 budgetConservation.delivery.declaration（写入链落库），
    // 存量路径回退扫描述标记（路径级【课时说明】优先，其次阶段级时间/容量说明）。
    const persisted = (conservation as { delivery?: { declaration?: unknown } })?.delivery?.declaration;
    const declaration: ShortfallDeclaration = persisted === 'path' || persisted === 'stage'
      ? persisted
      : detectShortfallDeclaration({
          pathDescription: path.description,
          milestoneDescriptions: path.milestones.map((milestone) => milestone.description),
        });
    rows.push({ pathId: path.id, title: path.title, status: path.status, taskCount, ratio, declaration });
  }

  const summary = summarizeDeliveryRatios(rows.map((row) => row.ratio));
  const gapDeclarations = summarizeGapDeclarations(rows.map((row) => ({ trueGap: row.ratio.trueGap, declaration: row.declaration })));
  const gaps = rows
    .filter((row) => row.ratio.trueGap)
    .sort((a, b) => a.ratio.ratioActual - b.ratio.ratioActual);
  // 计划→实际兑现不足的全体（含 cap ≥0.8 的设计性缩水）：路径级声明的目标集合
  const plannedShortfalls = rows
    .filter((row) => row.ratio.actualVsPlanned !== null && row.ratio.actualVsPlanned < 0.8)
    .sort((a, b) => (a.ratio.actualVsPlanned ?? 1) - (b.ratio.actualVsPlanned ?? 1));

  if (AS_JSON) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      paths: paths.length,
      noTemplate,
      noAnchor,
      noTasks,
      summary,
      gapDeclarations,
      trueGaps: gaps,
      plannedShortfalls,
    }, null, 2));
    return;
  }

  console.log(`[delivery:ratio] 路径 ${paths.length}（无模板 ${noTemplate} / 无预算锚 ${noAnchor} / 锚定但无任务 ${noTasks}）`);
  console.log(`[delivery:ratio] 可算 ${summary.computable} 条`);
  console.log(`  实际口径 ratio<0.6：${summary.below60}（${(summary.below60Rate * 100).toFixed(1)}%）`);
  console.log(`  真缺口（<0.6 且 cap<0.8）：${summary.trueGap}（${(summary.trueGapRate * 100).toFixed(1)}%）`);
  console.log(`  中位实际 ratio：${summary.medianActual ?? '-'}`);
  console.log(`  分档：${JSON.stringify(summary.bands)}`);
  console.log(`  计划→实际兑现率 <0.8（守恒层说排了、任务没排到）：${summary.plannedShortfall} 条`);
  console.log(`  真缺口声明分档：已声明 ${gapDeclarations.declared} / 静默 ${gapDeclarations.silent}（真缺口 ${summary.trueGap} 条）`);
  console.log(`  判据（>40% 成立）：${summary.verdict}`);
  if (gaps.length) {
    console.log('[delivery:ratio] 真缺口样本（实际/计划/容量，hours）：');
    for (const row of gaps.slice(0, SAMPLE_LIMIT)) {
      const r = row.ratio;
      console.log(
        `  ${row.pathId} | ${row.status} | ${row.taskCount} 任务 | 锚 ${r.templateHours} 容量 ${r.capacityHours ?? '-'}`
        + ` 计划 ${r.plannedHours ?? '-'} 实际 ${r.deliveredHours} | ratio ${r.ratioActual} cap ${r.ratioCap ?? '-'}`
        + ` | 声明 ${row.declaration} | ${row.title ?? ''}`
      );
    }
  }
}

main()
  .catch((error) => {
    console.error('[delivery:ratio] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
