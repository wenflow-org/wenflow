/**
 * 字段路由清理脚本
 * 删除所有旧的 field_definitions / agent_contracts / agent_field_routings
 * 为新的 skill 粒度种子重做清空跑道
 *
 * 用法：npx ts-node --transpile-only src/scripts/cleanup-field-routings.ts
 */

import systemPrisma from '../config/system-database';

async function main() {
  console.log('=== 清理旧字段路由数据 ===\n');

  const [routingCount, contractCount, fieldCount] = await Promise.all([
    systemPrisma.agent_field_routings.count(),
    systemPrisma.agent_contracts.count(),
    systemPrisma.field_definitions.count()
  ]);

  console.log(`当前数据: ${routingCount} routings, ${contractCount} contracts, ${fieldCount} fields\n`);

  await systemPrisma.agent_field_routings.deleteMany();
  console.log(`  agent_field_routings: 已删除 ${routingCount} 行`);

  await systemPrisma.agent_contracts.deleteMany();
  console.log(`  agent_contracts: 已删除 ${contractCount} 行`);

  await systemPrisma.field_definitions.deleteMany();
  console.log(`  field_definitions: 已删除 ${fieldCount} 行`);

  console.log('\n=== 清理完成，下次启动时 seed 将重新创建 skill 粒度字段路由 ===');
}

main()
  .catch(e => { console.error('清理失败:', e); process.exit(1); })
  .finally(async () => await systemPrisma.$disconnect());