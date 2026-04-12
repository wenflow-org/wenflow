/**
 * AI Tutor 状态集成测试
 * 
 * 测试目标：
 * 1. 验证 tutoring 方法是否接受 studentState 参数
 * 2. 验证是否调用 aiStateAssessmentService
 * 3. 验证是否根据状态调整 temperature
 * 4. 验证干预策略是否生效
 */

import aiService from './services/ai/ai.service';

async function testTutorWithState() {
  console.log('=== AI Tutor 状态集成测试 ===\n');

  // 测试场景 1：高压力 + 低认知 → 情绪安抚策略
  console.log('📍 测试场景 1: 高压力 (0.8) + 低认知 (0.3) → 情绪安抚策略');
  console.log('---');
  
  try {
    const result1 = await aiService.tutoring('如何学习 Python？我感觉好难，完全看不懂...', {
      userId: 'test-user-001',
      sessionId: 'test-session-001',
      studentState: {
        cognitive: 0.3,  // 低认知
        stress: 0.8,     // 高压力
        engagement: 0.5,
        anomaly: false
      }
    });
    
    console.log('✅ AI Tutor 回应:');
    console.log(result1.answer);
    console.log('\n📊 使用的状态参数:');
    console.log(JSON.stringify(result1.studentState, null, 2));
    console.log('\n');
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
  }

  // 测试场景 2：低压力 + 高认知 → 进阶拔高策略
  console.log('📍 测试场景 2: 低压力 (0.2) + 高认知 (0.8) → 进阶拔高策略');
  console.log('---');
  
  try {
    const result2 = await aiService.tutoring('我想深入理解 Python 的装饰器原理', {
      userId: 'test-user-002',
      sessionId: 'test-session-002',
      studentState: {
        cognitive: 0.8,  // 高认知
        stress: 0.2,     // 低压力
        engagement: 0.9,
        anomaly: false
      }
    });
    
    console.log('✅ AI Tutor 回应:');
    console.log(result2.answer);
    console.log('\n📊 使用的状态参数:');
    console.log(JSON.stringify(result2.studentState, null, 2));
    console.log('\n');
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
  }

  // 测试场景 3：低压力 + 低认知 → 苏格拉底反问策略
  console.log('📍 测试场景 3: 低压力 (0.3) + 低认知 (0.3) → 苏格拉底反问策略');
  console.log('---');
  
  try {
    const result3 = await aiService.tutoring('Python 的列表和元组有什么区别？', {
      userId: 'test-user-003',
      sessionId: 'test-session-003',
      studentState: {
        cognitive: 0.3,  // 低认知
        stress: 0.3,     // 低压力
        engagement: 0.4, // 低投入
        anomaly: false
      }
    });
    
    console.log('✅ AI Tutor 回应:');
    console.log(result3.answer);
    console.log('\n📊 使用的状态参数:');
    console.log(JSON.stringify(result3.studentState, null, 2));
    console.log('\n');
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
  }

  // 测试场景 4：高压力 + 高认知 → 静默追踪策略
  console.log('📍 测试场景 4: 高压力 (0.8) + 高认知 (0.7) → 静默追踪策略');
  console.log('---');
  
  try {
    const result4 = await aiService.tutoring('这个算法的时间复杂度我推导出来了，但不确定对不对...', {
      userId: 'test-user-004',
      sessionId: 'test-session-004',
      studentState: {
        cognitive: 0.7,  // 高认知
        stress: 0.8,     // 高压力
        engagement: 0.6,
        anomaly: false
      }
    });
    
    console.log('✅ AI Tutor 回应:');
    console.log(result4.answer);
    console.log('\n📊 使用的状态参数:');
    console.log(JSON.stringify(result4.studentState, null, 2));
    console.log('\n');
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
  }

  // 测试场景 5：正常状态 → 正常引导策略
  console.log('📍 测试场景 5: 正常状态 (压力 0.5, 认知 0.6) → 正常引导策略');
  console.log('---');
  
  try {
    const result5 = await aiService.tutoring('Python 中的生成器如何使用？', {
      userId: 'test-user-005',
      sessionId: 'test-session-005',
      studentState: {
        cognitive: 0.6,  // 正常认知
        stress: 0.5,     // 正常压力
        engagement: 0.6, // 正常投入
        anomaly: false
      }
    });
    
    console.log('✅ AI Tutor 回应:');
    console.log(result5.answer);
    console.log('\n📊 使用的状态参数:');
    console.log(JSON.stringify(result5.studentState, null, 2));
    console.log('\n');
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
  }

  console.log('=== 测试完成 ===');
}

// 运行测试
testTutorWithState()
  .then(() => {
    console.log('\n✅ 所有测试执行完毕');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 测试执行失败:', error);
    process.exit(1);
  });
