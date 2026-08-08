/**
 * 一次性清理脚本（统一化阶段 2 P0）：
 * 清理退役 skill 在 system 库的残留数据（agent_field_routings / agent_contracts /
 * agent_prompts / skill_registrations / skill_model_configs）与 agent-snapshots 误入行。
 * 与 index.ts 的 purgeRetiredSkills 同语义；purge 在启动时也会执行，本脚本用于立即可见。
 */
import systemPrisma from '../config/system-database';

const RETIRED_SKILLS = [
  'pdf-parser', 'time-estimator', 'quiz-generation', 'exercise-generator', 'content-generation',
  'error-pattern', 'code-explainer', 'answer-generation', 'batch-anderson-labeler', 'goal-type-identifier',
  'task-profile-builder', 'state-assessment', 'confidence-handler', 'label-generator',
  'text-structure-analyzer', 'retrieval', 'web-extractor', 'image-analyzer', 'memory-search', 'smart-search',
  'session-knowledge-distiller', 'dialogue-concept-extractor',
  'learning-turn', 'learning-opening-generator', 'learning-strategy-selector',
  'generic-planner', 'basic-generator', 'basic-extractor', 'data-mapping',
  'path-scene-framing', 'goal-analysis',
  'goal-profile-inference', 'learning-pattern-distiller', 'structured-output-parser', 'prompt-compiler',
  // 2026-08 LLM skill 本体注销（保留确定性纯函数，不再注册为可执行 skill）
  'goal-understanding-composer', 'teaching-strategy-selector', 'acceptance-evidence-evaluator',
  // 2026-08 插件链/死链 aux 退役
  'basic-evaluator', 'goal-alignment-checker', 'concept-priority', 'path-adjustment-generator',
] as const;

async function main() {
  const retiredAgentIds = [...RETIRED_SKILLS].map((name) => `skill:${name}`);

  const [routings, contracts, prompts, registrations, modelConfigs] = await Promise.all([
    systemPrisma.agent_field_routings.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    systemPrisma.agent_contracts.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    systemPrisma.agent_prompts.deleteMany({ where: { agentId: { in: [...retiredAgentIds, 'agent-snapshots'] } } }),
    systemPrisma.skill_registrations.deleteMany({ where: { name: { in: [...RETIRED_SKILLS] } } }),
    systemPrisma.skill_model_configs.deleteMany({ where: { skillId: { in: [...RETIRED_SKILLS] } } }),
  ]);

  console.log(JSON.stringify({
    routingsDeleted: routings.count,
    contractsDeleted: contracts.count,
    promptsDeleted: prompts.count,
    registrationsDeleted: registrations.count,
    modelConfigsDeleted: modelConfigs.count,
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(async () => { await systemPrisma.$disconnect(); });
