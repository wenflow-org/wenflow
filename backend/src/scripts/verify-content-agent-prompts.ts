/**
 * 验证 ContentAgent v3.0 的 Prompt 模板
 * 
 * 查询并显示所有 ContentAgent v3.0 的 Prompt 配置
 * 
 * 使用方法：
 * npx ts-node src/scripts/verify-content-agent-prompts.ts
 */

import prisma from '../config/database';
import { logger } from '../utils/logger';

async function verifyContentAgentPrompts(): Promise<void> {
  try {
    logger.info('[Script] 开始验证 ContentAgent v3.0 Prompt 模板...');
    
    // 查询所有 ContentAgent v3.0 的 Prompt
    const prompts = await prisma.agent_prompts.findMany({
      where: {
        agentId: 'content-agent-v3'
      },
      orderBy: {
        version: 'asc'
      }
    });
    
    logger.info(`[Script] 找到 ${prompts.length} 个 Prompt 模板\n`);
    
    console.log('\n=== ContentAgent v3.0 Prompt 模板列表 ===\n');
    
    for (const prompt of prompts) {
      console.log(`\n【v${prompt.version}】 ${prompt.name}`);
      console.log(`  描述：${prompt.description || '无'}`);
      console.log(`  状态：${prompt.status}`);
      console.log(`  模型：${prompt.model}`);
      console.log(`  Temperature: ${prompt.temperature}`);
      console.log(`  MaxTokens: ${prompt.maxTokens}`);
      console.log(`  创建时间：${prompt.createdAt.toISOString()}`);
      console.log(`  更新时间：${prompt.updatedAt.toISOString()}`);
      console.log(`  SystemPrompt 长度：${prompt.systemPrompt.length} 字符`);
      console.log('─'.repeat(50));
    }
    
    // 验证数量
    if (prompts.length === 5) {
      logger.info('[Script] ✅ 验证通过：5 个 Prompt 模板全部创建成功');
      
      // 验证每个策略
      const strategies = {
        1: 'BASIC',
        2: 'SUPPORTIVE',
        3: 'STANDARD',
        4: 'CHALLENGE',
        5: 'REMEDIAL'
      };
      
      let allCorrect = true;
      for (const [version, name] of Object.entries(strategies)) {
        const prompt = prompts.find(p => p.version === parseInt(version));
        if (!prompt) {
          logger.error(`[Script] ❌ 缺少 v${version} ${name}`);
          allCorrect = false;
        } else if (prompt.status !== 'ACTIVE') {
          logger.warn(`[Script] ⚠️  v${version} ${name} 状态不是 ACTIVE`);
        } else {
          logger.info(`[Script] ✅ v${version} ${name} 配置正确`);
        }
      }
      
      if (allCorrect) {
        logger.info('[Script] ✅ 所有 Prompt 模板状态都是 ACTIVE');
      }
    } else {
      logger.error(`[Script] ❌ 验证失败：期望 5 个，实际 ${prompts.length} 个`);
    }
    
  } catch (error: any) {
    logger.error('[Script] 验证失败:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行脚本
if (require.main === module) {
  verifyContentAgentPrompts()
    .then(() => {
      logger.info('[Script] 验证脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[Script] 验证脚本执行失败:', error);
      process.exit(1);
    });
}

export { verifyContentAgentPrompts };