import dotenv from 'dotenv';
import prisma from '../config/database';
import { DEFAULT_PATH_GENERATION_PROMPT } from '../agents/path-agent';

dotenv.config();

async function publishPathAgentPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'path-agent';
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
      id: `ap_path_agent_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-path-agent-skeleton-only-no-subtasks`,
      description: '两层 Path 主链：path-agent 只输出 cognitiveCore 与 milestone 骨架，阶段 subtasks 由 stage-designer 单独生成。',
      systemPrompt: DEFAULT_PATH_GENERATION_PROMPT,
      temperature: 0.2,
      maxTokens: 32000,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'path-generation',
        architecture: 'goal -> path-scene-framing -> path-agent -> stage-designer',
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

publishPathAgentPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
