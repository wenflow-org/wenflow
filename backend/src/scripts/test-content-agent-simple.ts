/**
 * ContentAgent v3.0 核心功能测试脚本
 * 
 * 这个脚本测试 ContentAgent v3.0 的核心功能，不依赖完整的服务
 * 运行方式：npx ts-node src/scripts/test-content-agent-simple.ts
 */

import { StrategyManager, ContentStrategy } from '../agents/content-agent-v3/strategies';

console.log('='.repeat(60));
console.log('🧪 ContentAgent v3.0 核心功能测试');
console.log('='.repeat(60));
console.log('');

const testResults: Array<{ name: string; passed: boolean; details?: any }> = [];

// ==================== 测试 1: 策略选择 ====================

console.log('【测试 1】策略选择测试');
console.log('-'.repeat(60));

try {
  const strategyManager = new StrategyManager();

  // 测试场景 1: 高挫败感
  const highFrustrationResult = strategyManager.selectStrategy({
    problemClarity: 0.5,
    confidence: 0.4,
    frustration: 0.8,
    cognitiveDepth: 0.4,
    learningStyle: 'mixed',
    currentLSS: 0.65,
    currentKTL: 0.45,
    currentLF: 0.72,
    currentLSB: 0.30
  });

  const test1Passed = highFrustrationResult.strategy.type === ContentStrategy.SUPPORTIVE;
  testResults.push({
    name: '高挫败感学生策略选择',
    passed: test1Passed,
    details: {
      expected: ContentStrategy.SUPPORTIVE,
      actual: highFrustrationResult.strategy.type,
      reason: highFrustrationResult.reason
    }
  });
  console.log(`  ${test1Passed ? '✅' : '❌'} 高挫败感学生：${highFrustrationResult.strategy.type}`);

  // 测试场景 2: 低理解度
  const lowUnderstandingResult = strategyManager.selectStrategy({
    problemClarity: 0.2,
    confidence: 0.3,
    frustration: 0.4,
    cognitiveDepth: 0.2,
    learningStyle: 'mixed',
    currentLSS: 0.4,
    currentKTL: 0.25,
    currentLF: 0.3,
    currentLSB: -0.05
  });

  const test2Passed = lowUnderstandingResult.strategy.type === ContentStrategy.BASIC;
  testResults.push({
    name: '低理解度学生策略选择',
    passed: test2Passed,
    details: {
      expected: ContentStrategy.BASIC,
      actual: lowUnderstandingResult.strategy.type
    }
  });
  console.log(`  ${test2Passed ? '✅' : '❌'} 低理解度学生：${lowUnderstandingResult.strategy.type}`);

  // 测试场景 3: 优秀学生
  const excellentResult = strategyManager.selectStrategy({
    problemClarity: 0.9,
    confidence: 0.9,
    frustration: 0.1,
    cognitiveDepth: 0.85,
    learningStyle: 'mixed',
    currentLSS: 0.3,
    currentKTL: 0.85,
    currentLF: 0.2,
    currentLSB: 0.65
  });

  const test3Passed = excellentResult.strategy.type === ContentStrategy.CHALLENGE;
  testResults.push({
    name: '优秀学生策略选择',
    passed: test3Passed,
    details: {
      expected: ContentStrategy.CHALLENGE,
      actual: excellentResult.strategy.type
    }
  });
  console.log(`  ${test3Passed ? '✅' : '❌'} 优秀学生：${excellentResult.strategy.type}`);

  // 测试场景 4: 连续错误
  const strugglingResult = strategyManager.selectStrategy({
    problemClarity: 0.5,
    confidence: 0.4,
    frustration: 0.6,
    cognitiveDepth: 0.5,
    learningStyle: 'mixed',
    currentLSS: 0.5,
    currentKTL: 0.45,
    currentLF: 0.5,
    currentLSB: -0.05,
    consecutiveErrors: 3
  });

  const test4Passed = strugglingResult.strategy.type === ContentStrategy.REMEDIAL;
  testResults.push({
    name: '连续错误学生策略选择',
    passed: test4Passed,
    details: {
      expected: ContentStrategy.REMEDIAL,
      actual: strugglingResult.strategy.type
    }
  });
  console.log(`  ${test4Passed ? '✅' : '❌'} 连续错误学生：${strugglingResult.strategy.type}`);

  // 测试场景 5: 普通学生
  const averageResult = strategyManager.selectStrategy({
    problemClarity: 0.6,
    confidence: 0.6,
    frustration: 0.3,
    cognitiveDepth: 0.5,
    learningStyle: 'mixed',
    currentLSS: 0.4,
    currentKTL: 0.6,
    currentLF: 0.3,
    currentLSB: 0.3
  });

  const test5Passed = averageResult.strategy.type === ContentStrategy.STANDARD;
  testResults.push({
    name: '普通学生策略选择',
    passed: test5Passed,
    details: {
      expected: ContentStrategy.STANDARD,
      actual: averageResult.strategy.type
    }
  });
  console.log(`  ${test5Passed ? '✅' : '❌'} 普通学生：${averageResult.strategy.type}`);

} catch (error: any) {
  testResults.push({
    name: '策略选择测试',
    passed: false,
    details: { error: error.message }
  });
  console.log(`  ❌ 策略选择测试失败：${error.message}`);
}

console.log('');

// ==================== 测试 2: UI 类型推荐 ====================

console.log('【测试 2】UI 类型推荐测试');
console.log('-'.repeat(60));

try {
  const strategyManager = new StrategyManager();

  const supportiveUI = strategyManager.getUITypeRecommendation(ContentStrategy.SUPPORTIVE);
  const test6Passed = supportiveUI === 'choice';
  testResults.push({ name: 'SUPPORTIVE UI 推荐', passed: test6Passed, details: { expected: 'choice', actual: supportiveUI } });
  console.log(`  ${test6Passed ? '✅' : '❌'} SUPPORTIVE → ${supportiveUI}`);

  const basicUI = strategyManager.getUITypeRecommendation(ContentStrategy.BASIC);
  const test7Passed = basicUI === 'input';
  testResults.push({ name: 'BASIC UI 推荐', passed: test7Passed, details: { expected: 'input', actual: basicUI } });
  console.log(`  ${test7Passed ? '✅' : '❌'} BASIC → ${basicUI}`);

  const standardUI = strategyManager.getUITypeRecommendation(ContentStrategy.STANDARD);
  const test8Passed = standardUI === 'input';
  testResults.push({ name: 'STANDARD UI 推荐', passed: test8Passed, details: { expected: 'input', actual: standardUI } });
  console.log(`  ${test8Passed ? '✅' : '❌'} STANDARD → ${standardUI}`);

  const challengeUI = strategyManager.getUITypeRecommendation(ContentStrategy.CHALLENGE);
  const test9Passed = challengeUI === 'reflection';
  testResults.push({ name: 'CHALLENGE UI 推荐', passed: test9Passed, details: { expected: 'reflection', actual: challengeUI } });
  console.log(`  ${test9Passed ? '✅' : '❌'} CHALLENGE → ${challengeUI}`);

  const remedialUI = strategyManager.getUITypeRecommendation(ContentStrategy.REMEDIAL);
  const test10Passed = remedialUI === 'choice';
  testResults.push({ name: 'REMEDIAL UI 推荐', passed: test10Passed, details: { expected: 'choice', actual: remedialUI } });
  console.log(`  ${test10Passed ? '✅' : '❌'} REMEDIAL → ${remedialUI}`);

} catch (error: any) {
  testResults.push({
    name: 'UI 类型推荐测试',
    passed: false,
    details: { error: error.message }
  });
  console.log(`  ❌ UI 类型推荐测试失败：${error.message}`);
}

console.log('');

// ==================== 测试 3: 难度调整 ====================

console.log('【测试 3】难度调整测试');
console.log('-'.repeat(60));

try {
  const strategyManager = new StrategyManager();

  const supportiveAdj = strategyManager.getDifficultyAdjustment(ContentStrategy.SUPPORTIVE);
  const test11Passed = supportiveAdj === -2;
  testResults.push({ name: 'SUPPORTIVE 难度调整', passed: test11Passed, details: { expected: -2, actual: supportiveAdj } });
  console.log(`  ${test11Passed ? '✅' : '❌'} SUPPORTIVE 难度调整：${supportiveAdj}`);

  const basicAdj = strategyManager.getDifficultyAdjustment(ContentStrategy.BASIC);
  const test12Passed = basicAdj === -1;
  testResults.push({ name: 'BASIC 难度调整', passed: test12Passed, details: { expected: -1, actual: basicAdj } });
  console.log(`  ${test12Passed ? '✅' : '❌'} BASIC 难度调整：${basicAdj}`);

  const standardAdj = strategyManager.getDifficultyAdjustment(ContentStrategy.STANDARD);
  const test13Passed = standardAdj === 0;
  testResults.push({ name: 'STANDARD 难度调整', passed: test13Passed, details: { expected: 0, actual: standardAdj } });
  console.log(`  ${test13Passed ? '✅' : '❌'} STANDARD 难度调整：${standardAdj}`);

  const challengeAdj = strategyManager.getDifficultyAdjustment(ContentStrategy.CHALLENGE);
  const test14Passed = challengeAdj === 1;
  testResults.push({ name: 'CHALLENGE 难度调整', passed: test14Passed, details: { expected: 1, actual: challengeAdj } });
  console.log(`  ${test14Passed ? '✅' : '❌'} CHALLENGE 难度调整：${challengeAdj}`);

  const remedialAdj = strategyManager.getDifficultyAdjustment(ContentStrategy.REMEDIAL);
  const test15Passed = remedialAdj === -2;
  testResults.push({ name: 'REMEDIAL 难度调整', passed: test15Passed, details: { expected: -2, actual: remedialAdj } });
  console.log(`  ${test15Passed ? '✅' : '❌'} REMEDIAL 难度调整：${remedialAdj}`);

} catch (error: any) {
  testResults.push({
    name: '难度调整测试',
    passed: false,
    details: { error: error.message }
  });
  console.log(`  ❌ 难度调整测试失败：${error.message}`);
}

console.log('');

// ==================== 测试 4: 性能测试 ====================

console.log('【测试 4】性能测试');
console.log('-'.repeat(60));

try {
  const strategyManager = new StrategyManager();
  const startTime = Date.now();

  for (let i = 0; i < 100; i++) {
    strategyManager.selectStrategy({
      problemClarity: Math.random(),
      confidence: Math.random(),
      frustration: Math.random(),
      cognitiveDepth: Math.random(),
      learningStyle: 'mixed',
      currentLSS: Math.random(),
      currentKTL: Math.random(),
      currentLF: Math.random(),
      currentLSB: Math.random() * 2 - 1
    });
  }

  const duration = Date.now() - startTime;
  const avgTime = duration / 100;
  const test16Passed = avgTime < 10;

  testResults.push({
    name: '性能测试',
    passed: test16Passed,
    details: {
      totalDuration: duration,
      iterations: 100,
      avgTimePerCall: avgTime.toFixed(2) + 'ms'
    }
  });

  console.log(`  ${test16Passed ? '✅' : '❌'} 性能：100 次调用耗时 ${duration}ms (平均 ${avgTime.toFixed(2)}ms/次)`);

} catch (error: any) {
  testResults.push({
    name: '性能测试',
    passed: false,
    details: { error: error.message }
  });
  console.log(`  ❌ 性能测试失败：${error.message}`);
}

console.log('');

// ==================== 汇总 ====================

console.log('='.repeat(60));
console.log('📊 测试结果汇总');
console.log('='.repeat(60));
console.log('');

const passed = testResults.filter(r => r.passed).length;
const total = testResults.length;
const failed = total - passed;

console.log(`总测试数：${total}`);
console.log(`通过：${passed} ✅`);
console.log(`失败：${failed} ❌`);
console.log(`通过率：${((passed / total) * 100).toFixed(1)}%`);
console.log('');

if (passed === total) {
  console.log('🎉 所有测试通过！ContentAgent v3.0 核心功能验证完成！');
} else {
  console.log('⚠️ 部分测试失败，请检查详细信息');
  console.log('');
  console.log('失败的测试：');
  testResults
    .filter(r => !r.passed)
    .forEach(r => {
      console.log(`  - ${r.name}`);
      if (r.details) {
        console.log(`    详情：${JSON.stringify(r.details)}`);
      }
    });
}

console.log('');
console.log('='.repeat(60));

// 生成测试报告
const fs = require('fs');
const path = require('path');

const report = {
  timestamp: new Date().toISOString(),
  totalTests: total,
  passed: passed,
  failed: failed,
  passRate: ((passed / total) * 100).toFixed(2) + '%',
  tests: testResults
};

try {
  const logsDir = path.join(__dirname, '..', '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const reportFile = path.join(logsDir, 'content-agent-v3-core-test-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`\n📄 测试报告已保存至：${reportFile}`);
} catch (error: any) {
  console.log(`\n⚠️ 保存测试报告失败：${error.message}`);
}

console.log('');

// 退出代码
process.exit(passed === total ? 0 : 1);