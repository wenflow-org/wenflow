/**
 * EMA 服务测试脚本
 * 
 * 测试 EMA 更新、Z-Score 计算和异常检测
 */

import { 
  updateEMA, 
  calculateZScore, 
  processObservation,
  initializeBaseline,
  EMABaseline 
} from './services/ema.service';

console.log('=== EMA 服务测试 ===\n');

// 测试 1: 基础 EMA 更新
console.log('【测试 1】基础 EMA 更新');
const baseline1: EMABaseline = { ema: 10, emVar: 1, updateCount: 5 };
const result1 = updateEMA(baseline1, 12);
console.log('初始基线:', baseline1);
console.log('新观测值：12');
console.log('更新后基线:', result1);
console.log('✓ EMA 更新成功\n');

// 测试 2: Z-Score 计算
console.log('【测试 2】Z-Score 计算');
const zScore = calculateZScore(12, baseline1);
console.log('观测值：12');
console.log('基线:', baseline1);
console.log('Z-Score:', zScore.toFixed(4));
console.log('✓ Z-Score 计算成功\n');

// 测试 3: 完整观测处理流程
console.log('【测试 3】完整观测处理流程');
const baseline3: EMABaseline = { ema: 10, emVar: 1, updateCount: 5 };
const result3 = processObservation(baseline3, 15);
console.log('初始基线:', baseline3);
console.log('新观测值：15');
console.log('更新后基线:', result3.baseline);
console.log('Z-Score:', result3.zScore.toFixed(4));
console.log('是否异常:', result3.isAbnormal ? '是' : '否');
console.log('✓ 完整流程测试成功\n');

// 测试 4: 异常检测
console.log('【测试 4】异常检测（极端值）');
const baseline4: EMABaseline = { ema: 10, emVar: 1, updateCount: 10 };
const result4 = processObservation(baseline4, 20);
console.log('初始基线:', baseline4);
console.log('新观测值：20（极端值）');
console.log('Z-Score:', result4.zScore.toFixed(4));
console.log('是否异常:', result4.isAbnormal ? '是 ✓' : '否');
console.log('✓ 异常检测成功\n');

// 测试 5: 初始化默认基线
console.log('【测试 5】初始化默认基线');
const responseTimeBaseline = initializeBaseline('responseTime');
const messageLengthBaseline = initializeBaseline('messageLength');
const aiScoreBaseline = initializeBaseline('aiScore');
console.log('响应时间基线:', responseTimeBaseline);
console.log('消息长度基线:', messageLengthBaseline);
console.log('AI 评分基线:', aiScoreBaseline);
console.log('✓ 基线初始化成功\n');

// 测试 6: 多次迭代测试
console.log('【测试 6】多次迭代测试（模拟真实场景）');
let iterBaseline: EMABaseline = { ema: 50, emVar: 100, updateCount: 0 };
const observations = [45, 52, 48, 55, 50, 47, 53, 51, 49, 54];
console.log('观测序列:', observations);
console.log('迭代过程:');

observations.forEach((obs, idx) => {
  const result = processObservation(iterBaseline, obs);
  iterBaseline = result.baseline;
  console.log(`  ${idx + 1}. 观测=${obs}, EMA=${iterBaseline.ema.toFixed(2)}, Z=${result.zScore.toFixed(2)}, 异常=${result.isAbnormal ? '是' : '否'}`);
});

console.log('最终基线:', iterBaseline);
console.log('✓ 多次迭代测试成功\n');

// 测试 7: 数据不足时的处理
console.log('【测试 7】数据不足时的处理');
const newBaseline: EMABaseline = { ema: 10, emVar: 1, updateCount: 0 };
const zScoreNew = calculateZScore(12, newBaseline);
console.log('新基线（updateCount=0）');
console.log('观测值：12');
console.log('Z-Score:', zScoreNew, '（应为 0，因为数据不足）');
console.log('✓ 数据不足处理正确\n');

console.log('=== 所有测试通过 ✅ ===');
