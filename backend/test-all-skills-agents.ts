/**
 * 测试所有 Skills 和 Agents
 */

import { PrismaClient } from '@prisma/client';
import { createGateway, getGateway } from './src/gateway';
import { allSkillDefinitions, skillHandlers } from './src/skills';
import { allAgentDefinitions, agentHandlers, registerOfficialAgents } from './src/agents';

const prisma = new PrismaClient();

async function testSkills() {
  console.log('\n========================================');
  console.log('   测试所有 Skills (7 个)');
  console.log('========================================\n');

  const gateway = createGateway(prisma);
  
  // 注册所有 Skills
  for (const definition of allSkillDefinitions) {
    const handler = skillHandlers[definition.name];
    if (handler) {
      await gateway.registerSkill(definition, handler);
      console.log(`✅ 注册 Skill: ${definition.name}`);
    }
  }

  console.log('\n--- 测试 Skill 执行 ---\n');

  // 1. 测试 text-structure-analyzer
  console.log('1. 测试 text-structure-analyzer...');
  try {
    const result1 = await gateway.executeSkill('text-structure-analyzer', {
      text: `# Python 教程

## 第一章：基础语法
Python 是一种高级编程语言。

### 1.1 变量
变量用于存储数据。

## 第二章：数据结构
列表、字典、集合是常用的数据结构。`,
      detectOutline: true,
      extractKeywords: true
    });
    console.log('✅ text-structure-analyzer 成功');
    console.log('   大纲:', result1.output?.outline?.length || 0, '个条目');
    console.log('   关键词:', result1.output?.keywords?.length || 0, '个');
  } catch (error) {
    console.log('❌ text-structure-analyzer 失败:', error instanceof Error ? error.message : error);
  }

  // 2. 测试 time-estimator
  console.log('\n2. 测试 time-estimator...');
  try {
    const result2 = await gateway.executeSkill('time-estimator', {
      content: 'Python 基础教程，包含变量、数据类型、控制流程等',
      contentType: 'reading',
      difficulty: 'medium',
      userLevel: 'intermediate'
    });
    console.log('✅ time-estimator 成功');
    console.log('   预计时间:', result2.output?.estimatedMinutes, '分钟');
  } catch (error) {
    console.log('❌ time-estimator 失败:', error instanceof Error ? error.message : error);
  }

  // 3. 测试 content-generation
  console.log('\n3. 测试 content-generation...');
  try {
    const result3 = await gateway.executeSkill('content-generation', {
      topic: 'Python 变量',
      type: 'explanation',
      targetLevel: 'beginner',
      style: 'casual',
      length: 'short'
    });
    console.log('✅ content-generation 成功');
    console.log('   内容长度:', result3.output?.content?.length || 0, '字符');
  } catch (error) {
    console.log('❌ content-generation 失败:', error instanceof Error ? error.message : error);
  }

  // 4. 测试 quiz-generation
  console.log('\n4. 测试 quiz-generation...');
  try {
    const result4 = await gateway.executeSkill('quiz-generation', {
      topic: 'Python 基础',
      content: 'Python 是一种高级编程语言。变量用于存储数据。',
      questionCount: 2,
      questionTypes: ['multiple-choice'],
      difficulty: 'easy'
    });
    console.log('✅ quiz-generation 成功');
    console.log('   题目数量:', result4.output?.questions?.length || 0);
  } catch (error) {
    console.log('❌ quiz-generation 失败:', error instanceof Error ? error.message : error);
  }

  // 5. 测试 retrieval
  console.log('\n5. 测试 retrieval...');
  try {
    const result5 = await gateway.executeSkill('retrieval', {
      query: 'Python 变量',
      sources: [
        {
          type: 'text',
          content: 'Python 中，变量用于存储数据。变量不需要声明类型。',
          name: '教程片段'
        }
      ],
      topK: 3
    });
    console.log('✅ retrieval 成功');
    console.log('   结果数量:', result5.output?.results?.length || 0);
  } catch (error) {
    console.log('❌ retrieval 失败:', error instanceof Error ? error.message : error);
  }

  // 6. 测试 answer-generation
  console.log('\n6. 测试 answer-generation...');
  try {
    const result6 = await gateway.executeSkill('answer-generation', {
      question: 'Python 中如何定义变量？',
      context: 'Python 是一种高级编程语言',
      userLevel: 'beginner',
      style: 'direct'
    });
    console.log('✅ answer-generation 成功');
    console.log('   答案长度:', result6.output?.answer?.length || 0, '字符');
  } catch (error) {
    console.log('❌ answer-generation 失败:', error instanceof Error ? error.message : error);
  }

  // 7. 测试 pdf-parser (跳过，需要文件)
  console.log('\n7. 测试 pdf-parser...');
  console.log('⏭️  跳过 (需要 PDF 文件)');

  console.log('\n========================================');
  console.log('   Skills 测试完成');
  console.log('========================================\n');
}

async function testAgents() {
  console.log('\n========================================');
  console.log('   测试所有 Agents (4 个)');
  console.log('========================================\n');

  const gateway = getGateway();

  console.log('--- 测试 Agent 执行 ---\n');

  // 1. 测试 path-agent
  console.log('1. 测试 path-agent...');
  try {
    const result1 = await gateway.executeAgent({
      agentId: 'path-agent',
      input: {
        type: 'standard',
        goal: '学习 Python 基础',
        currentLevel: 'beginner',
        duration: 4,
        timePerDay: '1-2 小时',
        metadata: { userId: 'test-user' }
      },
      context: {
        userId: 'test-user',
        userProfile: {
          level: 1,
          xp: 0,
          skillLevel: 'beginner'
        }
      }
    });
    if (result1.success) {
      console.log('✅ path-agent 成功');
      console.log('   路径:', result1.output?.path?.name || 'N/A');
      console.log('   周数:', result1.output?.path?.totalWeeks || 0);
    } else {
      console.log('❌ path-agent 失败:', result1.error?.message);
    }
  } catch (error) {
    console.log('❌ path-agent 异常:', error instanceof Error ? error.message : error);
  }

  // 2. 测试 content-agent
  console.log('\n2. 测试 content-agent...');
  try {
    const result2 = await gateway.executeAgent({
      agentId: 'content-agent',
      input: {
        type: 'standard',
        goal: '学习 Python 变量',
        currentLevel: 'beginner',
        metadata: { 
          taskId: 'task-1',
          taskType: 'reading',
          topic: 'Python 变量'
        }
      },
      context: {
        userId: 'test-user',
        userProfile: {
          level: 1,
          xp: 0,
          skillLevel: 'beginner'
        }
      }
    });
    if (result2.success) {
      console.log('✅ content-agent 成功');
      console.log('   内容长度:', result2.output?.content?.explanation?.length || 0, '字符');
    } else {
      console.log('❌ content-agent 失败:', result2.error?.message);
    }
  } catch (error) {
    console.log('❌ content-agent 异常:', error instanceof Error ? error.message : error);
  }

  // 3. 测试 tutor-agent
  console.log('\n3. 测试 tutor-agent...');
  try {
    const result3 = await gateway.executeAgent({
      agentId: 'tutor-agent',
      input: {
        type: 'standard',
        goal: '解答 Python 问题',
        metadata: {
          question: 'Python 中什么是列表？',
          taskId: 'task-1'
        }
      },
      context: {
        userId: 'test-user',
        userProfile: {
          level: 1,
          xp: 0,
          skillLevel: 'beginner'
        }
      }
    });
    if (result3.success) {
      console.log('✅ tutor-agent 成功');
      console.log('   回答长度:', result3.output?.tutoring?.response?.length || 0, '字符');
    } else {
      console.log('❌ tutor-agent 失败:', result3.error?.message);
    }
  } catch (error) {
    console.log('❌ tutor-agent 异常:', error instanceof Error ? error.message : error);
  }

  // 4. 测试 progress-agent
  console.log('\n4. 测试 progress-agent...');
  try {
    const result4 = await gateway.executeAgent({
      agentId: 'progress-agent',
      input: {
        type: 'standard',
        goal: '追踪学习进度',
        metadata: {
          taskId: 'task-1',
          completionRate: 0.8,
          score: 85,
          timeSpent: 120
        }
      },
      context: {
        userId: 'test-user',
        userProfile: {
          level: 1,
          xp: 50,
          skillLevel: 'beginner'
        },
        currentState: {
          activePathId: 'path-1',
          activeTaskId: 'task-1'
        }
      }
    });
    if (result4.success) {
      console.log('✅ progress-agent 成功');
      console.log('   信号类型:', result4.output?.progress?.signal?.type || 'N/A');
      console.log('   KTL:', result4.output?.progress?.metrics?.ktl || 0);
    } else {
      console.log('❌ progress-agent 失败:', result4.error?.message);
    }
  } catch (error) {
    console.log('❌ progress-agent 异常:', error instanceof Error ? error.message : error);
  }

  console.log('\n========================================');
  console.log('   Agents 测试完成');
  console.log('========================================\n');
}

async function main() {
  try {
    console.log('\n🚀 开始测试 Skills 和 Agents\n');
    
    // 连接数据库
    await prisma.$connect();
    console.log('✅ 数据库已连接\n');

    // 测试 Skills
    await testSkills();

    // 测试 Agents
    await testAgents();

    // 清理
    await prisma.$disconnect();
    console.log('\n✅ 所有测试完成，数据库已断开\n');
  } catch (error) {
    console.error('\n❌ 测试过程中发生错误:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();