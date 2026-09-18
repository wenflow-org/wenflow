/**
 * 编排交接边用量审计（**只读**：不写库、不迁移、不调 LLM）
 *
 * 升级方向 Q9：编排拓扑当前只有节点级运行时调用量，边（handoff）没有数据。
 * 本脚本按真实列聚合 `agent_call_logs` 的 (callerAgent → agentId) 边，并对照
 * `prompts/orchestration/*.yaml` 的声明边，输出：
 *   - 命中率最高的交接边（调用数 / 失败数 / 末次出现）
 *   - 声明了但窗口内零命中的边（死边候选）
 *   - 运行了但 YAML 未声明的边（幽灵边候选）
 *   - GO / NO-GO 结论（运行边是否足以支撑后续在拓扑图上展示边用量）
 *
 * 数据列（核对 prisma/schema.prisma:32 `model agent_call_logs`）：
 *   - callee = `agentId`（skill span 形如 `skill:<skillId>`）
 *   - caller = `callerAgent`
 *   - `success` / `calledAt`
 *   写入点：skills/executor.ts（skill span）、gateway/api-gateway/executor.ts（网关行）。
 *
 * 口径说明：
 *   - 默认剔除基础设施边：callee=`api-gateway`（LLM 网关行，非编排交接）、caller=`system-canary`（健康探针）。
 *   - 阶段别名（teaching/profile/path/goal/simulation）在声明侧归一化到该阶段编排 agent。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-handoff-edges.ts [--days=30] [--top=15] [--limit=200000] [--json]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';
import {
  aggregateHandoffEdgeUsage,
  compareDeclaredVsUsed,
  extractDeclaredHandoffEdges,
  handoffEdgeKey,
  handoffPairKey,
  type HandoffEdgeUsage,
} from '../services/topology/handoff-edge-usage';

/** 非编排交接的基础设施调用方 / 被调方，默认从对比与榜单中剔除 */
const EXCLUDED_CALLERS = new Set(['system-canary']);
const EXCLUDED_CALLEES = new Set(['api-gateway']);

interface Args {
  days: number;
  top: number;
  limit: number;
  json: boolean;
  directed: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { days: 30, top: 15, limit: 200000, json: false, directed: false };
  for (const raw of argv) {
    const [key, value] = raw.split('=');
    if (key === '--days' && value) args.days = Math.max(1, Number(value) || 30);
    if (key === '--top' && value) args.top = Math.max(1, Number(value) || 15);
    if (key === '--limit' && value) args.limit = Math.max(1, Number(value) || 200000);
    if (raw === '--json') args.json = true;
    if (raw === '--directed') args.directed = true;
  }
  return args;
}

function isOrchestrationEdge(edge: HandoffEdgeUsage): boolean {
  return !EXCLUDED_CALLERS.has(edge.caller) && !EXCLUDED_CALLEES.has(edge.callee);
}

function fmtTime(value: Date | null): string {
  return value ? value.toISOString().slice(0, 19).replace('T', ' ') : '-';
}

function fmtEdge(edge: HandoffEdgeUsage): string {
  const rate = edge.successRate === null ? '-' : `${edge.successRate}%`;
  return `${edge.key.padEnd(56)} 调用 ${String(edge.calls).padStart(6)} 次 | 失败 ${String(edge.failures).padStart(5)} | 成功 ${rate.padStart(6)} | 末次 ${fmtTime(edge.lastSeenAt)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

  const [rows, stages] = await Promise.all([
    prisma.agent_call_logs.findMany({
      where: { calledAt: { gte: since } },
      select: { callerAgent: true, agentId: true, success: true, calledAt: true },
      orderBy: { calledAt: 'desc' },
      take: args.limit,
    }),
    Promise.resolve(loadOrchestrationFiles()),
  ]);

  const aggregation = aggregateHandoffEdgeUsage(rows, { since });
  const orchestrationEdges = aggregation.edges.filter(isOrchestrationEdge);
  const excludedEdgeCount = aggregation.edges.length - orchestrationEdges.length;

  if (args.json) {
    const comparison = compareDeclaredVsUsed(extractDeclaredHandoffEdges(stages), orchestrationEdges, { undirected: !args.directed });
    console.log(JSON.stringify({
      since: since.toISOString(),
      days: args.days,
      matching: args.directed ? 'directed' : 'undirected-pair',
      columns: { caller: 'agent_call_logs.callerAgent', callee: 'agent_call_logs.agentId', time: 'agent_call_logs.calledAt', success: 'agent_call_logs.success' },
      stats: {
        totalRows: aggregation.totalRows,
        consideredRows: aggregation.consideredRows,
        skippedOutOfWindow: aggregation.skippedOutOfWindow,
        skippedInvalidTime: aggregation.skippedInvalidTime,
        skippedMissingCaller: aggregation.skippedMissingCaller,
        skippedMissingCallee: aggregation.skippedMissingCallee,
        excludedInfraEdges: excludedEdgeCount,
        declaredEdges: comparison.declaredEdges.length,
        matchedEdges: comparison.matchedEdgeCount,
        declaredButNeverUsed: comparison.declaredButNeverUsed.length,
        usedButUndeclared: comparison.usedButUndeclared.length,
      },
      topEdges: orchestrationEdges.slice(0, args.top).map((edge) => ({
        caller: edge.caller, callee: edge.callee, key: edge.key,
        calls: edge.calls, failures: edge.failures, successRate: edge.successRate, lastSeenAt: edge.lastSeenAt,
      })),
      declaredButNeverUsed: comparison.declaredButNeverUsed.slice(0, args.top),
      usedButUndeclared: comparison.usedButUndeclared.slice(0, args.top).map((edge) => ({ key: edge.key, calls: edge.calls, failures: edge.failures })),
    }, null, 2));
    return;
  }

  console.log(`== 编排交接边用量审计（近 ${args.days} 天）==`);
  console.log(`声明源：prompts/orchestration/*.yaml（${stages.length} 个 stage）｜只读，未写入任何数据`);
  console.log(`数据列：caller=agent_call_logs.callerAgent｜callee=agent_call_logs.agentId｜time=calledAt｜success=success`);
  console.log(
    `窗口内日志 ${aggregation.totalRows} 行｜可用 ${aggregation.consideredRows} 行` +
    `｜窗口外 ${aggregation.skippedOutOfWindow}｜时间非法 ${aggregation.skippedInvalidTime}` +
    `｜缺调用方 ${aggregation.skippedMissingCaller}｜缺被调方 ${aggregation.skippedMissingCallee}`,
  );

  const matchingMode = args.directed ? '有向边' : '无向配对';
  const comparison = compareDeclaredVsUsed(extractDeclaredHandoffEdges(stages), orchestrationEdges, { undirected: !args.directed });

  console.log(`\n-- 运行交接边 Top ${Math.min(args.top, orchestrationEdges.length)}（已剔除网关/探针 ${excludedEdgeCount} 条）--`);
  if (orchestrationEdges.length === 0) {
    console.log('  (无)');
  } else {
    for (const edge of orchestrationEdges.slice(0, args.top)) console.log(`  ${fmtEdge(edge)}`);
  }

  console.log(`\n-- 声明 vs 运行（匹配口径：${matchingMode}）--`);
  console.log(`  声明边 ${comparison.declaredEdges.length} 条｜命中 ${comparison.matchedEdgeCount} 条｜运行边 ${comparison.usedEdgeCount} 条`);
  if (!args.directed) {
    console.log('  说明：声明是数据交付方向（产出方→消费方），日志是调用方向（调用方→被调方），二者常相反，故默认按无向配对匹配。');
  }
  console.log(`  声明但窗口内零命中（死边候选）：${comparison.declaredButNeverUsed.length} 条`);
  for (const edge of comparison.declaredButNeverUsed.slice(0, args.top)) {
    const key = args.directed ? handoffEdgeKey(edge.caller, edge.callee) : handoffPairKey(edge.caller, edge.callee);
    console.log(`    · ${key}  ← ${edge.stage} / ${edge.fields.length} 字段`);
  }
  console.log(`  运行但未声明（幽灵边候选）：${comparison.usedButUndeclared.length} 条`);
  for (const edge of comparison.usedButUndeclared.slice(0, args.top)) {
    console.log(`    · ${edge.key}  调用 ${edge.calls} 次｜失败 ${edge.failures}`);
  }

  console.log(`\n-- GO / NO-GO --`);
  if (aggregation.consideredRows === 0) {
    console.log('  NO-GO：窗口内没有带 callerAgent 的可用日志，边上无运行时数据可展示。');
  } else if (comparison.matchedEdgeCount === 0) {
    console.log('  NO-GO：声明边与运行边零命中，两端标识口径可能不一致，不宜直接上图。');
  } else {
    console.log(`  GO：运行边可聚合，且命中声明边 ${comparison.matchedEdgeCount} 条；可据此在拓扑图上标注边用量。`);
    if (comparison.declaredButNeverUsed.length > 0) {
      console.log(`  注意：仍有 ${comparison.declaredButNeverUsed.length} 条声明边零命中（可能为死边或阶段级交接未落日志）。`);
    }
    if (comparison.usedButUndeclared.length > 0) {
      console.log(`  注意：有 ${comparison.usedButUndeclared.length} 条运行边未在 YAML 声明（补声明或确认基础设施）。`);
    }
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[audit-handoff-edges] 失败：', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
