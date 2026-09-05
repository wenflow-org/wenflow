/**
 * 孤儿字段路由一次性清理（2026-08 单源化收尾）
 * 背景：漂移清零后，DB 三表中存在编排文件未声明的孤儿行（seed 时代声明移除的残留）：
 *   - field_definitions 24 条（*Narrative/Note/Pattern 系列、extractorTransferSignals、
 *     displayLabel/shortLabel/labelIcon/labelColor）
 *   - agent_field_routings 14 条（全部为 profile-agent 名下上述孤儿字段的路由）
 * 处置前已逐一 grep 全仓库 backend/src 与 frontend/src（排除 generated/ 与 .playwright-mcp）：
 * 24 个 fieldId 均无定向消费（narrativeInsights 键为 profile-aggregator 代码计算值，
 * 不经 field_definitions 表；displayLabel 仅存在于任务(task)记录，与字段路由表无关）。
 * 结论：删除 DB 行，不补声明。
 * 备份：prisma/system.db.backup-20260809-orphan-cleanup.bak
 *
 * 用法：npx ts-node --transpile-only src/scripts/cleanup-orphan-field-routings.ts
 */

import systemPrisma from '../config/system-database';

const ORPHAN_FIELD_IDS = [
  'goalNarrative',
  'backgroundContextNote',
  'motivationNarrative',
  'timeConstraintNote',
  'selfAssessmentNote',
  'contentReceptionPattern',
  'practicePreferenceNote',
  'frictionPatternNote',
  'effectiveTeachingPattern',
  'supportStyleNote',
  'taskGranularityNote',
  'backgroundNarrative',
  'baselineNarrative',
  'learningContextNarrative',
  'learningPreferenceNarrative',
  'teachingModeNarrative',
  'cognitiveStyleNarrative',
  'pacingNarrative',
  'motivationLeverNarrative',
  'extractorTransferSignals',
  'displayLabel',
  'shortLabel',
  'labelIcon',
  'labelColor',
];

async function main() {
  console.log('=== 清理孤儿字段路由（单源化收尾）===\n');

  const fieldsBefore = await systemPrisma.field_definitions.findMany({
    where: { fieldId: { in: ORPHAN_FIELD_IDS } },
    select: { fieldId: true },
  });
  const routingsBefore = await systemPrisma.agent_field_routings.findMany({
    where: { fieldId: { in: ORPHAN_FIELD_IDS } },
    select: { agentId: true, fieldId: true },
  });

  console.log(`待删 field_definitions: ${fieldsBefore.length} 条`);
  console.log(`待删 agent_field_routings: ${routingsBefore.length} 条`);

  if (fieldsBefore.length !== 24 || routingsBefore.length !== 14) {
    throw new Error(`孤儿行数量与预期不符（fields=${fieldsBefore.length}/24, routings=${routingsBefore.length}/14），中止`);
  }

  const routingDelete = await systemPrisma.agent_field_routings.deleteMany({
    where: { fieldId: { in: ORPHAN_FIELD_IDS } },
  });
  console.log(`  agent_field_routings: 已删除 ${routingDelete.count} 行`);

  const fieldDelete = await systemPrisma.field_definitions.deleteMany({
    where: { fieldId: { in: ORPHAN_FIELD_IDS } },
  });
  console.log(`  field_definitions: 已删除 ${fieldDelete.count} 行`);

  const [fieldsLeft, routingsLeft] = await Promise.all([
    systemPrisma.field_definitions.count(),
    systemPrisma.agent_field_routings.count(),
  ]);
  console.log(`\n清理后：field_definitions=${fieldsLeft} 条, agent_field_routings=${routingsLeft} 条`);
  console.log('=== 清理完成 ===');
}

main()
  .catch((e) => {
    console.error('清理失败:', e);
    process.exit(1);
  })
  .finally(async () => await systemPrisma.$disconnect());
