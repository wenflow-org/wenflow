import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import { clearRoutingCache } from '../../services/field-dispatcher';
import { clearSupplementRenderCache } from '../../services/prompt-composer';
import { detectFieldRoutingDrift } from '../../services/field-routing-bootstrap.service';

const router = Router();

const PROMPT_ROLES = [
  'hard-required',
  'soft-info',
  'hidden-inference',
  'public-reply',
  'proposal-output',
  'derived-presentation',
  'control-signal',
] as const;

const RENDER_VALUES = ['visible', 'hidden'] as const;

function parseJson<T = any>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stringifyOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function lockSummary(field: any, routing: any | null) {
  const systemLocked = Boolean(field?.systemLocked) || Boolean(routing?.systemLocked);
  const structureLocked = systemLocked || Boolean(field?.structureLocked) || Boolean(routing?.structureLocked);
  let level: 'system-locked' | 'structure-locked' | 'fully-editable' = 'fully-editable';
  if (systemLocked) level = 'system-locked';
  else if (structureLocked) level = 'structure-locked';
  return { systemLocked, structureLocked, level };
}

function serializeField(row: any) {
  return {
    id: row.id,
    fieldId: row.fieldId,
    stage: row.stage,
    promptRole: row.promptRole,
    valueType: row.valueType,
    snakeName: row.snakeName,
    camelName: row.camelName,
    description: row.description,
    enumValues: parseJson(row.enumValues),
    schemaVersion: row.schemaVersion,
    source: row.source,
    managedByCode: row.managedByCode,
    systemLocked: row.systemLocked,
    structureLocked: row.structureLocked,
    bindings: parseJson(row.bindings),
    metadata: parseJson(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeRouting(row: any) {
  return {
    id: row.id,
    agentId: row.agentId,
    fieldId: row.fieldId,
    render: row.render,
    handoff: parseJson<string[]>(row.handoff) || [],
    internal: row.internalFlag,
    accumulate: row.accumulate,
    visibilityPreset: row.visibilityPreset,
    ordering: row.ordering,
    notes: row.notes,
    source: row.source,
    managedByCode: row.managedByCode,
    systemLocked: row.systemLocked,
    structureLocked: row.structureLocked,
    updatedAt: row.updatedAt,
  };
}

function serializeContract(row: any) {
  return {
    id: row.id,
    agentId: row.agentId,
    stage: row.stage,
    displayName: row.displayName,
    description: row.description,
    schemaVersion: row.schemaVersion,
    source: row.source,
    managedByCode: row.managedByCode,
    metadata: parseJson(row.metadata),
    updatedAt: row.updatedAt,
  };
}

async function recordChange(payload: {
  changeType: string;
  targetTable: string;
  targetId: string;
  agentId?: string | null;
  fieldId?: string | null;
  before?: unknown;
  after?: unknown;
  actorId?: string | null;
  actorRole?: string | null;
  reason?: string | null;
}) {
  try {
    await systemPrisma.node_config_changes.create({
      data: {
        id: randomUUID(),
        changeType: payload.changeType,
        targetTable: payload.targetTable,
        targetId: payload.targetId,
        agentId: payload.agentId ?? null,
        fieldId: payload.fieldId ?? null,
        before: stringifyOrNull(payload.before),
        after: stringifyOrNull(payload.after),
        actorId: payload.actorId ?? null,
        actorRole: payload.actorRole ?? null,
        reason: payload.reason ?? null,
      },
    });
  } catch (err) {
    // 审计写失败不影响主流程
    logger.warn('[field-routings] audit write failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

function actorOf(req: Request): { actorId: string | null; actorRole: string | null } {
  const u = (req as any).user || {};
  return {
    actorId: u.id || u.userId || null,
    actorRole: u.role || 'admin',
  };
}

// ============================================================
// GET /api/admin/field-routings/stages
// 返回支持的 stage 清单 + 元信息
// ============================================================
router.get('/stages', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      stages: [
        {
          id: 'goal',
          displayName: 'Goal 阶段',
          description: '目标对话：澄清目标、收集背景、收敛到方向方案',
          status: 'active',
        },
        {
          id: 'path',
          displayName: 'Path 阶段',
          description: '学习路径生成：Framing → Path Planning → Stage Designer',
          status: 'active',
        },
        {
          id: 'teaching',
          displayName: '教学阶段',
          description: '授课执行：Teaching Turn → Peer/Checkpoint → Wrapup',
          status: 'active',
        },
        {
          id: 'profile',
          displayName: '画像阶段',
          description: '学习者画像增强与背景知识沉淀（编排器内部）',
          status: 'active',
        },
        {
          id: 'simulation',
          displayName: '仿真阶段',
          description: '虚拟学习者实验：样本设计 → 模拟器 → 旁路审计（服务端注入输入，无阶段间 handoff）',
          status: 'active',
        },
      ],
      promptRoles: PROMPT_ROLES,
      renderValues: RENDER_VALUES,
    },
  });
});

// ============================================================
// GET /api/admin/field-routings/stages/:stage
// 返回某阶段的「字段路由中心」全量数据：
//   - fields: 该阶段所有字段定义
//   - agents: 该阶段所有 Agent 契约
//   - routings: 字段 × Agent 的路由矩阵
// ============================================================
router.get('/stages/:stage', async (req: Request, res: Response) => {
  const stage = String(req.params.stage || '').trim();
  if (!stage) {
    return res.status(400).json({ success: false, error: { message: 'stage 参数缺失' } });
  }

  const [fields, contracts] = await Promise.all([
    systemPrisma.field_definitions.findMany({
      where: { stage },
      orderBy: [{ promptRole: 'asc' }, { fieldId: 'asc' }],
    }),
    systemPrisma.agent_contracts.findMany({
      where: { stage },
      orderBy: { displayName: 'asc' },
    }),
  ]);

  const agentIds = contracts.map((c) => c.agentId);
  const fieldIds = fields.map((f) => f.fieldId);

  const routings = agentIds.length && fieldIds.length
    ? await systemPrisma.agent_field_routings.findMany({
        where: {
          agentId: { in: agentIds },
          fieldId: { in: fieldIds },
        },
      })
    : [];

  const fieldsOut = fields.map(serializeField);
  const contractsOut = contracts.map(serializeContract);
  const routingsOut = routings.map(serializeRouting);

  // 计算每条 routing 的锁状态（合并 field + routing 自身标记）
  const fieldMap = new Map(fields.map((f) => [f.fieldId, f]));
  const routingsWithLocks = routingsOut.map((r) => {
    const f = fieldMap.get(r.fieldId);
    return { ...r, locks: lockSummary(f, r) };
  });

  // 计算每个字段的锁概览（取最严格的）
  const fieldsWithLocks = fieldsOut.map((f) => ({
    ...f,
    locks: lockSummary(f, null),
  }));

  res.json({
    success: true,
    data: {
      stage,
      fields: fieldsWithLocks,
      agents: contractsOut,
      routings: routingsWithLocks,
    },
  });
});

// ============================================================
// GET /api/admin/field-routings/flow/:stage
// 字段流图数据：节点 = Agent + Skill，边 = 字段在 handoff 中的传递
//
// 输出：
//   nodes: [{ id, type: 'agent'|'skill', label, ... }]
//   edges: [{ id, source, target, label, fields: [{ fieldId, routing }], routing }]
//
// 规则：
//   - source = 某 Agent / Skill（已生产该字段）
//   - target = handoff 目标（可能是 stage 字符串如 'path'，转成对应顶层 Agent）
//   - 一条 source -> target 上多个字段聚合
//   - accumulate / handoff / render=hidden 等用不同颜色区分
// ============================================================
router.get('/flow/:stage', async (req: Request, res: Response) => {
  const stage = String(req.params.stage || '').trim();
  if (!stage) {
    return res.status(400).json({ success: false, error: { message: 'stage 参数缺失' } });
  }

  const { listTopLevelAgents, getCanonicalAgentId, getAgentOfSkill, listAgentManifest } = await import('../../services/agent-manifest.service');
  const topAgents = listTopLevelAgents();
  const allManifest = listAgentManifest();
  const manifestMap = new Map(allManifest.map(m => [m.id, m]));

  // stage -> 顶层 Agent ID 的映射（handoff 用 stage 名指代下游）
  const STAGE_TO_AGENT: Record<string, string> = {
    goal: 'goal-agent',
    requirement: 'goal-agent',
    path: 'path-agent',
    teaching: 'teaching-agent',
    profile: 'profile-agent',
    learner: 'profile-agent'
  };

  const [fields, contracts] = await Promise.all([
    systemPrisma.field_definitions.findMany({ where: { stage } }),
    systemPrisma.agent_contracts.findMany({ where: { stage } })
  ]);

  const stageAgentIds = contracts.map(c => c.agentId);
  const routings = stageAgentIds.length > 0
    ? await systemPrisma.agent_field_routings.findMany({ where: { agentId: { in: stageAgentIds } } })
    : [];

  const fieldMap = new Map(fields.map(f => [f.fieldId, f]));

  // 节点集合：本 stage 涉及到的 Agent/Skill（含 handoff 目标 Agent）
  const involvedNodes = new Map<string, any>();

  const addNode = (rawId: string) => {
    const canonical = getCanonicalAgentId(rawId);
    if (involvedNodes.has(canonical)) return;
    const manifest = manifestMap.get(canonical);
    if (manifest) {
      involvedNodes.set(canonical, {
        id: canonical,
        type: manifest.kind,
        label: manifest.name,
        category: manifest.category,
        parentAgentId: manifest.kind === 'skill' ? (getAgentOfSkill(canonical)?.id || null) : null
      });
    } else {
      // stage 名作为虚拟节点
      involvedNodes.set(canonical, {
        id: canonical,
        type: 'stage',
        label: canonical,
        category: 'stage'
      });
    }
  };

  // 把 contracts 涉及的 agent / skill 都加进节点
  for (const c of contracts) addNode(c.agentId);

  // 把 handoff 目标涉及的下游 Agent 也加节点（基于 stage 名映射）
  for (const r of routings) {
    const handoff = parseHandoff(r.handoff);
    for (const h of handoff) {
      const mappedAgentId = STAGE_TO_AGENT[h] || h;
      addNode(mappedAgentId);
    }
  }

  // 构造边：按 (source, target) 聚合
  const edgeAgg = new Map<string, { source: string; target: string; fields: any[]; renderBuckets: Record<string, number>; routingTypes: Set<string> }>();

  for (const r of routings) {
    const sourceCanonical = getCanonicalAgentId(r.agentId);
    const f = fieldMap.get(r.fieldId);
    const handoff = parseHandoff(r.handoff);

    if (handoff.length === 0) {
      // 没有 handoff 但 accumulate=true → 流向 profile-agent
      if (r.accumulate) {
        const target = 'profile-agent';
        addNode(target);
        const key = `${sourceCanonical}__${target}`;
        if (!edgeAgg.has(key)) {
          edgeAgg.set(key, { source: sourceCanonical, target, fields: [], renderBuckets: {}, routingTypes: new Set() });
        }
        const e = edgeAgg.get(key)!;
        e.fields.push({ fieldId: r.fieldId, render: r.render, promptRole: f?.promptRole, routingMode: 'accumulate' });
        e.routingTypes.add('accumulate');
        e.renderBuckets[r.render || 'visible'] = (e.renderBuckets[r.render || 'visible'] || 0) + 1;
      }
      continue;
    }

    for (const h of handoff) {
      const target = STAGE_TO_AGENT[h] || h;
      addNode(target);
      const key = `${sourceCanonical}__${target}`;
      if (!edgeAgg.has(key)) {
        edgeAgg.set(key, { source: sourceCanonical, target, fields: [], renderBuckets: {}, routingTypes: new Set() });
      }
      const e = edgeAgg.get(key)!;
      e.fields.push({ fieldId: r.fieldId, render: r.render, promptRole: f?.promptRole, routingMode: 'handoff' });
      e.routingTypes.add('handoff');
      e.renderBuckets[r.render || 'visible'] = (e.renderBuckets[r.render || 'visible'] || 0) + 1;
    }
  }

  const edges = Array.from(edgeAgg.values()).map(e => ({
    id: `${e.source}__${e.target}`,
    source: e.source,
    target: e.target,
    fieldCount: e.fields.length,
    fields: e.fields,
    renderBuckets: e.renderBuckets,
    routingTypes: Array.from(e.routingTypes),
    label: `${e.fields.length} 个字段`
  }));

  res.json({
    success: true,
    data: {
      stage,
      nodes: Array.from(involvedNodes.values()),
      edges,
      summary: {
        nodeCount: involvedNodes.size,
        edgeCount: edges.length,
        fieldCount: fields.length,
        routingCount: routings.length
      }
    }
  });
});

function parseHandoff(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// ============================================================
// POST /api/admin/field-routings/fields
// 新建字段定义（系统锁字段不允许由 admin 创建到 hard-required / control-signal）
// ============================================================
router.post('/fields', async (req: Request, res: Response) => {
  const body = req.body || {};
  const fieldId = String(body.fieldId || '').trim();
  const stage = String(body.stage || '').trim();
  const promptRole = String(body.promptRole || '').trim();

  if (!fieldId || !stage || !promptRole) {
    return res.status(400).json({ success: false, error: { message: 'fieldId / stage / promptRole 必填' } });
  }
  if (!PROMPT_ROLES.includes(promptRole as any)) {
    return res.status(400).json({ success: false, error: { message: `promptRole 非法，须在 ${PROMPT_ROLES.join(',')} 中` } });
  }

  // V3 §10 P1.0：admin 只允许新建到 soft-info / hidden-inference / derived-presentation
  const ADMIN_ALLOWED = new Set(['soft-info', 'hidden-inference', 'derived-presentation']);
  if (!ADMIN_ALLOWED.has(promptRole)) {
    return res.status(400).json({
      success: false,
      error: {
        message: `admin 不允许新建 promptRole=${promptRole} 的字段（hard-required / public-reply / proposal-output / control-signal 必须先有代码消费）`,
      },
    });
  }

  // 重复检查
  const exists = await systemPrisma.field_definitions.findUnique({ where: { fieldId } });
  if (exists) {
    return res.status(409).json({ success: false, error: { message: `字段 ${fieldId} 已存在` } });
  }

  const id = randomUUID();
  const created = await systemPrisma.field_definitions.create({
    data: {
      id,
      fieldId,
      stage,
      promptRole,
      valueType: String(body.valueType || 'string'),
      snakeName: body.snakeName || null,
      camelName: body.camelName || null,
      description: body.description || null,
      enumValues: stringifyOrNull(body.enumValues),
      schemaVersion: body.schemaVersion || 'v3',
      source: 'admin',
      managedByCode: false,
      systemLocked: false,
      structureLocked: false,
      bindings: stringifyOrNull(body.bindings),
      metadata: stringifyOrNull(body.metadata),
    },
  });

  const actor = actorOf(req);
  await recordChange({
    changeType: 'field-create',
    targetTable: 'field_definitions',
    targetId: id,
    fieldId,
    after: serializeField(created),
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    reason: body.reason || 'admin create field',
  });

  // 字段表变化会改变 supplement 渲染与 handoff 抽取结果，立即失效缓存
  clearRoutingCache();
  clearSupplementRenderCache();

  res.status(201).json({ success: true, data: { ...serializeField(created), locks: lockSummary(created, null) } });
});

// ============================================================
// PATCH /api/admin/field-routings/routings/:orchestratorId/:fieldId
// 调整某字段在某编排器下的 4 路由属性
// ============================================================
router.patch('/routings/:agentId/:fieldId', async (req: Request, res: Response) => {
  const { agentId, fieldId } = req.params;
  const body = req.body || {};

  const [field, existing, contract] = await Promise.all([
    systemPrisma.field_definitions.findUnique({ where: { fieldId } }),
    systemPrisma.agent_field_routings.findUnique({
      where: { agentId_fieldId: { agentId, fieldId } },
    }),
    systemPrisma.agent_contracts.findUnique({ where: { agentId } }),
  ]);

  if (!field) {
    return res.status(404).json({ success: false, error: { message: `field ${fieldId} 不存在` } });
  }
  if (!contract) {
    return res.status(404).json({ success: false, error: { message: `agent ${agentId} 不存在` } });
  }

  // 锁检查
  const locks = lockSummary(field, existing);
  if (locks.systemLocked) {
    return res.status(403).json({
      success: false,
      error: { message: 'system-locked 字段不允许任何调整（必须先改代码）' },
    });
  }
  if (locks.structureLocked) {
    // structure-locked 仅允许 prompt 级精调；当前没有 prompt 字段，因此完全只读
    return res.status(403).json({
      success: false,
      error: { message: 'structure-locked 字段不允许调整路由（仅允许 prompt 级精调）' },
    });
  }

  const data: Record<string, any> = {};

  if (typeof body.render === 'string') {
    if (!RENDER_VALUES.includes(body.render)) {
      return res.status(400).json({ success: false, error: { message: `render 非法` } });
    }
    data.render = body.render;
  }
  if (Array.isArray(body.handoff)) {
    data.handoff = stringifyOrNull(body.handoff);
  }
  if (typeof body.internal === 'boolean') {
    data.internalFlag = body.internal;
  }
  if (typeof body.accumulate === 'boolean') {
    data.accumulate = body.accumulate;
  }
  if (typeof body.notes === 'string') {
    data.notes = body.notes;
  }

  if (!Object.keys(data).length) {
    return res.status(400).json({ success: false, error: { message: '没有有效字段被更新' } });
  }

  let saved: any;
  if (existing) {
    saved = await systemPrisma.agent_field_routings.update({
      where: { agentId_fieldId: { agentId, fieldId } },
      data: { ...data, updatedAt: new Date() },
    });
  } else {
    saved = await systemPrisma.agent_field_routings.create({
      data: {
        id: randomUUID(),
        agentId,
        fieldId,
        render: data.render || 'visible',
        handoff: data.handoff || null,
        internalFlag: typeof data.internalFlag === 'boolean' ? data.internalFlag : false,
        accumulate: typeof data.accumulate === 'boolean' ? data.accumulate : false,
        notes: data.notes || null,
        source: 'admin',
        managedByCode: false,
      },
    });
  }

  const actor = actorOf(req);
  await recordChange({
    changeType: existing ? 'routing-update' : 'routing-create',
    targetTable: 'agent_field_routings',
    targetId: saved.id,
    agentId,
    fieldId,
    before: existing ? serializeRouting(existing) : null,
    after: serializeRouting(saved),
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    reason: body.reason || 'admin update routing',
  });

  // 路由变化立即生效：失效 field-dispatcher 缓存（handoff 抽取/supplement 渲染/hard-required 清单）
  clearRoutingCache();
  clearSupplementRenderCache();

  res.json({ success: true, data: { ...serializeRouting(saved), locks: lockSummary(field, saved) } });
});

// ============================================================
// GET /api/admin/field-routings/drift?kind=&stage=
// seed vs DB 漂移报告（managedByCode=true 行参与 diff；admin 改过的行跳过）
// ============================================================
router.get('/drift', async (req: Request, res: Response) => {
  const kind = typeof req.query.kind === 'string' && req.query.kind.trim() ? req.query.kind.trim() : undefined;
  const stage = typeof req.query.stage === 'string' && req.query.stage.trim() ? req.query.stage.trim() : undefined;

  const report = await detectFieldRoutingDrift(systemPrisma);

  const items = report.items
    .filter((item) => (kind ? item.kind === kind : true))
    .filter((item) => (stage ? item.key.includes(`:${stage}:`) || item.key.startsWith(`${stage}:`) : true));

  res.json({
    success: true,
    data: {
      driftCount: items.length,
      totalDriftCount: report.driftCount,
      items,
    },
  });
});

// GET /api/admin/field-routings/changes?stage=&fieldId=&limit=
// 审计日志
// ============================================================
router.get('/changes', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const fieldId = typeof req.query.fieldId === 'string' && req.query.fieldId.trim() ? req.query.fieldId.trim() : undefined;
  const agentId = typeof req.query.agentId === 'string' && req.query.agentId.trim() ? req.query.agentId.trim() : undefined;

  const rows = await systemPrisma.node_config_changes.findMany({
    where: {
      ...(fieldId ? { fieldId } : {}),
      ...(agentId ? { agentId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      changeType: row.changeType,
      targetTable: row.targetTable,
      targetId: row.targetId,
      agentId: row.agentId,
      fieldId: row.fieldId,
      before: parseJson(row.before),
      after: parseJson(row.after),
      actorId: row.actorId,
      actorRole: row.actorRole,
      reason: row.reason,
      createdAt: row.createdAt,
    })),
  });
});

export default router;
