/**
 * inputs 声明 ↔ 字段路由 handoff 双向对账（fail-fast 模式）
 *
 * 规则：每个 core 文件的 inputs ref（skill:Y.F）必须能在上游 Y 的路由表中
 * 找到匹配字段且 handoff 包含本 skill。
 * - 默认模式（--strict 缺省关闭）：问题以 warn 输出，退出码 0
 * - --strict：任何问题都失败（退出码 1），供 CI / 发布门禁用
 *
 * 用法：npx ts-node src/scripts/check-input-handoffs.ts [--strict]
 */

import { scanCoreFiles } from '../services/prompt-lab/core-file-loader';
import { checkInputHandoffs } from '../services/prompt-lab/input-handoff-check';
import type { GateIssue } from '../services/prompt-lab/core-compiler';
import { bootstrapFieldRoutings } from '../services/field-routing-bootstrap.service';
import systemPrisma from '../config/system-database';

async function main() {
  // 检查前先同步字段路由表到 DB（避免 CI 中种子步骤与检查步骤脱节）
  await bootstrapFieldRoutings({ database: systemPrisma as any });
  const strict = process.argv.includes('--strict');
  const { files } = scanCoreFiles();
  const issues: Array<{ skillId: string; issue: GateIssue }> = [];

  for (const core of files) {
    const found = await checkInputHandoffs(core);
    for (const issue of found) {
      issues.push({ skillId: core.skillId, issue });
    }
  }

  if (issues.length > 0) {
    for (const { skillId, issue } of issues) {
      console.log(`[${issue.code}] ${skillId}: ${issue.message}`);
    }
    console.log(`\ninputs↔handoff 对账：${issues.length} 个问题（${strict ? 'strict 模式，判定失败' : 'advisory'}）`);
    if (strict) process.exit(1);
  } else {
    console.log(`inputs↔handoff 对账：${files.length} 个核心文件全部通过`);
  }
}

main().catch((error) => {
  console.error('[check-input-handoffs] 执行失败', error);
  process.exit(1);
});
