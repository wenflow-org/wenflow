import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const prompts = await prisma.agent_prompts.findMany({
    where: { agentId: 'skill:goal-conversation' },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      name: true,
      status: true,
      description: true,
      createdAt: true,
    },
  });

  console.log('Goal Conversation Agent Prompts:');
  prompts.forEach((p) => {
    console.log(`  v${p.version}: ${p.name} (${p.status})`);
    console.log(`      ID: ${p.id}`);
    console.log(`      描述: ${p.description}`);
    console.log(`      创建时间: ${p.createdAt}`);
    console.log('');
  });

  const activePrompt = await prisma.agent_prompts.findFirst({
    where: { agentId: 'skill:goal-conversation', status: 'ACTIVE' },
  });

  if (activePrompt) {
    console.log('当前 ACTIVE 版本:');
    console.log(`  版本: v${activePrompt.version}`);
    console.log(`  名称: ${activePrompt.name}`);
    console.log(`  描述: ${activePrompt.description}`);
    console.log(`  System Prompt 前 200 字符:`);
    console.log(activePrompt.systemPrompt.substring(0, 200) + '...');
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());