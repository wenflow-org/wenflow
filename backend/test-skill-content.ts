/**
 * 测试内容生成 Skill - Excel 报表自动化
 */

import { contentGeneration } from './src/skills/content-generation';

async function testContentGeneration() {
  console.log('=== 测试内容生成 Skill: Excel 报表自动化 ===\n');

  const input = {
    topic: 'Excel 报表自动化：Python 实战',
    type: 'tutorial' as const,
    targetLevel: 'intermediate' as const,
    style: 'casual' as const,
    length: 'long' as const,
    context: '用户想学习如何使用 Python 自动化处理 Excel 报表，提高工作效率。需要涵盖 openpyxl 和 pandas 库的使用。'
  };

  try {
    const result = await contentGeneration(input);
    
    console.log('=== 内容生成结果 ===\n');
    if (result.success && result.output) {
      console.log('标题:', result.output.sections?.[0]?.title || 'N/A');
      console.log('\n--- 内容预览 ---');
      console.log(result.output.content?.substring(0, 500) || 'N/A');
      console.log('\n--- 关键点 ---');
      result.output.keyPoints?.forEach((point: string, i: number) => {
        console.log(`${i + 1}. ${point}`);
      });
      console.log('\n=== 完整内容 ===');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('生成失败:', result.error);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testContentGeneration();
