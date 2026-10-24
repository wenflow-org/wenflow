/**
 * Skill 字段原子编辑引擎 · 改字段（2026-10-24 架构优化批 1：routes/prompt-lab.ts 拆分迁出）。
 *
 * 含改/删共用的双文件读取与字段定位（loadSkillFieldContext）、现状快照、
 * PATCH 载荷 → 目标快照、路由语义校验与幂等比对。协议见路由侧注释。
 */
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger';
import { parseCoreFile, CORE_FILES_DIR, type CoreFile } from './core-file-loader';
import {
  updateFieldInCore,
  updateFieldInOrchestration,
  type CoreFieldUpdateSpec,
  type OrchestrationFieldUpdateSpec,
  type OrchestrationRoutingUpdateSpec,
} from '../skill-registry/skill-scaffold.service';
import { loadSkillsBookRaw, SKILL_STAGES, type SkillEntry } from '../skill-registry/skills-file';
import {
  ORCHESTRATION_DIR,
  parseOrchestrationFile,
  validateOrchestrationContent,
  type OrchestrationField,
  type OrchestrationRouting,
  type OrchestrationStage,
} from '../field-routing/orchestration-file';
import { syncStageRoutingsForStage } from '../field-routing/admin-field-routings.repo';
import { clearRoutingCache } from '../field-dispatcher';
import { clearSupplementRenderCache } from '../prompt-composer';
import { analyzeCoreFieldsSync } from '../prompt-manifest/check-core-fields-sync';
import {
  CORE_FIELD_TYPES,
  PROMPT_ROLES,
  RENDER_VALUES,
  VISIBILITY_PRESETS,
  coreTypeToValueType,
  stripOptionalSuffix,
} from '../yaml-vocabulary';
import { getAgentManifest, getCanonicalAgentId } from '../agent-manifest.service';
import { writeNodeConfigChangeToSystemDb } from '../node-config-change-audit';
import {
  CORE_FIELD_NAME_SEGMENT,
  FIELD_ADD_BACKUPS_DIR,
  SkillFieldEditError,
  fieldAddBooleanFlag,
  fieldAddTrimmedString,
  type SkillFieldSnapshot,
  type SkillFieldUpdateRequest,
  type SkillFieldUpdateResult,
} from './skill-field-shared';

/** 解析 core 顶层字段 desc 中的子字段说明（`· path（type）desc`），供嵌套字段定位/摘要 */
function parseCoreChildNote(desc: string, childPath: string): { type: string; desc: string } | null {
  const escaped = childPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)\\s*·\\s*${escaped}\\s*（([^）]*)）\\s*([^\\n]*)`);
  const match = desc.match(re);
  if (!match) return null;
  const typeToken = match[1].trim().split(/[，,（]/)[0].trim();
  return { type: typeToken, desc: match[2].trim() };
}

/** 读取双文件并定位字段（改/删共用）；任一缺失 → 404 */
export async function loadSkillFieldContext(skillId: string, name: string): Promise<{
  entry: SkillEntry;
  stageName: string;
  agentId: string;
  isNested: boolean;
  root: string;
  corePath: string;
  orchestrationPath: string;
  coreText: string;
  core: CoreFile;
  coreField: CoreFile['fields'][number];
  orchestrationText: string;
  stage: OrchestrationStage;
  orchField: OrchestrationField;
  orchRouting: OrchestrationRouting;
  childNote: { type: string; desc: string } | null;
}> {
  const nameSegments = name.split('.');
  if (!nameSegments.every((seg) => CORE_FIELD_NAME_SEGMENT.test(seg))) {
    throw new SkillFieldEditError(
      400,
      'FIELD_NAME_INVALID',
      `字段名 "${name}" 非法（每段须小写字母开头，仅含字母/数字/下划线，可点分嵌套）`,
    );
  }
  const isNested = nameSegments.length > 1;
  const root = nameSegments[0];

  const book = loadSkillsBookRaw();
  const entry = book.skills.find((item) => item.skillId === skillId);
  if (!entry) throw new SkillFieldEditError(404, 'SKILL_NOT_FOUND', `skills.yaml 无该 skill 登记：${skillId}`);
  if (!entry.stage) throw new SkillFieldEditError(422, 'SKILL_NO_STAGE', `skill ${skillId} 无编排阶段归属（kind=${entry.kind}）`);
  const stageName = entry.stage;
  const agentId = `skill:${skillId}`;
  const corePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
  const orchestrationPath = path.join(ORCHESTRATION_DIR, `${stageName}.yaml`);

  let coreText: string;
  try {
    coreText = await fs.readFile(corePath, 'utf-8');
  } catch {
    throw new SkillFieldEditError(404, 'CORE_FILE_MISSING', `核心文件不存在: prompts/core/${skillId}.yaml`);
  }
  const parsedCore = parseCoreFile(corePath, coreText);
  if (!parsedCore.core) {
    throw new SkillFieldEditError(
      422,
      'CORE_FILE_INVALID',
      `核心文件 schema 不合法：${parsedCore.diagnostics.map((d) => d.message).join('；')}`,
    );
  }
  const core = parsedCore.core;

  let orchestrationText: string;
  try {
    orchestrationText = await fs.readFile(orchestrationPath, 'utf-8');
  } catch {
    throw new SkillFieldEditError(404, 'ORCHESTRATION_FILE_MISSING', `编排文件不存在: prompts/orchestration/${stageName}.yaml`);
  }
  let stage: OrchestrationStage;
  try {
    stage = parseOrchestrationFile(orchestrationPath);
  } catch (error) {
    throw new SkillFieldEditError(422, 'ORCHESTRATION_FILE_INVALID', `编排文件解析失败：${(error as Error).message}`);
  }

  const coreField = core.fields.find((f) => f.name === root);
  const orchField = stage.fields.find((f) => f.fieldId === name);
  const orchRouting = stage.routings.find((r) => r.agentId === agentId && r.fieldId === name);

  let childNote: { type: string; desc: string } | null = null;
  if (isNested) {
    childNote = coreField ? parseCoreChildNote(coreField.desc, nameSegments.slice(1).join('.')) : null;
  }
  const corePresent = coreField !== undefined && (!isNested || childNote !== null);
  if (!corePresent || !orchField || !orchRouting) {
    throw new SkillFieldEditError(
      404,
      'FIELD_NOT_FOUND',
      `字段 ${name} 不存在（core fields / 编排 fields / 编排 routings 三处需同名登记）`,
    );
  }
  return {
    entry,
    stageName,
    agentId,
    isNested,
    root,
    corePath,
    orchestrationPath,
    coreText,
    core,
    coreField,
    orchestrationText,
    stage,
    orchField,
    orchRouting,
    childNote,
  };
}

/** 字段现状摘要（before 审计 / 幂等比对 / 编辑预填共用的归一视图） */
export function buildSkillFieldSnapshot(
  ctx: {
    isNested: boolean;
    coreField: CoreFile['fields'][number];
    orchField: OrchestrationField;
    orchRouting: OrchestrationRouting;
    childNote: { type: string; desc: string } | null;
  },
  name: string,
): SkillFieldSnapshot {
  const { isNested, coreField, orchField, orchRouting, childNote } = ctx;
  let coreType = coreField.type;
  let turn = Boolean(coreField.turn);
  let desc = coreField.desc;
  if (isNested && childNote) {
    coreType = childNote.type;
    turn = false;
    desc = childNote.desc;
  }
  const locked = orchField.systemLocked ? 'system' : orchField.structureLocked ? 'structure' : null;
  return {
    name,
    root: name.split('.')[0],
    isNested,
    coreType,
    turn,
    promptRole: orchField.promptRole,
    valueType: orchField.valueType,
    persistKey: orchField.persistKey ?? null,
    pathInRawOutput: orchField.pathInRawOutput ?? null,
    render: orchRouting.render,
    handoff: [...orchRouting.handoff],
    internal: orchRouting.internal,
    accumulate: orchRouting.accumulate,
    visibilityPreset: orchRouting.visibilityPreset ?? null,
    locked,
    desc,
  };
}

/** PATCH 载荷校验 → 完整"目标快照"（undefined 保持现状；''/null 清除可选声明） */
export function resolveFieldUpdateTarget(
  before: SkillFieldSnapshot,
  payload: SkillFieldUpdateRequest,
): SkillFieldSnapshot {
  const isNested = before.isNested;

  let rawType = before.coreType;
  if (payload.type !== undefined) {
    const t = fieldAddTrimmedString(payload.type);
    if (!t) throw new SkillFieldEditError(400, 'FIELD_TYPE_REQUIRED', 'type（core 类型）不能为空');
    const baseType = stripOptionalSuffix(t);
    if (!(CORE_FIELD_TYPES as readonly string[]).includes(baseType)) {
      throw new SkillFieldEditError(
        400,
        'FIELD_TYPE_UNKNOWN',
        `type "${t}" 不在受控词表（${CORE_FIELD_TYPES.join(' | ')}，可带 ? 后缀）`,
      );
    }
    if (!t.endsWith('?') && t !== baseType) {
      throw new SkillFieldEditError(400, 'FIELD_TYPE_INVALID', `type "${t}" 非法（? 只能作后缀）`);
    }
    rawType = isNested ? baseType : t;
  }
  const valueType = coreTypeToValueType(rawType);
  if (valueType === undefined) {
    throw new SkillFieldEditError(
      422,
      'VALUE_TYPE_UNMAPPABLE',
      `type "${rawType}"（enum）为 core-only，编排侧无对应 valueType，请人工登记编排侧或选用其它类型`,
    );
  }

  const role = payload.role !== undefined ? (fieldAddTrimmedString(payload.role) ?? '') : before.promptRole;
  if (!role) throw new SkillFieldEditError(400, 'FIELD_DESC_REQUIRED', 'role 不能为空');
  if (!(PROMPT_ROLES as readonly string[]).includes(role)) {
    throw new SkillFieldEditError(400, 'ROLE_UNKNOWN', `role "${role}" 非法（须在 ${PROMPT_ROLES.join(',')} 中）`);
  }

  const render = payload.render !== undefined ? (fieldAddTrimmedString(payload.render) ?? '') : before.render;
  if (!render) throw new SkillFieldEditError(400, 'RENDER_UNKNOWN', 'render 不能为空');
  if (!(RENDER_VALUES as readonly string[]).includes(render)) {
    throw new SkillFieldEditError(400, 'RENDER_UNKNOWN', `render "${render}" 非法（须在 ${RENDER_VALUES.join(',')} 中）`);
  }

  const handoff = payload.handoff !== undefined
    ? Array.isArray(payload.handoff)
      ? payload.handoff.map((item) => fieldAddTrimmedString(item)).filter((item): item is string => item !== null)
      : before.handoff
    : [...before.handoff];

  const internal = payload.internal !== undefined ? fieldAddBooleanFlag(payload.internal, before.internal) : before.internal;
  const accumulate = payload.accumulate !== undefined
    ? fieldAddBooleanFlag(payload.accumulate, before.accumulate)
    : before.accumulate;

  const visibilityPreset = payload.visibilityPreset !== undefined
    ? (fieldAddTrimmedString(payload.visibilityPreset) ?? null)
    : before.visibilityPreset;
  if (visibilityPreset !== null && !(VISIBILITY_PRESETS as readonly string[]).includes(visibilityPreset)) {
    throw new SkillFieldEditError(
      400,
      'VISIBILITY_PRESET_UNKNOWN',
      `visibilityPreset "${visibilityPreset}" 非法（须在 ${VISIBILITY_PRESETS.join(',')} 中）`,
    );
  }

  let locked = before.locked;
  if (payload.locked !== undefined) {
    const raw = payload.locked === null ? null : fieldAddTrimmedString(payload.locked);
    if (raw === null || raw === '') locked = null;
    else if (raw === 'system' || raw === 'structure') locked = raw;
    else throw new SkillFieldEditError(400, 'LOCKED_UNKNOWN', 'locked 非法（可选 system | structure，空串清除）');
  }
  if (locked === 'system') {
    throw new SkillFieldEditError(409, 'FIELD_SYSTEM_LOCKED', 'systemLocked 字段为平台派生/代码消费，禁止通过字段编辑 API 修改（需走编排文件）');
  }

  const desc = payload.desc !== undefined ? (fieldAddTrimmedString(payload.desc) ?? '') : before.desc;
  if (!desc) throw new SkillFieldEditError(400, 'FIELD_DESC_REQUIRED', 'desc（功能描述/生成指令）必填');

  const persistKey = payload.persistKey !== undefined
    ? (fieldAddTrimmedString(payload.persistKey) ?? null)
    : before.persistKey;
  const pathInRawOutput = payload.pathInRawOutput !== undefined
    ? (fieldAddTrimmedString(payload.pathInRawOutput) ?? null)
    : before.pathInRawOutput;

  const turn = isNested ? false : payload.turn !== undefined ? fieldAddBooleanFlag(payload.turn, before.turn) : before.turn;

  return {
    ...before,
    coreType: rawType,
    turn,
    promptRole: role,
    valueType,
    persistKey,
    pathInRawOutput,
    render,
    handoff,
    internal,
    accumulate,
    visibilityPreset,
    locked,
    desc,
  };
}

/** 路由语义校验（镜像 POST/seed：自环 / 目标存在性 / render+internal / 无流转去向） */
export function validateRoutingSemantics(agentId: string, target: SkillFieldSnapshot): void {
  if (target.handoff.includes(agentId)) {
    throw new SkillFieldEditError(422, 'HANDOFF_SELF_LOOP', `handoff 自环（指向自身 ${agentId}）`);
  }
  for (const handoffTarget of target.handoff) {
    const canonical = getCanonicalAgentId(handoffTarget);
    if (handoffTarget === canonical && (SKILL_STAGES as readonly string[]).includes(canonical as never)) continue;
    if (getAgentManifest(canonical)) continue;
    throw new SkillFieldEditError(
      422,
      'HANDOFF_TARGET_UNKNOWN',
      `handoff 目标 "${handoffTarget}" 不在 manifest（也不是阶段名 ${SKILL_STAGES.join('/')}）`,
    );
  }
  if (target.render === 'visible' && target.internal && target.promptRole !== 'control-signal') {
    throw new SkillFieldEditError(422, 'RENDER_INTERNAL_CONFLICT', 'render=visible 与 internal=true 组合仅允许 control-signal 字段');
  }
  if (target.handoff.length === 0 && !target.internal && !target.accumulate && target.render === 'visible' && target.promptRole !== 'public-reply') {
    throw new SkillFieldEditError(
      422,
      'ROUTING_NO_FLOW',
      'handoff 为空且非 public-reply/画像终点（internal+accumulate），缺少流转去向',
    );
  }
}

/** 幂等比对：目标快照与现状快照逐属性一致 → true */
export function snapshotsEqual(a: SkillFieldSnapshot, b: SkillFieldSnapshot): boolean {
  const keys: Array<keyof SkillFieldSnapshot> = [
    'coreType', 'turn', 'promptRole', 'valueType', 'persistKey', 'pathInRawOutput',
    'render', 'handoff', 'internal', 'accumulate', 'visibilityPreset', 'locked', 'desc',
  ];
  return keys.every((key) => {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(va) || Array.isArray(vb)) return JSON.stringify(va) === JSON.stringify(vb);
    return va === vb;
  });
}

/**
 * 原子改字段主流程（导出于单测直接调用；路由侧薄封装）。
 * 落库采用 sync 全量对账（update 语义）：managedByCode=true 行更新、false 行跳过并报告。
 */
export async function updateSkillFieldInCoreAndOrchestration(
  skillId: string,
  name: string,
  payload: SkillFieldUpdateRequest,
  opts: { actorId?: string } = {},
): Promise<SkillFieldUpdateResult> {
  const ctx = await loadSkillFieldContext(skillId, name);
  const { entry, stageName, agentId, isNested, corePath, orchestrationPath, coreText, core, orchestrationText, stage, orchField } = ctx;

  // 系统锁保护（409）：platform 派生/代码消费字段只读
  if (orchField.systemLocked) {
    throw new SkillFieldEditError(
      409,
      'FIELD_SYSTEM_LOCKED',
      `字段 ${name} 为 systemLocked（平台派生/代码消费），禁止通过字段编辑 API 修改（只读，需走编排文件）`,
      { lockReason: 'systemLocked' },
    );
  }

  const before = buildSkillFieldSnapshot(ctx, name);
  const after = resolveFieldUpdateTarget(before, payload);
  validateRoutingSemantics(agentId, after);

  // 幂等：无变化 → 不写盘 / 不落库 / 不审计
  const changed = !snapshotsEqual(before, after);
  const syncCheck = analyzeCoreFieldsSync([stage], [entry], () => ({ core })).find((r) => r.skillId === skillId) ?? null;
  if (!changed) {
    return {
      skillId,
      stage: stageName,
      name,
      changed: false,
      coreWritten: false,
      orchestrationWritten: false,
      dbSync: { fieldsUpdated: 0, routingsUpdated: 0, contractsUpdated: 0, createdCount: 0, skippedAdminRows: [] },
      syncCheck,
      auditId: '',
    };
  }

  // 内存修改 + parse 双校验（任一失败 → 不落任何文件）
  const coreSpec: CoreFieldUpdateSpec = isNested
    ? { name, child: { path: name.split('.').slice(1).join('.'), type: after.coreType, desc: after.desc } }
    : { name, type: after.coreType, desc: after.desc, turn: after.turn };
  const newCoreText = updateFieldInCore(coreText, coreSpec);
  const coreChecked = parseCoreFile(corePath, newCoreText);
  if (!coreChecked.core) {
    throw new SkillFieldEditError(
      422,
      'CORE_VALIDATION_FAILED',
      `修改后核心文件未通过 parseCoreFile：${coreChecked.diagnostics.map((d) => d.message).join('；')}`,
    );
  }
  const newCore = coreChecked.core;

  const fieldSpec: OrchestrationFieldUpdateSpec = {
    fieldId: name,
    promptRole: after.promptRole,
    valueType: after.valueType,
    pathInRawOutput: after.pathInRawOutput,
    persistKey: after.persistKey,
    description: after.desc,
    systemLocked: after.locked === 'system' ? true : null,
    structureLocked: after.locked === 'structure' ? true : null,
  };
  const routingSpec: OrchestrationRoutingUpdateSpec = {
    agentId,
    fieldId: name,
    render: after.render,
    handoff: after.handoff,
    internal: after.internal,
    accumulate: after.accumulate,
    visibilityPreset: after.visibilityPreset,
  };
  const newOrchestrationText = updateFieldInOrchestration(orchestrationText, fieldSpec, routingSpec);
  let newStage: OrchestrationStage;
  try {
    newStage = validateOrchestrationContent(newOrchestrationText);
  } catch (error) {
    throw new SkillFieldEditError(
      422,
      'ORCHESTRATION_VALIDATION_FAILED',
      `修改后编排文件未通过 validateOrchestrationContent：${(error as Error).message}`,
    );
  }

  // 备份 + 写盘（编排写失败 → 回滚 core）
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(FIELD_ADD_BACKUPS_DIR, ts);
  try {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(corePath, path.join(backupDir, `core-${skillId}.yaml`));
    await fs.copyFile(orchestrationPath, path.join(backupDir, `orchestration-${stageName}.yaml`));
  } catch {
    // 备份失败不阻断（与既有备份模式一致）
  }
  await fs.writeFile(corePath, newCoreText, 'utf-8');
  try {
    await fs.writeFile(orchestrationPath, newOrchestrationText, 'utf-8');
  } catch (error) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    throw new SkillFieldEditError(
      500,
      'ORCHESTRATION_WRITE_FAILED',
      `编排文件写盘失败（core 已回滚原内容）：${(error as Error).message}；恢复备份参考：${backupDir}`,
    );
  }

  // fields-sync 复检（违规 → 双文件回滚）
  const recheckReport = analyzeCoreFieldsSync([newStage], [entry], () => ({ core: newCore })).find((r) => r.skillId === skillId) ?? null;
  const recheckFailed = recheckReport !== null
    && (recheckReport.missing.some((item) => item.fieldId === name || item.root === ctx.root)
      || recheckReport.typeMismatch.some((item) => item.fieldId === name));
  if (recheckFailed) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    await fs.writeFile(orchestrationPath, orchestrationText, 'utf-8').catch(() => undefined);
    throw new SkillFieldEditError(
      422,
      'FIELDS_SYNC_RECHECK_FAILED',
      'fields-sync 复检未通过（缺项/类型不一致），已回滚双文件（恢复原内容）',
      { syncCheck: recheckReport },
    );
  }

  // 落库：sync 全量对账（update 语义；managedByCode=false 行跳过并报告）
  let dbSync: SkillFieldUpdateResult['dbSync'] = {
    fieldsUpdated: 0, routingsUpdated: 0, contractsUpdated: 0, createdCount: 0, skippedAdminRows: [],
  };
  try {
    const report = await syncStageRoutingsForStage(newStage);
    dbSync = {
      fieldsUpdated: report.fieldsUpdated,
      routingsUpdated: report.routingsUpdated,
      contractsUpdated: report.contractsUpdated,
      createdCount: report.createdCount,
      skippedAdminRows: report.skippedAdminRows,
    };
  } catch (error) {
    logger.warn('[prompt-lab] skill-field-update db sync failed（不阻断写盘结果）', {
      skillId,
      name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 审计（changeType='skill-field-update'；before=原摘要，after=新摘要）
  let auditId = '';
  try {
    auditId = await writeNodeConfigChangeToSystemDb({
      changeType: 'skill-field-update',
      targetTable: 'core.yaml+orchestration',
      targetId: skillId,
      agentId,
      fieldId: name,
      before,
      after,
      actorId: opts.actorId ?? 'admin',
      reason: '改字段原子编辑（core.yaml + 编排文件双写 + sync 全量对账落库）',
    });
  } catch (auditError) {
    logger.warn('[prompt-lab] skill-field-update audit write failed（不阻断）', {
      skillId,
      error: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }

  try {
    clearRoutingCache();
    clearSupplementRenderCache();
  } catch {
    // 缓存清理失败不阻断
  }

  return {
    skillId,
    stage: stageName,
    name,
    changed: true,
    coreWritten: true,
    orchestrationWritten: true,
    dbSync,
    syncCheck: recheckReport,
    auditId,
  };
}
