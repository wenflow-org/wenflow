import dotenv from 'dotenv';
import prisma from '../config/database';
import {
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE,
} from '../skills/virtual-learner-learn-turn-simulator';

dotenv.config();

async function publishVirtualLearnerLearnTurnSimulatorPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'skill:virtual-learner-learn-turn-simulator';
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
      id: `ap_virtual_learner_learn_turn_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-virtual-learner-learn-turn-feedback-closure`,
      description: 'Learn 阶段虚拟学习者回合模拟器提示词，输出学习者自然回复、主观状态和 learnerFeedback，用于当前 task 双钥匙收束判断。',
      systemPrompt: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT,
      temperature: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE,
      maxTokens: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'virtual-learner-learn-turn-simulator',
        outputMode: 'visible-reply-with-learner-feedback',
        notes: 'Used by simulation orchestrator for Learn learner turns. learnerFeedback is the AI student self-report only; task completion still requires a teaching-system closure signal.',
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

publishVirtualLearnerLearnTurnSimulatorPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
