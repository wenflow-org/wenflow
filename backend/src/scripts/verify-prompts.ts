/**
 * 验证脚本：检查迁移后的 Prompt 数据
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyPrompts() {
  console.log('=== Agent Prompt 验证报告 ===\n');

  // 1. 统计总数
  const total = await prisma.agent_prompts.count();
  console.log(`✅ 总 Prompt 数量: ${total}`);

  // 2. 按状态统计
  const byStatus = await prisma.agent_prompts.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  console.log('\n📊 按状态分布:');
  byStatus.forEach((s) => {
    console.log(`  - ${s.status}: ${s._count.id}`);
  });

  // 3. 按 Agent 统计
  const byAgent = await prisma.agent_prompts.groupBy({
    by: ['agentId'],
    _count: { id: true },
  });
  console.log('\n📊 按 Agent 分布:');
  byAgent.forEach((a) => {
    console.log(`  - ${a.agentId}: ${a._count.id} 个版本`);
  });

  // 4. 显示详细信息
  console.log('\n📋 Prompt 详情:');
  const prompts = await prisma.agent_prompts.findMany({
    orderBy: [{ agentId: 'asc' }, { version: 'desc' }],
    select: {
      id: true,
      agentId: true,
      version: true,
      name: true,
      status: true,
      model: true,
      temperature: true,
      maxTokens: true,
      useCount: true,
      createdAt: true,
      publishedAt: true,
    },
  });

  prompts.forEach((p) => {
    console.log(`\n  [${p.agentId}] v${p.version} - ${p.name}`);
    console.log(`    ID: ${p.id}`);
    console.log(`    Status: ${p.status}`);
    console.log(`    Model: ${p.model} (temp=${p.temperature}, maxTokens=${p.maxTokens})`);
    console.log(`    UseCount: ${p.useCount}`);
    console.log(`    Created: ${p.createdAt.toISOString()}`);
    if (p.publishedAt) {
      console.log(`    Published: ${p.publishedAt.toISOString()}`);
    }
  });

  // 5. 验证 systemPrompt 长度
  console.log('\n📝 System Prompt 长度检查:');
  const withContent = await prisma.agent_prompts.findMany({
    select: {
      agentId: true,
      version: true,
      systemPrompt: true,
    },
  });

  withContent.forEach((p) => {
    const length = p.systemPrompt.length;
    console.log(`  [${p.agentId}] v${p.version}: ${length} 字符`);
  });

  console.log('\n=== 验证完成 ===');
  await prisma.$disconnect();
}

verifyPrompts().catch((error) => {
  console.error('验证失败:', error);
  process.exit(1);
});
