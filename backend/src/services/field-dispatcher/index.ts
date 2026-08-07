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

/**
 * 判定某字段在某编排器下的 render 状态
 * 缺省：visible（向后兼容旧字段未在路由表里登记的情况）
 */
export async function getFieldRender(
  agentId: string,
  fieldId: string
): Promise<RenderValue> {
  const routings = await loadRoutings();
  const r = routings.byAgent.get(getCanonicalAgentId(agentId))?.get(fieldId);
  return r?.render || 'visible';
}

/**
 * 判定某字段是否要 handoff 给某下游编排器
 */
export async function shouldHandoff(
  agentId: string,
  fieldId: string,
  downstream: string
): Promise<boolean> {
  const routings = await loadRoutings();
  const r = routings.byAgent.get(getCanonicalAgentId(agentId))?.get(fieldId);
  return r?.handoff?.includes(downstream) || false;
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
    : (() => {
        const inner = cache?.byAgent.get('goal-agent');
        return inner ? Array.from(inner.values()) : [];
      })();
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
    : (() => {
        const inner = cache?.byAgent.get('path-agent');
        return inner ? Array.from(inner.values()) : [];
      })();
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
    : (() => {
        const inner = cache?.byAgent.get('teaching-agent');
        return inner ? Array.from(inner.values()) : [];
      })();
  const channelRows = rows.filter((row) => row.handoff.includes('skill:teaching-turn'));
  const channels = extractFieldsByPath(source, channelRows);
  const skipped = channelRows
    .filter((row) => channels[row.fieldId] === undefined)
    .map((row) => `${row.fieldId}(missing-or-unmapped)`);
  return { channels, skipped };
}

// ============================================================
// Goal 阶段专用：基于 routing 重新组装 envelope
// ============================================================

export interface GoalEnvelopeInput {
  /** 来自 GoalConversationAgentResult 的原始 result */
  result: any;
  /** 用于回填 conversationId 的兜底 */
  fallbackConversationId?: string;
  /** Goal 阶段编排器 id (默认 'goal-conversation') */
  agentId?: string;
}

export interface GoalEnvelopeOutput {
  envelope: any;
  diagnostics: {
    agentId: string;
    /** 路由表里 render: hidden 的字段 → 已被剔除 */
    hiddenFieldsRemoved: string[];
    /** 路由表里 internal: true 的字段 → 已从对外 envelope 剔除 */
    internalFieldsRemoved: string[];
    /** 没在路由表里的字段（默认 visible，但记录提醒） */
    unmappedFields: string[];
  };
}

/**
 * 把内部 result 平展成"路径映射" — 仅取我们关心的 understanding / proposal / control 字段
 */
function flattenGoalResult(result: any): Record<string, any> {
  const internal = result?.internal || {};
  const core = internal?.core || {};
  const goalExt = internal?.ext?.goalConversation || {};
  const understanding = goalExt?.understanding || {};
  const confirmed = goalExt?.confirmedProposal || {};

  const flat: Record<string, any> = {};

  // understanding.*
  if (understanding.surface_goal !== undefined) flat['understanding.surface_goal'] = understanding.surface_goal;
  if (understanding.real_problem !== undefined) flat['understanding.real_problem'] = understanding.real_problem;
  if (understanding.background_experience !== undefined)
    flat['understanding.background_experience'] = understanding.background_experience;
  if (understanding.learning_signal !== undefined)
    flat['understanding.learning_signal'] = understanding.learning_signal;
  if (understanding.constraints_and_boundaries !== undefined)
    flat['understanding.constraints_and_boundaries'] = understanding.constraints_and_boundaries;
  if (understanding.pain_points !== undefined) flat['understanding.pain_points'] = understanding.pain_points;
  if (understanding.motivation !== undefined) flat['understanding.motivation'] = understanding.motivation;
  if (understanding.urgency !== undefined) flat['understanding.urgency'] = understanding.urgency;
  if (understanding.scenario !== undefined) flat['understanding.scenario'] = understanding.scenario;
  if (understanding.deadline_text !== undefined) flat['understanding.deadline_text'] = understanding.deadline_text;

  if (understanding.current_baseline) {
    if (understanding.current_baseline.level !== undefined)
      flat['understanding.current_baseline.level'] = understanding.current_baseline.level;
    if (understanding.current_baseline.evidence !== undefined)
      flat['understanding.current_baseline.evidence'] = understanding.current_baseline.evidence;
  }
  if (understanding.success_criteria) {
    if (understanding.success_criteria.observable_result !== undefined)
      flat['understanding.success_criteria.observable_result'] =
        understanding.success_criteria.observable_result;
    if (understanding.success_criteria.acceptance_check !== undefined)
      flat['understanding.success_criteria.acceptance_check'] =
        understanding.success_criteria.acceptance_check;
  }
  if (understanding.available_resources) {
    if (understanding.available_resources.time_budget !== undefined)
      flat['understanding.available_resources.time_budget'] =
        understanding.available_resources.time_budget;
    if (understanding.available_resources.time_horizon !== undefined)
      flat['understanding.available_resources.time_horizon'] =
        understanding.available_resources.time_horizon;
    if (understanding.available_resources.time_per_session !== undefined)
      flat['understanding.available_resources.time_per_session'] =
        understanding.available_resources.time_per_session;
  }

  // confirmedProposal.*
  if (confirmed.learning_direction !== undefined)
    flat['confirmedProposal.learning_direction'] = confirmed.learning_direction;
  if (confirmed.first_deliverable !== undefined)
    flat['confirmedProposal.first_deliverable'] = confirmed.first_deliverable;
  if (confirmed.key_stages !== undefined) flat['confirmedProposal.key_stages'] = confirmed.key_stages;
  if (confirmed.out_of_scope !== undefined) flat['confirmedProposal.out_of_scope'] = confirmed.out_of_scope;

  // public-reply
  if (result?.userVisible !== undefined) flat['userVisible'] = result.userVisible;
  if (goalExt.nextQuestions !== undefined) flat['goalConversation.nextQuestions'] = goalExt.nextQuestions;
  if (goalExt.quickReplies !== undefined) flat['goalConversation.quickReplies'] = goalExt.quickReplies;

  // control-signal
  if (core.conversationId !== undefined) flat['core.conversationId'] = core.conversationId;
  if (core.stage !== undefined) flat['core.stage'] = core.stage;
  if (core.confidence !== undefined) flat['core.confidence'] = core.confidence;
  if (core.isCompleted !== undefined) flat['core.isCompleted'] = core.isCompleted;

  return flat;
}

/**
 * 把"路径映射"重建回嵌套 envelope 形态（向后兼容老前端字段名）
 */
function rebuildEnvelope(
  flat: Record<string, any>,
  fallbackConversationId?: string,
  goalExtRaw?: any
): any {
  // 重新拼回 understanding 嵌套结构
  const understanding: any = {};
  for (const [k, v] of Object.entries(flat)) {
    if (!k.startsWith('understanding.')) continue;
    const path = k.slice('understanding.'.length);
    const parts = path.split('.');
    let cur: any = understanding;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v;
  }

  const confirmed: any = {};
  for (const [k, v] of Object.entries(flat)) {
    if (!k.startsWith('confirmedProposal.')) continue;
    const key = k.slice('confirmedProposal.'.length);
    confirmed[key] = v;
  }

  const goalExt: any = {
    understanding: Object.keys(understanding).length ? understanding : {},
    nextQuestions: Array.isArray(flat['goalConversation.nextQuestions'])
      ? flat['goalConversation.nextQuestions']
      : [],
    quickReplies: Array.isArray(flat['goalConversation.quickReplies'])
      ? flat['goalConversation.quickReplies']
      : [],
  };
  if (Object.keys(confirmed).length) {
    goalExt.confirmedProposal = confirmed;
  } else if (goalExtRaw?.confirmedProposal) {
    goalExt.confirmedProposal = goalExtRaw.confirmedProposal;
  }
  // 透传不在路由表里的旧字段（向后兼容）
  if (goalExtRaw?.structuredData !== undefined) goalExt.structuredData = goalExtRaw.structuredData;
  if (goalExtRaw?.confidenceScores !== undefined) goalExt.confidenceScores = goalExtRaw.confidenceScores;
  if (goalExtRaw?.collected !== undefined) goalExt.collected = goalExtRaw.collected;

  return {
    userVisible: flat['userVisible'] || '',
    internal: {
      core: {
        conversationId: flat['core.conversationId'] || fallbackConversationId || null,
        stage: flat['core.stage'] || 'understanding',
        confidence: typeof flat['core.confidence'] === 'number' ? flat['core.confidence'] : 0,
        isCompleted: !!flat['core.isCompleted'],
        learningPath: null,
      },
      ext: {
        goalConversation: goalExt,
      },
    },
    renderHints: {
      quickReplies: Array.isArray(flat['goalConversation.quickReplies'])
        ? flat['goalConversation.quickReplies']
        : [],
    },
    schemaVersion: 'agent-output-v1',
    meta: {
      source: 'goal-conversation',
      timestamp: new Date().toISOString(),
      dispatcher: 'OrchestratorFieldDispatcher@v1',
    },
  };
}

/**
 * 主入口：根据路由表决策 envelope
 *   1. 平展原始 result 为 fieldId → value
 *   2. 查路由表，按 render === 'hidden' 或 internal === true 剔除
 *   3. 重新组装 envelope（保留向后兼容的嵌套结构）
 */
export async function dispatchGoalEnvelope(
  input: GoalEnvelopeInput
): Promise<GoalEnvelopeOutput> {
  const agentId = getCanonicalAgentId(input.agentId || 'skill:goal-conversation');
  const routings = await loadRoutings();
  const inner = routings.byAgent.get(agentId) || new Map();

  const flat = flattenGoalResult(input.result);
  const hiddenRemoved: string[] = [];
  const internalRemoved: string[] = [];
  const unmapped: string[] = [];

  // learningPath 不在路由表里管理（control 派生），单独保留
  const learningPath = input.result?.internal?.core?.learningPath || null;

  for (const fieldId of Object.keys(flat)) {
    const r = inner.get(fieldId);
    if (!r) {
      unmapped.push(fieldId);
      continue;
    }
    if (r.render === 'hidden') {
      delete flat[fieldId];
      hiddenRemoved.push(fieldId);
      continue;
    }
    if (r.internal) {
      // internal=true 表示仅供编排器内部使用，不进对外 envelope
      // 但 confidence 等字段历史上前端会读，此处仍保留（visible 优先）
      // 严格语义：如果 render: visible 同时 internal: true，仍然保留
      // 因为 visible 是"前端可见"，internal 是"不交付下游"，二者不冲突
    }
  }

  const envelope = rebuildEnvelope(
    flat,
    input.fallbackConversationId,
    input.result?.internal?.ext?.goalConversation
  );
  // 把 learningPath 还回 core
  if (envelope?.internal?.core) {
    envelope.internal.core.learningPath = learningPath;
  }

  return {
    envelope,
    diagnostics: {
      agentId,
      hiddenFieldsRemoved: hiddenRemoved,
      internalFieldsRemoved: internalRemoved,
      unmappedFields: unmapped,
    },
  };
}

// ============================================================
// Path skill handoff：取出该字段是否要交付 path
// ============================================================

export interface GoalToPathHandoffOutput {
  fields: Record<string, any>;
  skipped: string[];
}

/**
 * 拿"goal-conversation 编排器"路由里 handoff 包含 'requirement' 或 'path' 的所有字段
 * 用于在 buildGoalPathVisibleSummary 里替代硬编码字段拣选
 */
export async function pickGoalHandoffFields(
  result: any,
  downstream: 'requirement' | 'path' | 'teaching'
): Promise<GoalToPathHandoffOutput> {
  const routings = await loadRoutings();
  const inner = routings.byAgent.get('skill:goal-conversation') || new Map();

  const flat = flattenGoalResult(result);
  const fields: Record<string, any> = {};
  const skipped: string[] = [];

  for (const [fieldId, value] of Object.entries(flat)) {
    const r = inner.get(fieldId);
    if (!r) {
      skipped.push(`${fieldId}(unmapped)`);
      continue;
    }
    if (!r.handoff.includes(downstream)) {
      skipped.push(`${fieldId}(no-handoff-to-${downstream})`);
      continue;
    }
    fields[fieldId] = value;
  }

  return { fields, skipped };
}

/**
 * Feature flag：决定是否启用 dispatcher（默认 true，可通过环境变量关闭）
 */
export function isDispatcherEnabled(): boolean {
  const v = process.env.WENFLOW_FIELD_DISPATCHER;
  if (typeof v !== 'string') return true;
  const lo = v.trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(lo);
}

/**
 * 漂移检测：把 dispatcher 输出与 legacy envelope 做差异比较
 * 仅打 log，不改流程
 */
export function logEnvelopeDrift(legacy: any, fromDispatcher: any, conversationId?: string): void {
  try {
    const legacyKeys = new Set<string>();
    const dispKeys = new Set<string>();
    const collect = (obj: any, prefix: string, set: Set<string>) => {
      if (!obj || typeof obj !== 'object') return;
      for (const k of Object.keys(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        const v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          collect(v, path, set);
        } else {
          set.add(path);
        }
      }
    };
    collect(legacy, '', legacyKeys);
    collect(fromDispatcher, '', dispKeys);
    const onlyLegacy: string[] = [];
    const onlyDisp: string[] = [];
    legacyKeys.forEach((k) => {
      if (!dispKeys.has(k)) onlyLegacy.push(k);
    });
    dispKeys.forEach((k) => {
      if (!legacyKeys.has(k)) onlyDisp.push(k);
    });
    if (onlyLegacy.length || onlyDisp.length) {
      logger.info('[FieldDispatcher] envelope drift', {
        conversationId,
        onlyLegacy: onlyLegacy.slice(0, 20),
        onlyDispatcher: onlyDisp.slice(0, 20),
      });
    }
  } catch (err) {
    // 不影响主流程
    logger.debug('[FieldDispatcher] drift detection error', { error: (err as Error).message });
  }
}
