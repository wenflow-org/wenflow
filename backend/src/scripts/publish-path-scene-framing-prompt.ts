import dotenv from 'dotenv';
import prisma from '../config/database';
import {
  PATH_SCENE_FRAMING_MAX_TOKENS,
  PATH_SCENE_FRAMING_PROMPT,
  PATH_SCENE_FRAMING_TEMPERATURE,
} from '../skills/path-scene-framing';

dotenv.config();

async function publishPathSceneFramingPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'skill:path-scene-framing';
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
      id: `ap_path_scene_framing_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-path-scene-framing-normalized-input-cleaner`,
      description: '发布 path-scene-framing 当前代码默认 Prompt，确保管理台 ACTIVE 与运行时输入清洗规则一致。',
      systemPrompt: PATH_SCENE_FRAMING_PROMPT,
      temperature: PATH_SCENE_FRAMING_TEMPERATURE,
      maxTokens: PATH_SCENE_FRAMING_MAX_TOKENS,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'path-input-cleaning',
        architecture: 'goal -> path-scene-framing -> path-agent',
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

publishPathSceneFramingPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
