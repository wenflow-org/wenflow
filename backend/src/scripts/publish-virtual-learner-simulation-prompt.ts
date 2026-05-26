import dotenv from 'dotenv';
import prisma from '../config/database';
import { DEFAULT_SIMULATION_PROMPT } from '../agents/virtual-learner-simulation-agent/prompt';

dotenv.config();

async function publishVirtualLearnerSimulationPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'virtual-learner-simulation-agent';
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
      id: `ap_virtual_learner_simulation_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-virtual-learner-simulation-stage-aware`,
      description: '阶段感知的虚拟学习者提示词模板，覆盖画像生成、Goal 澄清、Path 评审与 Learn 阶段模拟。',
      systemPrompt: DEFAULT_SIMULATION_PROMPT,
      temperature: 0.8,
      maxTokens: 500,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'virtual-learner-simulation',
        notes: 'Runtime still builds stage-specific prompt in code; this ACTIVE record provides managed model/temperature/maxTokens and versioning.',
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

publishVirtualLearnerSimulationPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
