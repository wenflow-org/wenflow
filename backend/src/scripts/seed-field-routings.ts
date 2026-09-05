/**
 * 字段路由表 seed CLI（CI / 手动执行）
 *
 * 用途：在空库（或已有库）上把 agent_contracts / field_definitions /
 * agent_field_routings 三张表种到与 seed 声明一致。
 * - upsert 语义与启动期 bootstrapFieldRoutings 完全一致（只建不更新，保留 admin 编辑）
 * - 不触碰 agent_prompts（那是 prompts:sync-core 的职责）
 *
 * 用法：npx ts-node src/scripts/seed-field-routings.ts
 */

import systemPrisma from '../config/system-database';
import { bootstrapFieldRoutings } from '../services/field-routing-bootstrap.service';

async function main() {
  const result = await bootstrapFieldRoutings({ database: systemPrisma as any });
  console.log(
    JSON.stringify({
      success: true,
      goal: result.goal,
      path: result.path,
      teaching: result.teaching,
      profile: result.profile,
      simulation: result.simulation,
    }, null, 2)
  );
}

main()
  .catch((error) => {
    console.error('[seed-field-routings] 失败', error);
    process.exit(1);
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });
