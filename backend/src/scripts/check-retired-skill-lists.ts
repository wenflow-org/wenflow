/**
 * 退役名单门禁（retired:check）：
 * 校验 backend/src/skills/retired-skills.ts 单源名单的不变量与文件状态一致性，
 * 防止双名单漂移与僵尸项误入名单回归（doc/RETIRED_SKILLS_FIX_PLAN.md §4.2）。
 *
 * 检查项：
 * 1. 单源不变量：PURGED_SKILLS ⊆ ALL_RETIRED_SKILLS，且两名单内部无重复
 * 2. 活跃守卫：ALL_RETIRED_SKILLS ∩ 注册集（allSkillDefinitions 名称，含 v4-aux） = ∅。
 *    僵尸项（注册中但零调用，如 basic-evaluator / goal-alignment-checker / course-design）
 *    由此守卫保护——把注册中 skill 放入退役名单会在此被拒绝。
 *    说明：静态检查只能覆盖注册集；"零生产调用"判定需调用点审计，见
 *    services/skill-output-validator.ts 排除名单注释（自述口径）。
 * 3. manifest 状态一致性：退役 skill 不得存在 prompts/core/<id>.yaml（core 文件=活跃证据）；
 *    prompts/manifests/<id>.yaml 仅允许已声明残留项存在
 *    （concept-priority / path-adjustment-generator，2026-08-09 退役仅 manifest 残留）。
 *
 * 用法：npm run retired:check（已挂入 prompts:check:all 链）
 */
import fs from 'fs';
import path from 'path';
import { allSkillDefinitions } from '../skills';
import { PURGED_SKILLS, ALL_RETIRED_SKILLS } from '../skills/retired-skills';

const CORE_DIR = path.join(process.cwd(), '../prompts/core');
const MANIFESTS_DIR = path.join(process.cwd(), '../prompts/manifests');

/** 已声明允许保留 manifest 残留的退役项（2026-08-09 退役，resolve-prompt-contract 按需加载无运行影响） */
const MANIFEST_RESIDUE_ALLOWED = new Set(['concept-priority', 'path-adjustment-generator']);

function main() {
  const errors: string[] = [];

  const allSet = new Set(ALL_RETIRED_SKILLS);

  // 1. 单源不变量
  const notInAll = PURGED_SKILLS.filter((name) => !allSet.has(name));
  if (notInAll.length > 0) {
    errors.push(`PURGED_SKILLS ⊄ ALL_RETIRED_SKILLS（PURGED 独有 ${notInAll.length} 项）: ${notInAll.join(', ')}`);
  }
  const dupInPurge = PURGED_SKILLS.filter((name, index) => PURGED_SKILLS.indexOf(name) !== index);
  const dupInAll = ALL_RETIRED_SKILLS.filter((name, index) => ALL_RETIRED_SKILLS.indexOf(name) !== index);
  if (dupInPurge.length > 0) errors.push(`PURGED_SKILLS 存在重复: ${[...new Set(dupInPurge)].join(', ')}`);
  if (dupInAll.length > 0) errors.push(`ALL_RETIRED_SKILLS 存在重复: ${[...new Set(dupInAll)].join(', ')}`);

  // 2. 活跃守卫：退役名单与注册集无交集
  const activeNames = new Set(allSkillDefinitions.map((definition) => definition.name));
  const activeConflicts = ALL_RETIRED_SKILLS.filter((name) => activeNames.has(name));
  if (activeConflicts.length > 0) {
    errors.push(
      `退役名单与活跃注册集有交集（疑似把注册中 skill 当退役，会误删不可自愈的 skill_model_configs）: ${activeConflicts.join(', ')}`,
    );
  }

  // 3. manifest 状态一致性
  for (const name of ALL_RETIRED_SKILLS) {
    if (fs.existsSync(path.join(CORE_DIR, `${name}.yaml`))) {
      errors.push(`退役 skill ${name} 仍存在 core 文件 prompts/core/${name}.yaml（core 文件=活跃证据，应删除或移出退役名单）`);
    }
    const manifestPath = path.join(MANIFESTS_DIR, `${name}.yaml`);
    if (fs.existsSync(manifestPath) && !MANIFEST_RESIDUE_ALLOWED.has(name)) {
      errors.push(`退役 skill ${name} 存在未声明残留的 manifest prompts/manifests/${name}.yaml（删除文件，或加入 MANIFEST_RESIDUE_ALLOWED 并注明原因）`);
    }
  }

  const protectedActive = [...activeNames].sort().filter((name) => !allSet.has(name));
  console.log(`[retired:check] PURGED=${PURGED_SKILLS.length} ALL=${ALL_RETIRED_SKILLS.length} ACTIVE=${activeNames.size}`);
  console.log(
    `[retired:check] 活跃注册集 ${activeNames.size} 项；不在退役名单的受保护项（含僵尸项 basic-evaluator / goal-alignment-checker / course-design，保留注册、零调用，由本守卫保护）: ${protectedActive.join(', ')}`,
  );
  console.log(
    '[retired:check] 零生产调用判定说明：静态检查仅覆盖注册集；调用点审计口径见 services/skill-output-validator.ts 排除名单注释',
  );

  if (errors.length > 0) {
    for (const message of errors) console.error(`[retired:check] FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log('[retired:check] OK：单源不变量、活跃守卫、manifest 状态一致性全部通过');
}

main();
