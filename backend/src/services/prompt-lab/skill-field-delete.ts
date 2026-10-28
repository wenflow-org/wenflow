/**
 * Skill 字段原子编辑引擎 · 删字段（2026-10-24 架构优化批 1：routes/prompt-lab.ts 拆分迁出）。
 *
 * 保护检查（systemLocked 禁删 / 下游消费 409）+ 双文件原子删除 + 复检回滚 + 落库删除 + 审计。
 * 协议见路由侧注释（DELETE /core/:skillId/field/:name）。
 */
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../../utils/logger';
import { parseCoreFile, CORE_FILES_DIR } from './core-file-loader';
import {
  deleteFieldFromCore,
  deleteFieldFromOrchestration,
} from '../skill-registry/skill-scaffold.service';
import {
  validateOrchestrationContent,
  type OrchestrationStage,
} from '../field-routing/orchestration-file';
import { deleteStageFieldRowsNow } from '../field-routing/admin-field-routings.repo';
import { clearRoutingCache } from '../field-dispatcher';
import { clearSupplementRenderCache } from '../prompt-composer';
import { analyzeCoreFieldsSync } from '../prompt-manifest/check-core-fields-sync';
import { writeNodeConfigChangeToSystemDb } from '../node-config-change-audit';
import {
  FIELD_ADD_BACKUPS_DIR,
  SkillFieldEditError,
  type SkillFieldDeleteResult,
} from './skill-field-shared';
import { buildSkillFieldSnapshot, loadSkillFieldContext } from './skill-field-edit';

/** 扫描全部 core 文件 inputs：其他 skill 的 `ref: skill:<skillId>.<field>` 消费引用 */
async function findCoreInputConsumers(skillId: string, fieldName: string): Promise<Array<{ skillId: string; refs: string[] }>> {
  const refPrefix = `skill:${skillId}.`;
  const root = fieldName.split('.')[0];
  const consumers: Array<{ skillId: string; refs: string[] }> = [];
  let files: string[];
  try {
    files = await fs.readdir(CORE_FILES_DIR);
  } catch {
    return consumers;
  }
  for (const file of files.filter((f) => f.endsWith('.yaml'))) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(CORE_FILES_DIR, file), 'utf-8');
    } catch {
      continue;
    }
    let parsed: Record<string, unknown> | null;
    try {
      parsed = (yaml.load(raw) as Record<string, unknown>) ?? null;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.skillId !== 'string') continue;
    const consumerSkillId = parsed.skillId;
    if (consumerSkillId === skillId) continue; // 自身 inputs 不算下游消费
    const inputs = Array.isArray(parsed.inputs) ? (parsed.inputs as Array<Record<string, unknown>>) : [];
    const refs: string[] = [];
    for (const input of inputs) {
      const ref = typeof input?.ref === 'string' ? input.ref : '';
      if (!ref.startsWith(refPrefix)) continue;
      const rest = ref.slice(refPrefix.length);
      if (rest === root || rest === fieldName || rest.startsWith(`${root}.`) || rest.startsWith(`${fieldName}.`)) {
        refs.push(ref);
      }
    }
    if (refs.length > 0) consumers.push({ skillId: consumerSkillId, refs });
  }
  return consumers;
}

/**
 * 原子删字段主流程（导出于单测直接调用；路由侧薄封装）。
 */
export async function deleteSkillFieldFromCoreAndOrchestration(
  skillId: string,
  name: string,
  opts: { actorId?: string } = {},
): Promise<SkillFieldDeleteResult> {
  const ctx = await loadSkillFieldContext(skillId, name);
  const { entry, stageName, agentId, isNested, root, corePath, orchestrationPath, coreText, orchestrationText, stage, orchField, orchRouting } = ctx;

  // ---- 保护检查 1：systemLocked 禁删 ----
  if (orchField.systemLocked) {
    throw new SkillFieldEditError(
      409,
      'FIELD_SYSTEM_LOCKED',
      `字段 ${name} 为 systemLocked（平台派生/代码消费），禁止删除；锁原因见编排文件 systemLocked 声明`,
      { lockReason: 'systemLocked' },
    );
  }

  // ---- 保护检查 2：消费检查（编排内其他 agent 引用 + 其他 skill core inputs 消费） ----
  const otherAgents = stage.routings
    .filter((r) => r.fieldId === name && r.agentId !== agentId)
    .map((r) => r.agentId);
  const inputConsumers = await findCoreInputConsumers(skillId, name);
  if (otherAgents.length > 0 || inputConsumers.length > 0) {
    const consumers: Record<string, unknown> = {
      agents: otherAgents,
      skills: inputConsumers,
    };
    const parts: string[] = [];
    if (otherAgents.length > 0) parts.push(`编排文件内其他 agent 的 routings 仍引用：${otherAgents.join(', ')}`);
    if (inputConsumers.length > 0) {
      parts.push(`其他 skill 的 core inputs 消费：${inputConsumers.map((c) => `${c.skillId}（${c.refs.join('，')}）`).join('；')}`);
    }
    throw new SkillFieldEditError(
      409,
      'FIELD_CONSUMED',
      `字段 ${name} 仍被下游引用，禁止删除：${parts.join('；')}（如需删除请先解除下游消费）`,
      { consumers },
    );
  }

  // ---- 删除前快照（审计 before = 被删字段全量摘要） ----
  const before = buildSkillFieldSnapshot(ctx, name);

  // ---- 内存删除 + parse 双校验 ----
  const deleted: Array<{ table: string; key: string }> = [];
  let newCoreText = deleteFieldFromCore(coreText, name).text;
  deleted.push({ table: 'core-fields', key: name });
  if (isNested) {
    // 级联：该 skill 名下 root 已无任何路由行 → 移除 core root 顶层条目（防新孤儿）
    const remainingRootRows = stage.routings.filter((r) => r.agentId === agentId && r.fieldId.split('.')[0] === root && r.fieldId !== name);
    if (remainingRootRows.length === 0) {
      newCoreText = deleteFieldFromCore(newCoreText, root).text;
      deleted.push({ table: 'core-fields', key: root });
    }
  }
  const coreChecked = parseCoreFile(corePath, newCoreText);
  if (!coreChecked.core) {
    throw new SkillFieldEditError(
      422,
      'CORE_VALIDATION_FAILED',
      `删除后核心文件未通过 parseCoreFile：${coreChecked.diagnostics.map((d) => d.message).join('；')}`,
    );
  }
  const newCore = coreChecked.core;

  const orchResult = deleteFieldFromOrchestration(orchestrationText, name, agentId, { removeFieldEntry: true });
  deleted.push({ table: 'orchestration-routings', key: `${agentId}/${name}` });
  if (orchResult.fieldRemoved) deleted.push({ table: 'orchestration-fields', key: name });
  let newStage: OrchestrationStage;
  try {
    newStage = validateOrchestrationContent(orchResult.text);
  } catch (error) {
    throw new SkillFieldEditError(
      422,
      'ORCHESTRATION_VALIDATION_FAILED',
      `删除后编排文件未通过 validateOrchestrationContent：${(error as Error).message}`,
    );
  }

  // ---- 备份 + 双文件写（编排写失败 → 回滚 core） ----
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
    await fs.writeFile(orchestrationPath, orchResult.text, 'utf-8');
  } catch (error) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    throw new SkillFieldEditError(
      500,
      'ORCHESTRATION_WRITE_FAILED',
      `编排文件写盘失败（core 已回滚原内容）：${(error as Error).message}；恢复备份参考：${backupDir}`,
    );
  }

  // ---- fields-sync 复检（删后 core 与编排同时少 → 应无新缺项/新孤儿） ----
  const recheckReport = analyzeCoreFieldsSync([newStage], [entry], () => ({ core: newCore })).find((r) => r.skillId === skillId) ?? null;
  const recheckFailed = recheckReport !== null
    && (recheckReport.missing.some((item) => item.fieldId === name || item.root === root)
      || recheckReport.typeMismatch.some((item) => item.fieldId === name)
      || recheckReport.orphan.some((item) => deleted.some((d) => d.key === item.coreField)));
  if (recheckFailed) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    await fs.writeFile(orchestrationPath, orchestrationText, 'utf-8').catch(() => undefined);
    throw new SkillFieldEditError(
      422,
      'FIELDS_SYNC_RECHECK_FAILED',
      'fields-sync 复检未通过（删除产生新缺项/孤儿/类型不一致），已回滚双文件（恢复原内容）',
      { syncCheck: recheckReport },
    );
  }

  // ---- 落库：删除 field_definitions 行 + 该 skill 名下 routings 行（跳过 managedByCode=false 并报告） ----
  const dbDeleted: Array<{ table: string; key: string }> = [];
  const protectedRows: Array<{ table: string; key: string }> = [];
  try {
    const report = await deleteStageFieldRowsNow({ stage: stageName, fieldId: name, agentId });
    for (const row of report.deletedRows) dbDeleted.push({ table: row.table, key: row.key });
    for (const row of report.protectedRows) protectedRows.push(row);
  } catch (error) {
    logger.warn('[prompt-lab] skill-field-delete db delete failed（不阻断写盘结果）', {
      skillId,
      name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ---- 审计（changeType='skill-field-delete'；before=被删字段全量摘要） ----
  let auditId = '';
  try {
    auditId = await writeNodeConfigChangeToSystemDb({
      changeType: 'skill-field-delete',
      targetTable: 'core.yaml+orchestration',
      targetId: skillId,
      agentId,
      fieldId: name,
      before: { ...before, routing: { render: orchRouting.render, handoff: orchRouting.handoff, internal: orchRouting.internal, accumulate: orchRouting.accumulate } },
      after: null,
      actorId: opts.actorId ?? 'admin',
      reason: '删字段原子删除（core.yaml + 编排文件双写 + DB 行清理）',
    });
  } catch (auditError) {
    logger.warn('[prompt-lab] skill-field-delete audit write failed（不阻断）', {
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
    coreWritten: true,
    orchestrationWritten: true,
    deleted,
    syncCheck: recheckReport,
    dbDeleted,
    protectedRows,
    auditId,
  };
}
