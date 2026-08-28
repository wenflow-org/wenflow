import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import { clearRoutingCache } from '../../services/field-dispatcher';
import { clearSupplementRenderCache } from '../../services/prompt-composer';
import { detectFieldRoutingDrift, ensureStageFieldRoutings, syncStageFieldRoutingsFromFile, pruneStageFieldRoutings } from '../../services/field-routing-bootstrap.service';
import {
  loadOrchestrationFiles,
  ORCHESTRATION_DIR,
  PROMPT_ROLES,
  RENDER_VALUES,
  validateOrchestrationContent,
  parseOrchestrationFile,
  type OrchestrationStage,
} from '../../services/field-routing/orchestration-file';
import { PROMPT_ROLE_META } from '../../services/yaml-vocabulary';
import { getCanonicalAgentId, getAgentManifest } from '../../services/agent-manifest.service';
import { writeNodeConfigChange, summarizeTextDigest } from '../../services/node-config-change-audit';
import { loadSkillsBookRaw } from '../../services/skill-registry/skills-file';
import { analyzeCoreFieldsSync, type CoreFieldsSyncSkillReport } from '../../scripts/check-core-fields-sync';
import { loadCoreFile } from '../../services/prompt-lab/core-file-loader';

const router = Router();

// ============================================================
// skill 维度投影共享实现（GET /skill/:skillId 单 skill 端点与
// GET /skill-batch 批量端点共用，保证批量条目与单 skill 响应逐字段一致）
// ============================================================
function locksOf(field: { systemLocked?: boolean; structureLocked?: boolean }) {
  const systemLocked = Boolean(field?.systemLocked);
  const structureLocked = systemLocked || Boolean(field?.structureLocked);
  return {
    systemLocked,
    structureLocked,
    level: systemLocked ? 'system-locked' : structureLocked ? 'structure-locked' : 'fully-editable',
  } as const;
}

function projectSkillSync(
  skillId: string,
  stageName: string,
  stage: OrchestrationStage,
  core: ReturnType<typeof loadCoreFile>,
  sync: CoreFieldsSyncSkillReport | null,
) {
  const agentId = `skill:${skillId}`;
  const routings = stage.routings.filter((routing) => routing.agentId === agentId);
  const routedFieldIds = new Set(routings.map((routing) => routing.fieldId));
  const fields = stage.fields.filter((field) => routedFieldIds.has(field.fieldId));
  return {
    skillId,
    stage: stageName,
    agentId,
    routings,
    fields: fields.map((field) => ({ ...field, locks: locksOf(field) })),
    core: {
      exists: Boolean(core?.core),
      fields: core?.core?.fields ?? [],
      diagnostics: core?.diagnostics ?? [],
      sync,
    },
  };
}

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
    pathInRawOutput: row.pathInRawOutput,
    persistKey: row.persistKey,
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
      // promptRole 人话单源：后端 yaml-vocabulary 派生下发，前端图例/徽章只消费（不再各写一份）
      promptRoleMeta: PROMPT_ROLE_META,
    },
  });
});

// ============================================================
// GET /api/admin/field-routings/skill-batch?stage=X
// 阶段级批量 skill 字段路由 + core 状态投影（消灭 FieldRoutingTable 的 N+1，
// ADMIN_PERFORMANCE_AUDIT P4）：一次加载 skills.yaml + 编排文件（各解析一次，
// 经 yaml-file-cache 按 mtime 缓存，跨请求亦复用），对该 stage 下全部 skill
// 循环投影。每条数据结构与 GET /skill/:skillId 单 skill 响应一致
// （不含 promptRoleMeta——该元信息在顶层下发一次，promptRoleMeta 不随 skill 变化）。
// 注意：必须注册在 /skill/:skillId 之前（否则 /skill-batch 会被 skillId='batch'
// 的单 skill 路由吞掉）。
// ============================================================
router.get('/skill-batch', async (req: Request, res: Response) => {
  const stage = String(req.query.stage || '').trim();
  if (!stage) {
    return res.status(400).json({ success: false, error: { message: 'stage 参数缺失' } });
  }

  const filePath = resolveOrchestrationFile(stage);
  if (!filePath) {
    return res.status(404).json({ success: false, error: { message: `编排文件不存在：${stage}` } });
  }

  let stageParsed: OrchestrationStage;
  try {
    stageParsed = parseOrchestrationFile(filePath);
  } catch (error) {
    return res.status(422).json({
      success: false,
      error: { message: `编排文件解析失败（文件本身损坏，需先修复）：${error instanceof Error ? error.message : String(error)}` },
    });
  }

  const book = loadSkillsBookRaw();
  const entries = book.skills.filter((entry) => entry.stage === stage);

  // 全 stage 一次分析：core 加载按 skillId 复用（每 skill 只读盘一次）
  const coreBySkill = new Map<string, ReturnType<typeof loadCoreFile>>();
  const loadCore = (skillId: string): ReturnType<typeof loadCoreFile> => {
    if (!coreBySkill.has(skillId)) coreBySkill.set(skillId, loadCoreFile(skillId));
    return coreBySkill.get(skillId) ?? null;
  };
  const reports = analyzeCoreFieldsSync([stageParsed], entries, loadCore);
  const reportBySkill = new Map(reports.map((report) => [report.skillId, report]));

  res.json({
    success: true,
    data: {
      stage,
      promptRoleMeta: PROMPT_ROLE_META,
      skills: entries.map((entry) =>
        projectSkillSync(entry.skillId, stage, stageParsed, loadCore(entry.skillId), reportBySkill.get(entry.skillId) ?? null),
      ),
    },
  });
});

// ============================================================
// GET /api/admin/field-routings/skill/:skillId
// skill 维度字段路由读取（M1 统一编辑，供「字段路由 tab」消费）：
//   - 该 skill 的产出路由（编排文件 agentId=skill:<id> 的 routings）
//   - 对应 fields 定义（fieldId 从 routings 反查）
//   - core.yaml 对应字段状态投影（analyzeCoreFieldsSync 单 skill：缺项/孤儿/类型不一致）
// 数据源 = 编排文件 + core.yaml（File-as-Truth，与 GET /stages/:stage 的 DB 视图互补）
// ============================================================
router.get('/skill/:skillId', async (req: Request, res: Response) => {
  const skillId = String(req.params.skillId || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(skillId)) {
    return res.status(400).json({ success: false, error: { message: `非法 skillId：${skillId}` } });
  }

  const book = loadSkillsBookRaw();
  const entry = book.skills.find((item) => item.skillId === skillId);
  if (!entry) {
    return res.status(404).json({ success: false, error: { message: `skills.yaml 无该 skill 登记：${skillId}` } });
  }
  if (!entry.stage) {
    return res.status(422).json({ success: false, error: { message: `skill ${skillId} 无编排阶段归属（kind=${entry.kind}）` } });
  }
  const stageName = entry.stage;
  const filePath = resolveOrchestrationFile(stageName);
  if (!filePath) {
    return res.status(404).json({ success: false, error: { message: `编排文件不存在：${stageName}` } });
  }

  let stage: OrchestrationStage;
  try {
    stage = parseOrchestrationFile(filePath);
  } catch (error) {
    return res.status(422).json({
      success: false,
      error: { message: `编排文件解析失败（文件本身损坏，需先修复）：${error instanceof Error ? error.message : String(error)}` },
    });
  }

  // core 状态投影（analyzeCoreFieldsSync 单 skill；mainline 才产报告）
  const core = loadCoreFile(skillId);
  const syncReports = analyzeCoreFieldsSync([stage], [entry], () => core);
  const sync = syncReports.find((report) => report.skillId === skillId) ?? null;

  res.json({
    success: true,
    data: {
      ...projectSkillSync(skillId, stageName, stage, core, sync),
      promptRoleMeta: PROMPT_ROLE_META,
    },
  });
});

// ============================================================
// 编排文件编辑侧（单源化批次 C）
// 编排文件 prompts/orchestration/<stage>.yaml 是字段路由唯一声明源。
// 行级 PATCH /routings/:agentId/:fieldId 与 POST /fields 曾退役（批次 D）；
// 2026-08 编排结构页重构后恢复行级 PATCH（编辑形态回归「编排文件 + 行级并存」）：
//   - 行级 PATCH 只允许编辑路由行属性（render/handoff/internal/accumulate/visibilityPreset/notes），
//     不碰字段定义（字段定义仍走编排文件）；
//   - 落库前将改动回写编排文件对应 routing 条目（File-as-Truth 保持唯一声明源），
//     文件写失败则整体拒绝（DB 与文件不产生分叉）；
//   - 系统锁（systemLocked/structureLocked）路由行禁止行级修改；
//   - 写 node_config_changes 审计（changeType='routing-patch'）。
// ============================================================
router.patch('/routings/:agentId/:fieldId', async (req: Request, res: Response) => {
  const agentId = String(req.params.agentId || '').trim();
  const fieldId = String(req.params.fieldId || '').trim();
  if (!agentId || !fieldId) {
    return res.status(400).json({ success: false, error: { message: 'agentId / fieldId 必填' } });
  }

  // 允许编辑的列白名单（与编排文件 routing 条目键一致）
  const EDITABLE_KEYS = ['render', 'handoff', 'internal', 'accumulate', 'visibilityPreset', 'notes'] as const;

  const body = (req.body || {}) as Record<string, unknown>;
  const edits: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    if (body[key] !== undefined) edits[key] = body[key];
  }
  if (!Object.keys(edits).length) {
    return res.status(400).json({ success: false, error: { message: '无可编辑字段（render/handoff/internal/accumulate/visibilityPreset/notes）' } });
  }
  for (const key of Object.keys(edits)) {
    if (key === 'handoff') {
      const raw = edits.handoff;
      const arr = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw.trim() ? raw.split(/[,\s]+/).filter(Boolean) : [];
      const stageNames = new Set(loadOrchestrationFiles().map((s) => s.stage));
      for (const target of arr) {
        const canonical = getCanonicalAgentId(target);
        if (canonical === target && stageNames.has(target)) continue;
        if (getAgentManifest(canonical)) continue;
        return res.status(422).json({
          success: false,
          error: { message: `handoff 目标 "${target}" 不在 manifest（也不是阶段名）` },
        });
      }
      edits.handoff = arr;
    } else if (key === 'render') {
      const v = String(edits.render);
      if (v !== 'visible' && v !== 'hidden') {
        return res.status(422).json({ success: false, error: { message: 'render 仅允许 visible / hidden' } });
      }
      edits.render = v;
    } else if (key === 'internal' || key === 'accumulate') {
      edits[key] = Boolean(edits[key]);
    } else if (key === 'visibilityPreset') {
      edits[key] = edits[key] ? String(edits[key]) : null;
    } else if (key === 'notes') {
      edits[key] = edits[key] ? String(edits[key]) : null;
    }
  }

  // 定位所属编排文件（路由行按 (agentId, fieldId) 全局唯一）
  const owned = loadOrchestrationFiles().find((s) =>
    s.routings.some((r) => r.agentId === agentId && r.fieldId === fieldId),
  );
  if (!owned) {
    return res.status(404).json({ success: false, error: { message: `编排文件无该路由行：${agentId}/${fieldId}` } });
  }
  const stage = owned.stage;
  const filePath = resolveOrchestrationFile(stage);
  if (!filePath) {
    return res.status(404).json({ success: false, error: { message: `编排文件不存在：${stage}` } });
  }

  // 读当前 DB 行（锁判定 + 审计 before）
  const dbRow = await systemPrisma.agent_field_routings.findUnique({
    where: { agentId_fieldId: { agentId, fieldId } },
  });
  if (!dbRow) {
    return res.status(404).json({ success: false, error: { message: `DB 路由行不存在：${agentId}/${fieldId}（请先同步编排文件）` } });
  }
  if (dbRow.systemLocked || dbRow.structureLocked) {
    return res.status(423).json({
      success: false,
      error: { message: '该路由行为系统锁/结构锁，不可行级修改（需改编排文件）' },
    });
  }
  // 字段定义级锁：字段 systemLocked → 该字段的所有路由行均锁定
  const fieldDef = await systemPrisma.field_definitions.findFirst({
    where: { stage, fieldId },
    select: { systemLocked: true, structureLocked: true },
  });
  if (fieldDef && (fieldDef.systemLocked || fieldDef.structureLocked)) {
    return res.status(423).json({
      success: false,
      error: { message: '该字段为系统锁/结构锁（字段定义级），不可行级修改（需改编排文件）' },
    });
  }

  // 行级修改 → 写回编排文件对应 routing 条目（File-as-Truth 单源化保持）
  const yaml = await fs.promises.readFile(filePath, 'utf-8');
  const beforeText = yaml;
  const lines = yaml.split('\n');
  // 定位该 (agentId, fieldId) 的 routing 条目：routings 段内逐块扫描
  // （块 = 每条「- agentId: X」起始到下一个「- agentId:」前；goal-agent 的桥接路由
  //   可能被 YAML 拆成多段，不能只取首个同名 agent 块）
  let entryStart = -1;
  let entryEndInBlock = 0;
  let blockBase = 0;
  const routingsIdx = lines.findIndex((l) => l.trim() === 'routings:');
  const scanStart = routingsIdx >= 0 ? routingsIdx : 0;
  for (let i = scanStart; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('- agentId:')) continue;
    const idMatch = t.match(/agentId:\s*"?([^"\s]+)"?/);
    if (!idMatch || idMatch[1] !== agentId) continue;
    const nextBlock = lines.slice(i + 1).findIndex((l) => l.trim().startsWith('- agentId:'));
    const blockEndAbs = nextBlock >= 0 ? i + 1 + nextBlock : lines.length;
    const blockLines = lines.slice(i, blockEndAbs);
    const fIdx = blockLines.findIndex((l) => l.trim().startsWith('fieldId:'));
    if (fIdx < 0) continue;
    const idText = blockLines[fIdx].trim().replace(/^fieldId:\s*/, '').replace(/['"]/g, '').trim();
    if (idText !== fieldId) continue;
    entryStart = i;
    entryEndInBlock = blockEndAbs;
    blockBase = i;
    break;
  }  if (entryStart < 0) {
    return res.status(422).json({
      success: false,
      error: { message: `编排文件 ${stage}.yaml 未找到 ${agentId}/${fieldId} 路由条目（文件与声明不一致，请先同步）` },
    });
  }
  const entryLines = lines.slice(blockBase, entryEndInBlock);

  const indent = (entryLines[0].match(/^\s*/) || [''])[0];
  const keyIndent = `${indent}  `;
  const edited = [...entryLines];
  const setKey = (key: string, value: string) => {
    const idx = edited.findIndex((l) => l.trim().startsWith(`${key}:`));
    const line = `${keyIndent}${key}: ${value}`;
    if (idx >= 0) edited[idx] = line;
    else edited.splice(edited.length, 0, line);
  };
  for (const key of Object.keys(edits) as Array<keyof typeof edits>) {
    let value = edits[key];
    if (key === 'handoff') {
      value = Array.isArray(value) && (value as string[]).length ? `[${(value as string[]).map((v) => `'${v}'`).join(', ')}]` : '[]';
    } else if (key === 'internal' || key === 'accumulate') {
      value = value ? 'true' : 'false';
    } else if (value == null || value === '') {
      value = 'null';
    }
    setKey(key, String(value));
  }

  const next = [...lines.slice(0, blockBase), ...edited, ...lines.slice(entryEndInBlock)];
  const nextText = next.join('\n');
  // 写盘前整体校验（防止行级编辑破坏文件）
  try {
    validateOrchestrationContent(nextText);
  } catch (error) {
    return res.status(422).json({
      success: false,
      error: { message: `行级编辑后的编排文件校验失败（已拒绝写盘）：${error instanceof Error ? error.message : String(error)}` },
    });
  }

  await fs.promises.writeFile(filePath, nextText, 'utf-8');

  // DB 同步（仅更新业务列；managedByCode=false 的 admin 覆盖行也允许（行级编辑即 admin 覆盖））
  const nextData: Record<string, unknown> = {
    render: edits.render !== undefined ? edits.render : dbRow.render,
    handoff: edits.handoff !== undefined
      ? ((edits.handoff as string[]).length ? JSON.stringify(edits.handoff) : null)
      : dbRow.handoff,
    internalFlag: edits.internal !== undefined ? edits.internal : dbRow.internalFlag,
    accumulate: edits.accumulate !== undefined ? edits.accumulate : dbRow.accumulate,
    visibilityPreset: edits.visibilityPreset !== undefined ? edits.visibilityPreset : dbRow.visibilityPreset,
    notes: edits.notes !== undefined ? edits.notes : dbRow.notes,
    updatedAt: new Date(),
  };
  // 覆盖 DB 中与本次编辑相关的脏值（notes 等）：
  // 同步时将文件声明值回写 DB，保证「文件为准」在行级编辑后依然成立
  const fileSync = async () => {
    const refreshed = loadOrchestrationFiles().find((s) => s.stage === stage);
    if (!refreshed) return;
    const fileRouting = refreshed.routings.find((r) => r.agentId === agentId && r.fieldId === fieldId);
    if (!fileRouting) return;
    await systemPrisma.agent_field_routings.update({
      where: { agentId_fieldId: { agentId, fieldId } },
      data: {
        render: fileRouting.render,
        handoff: fileRouting.handoff.length ? JSON.stringify(fileRouting.handoff) : null,
        internalFlag: fileRouting.internal,
        accumulate: fileRouting.accumulate,
        visibilityPreset: fileRouting.visibilityPreset ?? null,
        notes: fileRouting.notes ?? null,
        updatedAt: new Date(),
      },
    });
  };
  await fileSync();

  // 审计（before = 编辑前 routing 行；after = 编辑后行）
  try {
    const actorId = (req as Request & { user?: { userId?: string } }).user?.userId || 'admin';
    const afterHandoff = edits.handoff !== undefined ? edits.handoff : (parseJson<string[]>(dbRow.handoff) || []);
    await writeNodeConfigChange(systemPrisma, {
      changeType: 'routing-patch',
      targetTable: 'agent_field_routings',
      targetId: `${agentId}/${fieldId}`,
      agentId,
      fieldId,
      before: {
        render: dbRow.render,
        handoff: parseJson<string[]>(dbRow.handoff) || [],
        internal: dbRow.internalFlag,
        accumulate: dbRow.accumulate,
        visibilityPreset: dbRow.visibilityPreset,
        notes: dbRow.notes,
      },
      after: {
        render: nextData.render,
        handoff: afterHandoff,
        internal: nextData.internalFlag,
        accumulate: nextData.accumulate,
        visibilityPreset: nextData.visibilityPreset,
        notes: nextData.notes,
      },
      actorId,
      reason: `行级编辑 ${agentId}/${fieldId}（${stage}）——已回写编排文件 ${stage}.yaml`,
    });
  } catch (auditError) {
    logger.warn('[field-routings] routing-patch audit write failed（不阻断保存）', { agentId, fieldId, error: auditError instanceof Error ? auditError.message : String(auditError) });
  }

  clearRoutingCache();
  clearSupplementRenderCache();

  const afterRow = await systemPrisma.agent_field_routings.findUnique({
    where: { agentId_fieldId: { agentId, fieldId } },
  });
  res.json({
    success: true,
    data: {
      stage,
      routing: afterRow ? serializeRouting(afterRow) : null,
      fileUpdated: true,
      syncHint: '已同步编排文件与 DB（行级编辑即 admin 覆盖，后续全量同步将保留该行）',
    },
  });
});

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

  // 写盘前快照（P2 审计 before 摘要的数据源）
  let beforeText = '';
  try {
    beforeText = await fs.promises.readFile(filePath, 'utf-8');
  } catch (error) {
    logger.warn('[field-routings] orchestration before-snapshot read failed', { stage, error: error instanceof Error ? error.message : String(error) });
  }

  // 写盘（文件为准）
  await fs.promises.writeFile(filePath, content, 'utf-8');

  // P2 审计补强：编排保存写 node_config_changes（changeType='orchestration-save'，
  // before/after = 保存前/后文件摘要：行数 + 字符数 + sha1 短哈希）——失败不阻断保存
  try {
    const actorId = (req as Request & { user?: { userId?: string } }).user?.userId || 'admin';
    await writeNodeConfigChange(systemPrisma, {
      changeType: 'orchestration-save',
      targetTable: 'orchestration',
      targetId: stage,
      before: summarizeTextDigest(beforeText),
      after: summarizeTextDigest(content),
      actorId,
      reason: '编排文件 PUT 保存（admin 管理端编排弹窗）',
    });
  } catch (auditError) {
    logger.warn('[field-routings] orchestration-save audit write failed（不阻断保存）', { stage, error: auditError instanceof Error ? auditError.message : String(auditError) });
  }

  // 立即 ensure（只建不更新：新字段/新路由进 DB；已有行属性修改待同步）——失败不阻断写盘结果
  let synced = true;
  let syncHint = '';
  try {
    await ensureStageFieldRoutings(systemPrisma, validated);
  } catch (error) {
    synced = false;
    syncHint = `DB 同步失败：${error instanceof Error ? error.message : String(error)}（新建行未入库，请复查漂移明细）`;
  }
  if (synced) {
    syncHint = '新建字段/路由已生效；已有行属性修改需执行同步后生效（或重启后由启动对账覆盖）';
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
// 实现：syncStageFieldRoutingsFromFile（field-routing-bootstrap.service，
// 与 CLI 脚本 / health-center 一键修复共用同一实现）
// ============================================================
router.post('/orchestration/:stage/sync', async (req: Request, res: Response) => {
  const stage = String(req.params.stage || '').trim();
  const found = loadOrchestrationFiles().find((s) => s.stage === stage);
  if (!found) {
    return res.status(404).json({ success: false, error: { message: `编排文件不存在：${stage}` } });
  }

  const report = await syncStageFieldRoutingsFromFile(systemPrisma, found);

  clearRoutingCache();
  clearSupplementRenderCache();

  res.json({
    success: true,
    data: {
      stage: report.stage,
      contractsUpdated: report.contractsUpdated,
      fieldsUpdated: report.fieldsUpdated,
      routingsUpdated: report.routingsUpdated,
      createdCount: report.createdCount,
      skippedAdminRows: report.skippedAdminRows,
    },
  });
});

// ============================================================
// POST /api/admin/field-routings/orchestration/:stage/prune
// 清理孤儿行（变更路径审计 C 缺口补全）：编排文件为唯一声明源，
// 删除声明中已不存在的 DB 行（managedByCode=true；managedByCode=false 覆盖行只报告不删）。
// body: { dryRun?: boolean } —— 默认 true（只报告不删）；dryRun=false 才执行删除，
// 删除前逐行写 node_config_changes 审计（changeType='orchestration-prune'，before=被删行全量）。
// ============================================================
router.post('/orchestration/:stage/prune', async (req: Request, res: Response) => {
  const stage = String(req.params.stage || '').trim();
  const found = loadOrchestrationFiles().find((s) => s.stage === stage);
  if (!found) {
    return res.status(404).json({ success: false, error: { message: `编排文件不存在：${stage}` } });
  }

  const dryRun = (req.body || {}).dryRun !== false;
  const actorId = (req as Request & { user?: { userId?: string } }).user?.userId || 'admin';

  try {
    const report = await pruneStageFieldRoutings(systemPrisma, found, { dryRun, actorId });

    clearRoutingCache();
    clearSupplementRenderCache();

    res.json({
      success: true,
      data: {
        stage: report.stage,
        dryRun: report.dryRun,
        candidates: report.candidates,
        protectedRows: report.protectedRows,
        deletedCount: report.deletedCount,
        auditIds: report.auditIds,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'orchestration prune failed' },
    });
  }
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
        // P2：stage 级审计（orchestration-save / orchestration-prune 等 targetTable='orchestration' 的行
        // 不带 agentId/fieldId，按 targetId=stage 命中，避免被行级过滤漏掉）
        { targetTable: 'orchestration', targetId: stage },
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
