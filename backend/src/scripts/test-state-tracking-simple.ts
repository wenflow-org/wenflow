/**
 * 学习状态追踪系统 - 核心功能测试（简化版）
 * 
 * 测试内容：
 * 1. EMA 服务功能测试
 * 2. AI 状态评估服务测试
 * 3. LearningSessionService 集成测试
 */

import prisma from '../config/database';
import { studentBaselineService } from '../services/student-baseline.service';
import { aiStateAssessmentService } from '../services/ai/state-assessment.service';
import { learningSessionService } from '../services/learning/learning-session.service';

// 测试用户 ID
const TEST_USER_ID = 'test-user-' + Date.now();
const TEST_MESSAGES = [
  { role: 'user' as const, content: '我想学习 Python 自动化 Excel 报表', timestamp: new Date().toISOString() },
  { role: 'assistant' as const, content: '好的，我来帮你规划学习路径。你之前有编程基础吗？', timestamp: new Date().toISOString() },
  { role: 'user' as const, content: '有一些基础，学过一点 Python 语法', timestamp: new Date().toISOString() },
  { role: 'assistant' as const, content: '很好！那你平时用 Excel 主要做什么操作呢？', timestamp: new Date().toISOString() },
  { role: 'user' as const, content: '主要是数据整理和报表生成，每天都要做类似的表格', timestamp: new Date().toISOString() }
];

async function testEMAService() {
  console.log('\n=== 测试 1: EMA 服务功能 ===\n');
  
  try {
    // 0. 创建测试用户
    console.log('0. 创建测试用户...');
    await prisma.users.create({
      data: {
        id: TEST_USER_ID,
        email: `test-${TEST_USER_ID}@test.com`,
        password: 'test-password',
        name: 'Test User',
        updatedAt: new Date()
      }
    });
    console.log('✓ 测试用户创建成功');
    
    // 1. 创建或获取基线
    console.log('1.1 创建基线...');
    const baseline = await studentBaselineService.getOrCreateBaseline(TEST_USER_ID);
    console.log('✓ 基线创建成功');
    console.log('   响应时间基线:', baseline.responseTime.ema, '±', Math.sqrt(baseline.responseTime.emVar).toFixed(2));
    
    // 2. 更新基线
    console.log('\n1.2 更新基线（模拟 5 次学习行为）...');
    for (let i = 0; i < 5; i++) {
      const result = await studentBaselineService.updateBaseline(TEST_USER_ID, {
        responseTime: 8 + Math.random() * 4,
        messageLength: 30 + Math.random() * 40,
        interactionInterval: 2 + Math.random() * 3,
        aiScore: 0.5 + Math.random() * 0.3
      });
      
      console.log(`   第${i + 1}次更新:`);
      console.log('     Z-Score:', {
        responseTime: result.zScores.responseTime?.toFixed(2),
        messageLength: result.zScores.messageLength?.toFixed(2),
        aiScore: result.zScores.aiScore?.toFixed(2)
      });
      console.log('     异常检测:', result.anomaly.hasAnomaly ? '⚠️ ' + result.anomaly.reasoning : '✅ 正常');
    }
    
    // 3. 获取基线统计
    console.log('\n1.3 获取基线统计...');
    const stats = await studentBaselineService.getBaselineStats(TEST_USER_ID);
    console.log('✓ 基线统计:', {
      isStable: stats.isStable,
      confidence: (stats.confidence * 100).toFixed(0) + '%'
    });
    
    console.log('\n✅ EMA 服务测试通过\n');
    return true;
  } catch (error: any) {
    console.error('\n❌ EMA 服务测试失败:', error.message);
    console.error(error.stack);
    return false;
  }
}

async function testAIStateAssessment() {
  console.log('\n=== 测试 2: AI 状态评估服务 ===\n');
  
  try {
    // 1. AI 认知状态评估
    console.log('2.1 AI 认知状态评估...');
    const aiAssessment = await aiStateAssessmentService.assessCognitiveState(TEST_MESSAGES);
    console.log('✓ AI 评估结果:');
    console.log('   认知深度:', (aiAssessment.cognitiveDepth * 100).toFixed(0) + '%');
    console.log('   压力程度:', (aiAssessment.stressLevel * 100).toFixed(0) + '%');
    console.log('   投入程度:', (aiAssessment.engagement * 100).toFixed(0) + '%');
    console.log('   推理:', aiAssessment.reasoning.substring(0, 100) + '...');
    
    // 2. 准备 EMA 数据
    console.log('\n2.2 准备 EMA 数据...');
    const zScores = {
      responseTime: 0.5,
      messageLength: -0.3,
      interactionInterval: 0.2,
      aiScore: 0.1
    };
    const anomaly = {
      hasAnomaly: false,
      anomalyMetrics: [],
      zScores,
      reasoning: ''
    };
    
    // 3. 综合 AI 和 EMA
    console.log('\n2.3 综合 AI 和 EMA 判断...');
    const finalState = await aiStateAssessmentService.integrateAIandEMA(
      aiAssessment,
      zScores,
      anomaly,
      TEST_MESSAGES
    );
    console.log('✓ 综合评估结果:');
    console.log('   认知:', (finalState.cognitive * 100).toFixed(0) + '%');
    console.log('   压力:', (finalState.stress * 100).toFixed(0) + '%');
    console.log('   投入:', (finalState.engagement * 100).toFixed(0) + '%');
    console.log('   异常:', finalState.anomaly ? '是' : '否');
    
    // 4. 干预策略生成
    console.log('\n2.4 干预策略生成...');
    const strategy = aiStateAssessmentService.generateInterventionStrategy(finalState);
    console.log('✓ 干预策略:');
    console.log('   ', strategy.split('\n').slice(0, 3).join('\n    '));
    
    console.log('\n✅ AI 状态评估服务测试通过\n');
    return true;
  } catch (error: any) {
    console.error('\n❌ AI 状态评估服务失败:', error.message);
    console.error(error.stack);
    return false;
  }
}

async function testLearningSessionService() {
  console.log('\n=== 测试 3: LearningSessionService 集成测试 ===\n');
  
  try {
    // 1. 创建会话
    console.log('3.1 创建学习会话...');
    const session = await learningSessionService.createSession(TEST_USER_ID);
    console.log('✓ 会话创建成功:', session.id);
    
    // 2. 添加消息并评估状态
    console.log('\n3.2 添加消息并评估状态...');
    const testMessage = {
      role: 'user' as const,
      content: '我觉得 Python 的循环结构还是有点难理解',
      timestamp: new Date().toISOString()
    };
    
    const result = await learningSessionService.addMessageAndAssessState(
      session.id,
      testMessage,
      TEST_USER_ID
    );
    
    console.log('✓ 状态评估完成:');
    console.log('   认知深度:', (result.state.cognitive * 100).toFixed(0) + '%');
    console.log('   压力程度:', (result.state.stress * 100).toFixed(0) + '%');
    console.log('   投入程度:', (result.state.engagement * 100).toFixed(0) + '%');
    console.log('   异常检测:', result.anomaly?.hasAnomaly ? '⚠️ ' + result.anomaly.reasoning : '✅ 正常');
    
    // 3. 获取会话
    console.log('\n3.3 获取会话状态...');
    const updatedSession = await learningSessionService.getSession(session.id);
    console.log('✓ 会话状态:');
    console.log('   消息数:', updatedSession?.messages.length);
    console.log('   状态评估时间:', updatedSession?.state?.assessedAt);
    
    console.log('\n✅ LearningSessionService 测试通过\n');
    return true;
  } catch (error: any) {
    console.error('\n❌ LearningSessionService 测试失败:', error.message);
    console.error(error.stack);
    return false;
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 学习状态追踪系统 - 核心功能测试开始');
  console.log('='.repeat(60));
  
  const results = {
    ema: await testEMAService(),
    aiAssessment: await testAIStateAssessment(),
    sessionService: await testLearningSessionService()
  };
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(60));
  console.log('EMA 服务:', results.ema ? '✅ 通过' : '❌ 失败');
  console.log('AI 状态评估:', results.aiAssessment ? '✅ 通过' : '❌ 失败');
  console.log('LearningSession:', results.sessionService ? '✅ 通过' : '❌ 失败');
  console.log('='.repeat(60));
  
  const allPassed = Object.values(results).every(r => r === true);
  console.log('\n总评:', allPassed ? '✅ 所有测试通过！🎉' : '⚠️ 部分测试失败');
  console.log('='.repeat(60) + '\n');
  
  // 清理测试数据
  console.log('清理测试数据...');
  await prisma.student_baselines.deleteMany({
    where: { userId: TEST_USER_ID }
  });
  await prisma.learning_sessions.deleteMany({
    where: { userId: TEST_USER_ID }
  });
  await prisma.users.deleteMany({
    where: { id: TEST_USER_ID }
  });
  console.log('✓ 测试数据已清理\n');
  
  process.exit(allPassed ? 0 : 1);
}

// 运行测试
runAllTests().catch(error => {
  console.error('测试运行失败:', error);
  process.exit(1);
});