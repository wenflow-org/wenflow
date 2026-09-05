/**
 * 一次性清理脚本（统一化阶段 2 P0）：
 * 清理退役 skill 的残留数据：system 库（agent_field_routings / agent_contracts /
 * agent_prompts / skill_registrations / skill_model_configs）与 main 库
 * user_skill_configs（与 index.ts purgeRetiredSkills 对齐），含 agent-snapshots 误入行。
 * purge 在启动时也会执行，本脚本用于立即可见/停机运维。
 *
 * 名单单源：ALL_RETIRED_SKILLS（backend/src/skills/retired-skills.ts，40 项），禁止本地再定义名单。
 * 活跃保护：名单与 allSkillDefinitions 注册集相交时拒绝执行——防止误删注册中 skill 的
 * skill_model_configs（该表不可自愈，写入方仅管理端配置；僵尸项 basic-evaluator /
 * goal-alignment-checker 即因此保留注册并移出名单，见 doc/RETIRED_SKILLS_FIX_PLAN.md §3.1/§4.3）。
 *
 * 用法（默认 dry-run，只统计不删除）：
 *   npx ts-node --transpile-only src/scripts/cleanup-retired-field-data.ts
 *   npx ts-node --transpile-only src/scripts/cleanup-retired-field-data.ts --apply   # 实际删除
 * 注意：实际删除须在服务停机时执行（避免运行期窗口故障）。
 */
import 'dotenv/config';
import systemPrisma from '../config/system-database';
import prisma from '../config/database';
import { allSkillDefinitions } from '../skills';
import { ALL_RETIRED_SKILLS } from '../skills/retired-skills';

async function main() {
  const apply = process.argv.includes('--apply');
  const retiredSkillNames = [...ALL_RETIRED_SKILLS];
  const retiredAgentIds = retiredSkillNames.map((name) => `skill:${name}`);

  // 活跃保护：退役名单与注册集必须无交集（僵尸项守卫，同 retired:check 门禁）
  const activeNames = new Set(allSkillDefinitions.map((definition) => definition.name));
  const conflicts = retiredSkillNames.filter((name) => activeNames.has(name));
  if (conflicts.length > 0) {
    console.error(`[cleanup] 拒绝执行：以下 skill 仍处于注册中，疑似僵尸项误入退役名单: ${conflicts.join(', ')}`);
    console.error('[cleanup] 请先从 ALL_RETIRED_SKILLS 移除（或确认已正式注销注册），再重试');
    process.exit(1);
  }

  const steps: Array<{
    label: string;
    count: () => Promise<number>;
    del: () => Promise<{ count: number }>;
  }> = [
    {
      label: 'agent_field_routings',
      count: () => systemPrisma.agent_field_routings.count({ where: { agentId: { in: retiredAgentIds } } }),
      del: () => systemPrisma.agent_field_routings.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    },
    {
      label: 'agent_contracts',
      count: () => systemPrisma.agent_contracts.count({ where: { agentId: { in: retiredAgentIds } } }),
      del: () => systemPrisma.agent_contracts.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    },
    {
      label: 'agent_prompts',
      count: () => systemPrisma.agent_prompts.count({ where: { agentId: { in: [...retiredAgentIds, 'agent-snapshots'] } } }),
      del: () => systemPrisma.agent_prompts.deleteMany({ where: { agentId: { in: [...retiredAgentIds, 'agent-snapshots'] } } }),
    },
    {
      label: 'skill_registrations',
      count: () => systemPrisma.skill_registrations.count({ where: { name: { in: retiredSkillNames } } }),
      del: () => systemPrisma.skill_registrations.deleteMany({ where: { name: { in: retiredSkillNames } } }),
    },
    {
      label: 'skill_model_configs',
      count: () => systemPrisma.skill_model_configs.count({ where: { skillId: { in: retiredSkillNames } } }),
      del: () => systemPrisma.skill_model_configs.deleteMany({ where: { skillId: { in: retiredSkillNames } } }),
    },
    {
      label: 'user_skill_configs',
      count: () => prisma.user_skill_configs.count({ where: { skillName: { in: retiredSkillNames } } }),
      del: () => prisma.user_skill_configs.deleteMany({ where: { skillName: { in: retiredSkillNames } } }),
    },
  ];

  const report: Record<string, number> = {};
  for (const step of steps) {
    const found = await step.count();
    report[`${step.label}Deleted`] = found;
    if (apply && found > 0) {
      const deleted = await step.del();
      if (deleted.count !== found) {
        console.warn(`[cleanup] ${step.label}：预估 ${found} 行，实际删除 ${deleted.count} 行（并发变化）`);
      }
      report[`${step.label}Deleted`] = deleted.count;
    }
  }

  console.log(`[cleanup] mode=${apply ? 'apply' : 'dry-run'}${apply ? '' : '（只统计未删除；加 --apply 执行删除）'} retired=${retiredSkillNames.length} 项`);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(async () => {
    await Promise.all([systemPrisma.$disconnect(), prisma.$disconnect()]);
  });
