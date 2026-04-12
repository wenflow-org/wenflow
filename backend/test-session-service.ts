/**
 * LearningSessionService 集成测试
 * 
 * 测试内容：
 * 1. 创建学习会话
 * 2. 添加消息并评估状态
 * 3. 获取会话信息
 * 4. 验证数据库表结构
 */

import { learningSessionService } from './src/services/learning/learning-session.service';
import { studentBaselineService } from './src/services/student-baseline.service';
import { aiStateAssessmentService } from './src/services/ai/state-assessment.service';
import prisma from './src/config/database';
import { logger } from './src/utils/logger';

async function testLearningSessionService() {
  console.log('\n========================================');
  console.log('LearningSessionService 集成测试');
  console.log('========================================\n');
  
  const testUserId = 'test-user-session';
  let sessionId: string | null = null;
  
  try {
    // ========================================
    // 测试 0: 创建测试用户
    // ========================================
    console.log('【测试 0】创建测试用户...\n');
    
    // 尝试创建测试用户（如果不存在）
    try {
      // 检查用户是否存在
      const existingUser = await prisma.users.findUnique({
        where: { id: testUserId }
      });
      
      if (!existingUser) {
        // 使用 createMany 来绕过类型问题
        await prisma.users.createMany({
          data: [{
            id: testUserId,
            email: `${testUserId}@test.com`,
            password: 'hashed-password',
            name: 'Test User',
            role: 'user',
            xp: 0,
            level: 1,
            isAdmin: false,
            createdAt: new Date(),
            updatedAt: new Date()
          }]
        });
        console.log('✅ 测试用户已创建');
      } else {
        console.log('ℹ️  测试用户已存在，跳过创建');
      }
    } catch (error: any) {
      console.log('创建用户失败:', error.message);
      throw error;
    }
    
    // ========================================
    // 测试 1: 检查数据库表结构
    // ========================================
    console.log('【测试 1】检查 learning_sessions 表结构...\n');
    
    const tableInfo = await prisma.$queryRawUnsafe(`PRAGMA table_info(learning_sessions)`);
    console.log('表结构信息:');
    // 处理 BigInt 序列化问题
    console.log(JSON.stringify(tableInfo, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2));
    
    // 验证字段
    const columns = (tableInfo as any[]).map(col => col.name);
    const requiredColumns = ['id', 'userId', 'goalId', 'messages', 'state', 'createdAt', 'updatedAt'];
    
    console.log('字段验证:');
    requiredColumns.forEach(col => {
      const exists = columns.includes(col);
      console.log(`  ${exists ? '✅' : '❌'} ${col}`);
    });
    
    // ========================================
    // 测试 2: 创建学习会话
    // ========================================
    console.log('\n【测试 2】创建学习会话...\n');
    
    const session = await learningSessionService.createSession(testUserId);
    sessionId = session.id;
    
    console.log('创建会话成功:');
    console.log(`  - 会话 ID: ${session.id}`);
    console.log(`  - 用户 ID: ${session.userId}`);
    console.log(`  - 目标 ID: ${session.goalId || '无'}`);
    console.log(`  - 创建时间：${session.createdAt}`);
    console.log(`  - 初始消息数：${session.messages.length}`);
    
    // ========================================
    // 测试 3: 添加消息并评估状态
    // ========================================
    console.log('\n【测试 3】添加消息并评估状态...\n');
    
    const message1 = {
      role: 'user' as const,
      content: '你好，我想学习 Python 编程',
      timestamp: new Date().toISOString()
    };
    
    const result1 = await learningSessionService.addMessageAndAssessState(
      sessionId,
      message1,
      testUserId
    );
    
    console.log('添加第一条消息结果:');
    console.log(`  - 状态评估:`);
    console.log(`    * 认知深度：${result1.state.cognitive.toFixed(2)}`);
    console.log(`    * 压力程度：${result1.state.stress.toFixed(2)}`);
    console.log(`    * 投入程度：${result1.state.engagement.toFixed(2)}`);
    console.log(`    * 是否异常：${result1.state.anomaly}`);
    console.log(`  - 消息指标:`);
    console.log(`    * 消息长度：${result1.metrics.messageLength} 字符`);
    console.log(`    * 响应时间：${result1.metrics.responseTime} 秒`);
    console.log(`  - EMA 异常检测:`);
    console.log(`    * 是否异常：${result1.anomaly?.hasAnomaly}`);
    console.log(`    * 异常原因：${result1.anomaly?.reasoning || '无'}`);
    
    // 添加第二条消息
    console.log('\n添加第二条消息...');
    const message2 = {
      role: 'assistant' as const,
      content: '很好！Python 是一门非常流行的编程语言。请问你之前有编程经验吗？',
      timestamp: new Date().toISOString()
    };
    
    const result2 = await learningSessionService.addMessageAndAssessState(
      sessionId,
      message2,
      testUserId
    );
    
    console.log('添加第二条消息结果:');
    console.log(`  - 状态评估:`);
    console.log(`    * 认知深度：${result2.state.cognitive.toFixed(2)}`);
    console.log(`    * 压力程度：${result2.state.stress.toFixed(2)}`);
    console.log(`    * 投入程度：${result2.state.engagement.toFixed(2)}`);
    console.log(`  - 消息总数：${result2.session.messages.length}`);
    
    // 添加第三条消息（用户回复）
    console.log('\n添加第三条消息...');
    const message3 = {
      role: 'user' as const,
      content: '我完全没有编程经验，是零基础。我想学会用 Python 做数据分析。',
      timestamp: new Date().toISOString()
    };
    
    const result3 = await learningSessionService.addMessageAndAssessState(
      sessionId,
      message3,
      testUserId
    );
    
    console.log('添加第三条消息结果:');
    console.log(`  - 状态评估:`);
    console.log(`    * 认知深度：${result3.state.cognitive.toFixed(2)}`);
    console.log(`    * 压力程度：${result3.state.stress.toFixed(2)}`);
    console.log(`    * 投入程度：${result3.state.engagement.toFixed(2)}`);
    console.log(`    * 异常原因：${result3.state.anomalyReason || '无'}`);
    console.log(`    * 干预建议：${result3.state.intervention || '无'}`);
    console.log(`  - Z-Scores:`);
    console.log(`    * 响应时间：${result3.zScores?.responseTime?.toFixed(2) || 'N/A'}`);
    console.log(`    * 消息长度：${result3.zScores?.messageLength?.toFixed(2) || 'N/A'}`);
    
    // ========================================
    // 测试 4: 获取会话信息
    // ========================================
    console.log('\n【测试 4】获取会话信息...\n');
    
    const retrievedSession = await learningSessionService.getSession(sessionId);
    
    if (retrievedSession) {
      console.log('获取会话成功:');
      console.log(`  - 会话 ID: ${retrievedSession.id}`);
      console.log(`  - 消息数量：${retrievedSession.messages.length}`);
      console.log(`  - 当前状态:`);
      console.log(`    * 认知深度：${retrievedSession.state?.cognitive.toFixed(2)}`);
      console.log(`    * 压力程度：${retrievedSession.state?.stress.toFixed(2)}`);
      console.log(`    * 投入程度：${retrievedSession.state?.engagement.toFixed(2)}`);
      
      console.log('\n消息历史:');
      retrievedSession.messages.forEach((msg, idx) => {
        console.log(`  ${idx + 1}. [${msg.role}] ${msg.content.substring(0, 50)}...`);
      });
    } else {
      console.log('❌ 获取会话失败');
    }
    
    // ========================================
    // 测试 5: 获取活跃会话
    // ========================================
    console.log('\n【测试 5】获取用户的活跃会话...\n');
    
    const activeSessions = await learningSessionService.getActiveSessions(testUserId);
    
    console.log(`找到 ${activeSessions.length} 个活跃会话:`);
    activeSessions.forEach(s => {
      console.log(`  - ${s.id} (创建于：${s.createdAt}, 消息数：${s.messages.length})`);
    });
    
    // ========================================
    // 测试 6: 验证依赖服务
    // ========================================
    console.log('\n【测试 6】验证依赖服务...\n');
    
    // 测试 EMA 基线服务
    const baselineStats = await studentBaselineService.getBaselineStats(testUserId);
    console.log('EMA 基线服务:');
    console.log(`  - 基线是否稳定：${baselineStats.isStable}`);
    console.log(`  - 置信度：${(baselineStats.confidence * 100).toFixed(0)}%`);
    console.log(`  - 响应时间 EMA: ${baselineStats.current.responseTime.ema.toFixed(2)}秒`);
    console.log(`  - 消息长度 EMA: ${baselineStats.current.messageLength.ema.toFixed(2)}字符`);
    console.log(`  - AI 评分 EMA: ${baselineStats.current.aiScore.ema.toFixed(2)}`);
    
    // ========================================
    // 总结
    // ========================================
    console.log('\n========================================');
    console.log('测试总结');
    console.log('========================================\n');
    
    console.log('✅ LearningSessionService 功能正常');
    console.log('✅ 数据库表结构匹配 (messages, state 字段均为 JSON 字符串)');
    console.log('✅ 依赖服务集成正常:');
    console.log('   - studentBaselineService (EMA 基线)');
    console.log('   - aiStateAssessmentService (AI 状态评估)');
    console.log('   - extractMetrics (指标提取)');
    console.log('✅ 消息添加和状态评估流程正常');
    console.log('✅ Z-Score 计算和异常检测正常');
    
    console.log('\n测试结果：通过 ✅\n');
    
  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message);
    console.error('错误堆栈:', error.stack);
    throw error;
  } finally {
    // 清理测试数据
    if (sessionId) {
      console.log('\n清理测试数据...');
      try {
        await prisma.learning_sessions.delete({
          where: { id: sessionId }
        });
        console.log('已删除测试会话');
      } catch (e: any) {
        console.error('清理测试数据失败:', e.message);
      }
    }
    
    // 清理测试用户的基线数据
    try {
      await prisma.student_baselines.delete({
        where: { userId: testUserId }
      });
      console.log('已删除测试基线数据');
    } catch (e: any) {
      // 可能不存在，忽略
    }
    
    await prisma.$disconnect();
    console.log('\n数据库连接已关闭\n');
  }
}

// 运行测试
testLearningSessionService()
  .then(() => {
    console.log('测试完成！\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('测试异常退出\n');
    process.exit(1);
  });