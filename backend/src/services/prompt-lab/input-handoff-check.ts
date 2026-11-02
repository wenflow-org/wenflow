/**
 * inputs 声明 ↔ 字段路由 handoff 对账（§2.5 advisory 守门）
 *
 * 规则：core 声明的每个 input ref skill:Y.F，上游 skill:Y 的路由表中应存在
 * 与 F 前缀匹配的字段行，且 handoff 包含本 skill。
 * 对不上不阻断（路由表可能滞后于业务演进），以 advisory 告警呈现。
 *
 * 另含「声明边 ↔ 抽取器」对账（#189）：配置式跨阶段交接声明的 handoff 行，
 * 必须落在对应抽取器实际读取的 agentId 集合内，否则该声明在运行时永远抽不到值。
 */
import {
  getAgentRoutings,
  listConfigDrivenStageHandoffs,
  type FieldRoutingRow,
} from '../field-dispatcher';
import { getAgentOfSkill, getCanonicalAgentId } from '../agent-manifest.service';
import type { CoreFile, CoreInputRef } from './core-file-loader';
import type { GateIssue } from './core-compiler';

function fieldMatches(routingFieldId: string, refFieldPath: string): boolean {
  return (
    routingFieldId === refFieldPath ||
    routingFieldId.startsWith(`${refFieldPath}.`) ||
    refFieldPath.startsWith(`${routingFieldId}.`)
  );
}

/**
 * 对账单个 input ref（§2.5 三前缀分叉）：
 * - skill:Y.F：校验上游 skill/agent 路由表存在匹配字段且 handoff 包含本 skill
 * - sandbox:<path>：校验沙盘路径注册表（AgentContractView）
 * - user:<path>：绿灯（自文档化，运行时由执行信封承载）
 * 返回 null 表示通过；否则返回告警。
 */
export async function checkInputRefHandoff(
  core: CoreFile,
  input: CoreInputRef
): Promise<GateIssue | null> {
  if (input.kind === 'user') {
    return null; // user: 前缀绿灯
  }
  if (input.kind === 'sandbox') {
    return checkSandboxPath(input.ref.replace(/^sandbox:/, ''), input.ref);
  }
  const upstreamSkillId = `skill:${input.skill}`;
  const downstreamAgentId = `skill:${core.skillId}`;
  // 路由行可能挂在 skill 名下，也可能挂在编排层 agent 名下（如 normalizedInput/previousMilestone
  // 由 path-agent 确定性定帧）——先查 skill 行，再查其所属 agent 行兜底
  const upstreamOwnerIds = [
    upstreamSkillId,
    getAgentOfSkill(upstreamSkillId)?.id || '',
  ].filter(Boolean);
  const routings = (await Promise.all(
    upstreamOwnerIds.map((agentId) => getAgentRoutings(agentId).catch(() => []))
  )).flat() as FieldRoutingRow[];

  if (!routings.length) {
    return {
      code: 'input-upstream-unrouted',
      message: `「${input.ref}」上游 ${upstreamSkillId}（含所属 agent）没有任何字段路由登记，无法核对 handoff（advisory）`,
    };
  }

  const matched = routings.filter((row) => fieldMatches(row.fieldId, input.fieldPath));
  if (!matched.length) {
    return {
      code: 'input-field-unrouted',
      message: `「${input.ref}」上游路由表没有与 ${input.fieldPath} 匹配的字段（advisory）`,
    };
  }

  const handedOff = matched.filter((row) => row.handoff.includes(downstreamAgentId));
  if (!handedOff.length) {
    return {
      code: 'input-no-handoff',
      message:
        `「${input.ref}」上游路由表有该字段，但 handoff 未包含 ${downstreamAgentId}` +
        `（已登记 handoff：${[...new Set(matched.flatMap((r) => r.handoff))].join('、') || '无'}；advisory）`,
    };
  }
  return null;
}

/** sandbox: 路径对账：对照沙盘路径注册表（AgentContractView 动态推导 + 静态补充键） */
async function checkSandboxPath(path: string, ref: string): Promise<GateIssue | null> {
  const { validateSandboxPath } = await import('../agent-contract-view');
  const error = await validateSandboxPath(path);
  if (error) {
    return { code: 'sandbox-path-unregistered', message: `「${ref}」${error}（advisory）` };
  }
  return null;
}

/** 对账 core 的全部 inputs 声明；返回 advisory 告警列表（通过为空数组） */
export async function checkInputHandoffs(core: CoreFile): Promise<GateIssue[]> {
  if (!core.inputs?.length) return [];
  const issues = await Promise.all(core.inputs.map((input) => checkInputRefHandoff(core, input)));
  return issues.filter((issue): issue is GateIssue => issue !== null);
}

/** 编排文件里一张 stage 的路由声明（结构最小化，便于注入测试） */
export interface StageRoutingDecl {
  stage: string;
  routings: ReadonlyArray<{ agentId: string; fieldId: string; handoff?: string[] }>;
}

/**
 * 声明边 ↔ 抽取器对账（#189）：对每个登记在册的配置式跨阶段交接抽取器，
 * 检查其 source 阶段内所有 handoff 指向 target 阶段的行，是否都落在抽取器
 * 实际读取的 agentId 集合内。落在范围外 = 该交接声明运行时不生效（静默失效）。
 */
export function checkConfigDrivenStageHandoffCoverage(
  stages: ReadonlyArray<StageRoutingDecl>,
): GateIssue[] {
  const issues: GateIssue[] = [];
  for (const extractor of listConfigDrivenStageHandoffs()) {
    const stage = stages.find((s) => s.stage === extractor.sourceStage);
    if (!stage) {
      issues.push({
        code: 'handoff-extractor-source-stage-missing',
        message:
          `抽取器 ${extractor.extractor} 登记的来源阶段「${extractor.sourceStage}」在编排文件中不存在，` +
          `声明边无法与其对账`,
      });
      continue;
    }
    const scope = new Set(extractor.sourceAgentIds());
    for (const row of stage.routings) {
      if (!(row.handoff || []).includes(extractor.targetStage)) continue;
      if (scope.has(getCanonicalAgentId(row.agentId))) continue;
      issues.push({
        code: 'declared-handoff-not-extractable',
        message:
          `${row.agentId}/${row.fieldId} 声明 handoff→${extractor.targetStage}，` +
          `但抽取器 ${extractor.extractor} 只读 [${[...scope].join('、')}]，该交接声明运行时不生效`,
      });
    }
  }
  return issues;
}
