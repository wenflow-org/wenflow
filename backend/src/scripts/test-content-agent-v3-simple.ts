/**
 * 测试 ContentAgent v3.0 注册（简化版）
 * 
 * 验证 ContentAgent v3.0 是否正确定义和导出
 */

import { ContentAgentV3 } from '../agents/content-agent-v3';
import { allAgentDefinitions } from '../agents';
import { logger } from '../utils/logger';

async function testContentAgentV3Simple(): Promise<void> {
  logger.info('[Test] 开始简化测试 ContentAgent v3.0...');
  
  // 1. 测试类实例化
  logger.info('[Test] 步骤 1: 测试 ContentAgentV3 类实例化...');
  try {
    const agent = new ContentAgentV3();
    
    logger.info('✅ ContentAgentV3 类实例化成功');
    logger.info(`   - Agent ID: ${agent.id}`);
    logger.info(`   - Agent Name: ${agent.name}`);
    logger.info(`   - Agent Version: ${agent.version}`);
    logger.info(`   - Subject: ${agent.subject}`);
    logger.info(`   - Capabilities: ${JSON.stringify(agent.capabilities.tags)}`);
  } catch (error: any) {
    logger.error('❌ ContentAgentV3 类实例化失败:', error.message);
    throw error;
  }
  
  // 2. 验证 Agent 定义是否存在于 allAgentDefinitions
  logger.info('[Test] 步骤 2: 验证 Agent 定义...');
  const agentDef = allAgentDefinitions.find(def => def.id === 'content-agent-v3');
  
  if (!agentDef) {
    throw new Error('❌ content-agent-v3 不在 allAgentDefinitions 中');
  }
  
  logger.info('✅ Agent 定义验证成功');
  logger.info(`   - ID: ${agentDef.id}`);
  logger.info(`   - Name: ${agentDef.name}`);
  logger.info(`   - Version: ${agentDef.version}`);
  logger.info(`   - Type: ${agentDef.type}`);
  logger.info(`   - Category: ${agentDef.category}`);
  logger.info(`   - Capabilities: ${agentDef.capabilities.join(', ')}`);
  logger.info(`   - Subscribes: ${agentDef.subscribes.join(', ')}`);
  logger.info(`   - Publishes: ${agentDef.publishes.join(', ')}`);
  
  // 3. 验证所有 Agent 定义
  logger.info('\n[Test] 步骤 3: 列出所有已注册的 Agent 定义...');
  logger.info(`   共 ${allAgentDefinitions.length} 个 Agent:`);
  
  for (const def of allAgentDefinitions) {
    logger.info(`   - ${def.name} (${def.id}) v${def.version}`);
  }
  
  // 4. 验证 content-agent-v3 是否存在
  const hasContentAgentV3 = allAgentDefinitions.some(def => def.id === 'content-agent-v3');
  
  if (hasContentAgentV3) {
    logger.info('\n✅ ContentAgent v3.0 已成功注册到系统！');
  } else {
    throw new Error('❌ ContentAgent v3.0 未注册到系统');
  }
  
  // 总结
  logger.info('\n[Test] ========== 测试总结 ==========');
  logger.info('✅ ContentAgent v3.0 定义验证通过');
  logger.info('✅ ContentAgent v3.0 已添加到 allAgentDefinitions');
  logger.info('✅ ContentAgent v3.0 可以在系统中使用');
  logger.info('=====================================\n');
}

// 执行测试
if (require.main === module) {
  testContentAgentV3Simple()
    .then(() => {
      logger.info('[Test] 测试执行完成');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[Test] 测试执行失败:', error);
      process.exit(1);
    });
}

export { testContentAgentV3Simple };
