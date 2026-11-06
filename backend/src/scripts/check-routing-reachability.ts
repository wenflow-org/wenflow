/**
 * prompts:reachability:check —— routing 可达性声明的静态门禁（#200，纯静态、零 DB）
 *
 * 背景（#184）：`simulation.yaml` 的 13 条 VL 审计 routing 已按 `reachability: manual|external`
 * 标注（永久死边改为显式的人工/外部入口声明）；但**其余 routing 仍靠缺省 auto**，
 * 没有任何 CI 断言能拦住「新加一条永远不被自动链调用的 routing」——它只会以运行时死边
 * （audit-field-hit-rates / audit-handoff-edges，需 DB + 观测窗口）的形式被人看见。
 *
 * 本门禁把这件事前移到声明层（读 prompts/orchestration/*.yaml，不碰 DB、不开服务）：
 *   每条受管辖 routing 必须 = 显式 `reachability: manual|external`
 *                       或 notes 里 `auto — <入口说明>` 登记「已确认默认主链可达，入口是 X」；
 *   二者皆无 → 失败并逐条列出（stage / agentId / fieldId）。
 *
 * 范围与口径见 services/field-routing/routing-reachability.ts（受管辖阶段 = 已启用词表的阶段；
 * 未接入词表的阶段必须登记在 UNGOVERNED_STAGE_REGISTRY 里，未登记即失败）。
 *
 * 用法：npm run prompts:reachability:check（已挂入 prompts:check:all → check:quality）
 */
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';
import {
  collectRoutingReachabilityGaps,
  formatRoutingReachabilityReport,
} from '../services/field-routing/routing-reachability';

const TAG = '[routing:reachability]';

function main(): void {
  const stages = loadOrchestrationFiles();
  const report = collectRoutingReachabilityGaps(stages);

  if (report.violations.length > 0 || report.unregisteredStages.length > 0) {
    for (const line of formatRoutingReachabilityReport(report).split('\n')) {
      console.error(`${TAG} ${line}`);
    }
    console.error(
      `${TAG} FAIL：${report.violations.length} 条 routing 未声明可达性`
      + `、${report.unregisteredStages.length} 个阶段未登记口径`,
    );
    process.exitCode = 1;
    return;
  }

  for (const line of formatRoutingReachabilityReport(report).split('\n')) {
    console.log(`${TAG} ${line}`);
  }
  console.log(`${TAG} OK：${stages.length} 个 stage / ${report.governedStages.length} 个受管辖阶段，未声明 0 条`);
}

if (require.main === module) {
  main();
}
