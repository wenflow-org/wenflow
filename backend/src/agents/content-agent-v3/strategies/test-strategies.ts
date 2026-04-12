/**
 * ContentAgent v3.0 - 策略选择机制测试脚本
 * 
 * 测试 5 种策略的触发场景
 */

import { StrategyManager, ContentStrategy, StudentState } from './index';

// 创建策略管理器实例
const strategyManager = new StrategyManager();

console.log('='.repeat(60));
console.log('ContentAgent v3.0 - 策略选择机制测试');
console.log('='.repeat(60));

// 测试场景 1: 高挫败感学生
console.log('\n【测试场景 1】高挫败感学生');
const highFrustrationState: StudentState = {
  problemClarity: 0.5,
  confidence: 0.4,
  frustration: 0.85,  // 高挫败感
  cognitiveDepth: 0.5,
  learningStyle: 'mixed',
  currentLSS: 0.7,
  currentKTL: 0.5,
  currentLF: 0.6,
  currentLSB: -0.1
};

const result1 = strategyManager.selectStrategy(highFrustrationState);
console.log(`选中策略：${result1.strategy.type}`);
console.log(`选择原因：${result1.reason}`);
console.log(`得分：${result1.score}`);
console.log(`触发条件数：${result1.triggeredConditions.length}`);
console.log(`推荐 UI 类型：${result1.strategy.uiTypeRecommendation}`);
console.log(`难度调整：${result1.strategy.difficultyAdjustment}`);

// 测试场景 2: 低理解度学生
console.log('\n【测试场景 2】低理解度学生');
const lowUnderstandingState: StudentState = {
  problemClarity: 0.2,  // 低清晰度
  confidence: 0.3,
  frustration: 0.3,
  cognitiveDepth: 0.3,
  learningStyle: 'mixed',
  currentLSS: 0.4,
  currentKTL: 0.2,  // 低 KTL
  currentLF: 0.3,
  currentLSB: -0.1
};

const result2 = strategyManager.selectStrategy(lowUnderstandingState);
console.log(`选中策略：${result2.strategy.type}`);
console.log(`选择原因：${result2.reason}`);
console.log(`推荐 UI 类型：${result2.strategy.uiTypeRecommendation}`);
console.log(`内容指导语气：${result2.strategy.contentGuidelines.tone}`);

// 测试场景 3: 优秀学生（高理解 + 高信心）
console.log('\n【测试场景 3】优秀学生（高理解 + 高信心）');
const excellentState: StudentState = {
  problemClarity: 0.9,  // 高清晰度
  confidence: 0.9,      // 高信心
  frustration: 0.1,
  cognitiveDepth: 0.8,
  learningStyle: 'mixed',
  currentLSS: 0.3,
  currentKTL: 0.8,  // 高 KTL
  currentLF: 0.2,
  currentLSB: 0.6
};

const result3 = strategyManager.selectStrategy(excellentState);
console.log(`选中策略：${result3.strategy.type}`);
console.log(`选择原因：${result3.reason}`);
console.log(`推荐 UI 类型：${result3.strategy.uiTypeRecommendation}`);
console.log(`难度调整：${result3.strategy.difficultyAdjustment}`);

// 测试场景 4: 连续错误学生
console.log('\n【测试场景 4】连续错误学生');
const errorProneState: StudentState = {
  problemClarity: 0.5,
  confidence: 0.4,
  frustration: 0.5,
  cognitiveDepth: 0.5,
  learningStyle: 'mixed',
  currentLSS: 0.5,
  currentKTL: 0.5,
  currentLF: 0.5,
  currentLSB: 0,
  consecutiveErrors: 3  // 连续错误 >= 2
};

const result4 = strategyManager.selectStrategy(errorProneState);
console.log(`选中策略：${result4.strategy.type}`);
console.log(`选择原因：${result4.reason}`);
console.log(`触发条件：${JSON.stringify(result4.triggeredConditions, null, 2)}`);

// 测试场景 5: 普通学生（默认状态）
console.log('\n【测试场景 5】普通学生（默认状态）');
const normalState: StudentState = {
  problemClarity: 0.6,
  confidence: 0.6,
  frustration: 0.3,
  cognitiveDepth: 0.5,
  learningStyle: 'mixed',
  currentLSS: 0.4,
  currentKTL: 0.6,
  currentLF: 0.3,
  currentLSB: 0.3
};

const result5 = strategyManager.selectStrategy(normalState);
console.log(`选中策略：${result5.strategy.type}`);
console.log(`选择原因：${result5.reason}`);
console.log(`得分：${result5.score}（默认策略基础分）`);

// 测试场景 6: UI 类型推荐
console.log('\n【测试场景 6】UI 类型推荐测试');
const taskTypes = ['discussion', 'code', 'coding', 'practice'];
for (const taskType of taskTypes) {
  const uiType = strategyManager.getUITypeRecommendation(ContentStrategy.STANDARD, taskType);
  console.log(`任务类型 "${taskType}" -> UI 类型：${uiType}`);
}

// 测试场景 7: 内容指导获取
console.log('\n【测试场景 7】内容指导获取');
const strategies = [
  ContentStrategy.SUPPORTIVE,
  ContentStrategy.BASIC,
  ContentStrategy.STANDARD,
  ContentStrategy.CHALLENGE,
  ContentStrategy.REMEDIAL
];

for (const strategy of strategies) {
  const guidelines = strategyManager.getContentGuidelines(strategy);
  console.log(`\n${strategy}:`);
  console.log(`  语气：${guidelines.tone}`);
  console.log(`  代词：${guidelines.pronounUsage}`);
  console.log(`  难度：${guidelines.difficultyLevel}/5`);
  console.log(`  讲解深度：${guidelines.explanationDepth}`);
  console.log(`  示例类型：${guidelines.exampleType}`);
  console.log(`  提示频率：${guidelines.hintFrequency}`);
}

// 测试场景 8: 难度调整
console.log('\n【测试场景 8】难度调整测试');
for (const strategy of strategies) {
  const adjustment = strategyManager.getDifficultyAdjustment(strategy);
  const adjustmentLabel = adjustment > 0 ? `+${adjustment}` : adjustment.toString();
  console.log(`${strategy}: 难度调整 ${adjustmentLabel}`);
}

console.log('\n' + '='.repeat(60));
console.log('测试完成！');
console.log('='.repeat(60));
