/**
 * AI 状态评估服务测试脚本
 * 
 * 测试内容：
 * 1. assessCognitiveState - AI 认知状态评估
 * 2. integrateAIandEMA - AI+EMA 融合评估
 * 3. generateInterventionStrategy - 四象限干预策略生成
 */

import { 
  AIStateAssessmentService, 
  Message, 
  AIAssessmentResult,
  StudentStateAssessment 
} from '../services/ai/state-assessment.service';
import { ZScoreResult, AnomalyDetectionResult } from '../services/student-baseline.service';

// 测试数据
const testCases = {
  // 测试用例 1: 高压力 + 低掌握度（需要情绪安抚）
  highStressLowMastery: {
    conversation: [
      { role: 'user' as const, content: '这个完全不懂啊，太难了', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: '哪里不懂呢？', timestamp: new Date().toISOString() },
      { role: 'user' as const, content: '都不懂，能不能直接给答案', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: '我们可以一步步来', timestamp: new Date().toISOString() },
      { role: 'user' as const, content: '好吧，但是真的好复杂', timestamp: new Date().toISOString() }
    ] as Message[],
    description: '高压力 + 低掌握度'
  },
  
  // 测试用例 2: 低压力 + 高掌握度（最佳状态）
  lowStressHighMastery: {
    conversation: [
      { role: 'user' as const, content: '我觉得这个概念和之前学的 xxx 有联系', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: '很好的观察！具体是什么联系？', timestamp: new Date().toISOString() },
      { role: 'user' as const, content: '都是关于 xxx 的抽象，不过这个更一般化', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: '非常正确！', timestamp: new Date().toISOString() },
      { role: 'user' as const, content: '那如果应用到 xxx 场景呢？', timestamp: new Date().toISOString() }
    ] as Message[],
    description: '低压力 + 高掌握度'
  },
  
  // 测试用例 3: 低压力 + 低掌握度（敷衍状态）
  lowStressLowMastery: {
    conversation: [
      { role: 'user' as const, content: '嗯', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: '你理解了吗？', timestamp: new Date().toISOString() },
      { role: 'user' as const, content: '吧', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: '能说说你的想法吗？', timestamp: new Date().toISOString() },
      { role: 'user' as const, content: '没什么想法', timestamp: new Date().toISOString() }
    ] as Message[],
    description: '低压力 + 低掌握度（敷衍）'
  },
  
  // 测试用例 4: 高压力 + 高掌握度（挑战状态）
  highStressHighMastery: {
    conversation: [
      { role: 'user' as const, content: '这个推导我卡住了，但是我觉得应该用 xxx 方法', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: '很好的思路！继续', timestamp: new Date().toISOString() },
      { role: 'user' as const, content: '但是这里有个矛盾，我推不出来', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: '检查一下假设', timestamp: new Date().toISOString() },
      { role: 'user' as const, content: '等等，我好像发现问题了，让我再想想', timestamp: new Date().toISOString() }
    ] as Message[],
    description: '高压力 + 高掌握度'
  }
};

// Mock EMA 数据
const mockZScores: ZScoreResult = {
  responseTime: 2.8,
  messageLength: -0.5,
  interactionInterval: 1.2,
  aiScore: 0.75
};

const mockAnomaly: AnomalyDetectionResult = {
  hasAnomaly: true,
  anomalyMetrics: ['responseTime'],
  zScores: mockZScores,
  reasoning: '响应时间显著高于基线（Z=2.8 > 2.5），学生可能遇到困难'
};

async function runTests() {
  console.log('='.repeat(80));
  console.log('AI 状态评估服务测试');
  console.log('='.repeat(80));
  console.log('');
  
  const service = new AIStateAssessmentService();
  
  // 测试 1: assessCognitiveState
  console.log('【测试 1】assessCognitiveState - AI 认知状态评估');
  console.log('-'.repeat(80));
  
  for (const [key, testCase] of Object.entries(testCases)) {
    console.log(`\n测试用例：${testCase.description}`);
    console.log(`对话轮数：${testCase.conversation.length}`);
    
    try {
      const result = await service.assessCognitiveState(testCase.conversation);
      
      console.log('✅ AI 评估结果:');
      console.log(`   认知深度：${result.cognitiveDepth.toFixed(3)}`);
      console.log(`   压力程度：${result.stressLevel.toFixed(3)}`);
      console.log(`   投入程度：${result.engagement.toFixed(3)}`);
      console.log(`   推理：${result.reasoning.substring(0, 100)}...`);
      
      // 验证合理性
      validateAssessment(key, result);
    } catch (error: any) {
      console.log(`❌ 测试失败：${error.message}`);
    }
  }
  
  console.log('');
  console.log('='.repeat(80));
  
  // 测试 2: integrateAIandEMA
  console.log('\n【测试 2】integrateAIandEMA - AI+EMA 融合评估');
  console.log('-'.repeat(80));
  
  const testConversation = testCases.highStressLowMastery.conversation;
  
  try {
    // 先获取 AI 评估
    const aiAssessment = await service.assessCognitiveState(testConversation);
    console.log('\nAI 评估结果:');
    console.log(`   认知深度：${aiAssessment.cognitiveDepth.toFixed(3)}`);
    console.log(`   压力程度：${aiAssessment.stressLevel.toFixed(3)}`);
    console.log(`   投入程度：${aiAssessment.engagement.toFixed(3)}`);
    
    // 融合 EMA
    console.log('\nEMA 数值指标:');
    console.log(`   响应时间 Z-Score: ${mockZScores.responseTime.toFixed(2)} ${mockZScores.responseTime > 2.5 ? '⚠️ 异常' : '✅ 正常'}`);
    console.log(`   消息长度 Z-Score: ${mockZScores.messageLength.toFixed(2)}`);
    console.log(`   互动间隔 Z-Score: ${mockZScores.interactionInterval.toFixed(2)}`);
    console.log(`   AI 评分：${mockZScores.aiScore.toFixed(2)}`);
    console.log(`   异常检测：${mockAnomaly.hasAnomaly ? '⚠️ 检测到异常' : '✅ 正常'}`);
    console.log(`   异常原因：${mockAnomaly.reasoning}`);
    
    const integratedResult = await service.integrateAIandEMA(
      aiAssessment,
      mockZScores,
      mockAnomaly,
      testConversation
    );
    
    console.log('\n✅ 融合评估结果:');
    console.log(`   认知状态：${integratedResult.cognitive.toFixed(3)}`);
    console.log(`   压力程度：${integratedResult.stress.toFixed(3)}`);
    console.log(`   投入程度：${integratedResult.engagement.toFixed(3)}`);
    console.log(`   异常状态：${integratedResult.anomaly ? '是' : '否'}`);
    console.log(`   异常原因：${integratedResult.anomalyReason || '无'}`);
    console.log(`   干预建议：${integratedResult.intervention ? '有' : '无'}`);
    console.log(`   评估时间：${integratedResult.assessedAt}`);
    
  } catch (error: any) {
    console.log(`❌ 测试失败：${error.message}`);
  }
  
  console.log('');
  console.log('='.repeat(80));
  
  // 测试 3: generateInterventionStrategy
  console.log('\n【测试 3】generateInterventionStrategy - 四象限干预策略生成');
  console.log('-'.repeat(80));
  
  const interventionTestCases = [
    { stress: 0.8, cognitive: 0.3, engagement: 0.4, description: '高压力 + 低掌握度' },
    { stress: 0.8, cognitive: 0.7, engagement: 0.6, description: '高压力 + 高掌握度' },
    { stress: 0.3, cognitive: 0.3, engagement: 0.3, description: '低压力 + 低掌握度' },
    { stress: 0.3, cognitive: 0.8, engagement: 0.9, description: '低压力 + 高掌握度' },
    { stress: 0.5, cognitive: 0.5, engagement: 0.5, description: '中等状态（默认）' }
  ];
  
  for (const testCase of interventionTestCases) {
    const state: StudentStateAssessment = {
      cognitive: testCase.cognitive,
      stress: testCase.stress,
      engagement: testCase.engagement,
      anomaly: false,
      anomalyReason: '',
      assessedAt: new Date().toISOString()
    };
    
    console.log(`\n测试场景：${testCase.description}`);
    console.log(`   压力：${testCase.stress}, 认知：${testCase.cognitive}, 投入：${testCase.engagement}`);
    
    const strategy = service.generateInterventionStrategy(state);
    console.log('✅ 干预策略:');
    console.log(strategy.split('\n').map(line => `   ${line}`).join('\n'));
  }
  
  console.log('');
  console.log('='.repeat(80));
  console.log('测试完成！');
  console.log('='.repeat(80));
}

/**
 * 验证评估结果是否合理
 */
function validateAssessment(testCaseKey: string, result: AIAssessmentResult) {
  const expectations: Record<string, { stressRange: [number, number]; cognitiveRange: [number, number] }> = {
    highStressLowMastery: { stressRange: [0.6, 1.0], cognitiveRange: [0.0, 0.4] },
    lowStressHighMastery: { stressRange: [0.0, 0.4], cognitiveRange: [0.6, 1.0] },
    lowStressLowMastery: { stressRange: [0.0, 0.5], cognitiveRange: [0.0, 0.4] },
    highStressHighMastery: { stressRange: [0.6, 1.0], cognitiveRange: [0.6, 1.0] }
  };
  
  const expected = expectations[testCaseKey];
  if (!expected) return;
  
  const stressValid = result.stressLevel >= expected.stressRange[0] && result.stressLevel <= expected.stressRange[1];
  const cognitiveValid = result.cognitiveDepth >= expected.cognitiveRange[0] && result.cognitiveDepth <= expected.cognitiveRange[1];
  
  if (stressValid && cognitiveValid) {
    console.log(`   ✅ 评估合理（压力:${result.stressLevel.toFixed(2)}, 认知:${result.cognitiveDepth.toFixed(2)}）`);
  } else {
    console.log(`   ⚠️ 评估可能偏差（期望压力:${expected.stressRange}, 实际:${result.stressLevel.toFixed(2)}）`);
    console.log(`   ⚠️ 期望认知:${expected.cognitiveRange}, 实际:${result.cognitiveDepth.toFixed(2)}）`);
  }
}

// 运行测试
runTests().catch(console.error);