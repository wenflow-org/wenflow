import dotenv from 'dotenv';
import prisma from '../config/database';
import {
  VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS,
  VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
  VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE,
} from '../skills/virtual-learner-persona-designer';

dotenv.config();

async function publishVirtualLearnerPersonaDesignerPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'skill:virtual-learner-persona-designer';
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
      id: `ap_virtual_learner_persona_designer_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-virtual-learner-persona-designer-identity-only`,
      description: '虚拟学习者身份生成 Prompt，只产出 personaSeed，不包含故事与情境。',
      systemPrompt: VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
      temperature: VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE,
      maxTokens: VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'virtual-learner-persona-design',
        output: ['personaSeed'],
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

publishVirtualLearnerPersonaDesignerPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
