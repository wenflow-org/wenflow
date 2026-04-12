/**
 * EMA 核心服务测试脚本
 * 
 * 测试内容：
 * 1. updateEMA 函数
 * 2. calculateZScore 函数
 * 3. studentBaselineService
 */

import { 
  updateEMA, 
  calculateZScore, 
  processObservation,
  initializeBaseline,
  EMABaseline 
} from '../services/ema.service';
import { studentBaselineService } from '../services/student-baseline.service';

// 测试颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function logTest(name: string) {
  console.log(`\n${colors.cyan}▶ ${name}${colors.reset}`);
}

function logSuccess(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logError(message: string) {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function logInfo(message: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
}

function assertEqual(actual: any, expected: any, message: string) {
  const tolerance = 0.0001;
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Math.abs(actual - expected) < tolerance) {
      logSuccess(message);
      return true;
    }
  } else if (actual === expected) {
    logSuccess(message);
    return true;
  }
  
  logError(`${message}: 期望 ${expected}, 实际 ${actual}`);
  return false;
}

// ============ 测试 1: updateEMA 函数 ============
async function testUpdateEMA() {
  logTest('测试 updateEMA 函数');
  
  let passed = 0;
  let total = 0;
  
  // 测试 1.1: 初始更新
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 1.0, updateCount: 0 };
    const newValue = 12.0;
    const config = { alpha: 0.1 };
    
    const result = updateEMA(baseline, newValue, config);
    
    // 手动计算期望值
    const expectedEma = 0.1 * 12.0 + 0.9 * 10.0; // 1.2 + 9.0 = 10.2
    const deviation = 12.0 - result.ema; // 12.0 - 10.2 = 1.8
    const expectedEmVar = 0.1 * (deviation * deviation) + 0.9 * 1.0; // 0.1 * 3.24 + 0.9 = 1.224
    
    assertEqual(result.ema, expectedEma, 'EMA 计算正确') && passed++;
    assertEqual(result.emVar, expectedEmVar, 'EMVar 计算正确') && passed++;
    assertEqual(result.updateCount, 1, '更新计数正确') && passed++;
    
    logInfo(`初始值：10.0, 新值：12.0, 新 EMA: ${result.ema.toFixed(4)}`);
  }
  
  // 测试 1.2: 连续更新
  {
    total++;
    let baseline: EMABaseline = { ema: 10.0, emVar: 1.0, updateCount: 0 };
    const values = [11, 12, 13, 14, 15];
    
    for (const val of values) {
      baseline = updateEMA(baseline, val, { alpha: 0.1 });
    }
    
    logInfo(`连续更新 5 次后的 EMA: ${baseline.ema.toFixed(4)}`);
    logInfo(`连续更新 5 次后的 EMVar: ${baseline.emVar.toFixed(4)}`);
    assertEqual(baseline.updateCount, 5, '更新计数正确') && passed++;
  }
  
  // 测试 1.3: 不同 Alpha 值的影响
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 1.0, updateCount: 0 };
    const newValue = 20.0;
    
    const result1 = updateEMA(baseline, newValue, { alpha: 0.1 });
    const result2 = updateEMA(baseline, newValue, { alpha: 0.5 });
    const result3 = updateEMA(baseline, newValue, { alpha: 0.9 });
    
    logInfo(`α=0.1: EMA=${result1.ema.toFixed(4)}`);
    logInfo(`α=0.5: EMA=${result2.ema.toFixed(4)}`);
    logInfo(`α=0.9: EMA=${result3.ema.toFixed(4)}`);
    
    // Alpha 越大，新值影响越大
    if (result3.ema > result2.ema && result2.ema > result1.ema) {
      logSuccess('Alpha 值影响符合预期（越大越敏感）');
      passed++;
    } else {
      logError('Alpha 值影响不符合预期');
    }
    total++;
  }
  
  // 测试 1.4: 极端值处理
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 1.0, updateCount: 0 };
    const extremeValue = 1000.0;
    
    const result = updateEMA(baseline, extremeValue, { alpha: 0.1 });
    logInfo(`极端值 ${extremeValue} 处理后的 EMA: ${result.ema.toFixed(4)}`);
    logInfo(`极端值 ${extremeValue} 处理后的 EMVar: ${result.emVar.toFixed(4)}`);
    
    if (isFinite(result.ema) && isFinite(result.emVar)) {
      logSuccess('极端值处理正常');
      passed++;
    } else {
      logError('极端值导致 NaN 或 Infinity');
    }
    total++;
  }
  
  console.log(`\n${colors.yellow}updateEMA 测试结果：${passed}/${total} 通过${colors.reset}`);
  return { passed, total };
}

// ============ 测试 2: calculateZScore 函数 ============
async function testCalculateZScore() {
  logTest('测试 calculateZScore 函数');
  
  let passed = 0;
  let total = 0;
  
  // 测试 2.1: 正常 Z-Score 计算
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 4.0, updateCount: 10 };
    const value = 14.0;
    
    const zScore = calculateZScore(value, baseline);
    const expectedZ = (14.0 - 10.0) / Math.sqrt(4.0); // 4 / 2 = 2.0
    
    assertEqual(zScore, expectedZ, 'Z-Score 计算正确') && passed++;
    logInfo(`值：${value}, EMA: ${baseline.ema}, StdDev: ${Math.sqrt(baseline.emVar)}, Z-Score: ${zScore.toFixed(4)}`);
  }
  
  // 测试 2.2: 数据不足时返回 0
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 4.0, updateCount: 3 };
    const value = 14.0;
    
    const zScore = calculateZScore(value, baseline);
    
    if (zScore === 0) {
      logSuccess('数据不足时返回 0');
      passed++;
    } else {
      logError(`数据不足时应返回 0，实际返回 ${zScore}`);
    }
    logInfo(`更新次数：${baseline.updateCount} < 5，返回 0`);
  }
  
  // 测试 2.3: 方差太小时返回 0
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 0.00001, updateCount: 10 };
    const value = 14.0;
    
    const zScore = calculateZScore(value, baseline);
    
    if (zScore === 0) {
      logSuccess('方差太小时返回 0（避免除零错误）');
      passed++;
    } else {
      logError(`方差太小时应返回 0，实际返回 ${zScore}`);
    }
    logInfo(`方差：${baseline.emVar} < 0.0001，返回 0`);
  }
  
  // 测试 2.4: 负 Z-Score
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 4.0, updateCount: 10 };
    const value = 6.0;
    
    const zScore = calculateZScore(value, baseline);
    const expectedZ = (6.0 - 10.0) / Math.sqrt(4.0); // -4 / 2 = -2.0
    
    assertEqual(zScore, expectedZ, '负 Z-Score 计算正确') && passed++;
    logInfo(`值：${value} < EMA: ${baseline.ema}, Z-Score: ${zScore.toFixed(4)}`);
  }
  
  // 测试 2.5: 异常值检测
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 1.0, updateCount: 10 };
    
    const normalValue = 11.0;
    const abnormalValue = 15.0;
    
    const normalZ = calculateZScore(normalValue, baseline);
    const abnormalZ = calculateZScore(abnormalValue, baseline);
    
    logInfo(`正常值 ${normalValue} 的 Z-Score: ${normalZ.toFixed(4)}`);
    logInfo(`异常值 ${abnormalValue} 的 Z-Score: ${abnormalZ.toFixed(4)}`);
    
    if (Math.abs(normalZ) < 2.5 && Math.abs(abnormalZ) > 2.5) {
      logSuccess('异常值检测正常');
      passed++;
    } else {
      logError('异常值检测不符合预期');
    }
  }
  
  console.log(`\n${colors.yellow}calculateZScore 测试结果：${passed}/${total} 通过${colors.reset}`);
  return { passed, total };
}

// ============ 测试 3: processObservation 函数 ============
async function testProcessObservation() {
  logTest('测试 processObservation 函数');
  
  let passed = 0;
  let total = 0;
  
  // 测试 3.1: 完整流程
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 1.0, updateCount: 10 };
    const newValue = 12.0;
    
    const result = processObservation(baseline, newValue);
    
    logInfo(`新值：${newValue}`);
    logInfo(`Z-Score: ${result.zScore.toFixed(4)}`);
    logInfo(`新 EMA: ${result.baseline.ema.toFixed(4)}`);
    logInfo(`是否异常：${result.isAbnormal}`);
    
    if (result.baseline.updateCount === 11) {
      logSuccess('更新计数正确');
      passed++;
    } else {
      logError('更新计数不正确');
    }
  }
  
  // 测试 3.2: 异常检测
  {
    total++;
    const baseline: EMABaseline = { ema: 10.0, emVar: 1.0, updateCount: 10 };
    const abnormalValue = 20.0; // 远大于阈值
    
    const result = processObservation(baseline, abnormalValue);
    
    logInfo(`异常值：${abnormalValue}`);
    logInfo(`Z-Score: ${result.zScore.toFixed(4)}`);
    logInfo(`是否异常：${result.isAbnormal}`);
    
    if (result.isAbnormal && Math.abs(result.zScore) > 2.5) {
      logSuccess('异常检测正确');
      passed++;
    } else {
      logError('异常检测失败');
    }
  }
  
  console.log(`\n${colors.yellow}processObservation 测试结果：${passed}/${total} 通过${colors.reset}`);
  return { passed, total };
}

// ============ 测试 4: initializeBaseline 函数 ============
async function testInitializeBaseline() {
  logTest('测试 initializeBaseline 函数');
  
  let passed = 0;
  let total = 0;
  
  const metricTypes = ['responseTime', 'messageLength', 'interactionInterval', 'aiScore'];
  
  for (const metricType of metricTypes) {
    total++;
    const baseline = initializeBaseline(metricType);
    
    logInfo(`${metricType}: EMA=${baseline.ema}, EMVar=${baseline.emVar}`);
    
    if (baseline.updateCount === 0) {
      logSuccess(`${metricType} 初始化成功`);
      passed++;
    } else {
      logError(`${metricType} 初始化失败`);
    }
  }
  
  // 测试未知类型
  {
    total++;
    const baseline = initializeBaseline('unknown');
    
    if (baseline.ema === 0 && baseline.emVar === 1 && baseline.updateCount === 0) {
      logSuccess('未知类型返回默认值');
      passed++;
    } else {
      logError('未知类型处理不正确');
    }
  }
  
  console.log(`\n${colors.yellow}initializeBaseline 测试结果：${passed}/${total} 通过${colors.reset}`);
  return { passed, total };
}

// ============ 测试 5: studentBaselineService ============
async function testStudentBaselineService() {
  logTest('测试 studentBaselineService');
  
  let passed = 0;
  let total = 0;
  
  // 使用一个测试用户 ID
  const testUserId = 'test-ema-user-' + Date.now();
  
  try {
    // 测试 5.1: 获取或创建基线
    {
      total++;
      logInfo(`测试用户 ID: ${testUserId}`);
      
      const baseline = await studentBaselineService.getOrCreateBaseline(testUserId);
      
      logInfo(`responseTime: EMA=${baseline.responseTime.ema}, EMVar=${baseline.responseTime.emVar}`);
      logInfo(`messageLength: EMA=${baseline.messageLength.ema}, EMVar=${baseline.messageLength.emVar}`);
      logInfo(`interactionInterval: EMA=${baseline.interactionInterval.ema}, EMVar=${baseline.interactionInterval.emVar}`);
      logInfo(`aiScore: EMA=${baseline.aiScore.ema}, EMVar=${baseline.aiScore.emVar}`);
      
      if (baseline.responseTime.updateCount === 0) {
        logSuccess('获取或创建基线成功');
        passed++;
      } else {
        logError('基线初始化不正确');
      }
    }
    
    // 测试 5.2: 更新基线
    {
      total++;
      const result = await studentBaselineService.updateBaseline(testUserId, {
        responseTime: 12.0,
        messageLength: 55.0,
        interactionInterval: 6.0,
        aiScore: 0.6
      });
      
      logInfo('更新后的基线:');
      logInfo(`  responseTime: EMA=${result.baseline.responseTime.ema.toFixed(4)}`);
      logInfo(`  messageLength: EMA=${result.baseline.messageLength.ema.toFixed(4)}`);
      logInfo(`  interactionInterval: EMA=${result.baseline.interactionInterval.ema.toFixed(4)}`);
      logInfo(`  aiScore: EMA=${result.baseline.aiScore.ema.toFixed(4)}`);
      
      logInfo('Z-Scores:');
      logInfo(`  responseTime: ${result.zScores.responseTime.toFixed(4)}`);
      logInfo(`  messageLength: ${result.zScores.messageLength.toFixed(4)}`);
      logInfo(`  interactionInterval: ${result.zScores.interactionInterval.toFixed(4)}`);
      logInfo(`  aiScore: ${result.zScores.aiScore.toFixed(4)}`);
      
      logInfo(`异常检测：${result.anomaly.hasAnomaly ? '有异常' : '无异常'}`);
      if (result.anomaly.hasAnomaly) {
        logInfo(`异常指标：${result.anomaly.anomalyMetrics.join(', ')}`);
        logInfo(`原因：${result.anomaly.reasoning}`);
      }
      
      if (result.baseline.responseTime.updateCount === 1) {
        logSuccess('更新基线成功');
        passed++;
      } else {
        logError('更新计数不正确');
      }
    }
    
    // 测试 5.3: 多次更新
    {
      total++;
      logInfo('进行多次更新以测试基线稳定性...');
      
      for (let i = 0; i < 10; i++) {
        await studentBaselineService.updateBaseline(testUserId, {
          responseTime: 10 + Math.random() * 5,
          messageLength: 50 + Math.random() * 20,
          interactionInterval: 5 + Math.random() * 3,
          aiScore: 0.5 + Math.random() * 0.2
        });
      }
      
      const stats = await studentBaselineService.getBaselineStats(testUserId);
      
      logInfo(`更新次数：${stats.current.responseTime.updateCount}`);
      logInfo(`基线是否稳定：${stats.isStable}`);
      logInfo(`置信度：${(stats.confidence * 100).toFixed(2)}%`);
      
      if (stats.current.responseTime.updateCount === 11) {
        logSuccess('多次更新成功');
        passed++;
      } else {
        logError('更新计数不正确');
      }
    }
    
    // 测试 5.4: 获取基线统计
    {
      total++;
      const stats = await studentBaselineService.getBaselineStats(testUserId);
      
      logInfo('基线统计信息:');
      logInfo(`  当前 EMA (responseTime): ${stats.current.responseTime.ema.toFixed(4)}`);
      logInfo(`  当前 EMVar (responseTime): ${stats.current.responseTime.emVar.toFixed(4)}`);
      logInfo(`  是否稳定：${stats.isStable}`);
      logInfo(`  置信度：${(stats.confidence * 100).toFixed(2)}%`);
      
      logSuccess('获取基线统计成功');
      passed++;
    }
    
    // 清理测试数据
    // await prisma.student_baselines.delete({ where: { userId: testUserId } });
    logInfo(`测试数据已创建，用户 ID: ${testUserId}`);
    
  } catch (error: any) {
    logError(`测试失败：${error.message}`);
    console.error(error);
  }
  
  console.log(`\n${colors.yellow}studentBaselineService 测试结果：${passed}/${total} 通过${colors.reset}`);
  return { passed, total };
}

// ============ 主测试函数 ============
async function runAllTests() {
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}   EMA 核心服务测试${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}`);
  
  const results = {
    updateEMA: await testUpdateEMA(),
    calculateZScore: await testCalculateZScore(),
    processObservation: await testProcessObservation(),
    initializeBaseline: await testInitializeBaseline(),
    studentBaselineService: await testStudentBaselineService()
  };
  
  const totalPassed = Object.values(results).reduce((sum, r) => sum + r.passed, 0);
  const totalTests = Object.values(results).reduce((sum, r) => sum + r.total, 0);
  
  console.log(`\n${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}   测试汇总${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`\n${colors.green}总通过：${totalPassed}/${totalTests}${colors.reset}`);
  
  if (totalPassed === totalTests) {
    console.log(`\n${colors.green}🎉 所有测试通过！${colors.reset}`);
  } else {
    console.log(`\n${colors.red}⚠️  有 ${totalTests - totalPassed} 个测试失败${colors.reset}`);
  }
}

// 运行测试
runAllTests().catch(console.error);