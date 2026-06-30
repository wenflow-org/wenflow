import dotenv from 'dotenv';
import systemPrisma from '../config/system-database';

dotenv.config();

async function publishGoalConversationPrompt() {
  const model = (process.env.AI_MODEL || '').trim();
  if (!model) {
    throw new Error('AI_MODEL is required');
  }

  const agentId = 'goal-conversation-agent';
  const latest = await systemPrisma.agent_prompts.findFirst({
    where: { agentId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const version = (latest?.version || 0) + 1;

  await systemPrisma.agent_prompts.updateMany({
    where: { agentId, status: 'ACTIVE' },
    data: { status: 'ARCHIVED', updatedAt: new Date() },
  });

  const created = await systemPrisma.agent_prompts.create({
    data: {
      id: `ap_goal_conversation_${Date.now()}`,
      agentId,
      version,
      name: `v${version}-goal-conversation-surface-real-problem-strict`,
      description: '收紧 surface_goal 与 real_problem 的语义边界：保留用户原话，禁止把表面诉求伪装成诊断结论。',
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      temperature: 0.7,
      maxTokens: 4000,
      model,
      status: 'ACTIVE',
      createdBy: 'opencode',
      publishedAt: new Date(),
      updatedAt: new Date(),
      metadata: JSON.stringify({
        role: 'goal-clarification',
        architecture: 'goal-conversation -> path-scene-framing -> path-agent',
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

publishGoalConversationPrompt()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });
