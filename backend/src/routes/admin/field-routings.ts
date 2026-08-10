import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import { clearRoutingCache } from '../../services/field-dispatcher';
import { clearSupplementRenderCache } from '../../services/prompt-composer';
import { detectFieldRoutingDrift, ensureStageFieldRoutings } from '../../services/field-routing-bootstrap.service';
import {
  loadOrchestrationFiles,
  ORCHESTRATION_DIR,
  PROMPT_ROLES,
  RENDER_VALUES,
  validateOrchestrationContent,
  type OrchestrationStage,
} from '../../services/field-routing/orchestration-file';

const router = Router();

function parseJson<T = any>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
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

// ============================================================
// GET /api/admin/field-routings/stages
// 返回支持的 stage 清单 + 元信息（派生自 prompts/orchestration/*.yaml）
// ============================================================
router.get('/stages', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      stages: loadOrchestrationFiles().map((stage) => ({
        id: stage.stage,
        displayName: stage.displayName || stage.stage,
        description: stage.description || '',
        status: 'active',
      })),
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
// 编排文件编辑侧（单源化批次 C）
// 编排文件 prompts/orchestration/<stage>.yaml 是字段路由唯一声明源。
// 行级 PATCH /routings/:agentId/:fieldId 与 POST /fields 已退役（批次 D）。
// ============================================================

/** 解析 URL 中的 stage 并定位编排文件；非法/不存在返回 null（防路径穿越） */
function resolveOrchestrationFile(stage: string): string | null {
  if (!stage || !/^[\w.-]+$/.test(stage)) return null;
  const yamlPath = path.join(ORCHESTRATION_DIR, `${stage}.yaml`);
  if (fs.existsSync(yamlPath)) return yamlPath;
  const ymlPath = path.join(ORCHESTRATION_DIR, `${stage}.yml`);
  if (fs.existsSync(ymlPath)) return ymlPath;
  return null;
}

// ============================================================
// GET /api/admin/field-routings/orchestration/:stage
// 返回编排文件原文与解析摘要
// ============================================================
router.get('/orchestration/:stage', async (req: Request, res: Response) => {
  const stage = String(req.params.stage || '').trim();
  const filePath = resolveOrchestrationFile(stage);
  if (!filePath) {
    return res.status(404).json({ success: false, error: { message: `编排文件不存在：${stage}` } });
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: `编排文件读取失败：${filePath}（${error instanceof Error ? error.message : String(error)}）` },
    });
  }

  let parsed: OrchestrationStage;
  try {
    parsed = validateOrchestrationContent(content);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { message: `编排文件解析失败（文件本身损坏，需先修复）：${error instanceof Error ? error.message : String(error)}` },
    });
  }

  res.json({
    success: true,
    data: {
      stage,
      fileName: path.basename(filePath),
      content,
      parsed: {
        contractCount: parsed.contracts.length,
        fieldCount: parsed.fields.length,
        routingCount: parsed.routings.length,
      },
    },
  });
});

// ============================================================
// PUT /api/admin/field-routings/orchestration/:stage
// 保存完整编排文件 YAML：内存校验 → 备份 → 写盘 → ensure 同步（只建不更新）→ 清缓存
// ============================================================
router.put('/orchestration/:stage', async (req: Request, res: Response) => {
  const stage = String(req.params.stage || '').trim();
  const filePath = resolveOrchestrationFile(stage);
  if (!filePath) {
    return res.status(404).json({ success: false, error: { message: `编排文件不存在：${stage}` } });
  }

  const content = typeof (req.body || {}).content === 'string' ? (req.body as { content: string }).content : '';
  if (!content.trim()) {
    return res.status(400).json({ success: false, error: { message: 'content（完整编排文件 YAML 文本）必填' } });
  }

  let validated: OrchestrationStage;
  try {
    validated = validateOrchestrationContent(content);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { message: `编排文件校验失败：${error instanceof Error ? error.message : String(error)}` },
    });
  }
  if (validated.stage !== stage) {
    return res.status(400).json({
      success: false,
      error: { message: `编排文件内 stage 声明（${validated.stage}）与 URL（${stage}）不一致` },
    });
  }

  // 备份当前生产文件（失败静默，不阻断保存）
  try {
    const backupsDir = path.join(path.dirname(ORCHESTRATION_DIR), 'backups', 'orchestration', stage);
    await fs.promises.mkdir(backupsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.promises.copyFile(filePath, path.join(backupsDir, `${ts}.yaml`));
  } catch (error) {
    logger.warn('[field-routings] orchestration backup failed', { stage, error: error instanceof Error ? error.message : String(error) });
  }

  // 写盘（文件为准）
  await fs.promises.writeFile(filePath, content, 'utf-8');

  // 立即 ensure（只建不更新：新字段/新路由进 DB；已有行属性修改待同步）——失败不阻断写盘结果
  let synced = true;
  let syncHint = '';
  try {
    await ensureStageFieldRoutings(systemPrisma, validated);
  } catch (error) {
    synced = false;
    syncHint = `DB 同步失败：${error instanceof Error ? error.message : String(error)}（新建行未入库，可在「漂移与审计」复查）`;
  }
  if (synced) {
    syncHint = '新建字段/路由已生效；已有行属性修改需「强制同步 DB」或重启后由 bootstrap 覆盖生效';
  }

  clearRoutingCache();
  clearSupplementRenderCache();

  res.json({
    success: true,
    data: {
      stage,
      fieldCount: validated.fields.length,
      routingCount: validated.routings.length,
      contractCount: validated.contracts.length,
      synced,
      syncHint,
    },
  });
});

// ============================================================
// POST /api/admin/field-routings/orchestration/:stage/sync
// 全量对账（文件为准，立即生效）：三表 upsert(update: 全部业务列)
// admin 覆盖行（managedByCode=false）跳过更新并记入 skipped 清单
// ============================================================
router.post('/orchestration/:stage/sync', async (req: Request, res: Response) => {
  const stage = String(req.params.stage || '').trim();
  const found = loadOrchestrationFiles().find((s) => s.stage === stage);
  if (!found) {
    return res.status(404).json({ success: false, error: { message: `编排文件不存在：${stage}` } });
  }

  const skippedAdminRows: Array<{ table: string; key: string }> = [];
  let contractsUpdated = 0;
  let fieldsUpdated = 0;
  let routingsUpdated = 0;
  let createdCount = 0;

  for (const c of found.contracts) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    if (exists) {
      if (exists.managedByCode === false) {
        skippedAdminRows.push({ table: 'agent_contracts', key: c.agentId });
        continue;
      }
      await systemPrisma.agent_contracts.update({
        where: { agentId: c.agentId },
        data: { stage, displayName: c.displayName, description: c.description, updatedAt: new Date() },
      });
      contractsUpdated++;
    } else {
      await systemPrisma.agent_contracts.create({
        data: {
          id: randomUUID(),
          agentId: c.agentId,
          stage,
          displayName: c.displayName,
          description: c.description,
          schemaVersion: 'v3',
          source: 'code',
          managedByCode: true,
        },
      });
      createdCount++;
    }
  }

  for (const f of found.fields) {
    const exists = await systemPrisma.field_definitions.findUnique({ where: { fieldId: f.fieldId } });
    if (exists) {
      if (exists.managedByCode === false) {
        skippedAdminRows.push({ table: 'field_definitions', key: f.fieldId });
        continue;
      }
      await systemPrisma.field_definitions.update({
        where: { fieldId: f.fieldId },
        data: {
          stage,
          promptRole: f.promptRole,
          valueType: f.valueType,
          snakeName: f.snakeName ?? null,
          camelName: f.camelName ?? null,
          pathInRawOutput: f.pathInRawOutput ?? null,
          description: f.description,
          enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null,
          systemLocked: f.systemLocked ?? false,
          structureLocked: f.structureLocked ?? false,
          bindings: f.bindings ? JSON.stringify(f.bindings) : null,
          updatedAt: new Date(),
        },
      });
      fieldsUpdated++;
    } else {
      await systemPrisma.field_definitions.create({
        data: {
          id: randomUUID(),
          fieldId: f.fieldId,
          stage,
          promptRole: f.promptRole,
          valueType: f.valueType,
          snakeName: f.snakeName ?? null,
          camelName: f.camelName ?? null,
          pathInRawOutput: f.pathInRawOutput ?? null,
          description: f.description,
          enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null,
          systemLocked: f.systemLocked ?? false,
          structureLocked: f.structureLocked ?? false,
          bindings: f.bindings ? JSON.stringify(f.bindings) : null,
          schemaVersion: 'v3',
          source: 'code',
          managedByCode: true,
        },
      });
      createdCount++;
    }
  }

  for (const r of found.routings) {
    const where = { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } };
    const exists = await systemPrisma.agent_field_routings.findUnique({ where });
    if (exists) {
      if (exists.managedByCode === false) {
        skippedAdminRows.push({ table: 'agent_field_routings', key: `${r.agentId}/${r.fieldId}` });
        continue;
      }
      await systemPrisma.agent_field_routings.update({
        where,
        data: {
          render: r.render,
          handoff: r.handoff.length ? JSON.stringify(r.handoff) : null,
          internalFlag: r.internal,
          accumulate: r.accumulate,
          visibilityPreset: r.visibilityPreset ?? null,
          notes: r.notes ?? null,
          updatedAt: new Date(),
        },
      });
      routingsUpdated++;
    } else {
      await systemPrisma.agent_field_routings.create({
        data: {
          id: randomUUID(),
          agentId: r.agentId,
          fieldId: r.fieldId,
          render: r.render,
          handoff: r.handoff.length ? JSON.stringify(r.handoff) : null,
          internalFlag: r.internal,
          accumulate: r.accumulate,
          visibilityPreset: r.visibilityPreset ?? null,
          notes: r.notes ?? null,
          source: 'code',
          managedByCode: true,
        },
      });
      createdCount++;
    }
  }

  clearRoutingCache();
  clearSupplementRenderCache();

  res.json({
    success: true,
    data: { stage, contractsUpdated, fieldsUpdated, routingsUpdated, createdCount, skippedAdminRows },
  });
});

// ============================================================
// GET /api/admin/field-routings/drift?kind=&stage=
// seed vs DB 漂移报告（managedByCode=true 行参与 diff；admin 改过的行跳过）
// ============================================================
router.get('/drift', async (req: Request, res: Response) => {
  const kind = typeof req.query.kind === 'string' && req.query.kind.trim() ? req.query.kind.trim() : undefined;
  const stage = typeof req.query.stage === 'string' && req.query.stage.trim() ? req.query.stage.trim() : undefined;

  const report = await detectFieldRoutingDrift(systemPrisma);

  let items = report.items;
  if (kind) {
    items = items.filter((item) => item.kind === kind);
  }

  // stage 过滤：drift 条目 key 是 agentId（contract）或 fieldId（field），
  // routing 条目 key 是 `${agentId}\0${fieldId}`。
  // 先按 stage 查 agent_contracts / field_definitions 得到该阶段的 agentIds / fieldIds，
  // 再按 agentId 或 fieldId 命中过滤（原来的 key.includes(':stage:') 永远匹配不到）。
  if (stage) {
    const [contracts, fields] = await Promise.all([
      systemPrisma.agent_contracts.findMany({ where: { stage }, select: { agentId: true } }),
      systemPrisma.field_definitions.findMany({ where: { stage }, select: { fieldId: true } }),
    ]);
    const agentIds = new Set(contracts.map((c) => c.agentId));
    const fieldIds = new Set(fields.map((f) => f.fieldId));
    items = items.filter((item) => {
      if (item.kind === 'contract') return agentIds.has(item.key);
      if (item.kind === 'field') return fieldIds.has(item.key);
      if (item.kind === 'routing') {
        const sep = item.key.indexOf('\0');
        const agentId = sep >= 0 ? item.key.slice(0, sep) : item.key;
        const fieldId = sep >= 0 ? item.key.slice(sep + 1) : '';
        return agentIds.has(agentId) || fieldIds.has(fieldId);
      }
      return false;
    });
  }

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
  const stage = typeof req.query.stage === 'string' && req.query.stage.trim() ? req.query.stage.trim() : undefined;
  const fieldId = typeof req.query.fieldId === 'string' && req.query.fieldId.trim() ? req.query.fieldId.trim() : undefined;
  const agentId = typeof req.query.agentId === 'string' && req.query.agentId.trim() ? req.query.agentId.trim() : undefined;

  let stageWhere: any = {};
  if (stage) {
    const [contracts, fields] = await Promise.all([
      systemPrisma.agent_contracts.findMany({ where: { stage }, select: { agentId: true } }),
      systemPrisma.field_definitions.findMany({ where: { stage }, select: { fieldId: true } }),
    ]);
    const agentIds = contracts.map((c) => c.agentId);
    const fieldIds = fields.map((f) => f.fieldId);
    if (agentIds.length === 0 && fieldIds.length === 0) {
      return res.json({ success: true, data: [] });
    }
    stageWhere = {
      OR: [
        ...(agentIds.length ? [{ agentId: { in: agentIds } }] : []),
        ...(fieldIds.length ? [{ fieldId: { in: fieldIds } }] : []),
      ],
    };
  }

  const rows = await systemPrisma.node_config_changes.findMany({
    where: {
      ...stageWhere,
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
