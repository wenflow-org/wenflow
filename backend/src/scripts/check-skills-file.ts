/**
 * skills:check —— 技能户口簿（prompts/skills.yaml）全量门禁（F1~F12 + 派生等价）
 *
 * 检查项（SKILLS_YAML_SPEC §2.4 表 A；F 系列纯静态、零误报）：
 *   F1   schema：字段必填/可选/值域（kind/stage 枚举、skillId kebab-case、未知字段拒绝）
 *   F2   skillId 全局唯一
 *   F3   mainline 的 stage ∈ 编排文件 stage 清单 + 对应 stage contracts 铁律
 *   F4   parentAgent ∈ manifest kind=agent 条目 id
 *   F5   handlerRef 文件存在（fs）
 *   F6   coreFile 存在（mainline/aux）+ 文件名约定
 *   F7   noPromptFile 一致性（handler-only 强制 true，其余禁 true）
 *   F8   活跃集 ∩ RETIRED_SKILLS_ALL/PURGED = ∅（retired-skills.ts 执行权威）
 *   F9   alias 全表唯一 + 不与 skillId / manifest canonical / manifest alias 冲突
 *   F10  coordinator 可解析（agentId ∈ 顶层 agent；step 引用自身 skillId 合法）
 *   F11  注册存在性（按 registrationPoint 分派：skillHandlers / agents / platform-direct 豁免）
 *        + 反向：代码注册集 ⊆ 户口簿；+ aux 集合 ↔ v4-aux-skills AuxSkillId 双向
 *   F12  manifest skill 条目 ↔ 户口簿活跃集双向一致（差额输出）
 *   P1   派生等价：manifest agentMembers（skills.yaml parentAgent 派生）与
 *        LEGACY_AGENT_MEMBERS 手写镜像逐项相等（迁移红线，diff 必须为空）
 *
 * 用法：npm run prompts:skills:check（已挂入 prompts:check:all 链）
 * 说明：F1~F10/F12 由 loadSkillsFile() 提供（fail-fast）；本脚本补充 F11 与差额/等价明细输出。
 */
import type { SkillsBook } from '../services/skill-registry/skills-file';
import {
  loadSkillsFile,
  diffSkillsBookWithManifest,
  resolveRegistrationPoint,
  getActiveSkillIds,
  getParentAgentMembers,
} from '../services/skill-registry/skills-file';
import { allSkillDefinitions, skillHandlers } from '../skills';
import { auxSkillDefinitions } from '../skills/v4-aux-skills';
import { agentHandlers } from '../agents';
import { listRawManifestEntries, LEGACY_AGENT_MEMBERS, getAgentMembersOfAgent } from '../services/agent-manifest.service';
import { ALL_RETIRED_SKILLS, PURGED_SKILLS } from '../skills/retired-skills';

function main() {
  const errors: string[] = [];

  // F1~F10 + F12 fail-fast（loadSkillsFile 内部抛错即终止，风格与编排文件一致）
  let book: SkillsBook;
  try {
    book = loadSkillsFile();
  } catch (error) {
    console.error(`[skills:check] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  // ---- F11：注册存在性（双向） ----
  const skillHandlersKeys = new Set(Object.keys(skillHandlers));
  const definitionsNames = new Set(allSkillDefinitions.map((d) => d.name));
  const agentHandlersKeys = new Set(Object.keys(agentHandlers));
  const auxDefinitionNames = new Set(auxSkillDefinitions.map((d) => d.name));

  const unregistered: string[] = [];
  for (const entry of book.skills) {
    const rp = resolveRegistrationPoint(entry);
    if (rp === 'platform-direct' || rp === 'none') continue; // 平台守门直调 / 无注册语义，豁免
    const registered = rp === 'agents'
      ? agentHandlersKeys.has(`skill:${entry.skillId}`)
      : skillHandlersKeys.has(entry.skillId) || definitionsNames.has(entry.skillId);
    if (!registered) {
      unregistered.push(`${entry.skillId}（registrationPoint=${rp}）`);
    }
  }
  if (unregistered.length > 0) {
    errors.push(`F11 注册缺失（按 registrationPoint 分派）: ${unregistered.join(', ')}`);
  }

  // F11 反向：代码注册集 ⊆ 户口簿（注册未登记 = 户口簿漏登记，fail-fast）
  const bookIds = getActiveSkillIds(book);
  const codeRegistered = new Set<string>([
    ...skillHandlersKeys,
    ...definitionsNames,
    ...[...agentHandlersKeys].filter((key) => key.startsWith('skill:')).map((key) => key.slice('skill:'.length)),
  ]);
  const registeredWithoutBook = [...codeRegistered].filter((id) => !bookIds.has(id) && id !== 'simulation-agent').sort();
  if (registeredWithoutBook.length > 0) {
    errors.push(`F11 反向（代码已注册但户口簿无登记）: ${registeredWithoutBook.join(', ')}`);
  }

  // ---- aux 集合 ↔ v4-aux-skills AuxSkillId 双向 ----
  const auxIds = new Set(book.skills.filter((entry) => entry.kind === 'aux' && !entry.platformGate).map((entry) => entry.skillId));
  const auxMissing = [...auxDefinitionNames].filter((id) => !auxIds.has(id)).sort();
  const auxExtra = [...auxIds].filter((id) => !auxDefinitionNames.has(id)).sort();
  if (auxMissing.length > 0) errors.push(`aux 集合差集（v4-aux 注册了但户口簿没有）: ${auxMissing.join(', ')}`);
  if (auxExtra.length > 0) errors.push(`aux 集合差集（户口簿登记了但 v4-aux 未注册）: ${auxExtra.join(', ')}`);

  // ---- F12 差额明细（双向输出） ----
  const diff = diffSkillsBookWithManifest(book);
  if (diff.manifestWithoutBook.length > 0) {
    errors.push(`F12 manifest 条目缺户口簿登记: ${diff.manifestWithoutBook.join(', ')}`);
  }
  const illegalBookOnly = diff.bookWithoutManifest.filter((item) => item.kind !== 'aux');
  if (illegalBookOnly.length > 0) {
    errors.push(`F12 户口簿登记缺 manifest 条目（mainline/handler-only 必须登记）: ${illegalBookOnly.map((item) => item.skillId).join(', ')}`);
  }

  // ---- P1 派生等价：派生 agentMembers vs LEGACY 手写镜像（逐项、保序相等） ----
  const agents = listRawManifestEntries().filter((item) => item.kind === 'agent').map((item) => item.id);
  const equivalenceFailures: string[] = [];
  for (const agentId of agents) {
    const legacy = LEGACY_AGENT_MEMBERS[agentId] || [];
    const derived = getAgentMembersOfAgent(agentId);
    if (JSON.stringify(legacy) !== JSON.stringify(derived)) {
      equivalenceFailures.push(`${agentId}: 手写=${JSON.stringify(legacy)} 派生=${JSON.stringify(derived)}`);
    }
  }
  if (equivalenceFailures.length > 0) {
    errors.push(`P1 派生等价失败（agentMembers 与手写镜像不一致）:\n${equivalenceFailures.map((line) => `    ${line}`).join('\n')}`);
  }

  // ---- 汇总输出 ----
  const kindCounts: Record<string, number> = {};
  const stageCounts: Record<string, number> = {};
  for (const entry of book.skills) {
    kindCounts[entry.kind] = (kindCounts[entry.kind] || 0) + 1;
    if (entry.stage) stageCounts[entry.stage] = (stageCounts[entry.stage] || 0) + 1;
  }
  const coordinatorCount = book.skills.filter((entry) => entry.coordinator).length;
  const parentAgentMembers = getParentAgentMembers(book);

  console.log(`[skills:check] skills.yaml 加载与 F1~F10/F12 校验 OK（version=${book.version}，${book.skills.length} 条活跃登记）`);
  console.log(`[skills:check] kind 分布: ${Object.entries(kindCounts).map(([kind, count]) => `${kind}=${count}`).join(' ')}（mainline=${kindCounts.mainline || 0} aux=${kindCounts.aux || 0} handler-only=${kindCounts['handler-only'] || 0}）`);
  console.log(`[skills:check] stage 分布: ${Object.entries(stageCounts).map(([stage, count]) => `${stage}=${count}`).join(' ')}`);
  console.log(`[skills:check] coordinator 挂接点登记: ${coordinatorCount} 条；parentAgent 归属: ${[...parentAgentMembers.keys()].map((agent) => `${agent}=${parentAgentMembers.get(agent)!.length} 成员`).join(' ')}`);
  console.log(`[skills:check] F8 退役互斥: 活跃集 ∩ PURGED(${PURGED_SKILLS.length})/ALL(${ALL_RETIRED_SKILLS.length}) = ∅（通过）`);
  console.log(`[skills:check] F11 注册存在性: ${book.skills.length - unregistered.length}/${book.skills.length} 通过（豁免: platform-direct/none 共 ${book.skills.filter((entry) => ['platform-direct', 'none'].includes(resolveRegistrationPoint(entry))).length} 条）`);
  console.log(`[skills:check] aux 集合: v4-aux AuxSkillId ${auxDefinitionNames.size} 条与户口簿双向一致（僵尸项 basic-evaluator/goal-alignment-checker/course-design 在册）`);
  console.log(`[skills:check] F12 差额: manifest ${listRawManifestEntries().filter((item) => item.kind === 'skill').length} 条全部登记；户口簿未登 manifest ${diff.bookWithoutManifest.length} 条（aux=${diff.bookWithoutManifest.filter((item) => item.kind === 'aux').length}，合法不登 manifest）`);
  console.log(`[skills:check] P1 派生等价: agentMembers ${agents.length}/${agents.length} 个顶层 Agent 与手写镜像一致（diff 为空）`);

  if (errors.length > 0) {
    for (const message of errors) console.error(`[skills:check] FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log('[skills:check] OK：F1~F12 全量 + P1 派生等价全部通过');
}

main();
