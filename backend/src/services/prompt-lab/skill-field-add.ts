/**
 * Skill 字段原子编辑引擎 · 加字段（2026-10-24 架构优化批 1：routes/prompt-lab.ts 拆分迁出）。
 *
 * 契约与原子性协议见路由侧注释（POST /core/:skillId/field）；本模块是纯业务流程，
 * 不感知 HTTP。导出于单测直接调用。
 */
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger';
import { parseCoreFile, CORE_FILES_DIR, FORBIDDEN_PLATFORM_FIELDS } from './core-file-loader';
import {
  appendFieldToCore,
  appendFieldToOrchestration,
  type CoreFieldAppendSpec,
  type OrchestrationFieldAppendSpec,
  type OrchestrationRoutingAppendSpec,
} from '../skill-registry/skill-scaffold.service';
import { loadSkillsBookRaw, SKILL_STAGES } from '../skill-registry/skills-file';
import {
  ORCHESTRATION_DIR,
  parseOrchestrationFile,
  validateOrchestrationContent,
  type OrchestrationStage,
} from '../field-routing/orchestration-file';
import { ensureStageRoutingsForStage } from '../field-routing/admin-field-routings.repo';
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
  SkillFieldAddError,
  fieldAddBooleanFlag,
  fieldAddTrimmedString,
  type SkillFieldAddRequest,
  type SkillFieldAddResult,
} from './skill-field-shared';

/** 原子加字段主流程（导出于单测直接调用；路由侧薄封装） */
export async function addSkillFieldToCoreAndOrchestration(
  skillId: string,
  payload: SkillFieldAddRequest,
  opts: { actorId?: string } = {},
): Promise<SkillFieldAddResult> {
  // ---- 1. 输入校验（400/422） ----
  const name = fieldAddTrimmedString(payload.name);
  if (!name) throw new SkillFieldAddError(400, 'FIELD_NAME_REQUIRED', 'name（字段名）必填');
  const nameSegments = name.split('.');
  if (!nameSegments.every((seg) => CORE_FIELD_NAME_SEGMENT.test(seg))) {
    throw new SkillFieldAddError(
      400,
      'FIELD_NAME_INVALID',
      `name "${name}" 非法（每段须小写字母开头，仅含字母/数字/下划线，可点分嵌套，如 understanding.surface_goal）`,
    );
  }
  const isNested = nameSegments.length > 1;
  const root = nameSegments[0];
  if (!isNested && (FORBIDDEN_PLATFORM_FIELDS as readonly string[]).includes(name)) {
    throw new SkillFieldAddError(
      422,
      'FIELD_NAME_PLATFORM',
      `字段名 "${name}" 是平台包装字段（success/quality/stage/raw），禁止出现在字段表（§2.4.3）`,
    );
  }

  const rawType = fieldAddTrimmedString(payload.type);
  if (!rawType) throw new SkillFieldAddError(400, 'FIELD_TYPE_REQUIRED', 'type（core 类型）必填');
  const baseType = stripOptionalSuffix(rawType);
  if (!(CORE_FIELD_TYPES as readonly string[]).includes(baseType)) {
    throw new SkillFieldAddError(
      400,
      'FIELD_TYPE_UNKNOWN',
      `type "${rawType}" 不在受控词表（${CORE_FIELD_TYPES.join(' | ')}，可带 ? 后缀）`,
    );
  }
  if (!rawType.endsWith('?') && rawType !== baseType) {
    throw new SkillFieldAddError(400, 'FIELD_TYPE_INVALID', `type "${rawType}" 非法（? 只能作后缀）`);
  }
  const valueType = coreTypeToValueType(rawType);
  if (valueType === undefined) {
    throw new SkillFieldAddError(
      422,
      'VALUE_TYPE_UNMAPPABLE',
      `type "${rawType}"（enum）为 core-only，编排侧无对应 valueType（coreTypeToValueType 返回 undefined），请人工登记编排侧或选用其它类型`,
    );
  }

  const role = (fieldAddTrimmedString(payload.role) ?? 'soft-info') as string;
  if (!(PROMPT_ROLES as readonly string[]).includes(role)) {
    throw new SkillFieldAddError(400, 'ROLE_UNKNOWN', `role "${role}" 非法（须在 ${PROMPT_ROLES.join(',')} 中）`);
  }
  const render = (fieldAddTrimmedString(payload.render) ?? 'visible') as string;
  if (!(RENDER_VALUES as readonly string[]).includes(render)) {
    throw new SkillFieldAddError(400, 'RENDER_UNKNOWN', `render "${render}" 非法（须在 ${RENDER_VALUES.join(',')} 中）`);
  }
  const handoff = Array.isArray(payload.handoff)
    ? payload.handoff.map((item) => fieldAddTrimmedString(item)).filter((item): item is string => item !== null)
    : [];
  const internal = fieldAddBooleanFlag(payload.internal, false);
  const accumulate = fieldAddBooleanFlag(payload.accumulate, false);
  const visibilityPreset = fieldAddTrimmedString(payload.visibilityPreset) ?? undefined;
  if (visibilityPreset !== undefined && !(VISIBILITY_PRESETS as readonly string[]).includes(visibilityPreset)) {
    throw new SkillFieldAddError(
      400,
      'VISIBILITY_PRESET_UNKNOWN',
      `visibilityPreset "${visibilityPreset}" 非法（须在 ${VISIBILITY_PRESETS.join(',')} 中）`,
    );
  }
  const locked = fieldAddTrimmedString(payload.locked) ?? undefined;
  if (locked !== undefined && locked !== 'system' && locked !== 'structure') {
    throw new SkillFieldAddError(400, 'LOCKED_UNKNOWN', 'locked 非法（可选 system | structure）');
  }
  const desc = fieldAddTrimmedString(payload.desc);
  if (!desc) throw new SkillFieldAddError(400, 'FIELD_DESC_REQUIRED', 'desc（功能描述/生成指令）必填');
  const persistKey = fieldAddTrimmedString(payload.persistKey) ?? undefined;
  const pathInRawOutput = fieldAddTrimmedString(payload.pathInRawOutput) ?? undefined;
  const turn = fieldAddBooleanFlag(payload.turn, false);

  // ---- 2. skill 归属（skills.yaml 户口簿 → stage）与文件定位 ----
  const book = loadSkillsBookRaw();
  const entry = book.skills.find((item) => item.skillId === skillId);
  if (!entry) throw new SkillFieldAddError(404, 'SKILL_NOT_FOUND', `skills.yaml 无该 skill 登记：${skillId}`);
  if (!entry.stage) throw new SkillFieldAddError(422, 'SKILL_NO_STAGE', `skill ${skillId} 无编排阶段归属（kind=${entry.kind}）`);
  const stageName = entry.stage;
  const corePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
  const orchestrationPath = path.join(ORCHESTRATION_DIR, `${stageName}.yaml`);

  // ---- 3. 读与校验（任一失败 → 不落任何文件） ----
  let coreText: string;
  try {
    coreText = await fs.readFile(corePath, 'utf-8');
  } catch {
    throw new SkillFieldAddError(404, 'CORE_FILE_MISSING', `核心文件不存在: prompts/core/${skillId}.yaml`);
  }
  const parsedCore = parseCoreFile(corePath, coreText);
  if (!parsedCore.core) {
    throw new SkillFieldAddError(
      422,
      'CORE_FILE_INVALID',
      `核心文件 schema 不合法：${parsedCore.diagnostics.map((d) => d.message).join('；')}`,
    );
  }

  let orchestrationText: string;
  try {
    orchestrationText = await fs.readFile(orchestrationPath, 'utf-8');
  } catch {
    throw new SkillFieldAddError(404, 'ORCHESTRATION_FILE_MISSING', `编排文件不存在: prompts/orchestration/${stageName}.yaml`);
  }
  let stage: OrchestrationStage;
  try {
    stage = parseOrchestrationFile(orchestrationPath);
  } catch (error) {
    throw new SkillFieldAddError(422, 'ORCHESTRATION_FILE_INVALID', `编排文件解析失败：${(error as Error).message}`);
  }

  // ---- 4. 唯一性（core fields ∪ 编排 fieldId）→ 409（提示去编辑） ----
  const coreFieldNames = new Set(parsedCore.core.fields.map((f) => f.name));
  if (!isNested && coreFieldNames.has(name)) {
    throw new SkillFieldAddError(409, 'FIELD_EXISTS', `core fields 已存在同名字段：${name}（如需调整请走既有编辑面）`);
  }
  if (stage.fields.some((f) => f.fieldId === name)) {
    throw new SkillFieldAddError(409, 'FIELD_EXISTS', `编排文件 fields 已存在同 fieldId：${name}（如需调整请走既有编辑面）`);
  }
  if (isNested) {
    const rootField = parsedCore.core.fields.find((f) => f.name === root);
    if (rootField && stripOptionalSuffix(rootField.type) !== 'object') {
      throw new SkillFieldAddError(
        422,
        'NESTED_ROOT_NOT_OBJECT',
        `嵌套字段 "${name}" 的顶层 "${root}" 已存在但类型为 ${rootField.type}（嵌套字段顶层必须是 object）`,
      );
    }
  }

  // ---- 5. 路由语义校验（镜像 field-routing-bootstrap seed 语义，防启动 fail-fast 误伤） ----
  const agentId = `skill:${skillId}`;
  if (handoff.includes(agentId)) {
    throw new SkillFieldAddError(422, 'HANDOFF_SELF_LOOP', `handoff 自环（指向自身 ${agentId}）`);
  }
  for (const target of handoff) {
    const canonical = getCanonicalAgentId(target);
    if (target === canonical && (SKILL_STAGES as readonly string[]).includes(canonical as never)) continue;
    if (getAgentManifest(canonical)) continue;
    throw new SkillFieldAddError(
      422,
      'HANDOFF_TARGET_UNKNOWN',
      `handoff 目标 "${target}" 不在 manifest（也不是阶段名 ${SKILL_STAGES.join('/')}）`,
    );
  }
  if (render === 'visible' && internal && role !== 'control-signal') {
    throw new SkillFieldAddError(422, 'RENDER_INTERNAL_CONFLICT', 'render=visible 与 internal=true 组合仅允许 control-signal 字段');
  }
  if (handoff.length === 0 && !internal && !accumulate && render === 'visible' && role !== 'public-reply') {
    throw new SkillFieldAddError(
      422,
      'ROUTING_NO_FLOW',
      'handoff 为空且非 public-reply/画像终点（internal+accumulate），缺少流转去向',
    );
  }

  // ---- 6. 双文件文本级追加（保留原文件注释/排版）+ 写盘前内存校验 ----
  const coreSpec: CoreFieldAppendSpec = isNested
    ? {
        name,
        type: baseType,
        desc: '',
        children: [{ path: nameSegments.slice(1).join('.'), type: baseType, desc }],
      }
    : { name, type: rawType, desc, turn };
  const newCoreText = appendFieldToCore(coreText, coreSpec);
  const coreChecked = parseCoreFile(corePath, newCoreText);
  if (!coreChecked.core) {
    throw new SkillFieldAddError(
      422,
      'CORE_VALIDATION_FAILED',
      `追加后核心文件未通过 parseCoreFile：${coreChecked.diagnostics.map((d) => d.message).join('；')}`,
    );
  }
  const newCore = coreChecked.core;

  const fieldSpec: OrchestrationFieldAppendSpec = {
    fieldId: name,
    promptRole: role,
    valueType,
    ...(pathInRawOutput ? { pathInRawOutput } : {}),
    ...(persistKey ? { persistKey } : {}),
    description: desc,
    ...(locked === 'system' ? { systemLocked: true } : {}),
    ...(locked === 'structure' ? { structureLocked: true } : {}),
  };
  const routingSpec: OrchestrationRoutingAppendSpec = {
    agentId,
    fieldId: name,
    render,
    handoff,
    internal,
    accumulate,
    ...(visibilityPreset ? { visibilityPreset } : {}),
  };
  const newOrchestrationText = appendFieldToOrchestration(orchestrationText, fieldSpec, routingSpec);
  let newStage: OrchestrationStage;
  try {
    newStage = validateOrchestrationContent(newOrchestrationText);
  } catch (error) {
    throw new SkillFieldAddError(
      422,
      'ORCHESTRATION_VALIDATION_FAILED',
      `追加后编排文件未通过 validateOrchestrationContent：${(error as Error).message}`,
    );
  }

  // ---- 7. 备份（prompts/backups/unified-edit/<ts>/）+ 写盘 ----
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
    // 原子性：编排写失败 → 恢复 core 原内容（双文件保持一致）
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    throw new SkillFieldAddError(
      500,
      'ORCHESTRATION_WRITE_FAILED',
      `编排文件写盘失败（core 已回滚原内容）：${(error as Error).message}；恢复备份参考：${backupDir}`,
    );
  }

  // ---- 8. fields-sync 复检（analyzeCoreFieldsSync 单 skill 投影；违规 → 双文件回滚） ----
  const syncCheck = analyzeCoreFieldsSync([newStage], [entry], () => ({ core: newCore }));
  const projection = syncCheck.find((report) => report.skillId === skillId) ?? null;
  const recheckFailed =
    (projection !== null &&
      (projection.missing.some((item) => item.fieldId === name) ||
        projection.typeMismatch.some((item) => item.fieldId === name) ||
        (projection.orphan.some((item) => item.coreField === root) && !coreFieldNames.has(root)))) ||
    (projection === null && !newStage.routings.some((r) => r.agentId === agentId && r.fieldId.split('.')[0] === root));
  if (recheckFailed) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    await fs.writeFile(orchestrationPath, orchestrationText, 'utf-8').catch(() => undefined);
    throw new SkillFieldAddError(
      422,
      'FIELDS_SYNC_RECHECK_FAILED',
      'fields-sync 复检未通过（缺项/孤儿/类型不一致），已回滚双文件（恢复原内容）',
      { syncCheck: projection },
    );
  }

  // ---- 9. 落库（ensureStageFieldRoutings 只建不更新；失败不阻断写盘结果） ----
  let synced = true;
  let syncHint = '新字段 core+编排双写完成；新建字段/路由已入库生效';
  try {
    await ensureStageRoutingsForStage(newStage);
  } catch (error) {
    synced = false;
    syncHint = `DB 同步失败：${(error as Error).message}（新建行未入库，可走「强制同步 DB」补录）`;
  }

  // ---- 10. 审计（node_config_changes；失败不阻断） ----
  let auditId = '';
  try {
    auditId = await writeNodeConfigChangeToSystemDb({
      changeType: 'skill-field-add',
      targetTable: 'core.yaml+orchestration',
      targetId: skillId,
      agentId,
      fieldId: name,
      before: null,
      after: {
        fieldId: name,
        stage: stageName,
        coreType: rawType,
        valueType,
        promptRole: role,
        render,
        handoff,
        internal,
        accumulate,
        ...(visibilityPreset ? { visibilityPreset } : {}),
        ...(locked ? { locked } : {}),
        ...(persistKey ? { persistKey } : {}),
      },
      actorId: opts.actorId ?? 'admin',
      reason: '加字段向导原子追加（core.yaml + 编排文件双写）',
    });
  } catch (auditError) {
    logger.warn('[prompt-lab] skill-field-add audit write failed（不阻断）', {
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
    field: { name, fieldId: name },
    coreWritten: true,
    orchestrationWritten: true,
    synced,
    syncHint,
    syncCheck: projection,
    auditId,
  };
}
