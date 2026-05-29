import dotenv from 'dotenv';
import prisma from '../config/database';
import {
  VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS,
  VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
  VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE,
} from '../skills/virtual-learner-scenario-designer';

dotenv.config();

async function publishVirtualLearnerScenarioDesignerPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'skill:virtual-learner-scenario-designer';
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
      id: `ap_virtual_learner_scenario_designer_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-virtual-learner-scenario-designer-persona-story`,
      description: '稳定人物 + 多故事虚拟学习者场景设计 Prompt，输出 personaSeed、situationSeed、stories 与 consistencyNotes。',
      systemPrompt: VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
      temperature: VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE,
      maxTokens: VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'virtual-learner-scenario-design',
        output: ['personaSeed', 'situationSeed', 'stories', 'goalSeed', 'consistencyNotes'],
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

publishVirtualLearnerScenarioDesignerPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
