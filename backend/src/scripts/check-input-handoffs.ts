/**
 * inputs 声明 ↔ 字段路由 handoff 双向对账（fail-fast 模式）
 *
 * 规则：每个 core 文件的 inputs ref（skill:Y.F）必须能在上游 Y 的路由表中
 * 找到匹配字段且 handoff 包含本 skill。
 * 另含「声明边 ↔ 抽取器」对账（#189）：配置式跨阶段交接的 handoff 行
 * 必须落在对应抽取器实际读取的 agentId 集合内。
 * 另含「规则引用键 ↔ inputs 声明」对账（#197）：规则正文点路径引用的数据键，
 * 其根必须能在本文件声明层定位到，或已在 RULE_KEY_SOURCES 登记归属与证据。
 * 另含「契约闭环」对账（#199）：实参（装配层 handoff 交付键）↔ 输入声明、
 * handoff 目标的消费者存在性、被消费字段的产出方契约——把门禁从声明层推进到
 * 声明↔装配↔产出三方。另补两条纯函数判据：
 *   4) 盲区 1 反向死声明：core 声明消费某字段、自动链上该字段有产出行却从不 handoff
 *      给该 skill/所属 agent ⇒ skill-input-dead-declaration；
 *   5) 盲区 3 sandbox ref 语义：sandbox: ref 的 agent 必须是顶层 5 agent，键必须解析到
 *      已登记的投影/快照键 ⇒ sandbox-ref-unregistered。
 * 已知 debt：盲区 2（manifest 登记但无真实装配代码）本轮不做，静态判据看不到
 * 「声明→TS 代码」，见 contract-closure-check.ts 头注释。
 * - 默认模式（--strict 缺省关闭）：问题以 warn 输出，退出码 0
 * - --strict：任何问题都失败（退出码 1），供 CI / 发布门禁用
 *
 * 用法：npx ts-node src/scripts/check-input-handoffs.ts [--strict]
 */

import { scanCoreFiles } from '../services/prompt-lab/core-file-loader';
import {
  checkConfigDrivenStageHandoffCoverage,
  checkInputHandoffs,
  checkRuleInputDeclarations,
} from '../services/prompt-lab/input-handoff-check';
import type { GateIssue } from '../services/prompt-lab/core-compiler';
import { checkContractClosure } from '../services/prompt-lab/contract-closure-check';
import { bootstrapFieldRoutings } from '../services/field-routing-bootstrap.service';
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';
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
    // 规则引用键 ↔ inputs 声明对账（#197）：规则依赖的键必须在声明层可见
    for (const issue of checkRuleInputDeclarations(core)) {
      issues.push({ skillId: core.skillId, issue });
    }
  }

  // 声明边 ↔ 抽取器对账（全局，非按 core 文件）
  for (const issue of checkConfigDrivenStageHandoffCoverage(loadOrchestrationFiles())) {
    issues.push({ skillId: '声明↔抽取器对账', issue });
  }

  // 契约闭环（#199）：实参↔声明、handoff 消费者存在性、产出↔消费闭环
  for (const issue of checkContractClosure({ stages: loadOrchestrationFiles(), cores: files })) {
    issues.push({ skillId: '契约闭环对账', issue });
  }

  if (issues.length > 0) {
    for (const { skillId, issue } of issues) {
      console.log(`[${issue.code}] ${skillId}: ${issue.message}`);
    }
    console.log(`\ninputs↔handoff / 声明↔抽取器 / 契约闭环 对账：${issues.length} 个问题（${strict ? 'strict 模式，判定失败' : 'advisory'}）`);
    if (strict) process.exit(1);
  } else {
    console.log(`inputs↔handoff / 声明↔抽取器 / 契约闭环 对账：${files.length} 个核心文件全部通过`);
  }
}

main().catch((error) => {
  console.error('[check-input-handoffs] 执行失败', error);
  process.exit(1);
});
