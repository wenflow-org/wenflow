import dotenv from 'dotenv';
import systemPrisma from '../config/system-database';

dotenv.config();

async function inspectActivePrompts() {
  const prompts = await systemPrisma.agent_prompts.findMany({
    where: {
      agentId: { in: ['skill:goal-conversation', 'skill:path-scene-framing', 'skill:path-planning', 'skill:stage-designer'] },
      status: 'ACTIVE',
    },
    select: {
      agentId: true,
      id: true,
      version: true,
      name: true,
      systemPrompt: true,
    },
    orderBy: [
      { agentId: 'asc' },
      { version: 'desc' },
    ],
  });

  const summary = prompts.map((item) => ({
    agentId: item.agentId,
    id: item.id,
    version: item.version,
    name: item.name,
    hasQualityFlags: item.systemPrompt.includes('qualityFlags'),
    hasSupportingEvidence: item.systemPrompt.includes('supportingEvidence'),
    hasStrictSurfaceGoalRule: item.systemPrompt.includes('surface_goal 是用户的原始诉求锚点'),
    hasStrictRealProblemRule: item.systemPrompt.includes('real_problem 必须是对 surface_goal 的诊断结果'),
    hasSubtasks: item.systemPrompt.includes('subtasks'),
    hasTaskChain: item.systemPrompt.includes('taskChain'),
    hasStageDesigner: item.systemPrompt.includes('stage-designer'),
    hasPlanningHints: item.systemPrompt.includes('planningHints'),
    hasPaceSignal: item.systemPrompt.includes('paceSignal'),
  }));

  console.log(JSON.stringify(summary, null, 2));
}

inspectActivePrompts()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });
