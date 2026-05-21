import dotenv from 'dotenv';
import prisma from '../config/database';
import { STAGE_DESIGNER_PROMPT } from '../skills/stage-designer';

dotenv.config();

async function publishStageDesignerPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'skill:stage-designer';
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
      id: `ap_stage_designer_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-stage-designer-milestone-task-expansion`,
      description: '两层 Path 主链：围绕单个 milestone 展开 subtasks，并补轻量任务标签，不直接写 Learn 教案。',
      systemPrompt: STAGE_DESIGNER_PROMPT,
      temperature: 0.3,
      maxTokens: 32000,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'stage-task-design',
        architecture: 'path-agent + stage-designer',
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

publishStageDesignerPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
