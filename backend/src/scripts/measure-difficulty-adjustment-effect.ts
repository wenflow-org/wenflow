/**
 * 难度调整的**效果度量**报告（只读）
 *
 * 主指标：下一条同路径状态是否不再触发同类降档理由（relieved）；
 * 辅指标：lsb 回升 / lf 回落；对照组（applied=false）与实验组（applied=true）分开统计。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/measure-difficulty-adjustment-effect.ts --user=<ID>
 *   npx ts-node --transpile-only src/scripts/measure-difficulty-adjustment-effect.ts --user=<ID> --path=<pathId> --days=30
 */
import 'dotenv/config';
import prisma from '../config/database';
import {
  measureTaskDifficultyEffects,
  type AdjustmentEffectGroup,
} from '../services/learner/TaskDifficultyAdjustmentLedger';

function formatGroup(group: AdjustmentEffectGroup): string {
  const label = group.applied ? '已按调整执行' : '未执行(对照)';
  const lsb = group.avgLsbDelta == null ? '-' : group.avgLsbDelta.toFixed(3);
  const lf = group.avgLfDelta == null ? '-' : group.avgLfDelta.toFixed(3);
  return `  ${group.reason.padEnd(24)} ${label.padEnd(14)} 缓解 ${group.relieved}/${group.total}`
    + ` (${(group.relievedRate * 100).toFixed(0)}%)  Δlsb ${lsb}  Δlf ${lf}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let userId: string | null = null;
  let pathId: string | null = null;
  let days = 30;
  for (const arg of argv) {
    if (arg.startsWith('--user=')) userId = arg.slice('--user='.length).trim() || null;
    else if (arg.startsWith('--path=')) pathId = arg.slice('--path='.length).trim() || null;
    else if (arg.startsWith('--days=')) days = Number(arg.slice('--days='.length)) || 30;
    else if (arg) throw new Error(`未知参数：${arg}`);
  }
  if (!userId) throw new Error('必须指定 --user=<学习者ID>');

  const since = new Date(Date.now() - days * 24 * 3600_000);
  const { effects, groups } = await measureTaskDifficultyEffects({ userId, pathId, since });
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { name: true } });

  console.log(`[measure] ${user?.name || userId}${pathId ? `｜路径 ${pathId}` : ''}｜近 ${days} 天`);
  console.log(`[measure] 锚点 ${effects.length} 条：`
    + `可度量 ${effects.filter((e) => e.outcome === 'relieved' || e.outcome === 'still_triggered').length}、`
    + `不可度量(知识类理由) ${effects.filter((e) => e.outcome === 'not_measurable').length}、`
    + `无后续状态 ${effects.filter((e) => e.outcome === 'no_next_state').length}`);

  if (groups.length === 0) {
    console.log('[measure] 没有可度量的锚点（先让课堂跑出若干次难度调整留痕）');
    return;
  }

  console.log('\n[measure] 按理由 × 是否执行分组：');
  for (const group of groups) console.log(formatGroup(group));

  console.log('\n[measure] 逐条：');
  for (const effect of effects) {
    const verdict = effect.outcome === 'relieved' ? '缓解'
      : effect.outcome === 'still_triggered' ? `仍触发(${effect.stillTriggeredReasons.join(',')})`
        : effect.outcome === 'not_measurable' ? '不可度量' : '无后续状态';
    console.log(`  ${effect.taskId.slice(0, 24)} ${effect.applied ? '执行' : '对照'} `
      + `难度 ${effect.baseline}→${effect.adjusted} | ${verdict} | Δlsb ${effect.lsbDelta ?? '-'} Δlf ${effect.lfDelta ?? '-'}`
      + ` | 理由 ${JSON.stringify(effect.reasons)}`);
  }

  const applied = groups.filter((group) => group.applied);
  const control = groups.filter((group) => !group.applied);
  if (applied.length > 0 && control.length > 0) {
    const rate = (list: AdjustmentEffectGroup[]) => {
      const total = list.reduce((sum, group) => sum + group.total, 0);
      const relieved = list.reduce((sum, group) => sum + group.relieved, 0);
      return total === 0 ? 0 : relieved / total;
    };
    console.log(`\n[measure] 结论：已执行组缓解率 ${(rate(applied) * 100).toFixed(0)}% vs 对照组 ${(rate(control) * 100).toFixed(0)}%`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
