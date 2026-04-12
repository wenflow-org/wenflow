/**
 * 测试内容生成 Agent - Excel 报表自动化
 */

import { contentAgentHandler } from './src/agents/content-agent';

async function testContentAgent() {
  console.log('=== 测试内容生成 Agent: Excel 报表自动化 ===\n');

  const input = {
    type: 'standard' as const,
    goal: 'Excel 报表自动化：Python 实战',
    scenario: '用户想学习如何使用 Python 自动化处理 Excel 报表，提高工作效率',
    currentLevel: 'intermediate' as const,
    duration: 4,
    timePerDay: '1-2 小时'
  };

  const context = {
    userId: 'test-user',
    userProfile: {
      level: 2,
      xp: 150,
      skillLevel: 'intermediate' as const
    }
  };

  try {
    const result = await contentAgentHandler(input, context);
    
    console.log('=== Content Agent 输出结果 ===\n');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

testContentAgent();
