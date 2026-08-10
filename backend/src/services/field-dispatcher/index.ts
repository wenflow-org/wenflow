/**
 * AgentFieldDispatcher (V3 §5)
 * ============================================================
 * 字段调度引擎：根据 agent_field_routings 表，
 * 决定某编排器视角下的 envelope 应该包含哪些字段。
 *
 * 现有「硬编码 envelope」逻辑（envelopeGoalConversation /
 * buildGoalPathVisibleSummary）将逐步被本服务替代。
 *
 * 当前阶段（PoC）：
 *   - 提供一个 dispatchEnvelope() 方法，跑出符合路由表的 envelope
 *   - 旧 envelopeGoalConversation 通过 feature flag 决定是否切换
 *   - 写日志对比两种 envelope 的差异（漂移检测）
 */

import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import { getCanonicalAgentId } from '../agent-manifest.service';

export type RenderValue = 'visible' | 'hidden';

export interface FieldRoutingRow {
  agentId: string;
  fieldId: string;
  render: RenderValue;
  handoff: string[];
  internal: boolean;
  accumulate: boolean;
  notes?: string | null;
  promptRole?: string;
  valueType?: string;
  /** 值抽取路径（field_definitions.pathInRawOutput）：字段值在产出方原始输出中的物理位置 */
  pathInRawOutput?: string | null;
}

interface CachedRoutings {
  loadedAt: number;
  /** agentId → fieldId → row */
  byAgent: Map<string, Map<string, FieldRoutingRow>>;
}

const ROUTING_CACHE_TTL_MS = 30 * 1000;
let cache: CachedRoutings | null = null;

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function loadRoutings(): Promise<CachedRoutings> {
  if (cache && Date.now() - cache.loadedAt < ROUTING_CACHE_TTL_MS) {
    return cache;
  }

  const [routings, fields] = await Promise.all([
    systemPrisma.agent_field_routings.findMany(),
    systemPrisma.field_definitions.findMany(),
  ]);

  const fieldMap = new Map<string, { promptRole: string; valueType: string; pathInRawOutput: string | null }>();
  for (const f of fields) {
    fieldMap.set(f.fieldId, { promptRole: f.promptRole, valueType: f.valueType, pathInRawOutput: f.pathInRawOutput ?? null });
  }

  const byAgent = new Map<string, Map<string, FieldRoutingRow>>();
  for (const r of routings) {
    // 路由表主键统一为 canonical id（skill: 前缀）；裸名/历史别名经 getCanonicalAgentId 归一，
    // 修复"seed 存 skill:goal-conversation、消费方查 goal-conversation 导致查空"的历史错位
    const canonicalAgentId = getCanonicalAgentId(r.agentId);
    let inner = byAgent.get(canonicalAgentId);
    if (!inner) {
      inner = new Map();
      byAgent.set(canonicalAgentId, inner);
    }
    const fieldMeta = fieldMap.get(r.fieldId);
    inner.set(r.fieldId, {
      agentId: canonicalAgentId,
      fieldId: r.fieldId,
      render: (r.render as RenderValue) || 'visible',
      handoff: safeParseJson<string[]>(r.handoff, []),
      internal: !!r.internalFlag,
      accumulate: !!r.accumulate,
      notes: r.notes,
      promptRole: fieldMeta?.promptRole,
      valueType: fieldMeta?.valueType,
      pathInRawOutput: fieldMeta?.pathInRawOutput ?? null,
    });
  }

  cache = { loadedAt: Date.now(), byAgent };
  return cache;
}

export function clearRoutingCache(): void {
  cache = null;
}

/**
 * 获取某编排器的所有路由（含锁信息）；入参自动 canonical 化
 */
export async function getAgentRoutings(
  agentId: string
): Promise<FieldRoutingRow[]> {
  const routings = await loadRoutings();
  const inner = routings.byAgent.get(getCanonicalAgentId(agentId));
  return inner ? Array.from(inner.values()) : [];
}

// ============================================================
// 配置式值抽取与组装（V3 Dispatcher 接线，P1 goal→path 试点）
// ============================================================

/**
 * 按 field_definitions.pathInRawOutput 从产出方原始 result 中抽取字段值。
 * 路径不存在/为空值时返回 null（与旧 flattenGoalResult 的"缺字段跳过"语义一致）。
 * 未登记 pathInRawOutput 的行跳过（不猜测路径）。
 */
export function extractFieldsByPath(
  result: any,
  rows: Array<{ fieldId: string; pathInRawOutput?: string | null }>
): Record<string, any> {
  const flat: Record<string, any> = {};
  for (const row of rows) {
    const path = row.pathInRawOutput;
    if (!path) continue;
    const value = path.split('.').reduce((cur: any, key) => (cur && typeof cur === 'object' ? cur[key] : undefined), result);
    if (value === undefined) continue;
    flat[row.fieldId] = value;
  }
  return flat;
}

/**
 * goal→path 交付字段组装（V3 §5.3 getHandoffInput 的配置化实现）：
 * 读 routings 表 goal-agent 名下 handoff 含 'path' 的行，按 pathInRawOutput
 * 从 goal skill 输出 result 抽取字段值，返回 fieldId → value 映射。
 * 仅使用路由声明，不依赖任何硬编码字段清单。
 * rowsOverride 用于测试/离线注入（缺省读 DB 路由表）。
 */
export async function assembleGoalHandoff(
  result: any,
  rowsOverride?: Array<{ fieldId: string; handoff: string[]; pathInRawOutput?: string | null }>
): Promise<{ fields: Record<string, any>; skipped: string[] }> {
  const rows = rowsOverride
    ? rowsOverride
    : Array.from((await loadRoutings()).byAgent.get('goal-agent')?.values() || []);
  const handingRows = rows.filter((row) => row.handoff.includes('path'));
  const fields = extractFieldsByPath(result, handingRows);
  const skipped = handingRows
    .filter((row) => fields[row.fieldId] === undefined)
    .map((row) => `${row.fieldId}(missing-or-unmapped)`);
  return { fields, skipped };
}

/**
 * stage-designer 跨轮上下文装配（配置式流转第三条链）：
 * 按 routings 表 path-agent 名下 handoff 含 skill:stage-designer 的编排注入行，
 * 从装配源 { milestone, previousMilestone, cognitiveCore, normalizedInput } 抽值。
 * 目前聚焦跨轮上下文（previousMilestone）；未登记路径/缺失的通道跳过。
 */
export async function assembleStageDesignerChannels(
  source: { previousMilestone?: any },
  rowsOverride?: Array<{ fieldId: string; handoff: string[]; pathInRawOutput?: string | null }>
): Promise<{ channels: Record<string, any>; skipped: string[] }> {
  const rows = rowsOverride
    ? rowsOverride
    : Array.from((await loadRoutings()).byAgent.get('path-agent')?.values() || []);
  const channelRows = rows.filter((row) => row.handoff.includes('skill:stage-designer'));
  const channels = extractFieldsByPath(source, channelRows);
  const skipped = channelRows
    .filter((row) => channels[row.fieldId] === undefined)
    .map((row) => `${row.fieldId}(missing-or-unmapped)`);
  return { channels, skipped };
}
export async function assembleTeachingTurnChannels(
  source: { session: any; teachingState: any; context: any },
  rowsOverride?: Array<{ fieldId: string; handoff: string[]; pathInRawOutput?: string | null }>
): Promise<{ channels: Record<string, any>; skipped: string[] }> {
  const rows = rowsOverride
    ? rowsOverride
    : Array.from((await loadRoutings()).byAgent.get('teaching-agent')?.values() || []);
  const channelRows = rows.filter((row) => row.handoff.includes('skill:teaching-turn'));
  const channels = extractFieldsByPath(source, channelRows);
  const skipped = channelRows
    .filter((row) => channels[row.fieldId] === undefined)
    .map((row) => `${row.fieldId}(missing-or-unmapped)`);
  return { channels, skipped };
}
