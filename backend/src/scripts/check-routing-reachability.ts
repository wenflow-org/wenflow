/**
 * prompts:reachability:check —— routing 可达性声明的静态门禁（#200，纯静态、零 DB）
 *
 * 背景（#184）：`simulation.yaml` 的 13 条 VL 审计 routing 已按 `reachability: manual|external`
 * 标注（永久死边改为显式的人工/外部入口声明）；但**其余 routing 仍靠缺省 auto**，
 * 没有任何 CI 断言能拦住「新加一条永远不被自动链调用的 routing」——它只会以运行时死边
 * （audit-field-hit-rates / audit-handoff-edges，需 DB + 观测窗口）的形式被人看见。
 *
 * 本门禁把这件事前移到声明层（读 prompts/orchestration/*.yaml，不碰 DB、不开服务）：
 *   ① 每条受管辖 routing 必须 = 显式 `reachability: manual|external`
 *                          或 notes 里 `auto — <入口说明>` 登记「已确认默认主链可达，入口是 X」；
 *   ② 未接入词表的阶段必须在 UNGOVERNED_STAGE_REGISTRY 里显式登记理由；
 *   ③ stage 名不得在多个编排文件里重复（登记表以 stage 字符串为键，重名即失效）；
 *   ④ routing 清单必须与基线一致——往**已登记**阶段里加一条边同样要显式认领
 *      （复核绕过 1：没有 ④ 时 goal 78→79 只进公示计数，门禁原样放行）。
 *   ④ 要更新基线时用 `--update-baseline`（这是一次显式动作，diff 会留在 PR 里）。
 *
 * 范围与口径见 services/field-routing/routing-reachability.ts。
 *
 * 用法：npm run prompts:reachability:check（已挂入 prompts:check:all → check:quality）
 *      npm run prompts:reachability:baseline:update（仅在有意的声明变更后执行）
 */
import fs from 'fs';
import path from 'path';
import { ORCHESTRATION_DIR, loadOrchestrationFiles } from '../services/field-routing/orchestration-file';
import {
  buildRoutingInventory,
  collectRoutingReachabilityGaps,
  diffRoutingInventory,
  formatRoutingInventoryDrift,
  formatRoutingReachabilityReport,
} from '../services/field-routing/routing-reachability';

const TAG = '[routing:reachability]';
/** 清单基线：与编排文件同目录、`_` 前缀（loader 只收 .yaml/.yml，不会把它当阶段文件） */
export const ROUTING_INVENTORY_BASELINE = path.join(ORCHESTRATION_DIR, '_reachability-baseline.json');

function readBaseline(): Record<string, string[]> | null {
  try {
    return JSON.parse(fs.readFileSync(ROUTING_INVENTORY_BASELINE, 'utf8')) as Record<string, string[]>;
  } catch {
    return null;
  }
}

function fail(lines: string[]): void {
  for (const line of lines) console.error(`${TAG} ${line}`);
  process.exitCode = 1;
}

function main(): void {
  const stages = loadOrchestrationFiles();
  const inventory = buildRoutingInventory(stages);

  if (process.argv.includes('--update-baseline')) {
    fs.writeFileSync(ROUTING_INVENTORY_BASELINE, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    console.log(`${TAG} 已更新清单基线：${ROUTING_INVENTORY_BASELINE}`);
    return;
  }

  const report = collectRoutingReachabilityGaps(stages);

  if (report.violations.length > 0 || report.unregisteredStages.length > 0 || report.duplicateStages.length > 0) {
    fail(formatRoutingReachabilityReport(report).split('\n'));
    console.error(
      `${TAG} FAIL：${report.violations.length} 条 routing 未声明可达性`
      + `、${report.unregisteredStages.length} 个阶段未登记口径`
      + `、${report.duplicateStages.length} 个阶段名重复`,
    );
    return;
  }

  const baseline = readBaseline();
  if (!baseline) {
    fail([
      `清单基线缺失或不可解析：${ROUTING_INVENTORY_BASELINE}`,
      '  ← 跑 npm run prompts:reachability:baseline:update 生成（这是一次显式认领，diff 会进 PR）',
    ]);
    return;
  }
  const drift = diffRoutingInventory(baseline, inventory);
  if (drift.length > 0) {
    fail(formatRoutingInventoryDrift(drift).split('\n'));
    console.error(`${TAG} FAIL：routing 清单较基线漂移（新增/删除都要显式认领）`);
    return;
  }

  for (const line of formatRoutingReachabilityReport(report).split('\n')) {
    console.log(`${TAG} ${line}`);
  }
  console.log(
    `${TAG} OK：${stages.length} 个 stage / ${report.governedStages.length} 个受管辖阶段`
    + `，未声明 0 条、清单与基线一致（${Object.values(inventory).reduce((n, pairs) => n + pairs.length, 0)} 条）`,
  );
}

if (require.main === module) {
  main();
}
