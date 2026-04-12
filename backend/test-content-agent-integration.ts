/**
 * ContentAgent v3.0 - 学习状态追踪系统集成测试
 * 
 * 测试目标：
 * 1. 验证学习状态服务调用
 * 2. 验证 EMA 基线服务调用
 * 3. 验证学习会话服务调用
 * 4. 验证状态丰富逻辑
 * 5. 验证策略选择考虑 LSS/KTL/LF
 * 6. 验证状态更新逻辑
 */

import ContentAgentV3 from './src/agents/content-agent-v3';
import { learningStateService } from './src/services/learning/learning-state.service';
import { studentBaselineService } from './src/services/student-baseline.service';
import { learningSessionService } from './src/services/learning/learning-session.service';
import prisma from './src/config/database';
import { logger } from './src/utils/logger';

async function testIntegration() {
  console.log('=== ContentAgent v3.0 学习状态追踪系统集成测试 ===\n');
  
  const agent = new ContentAgentV3();
  
  // 创建测试用户
  const testUserId = 'test-user-' + Date.now();
  
  try {
    // 1. 创建测试用户
    console.log('1. 创建测试用户...');
    await prisma.users.create({
      data: {
        id: testUserId,
        email: `test-${testUserId}@example.com`,
        passwordHash: 'hashed-password',
        name: 'Test User'
      }
    });
    console.log('✓ 测试用户创建成功\n');
    
    // 2. 初始化学习状态
    console.log('2. 初始化学习状态...');
    await learningStateService.calculateAndUpdate(testUserId, {
      difficulty: 5,
      cognitiveLoad: 4,
      efficiency: 0.7,
      timeSpent: 15,
      expectedTime: 10,
      completionRate: 0.8,
      taskType: 'practice'
    });
    console.log('✓ 学习状态初始化成功\n');
    
    // 3. 获取学生状态
    console.log('3. 获取学生状态...');
    const state = await learningStateService.getCurrentState(testUserId);
    console.log('LSS:', state?.lss.toFixed(2));
    console.log('KTL:', state?.ktl.toFixed(2));
    console.log('LF:', state?.lf.toFixed(2));
    console.log('LSB:', state?.lsb.toFixed(2));
    console.log();
    
    // 4. 创建学习会话
    console.log('4. 创建学习会话...');
    const session = await learningSessionService.createSession(testUserId);
    console.log('会话 ID:', session.id);
    console.log();
    
    // 5. 测试 ContentAgentV3 执行
    console.log('5. 测试 ContentAgentV3 执行...');
    const input = {
      prompt: '理解 TypeScript 的基本概念',
      taskId: 'test-task-1',
      taskTitle: 'TypeScript 入门',
      taskDescription: '学习 TypeScript 的基础语法',
      cognitiveObjective: '理解 TypeScript 的类型系统',
      studentState: {
        userId: testUserId,
        problemClarity: 0.6,
        confidence: 0.5,
        frustration: 0.3,
        cognitiveDepth: 0.4,
        learningStyle: 'mixed',
        currentLSS: state?.lss ?? 5,
        currentKTL: state?.ktl ?? 5,
        currentLF: state?.lf ?? 3,
        currentLSB: state?.lsb ?? 2
      },
      currentRound: 1,
      sessionId: session.id,
      params: {
        taskType: 'discussion'
      }
    };
    
    const output = await agent.execute(input as any);
    console.log('✓ Agent 执行成功');
    console.log('生成内容:', (output as any).content?.question?.substring(0, 100) + '...');
    console.log('策略:', (output as any).internal?.strategy);
    console.log('UI 类型:', (output as any).internal?.uiType);
    console.log('难度:', (output as any).internal?.difficulty);
    console.log('质量分数:', (output as any).internal?.qualityScore);
    console.log();
    
    // 6. 验证状态更新
    console.log('6. 验证状态更新...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // 等待状态更新完成
    
    const updatedState = await learningStateService.getCurrentState(testUserId);
    console.log('更新后的 LSS:', updatedState?.lss.toFixed(2));
    console.log('更新后的 KTL:', updatedState?.ktl.toFixed(2));
    console.log('更新后的 LF:', updatedState?.lf.toFixed(2));
    console.log();
    
    // 7. 验证 EMA 基线更新
    console.log('7. 验证 EMA 基线...');
    const baseline = await studentBaselineService.getOrCreateBaseline(testUserId);
    console.log('响应时间基线:', baseline.responseTime.ema.toFixed(2));
    console.log('消息长度基线:', baseline.messageLength.ema.toFixed(2));
    console.log('AI 评分基线:', baseline.aiScore.ema.toFixed(2));
    console.log('更新次数:', baseline.responseTime.updateCount);
    console.log();
    
    // 8. 验证学习会话消息
    console.log('8. 验证学习会话消息...');
    const updatedSession = await learningSessionService.getSession(session.id);
    console.log('消息数量:', updatedSession?.messages.length ?? 0);
    if (updatedSession?.messages.length) {
      console.log('最后一条消息:', updatedSession.messages[updatedSession.messages.length - 1].content.substring(0, 50) + '...');
    }
    console.log();
    
    // 9. 测试不同状态下的策略选择
    console.log('9. 测试不同状态下的策略选择...');
    
    // 高疲劳状态
    console.log('\n9.1 高疲劳状态测试 (LF > 7)...');
    const highFatigueInput = {
      ...input,
      studentState: {
        ...input.studentState,
        currentLF: 8.5,
        frustration: 0.8
      }
    };
    const highFatigueOutput = await agent.execute(highFatigueInput as any);
    console.log('策略:', (highFatigueOutput as any).internal?.strategy);
    console.log('预期：SUPPORTIVE（支持鼓励）');
    
    // 低知识掌握状态
    console.log('\n9.2 低知识掌握状态测试 (KTL < 3)...');
    const lowKtlInput = {
      ...input,
      studentState: {
        ...input.studentState,
        currentKTL: 2.0,
        confidence: 0.3
      }
    };
    const lowKtlOutput = await agent.execute(lowKtlInput as any);
    console.log('策略:', (lowKtlOutput as any).internal?.strategy);
    console.log('预期：BASIC（基础引导）');
    
    // 高压力状态
    console.log('\n9.3 高压力状态测试 (LSS > 7)...');
    const highStressInput = {
      ...input,
      studentState: {
        ...input.studentState,
        currentLSS: 8.0,
        frustration: 0.7
      }
    };
    const highStressOutput = await agent.execute(highStressInput as any);
    console.log('策略:', (highStressOutput as any).internal?.strategy);
    console.log('预期：SUPPORTIVE（支持鼓励）');
    
    // 高掌握度 + 高参与度
    console.log('\n9.4 高掌握度 + 高参与度测试 (KTL > 7, engagement > 0.8)...');
    const highMasteryInput = {
      ...input,
      studentState: {
        ...input.studentState,
        currentKTL: 8.5,
        confidence: 0.9,
        problemClarity: 0.9,
        frustration: 0.1,
        cognitiveDepth: 0.9
      }
    };
    const highMasteryOutput = await agent.execute(highMasteryInput as any);
    console.log('策略:', (highMasteryOutput as any).internal?.strategy);
    console.log('预期：CHALLENGE（挑战深化）');
    
    console.log('\n=== 测试完成 ===');
    
  } catch (error: any) {
    console.error('测试失败:', error.message);
    logger.error('集成测试错误:', error);
  } finally {
    // 清理测试数据
    try {
      console.log('\n清理测试数据...');
      await prisma.learning_sessions.deleteMany({
        where: { userId: testUserId }
      });
      await prisma.learning_metrics.deleteMany({
        where: { userId: testUserId }
      });
      await prisma.student_baselines.deleteMany({
        where: { userId: testUserId }
      });
      await prisma.users.delete({
        where: { id: testUserId }
      });
      console.log('✓ 测试数据已清理');
    } catch (cleanupError: any) {
      console.error('清理失败:', cleanupError.message);
    }
    
    // 关闭数据库连接
    await prisma.$disconnect();
  }
}

// 运行测试
testIntegration()
  .then(() => {
    console.log('\n测试执行完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n测试执行失败！');
    console.error(error);
    process.exit(1);
  });