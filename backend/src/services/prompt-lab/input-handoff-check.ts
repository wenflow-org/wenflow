/**
 * inputs 声明 ↔ 字段路由 handoff 对账（§2.5 advisory 守门）
 *
 * 规则：core 声明的每个 input ref skill:Y.F，上游 skill:Y 的路由表中应存在
 * 与 F 前缀匹配的字段行，且 handoff 包含本 skill。
 * 对不上不阻断（路由表可能滞后于业务演进），以 advisory 告警呈现。
 */
import { getAgentRoutings } from '../field-dispatcher';
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
 * 对账单个 input ref。返回 null 表示通过；否则返回告警。
 */
export async function checkInputRefHandoff(
  core: CoreFile,
  input: CoreInputRef
): Promise<GateIssue | null> {
  const upstreamAgentId = `skill:${input.skill}`;
  const downstreamAgentId = `skill:${core.skillId}`;
  const routings = await getAgentRoutings(upstreamAgentId).catch(() => []);

  if (!routings.length) {
    return {
      code: 'input-upstream-unrouted',
      message: `「${input.ref}」上游 ${upstreamAgentId} 没有任何字段路由登记，无法核对 handoff（advisory）`,
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

/** 对账 core 的全部 inputs 声明；返回 advisory 告警列表（通过为空数组） */
export async function checkInputHandoffs(core: CoreFile): Promise<GateIssue[]> {
  if (!core.inputs?.length) return [];
  const issues = await Promise.all(core.inputs.map((input) => checkInputRefHandoff(core, input)));
  return issues.filter((issue): issue is GateIssue => issue !== null);
}
