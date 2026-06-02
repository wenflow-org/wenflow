import dotenv from 'dotenv';
import prisma from '../config/database';
import {
  VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS,
  VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT,
  VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE,
} from '../skills/virtual-learner-path-evaluator';

dotenv.config();

async function publishVirtualLearnerPathEvaluatorPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'skill:virtual-learner-path-evaluator';
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
      id: `ap_virtual_learner_path_evaluator_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-virtual-learner-path-reaction-visible-only`,
      description: 'Path 阶段虚拟学习者评审提示词，只对平台输出学习者可见反应与显式修改点，内部判断下沉为 debug。',
      systemPrompt: VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT,
      temperature: VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE,
      maxTokens: VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'virtual-learner-path-evaluator',
        outputMode: 'visible-reaction-only',
        notes: 'Used by simulation orchestrator for path review. Public contract exposes reaction and visibleRequestedChanges only; internal decision is debug-only.',
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

publishVirtualLearnerPathEvaluatorPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
