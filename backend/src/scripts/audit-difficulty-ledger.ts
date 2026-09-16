/**
 * 难度调整台账的**回看**（只读）：生产锚点 → 效果度量（relieved / still_triggered）。
 *
 * 背景（doc/LEARNING_SCIENCE_AUDIT.md §7 P0-2）：`recordTaskDifficultyAdjustment` 此前
 * 唯一的调用者是模拟脚本，效果度量在真实课上从未运行。现已接进开课路径
 * （`AITeachingOrchestrator.recordTaskDifficultyAnchor`），本脚本用于回看真实数据。
 *
 * 口径（与台账一致，勿在此处改判据）：
 * - 主指标 `relieved` = 下一条同路径状态不再触发同类降档理由；
 * - 辅指标 Δlsb / Δlf 只给数值，不做判定；
 * - 知识类理由（fragile/struggling/prerequisite_gaps）需学习者快照才能复算 → `not_measurable`。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-difficulty-ledger.ts [--user=<ID>] [--days=30]
 */
import 'dotenv/config';
import prisma from '../config/database';
import {
  listTaskDifficultyAdjustments,
  measureTaskDifficultyEffects,
} from '../services/learner/TaskDifficultyAdjustmentLedger';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const fmt = (value: number | null) => (value === null ? '-' : String(value));

async function main(): Promise<void> {
  const requested = arg('user');
  const days = Number(arg('days')) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const learners = requested
    ? [{ id: requested, name: '(指定)' }]
    : await prisma.users.findMany({ where: { isVirtualLearner: true }, select: { id: true, name: true } });

  let anchorsTotal = 0;
  for (const learner of learners) {
    const anchors = await listTaskDifficultyAdjustments({ userId: learner.id, since });
    if (anchors.length === 0) continue;
    anchorsTotal += anchors.length;
    const { effects, groups } = await measureTaskDifficultyEffects({ userId: learner.id, since });

    console.log(`\n## ${learner.name || learner.id}｜锚点 ${anchors.length} 条（近 ${days} 天）`);
    for (const effect of effects) {
      console.log(
        `  · ${effect.taskId.slice(0, 8)} ${effect.baseline}→${effect.adjusted} applied=${effect.applied}` +
          ` reasons=[${effect.reasons.join(',')}] outcome=${effect.outcome}` +
          `${effect.stillTriggeredReasons.length ? ` still=[${effect.stillTriggeredReasons.join(',')}]` : ''}` +
          `｜Δlsb=${fmt(effect.lsbDelta)} Δlf=${fmt(effect.lfDelta)}`
      );
    }
    if (groups.length > 0) {
      console.log('  汇总（reason|applied → 缓解率；辅指标为均值）:');
      for (const group of groups) {
        console.log(
          `    ${group.reason}|applied=${group.applied}｜n=${group.total} relieved=${group.relieved}` +
            ` rate=${(group.relievedRate * 100).toFixed(0)}%｜avgΔlsb=${fmt(group.avgLsbDelta)} avgΔlf=${fmt(group.avgLfDelta)}`
        );
      }
    } else {
      console.log('  汇总：暂无可度量样本（全为 not_measurable / no_next_state）');
    }
  }

  if (anchorsTotal === 0) {
    console.log(`近 ${days} 天没有任何难度调整锚点（说明：只有出现降档/升档理由时才会留痕）。`);
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
