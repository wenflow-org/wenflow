import dotenv from 'dotenv';
import prisma from '../config/database';
import {
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS,
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT,
  VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE,
} from '../skills/virtual-learner-goal-dialogue-simulator';

dotenv.config();

async function publishVirtualLearnerGoalDialogueSimulatorPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'skill:virtual-learner-goal-dialogue-simulator';
  const latest = await prisma.agent_prompts.findFirst({
    where: { agentId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const version = (latest?.version || 0) + 1;

  await prisma.agent_prompts.updateMany({
    where: { agentId, status: 'ACTIVE' },
    data: { status: 'ARCHIVED', updatedAt: new Date() },
  });

  const created = await prisma.agent_prompts.create({
    data: {
      id: `ap_virtual_learner_goal_dialogue_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-virtual-learner-goal-dialogue-visible-context`,
      description: 'Goal 阶段虚拟学习者对话模拟器提示词，只使用学习者可见上下文，输出 proposal fit / task relevance 等阶段专属字段。',
      systemPrompt: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT,
      temperature: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE,
      maxTokens: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'virtual-learner-goal-dialogue-simulator',
        inputMode: 'full-visible-context',
        notes: 'Used by simulation orchestrator for Goal learner turns. The skill ignores system/developer/tool/reminder content and focuses on proposal fit, task relevance, execution concern, willingToTry, and readyToProceed.',
      }),
    }
  });

  console.log(JSON.stringify({
    success: true,
    agentId,
    version,
    promptId: created.id,
    name: created.name,
  }, null, 2));
}

publishVirtualLearnerGoalDialogueSimulatorPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
