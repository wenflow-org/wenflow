/**
 * 生成学习趋势数据 - 用于展示效果
 * 为测试用户创建7天的学习指标数据
 * 包含 lssHistory 用于图表显示
 */

import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';

const logger = {
  info: (msg: string) => console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`),
  error: (msg: string, err?: any) => {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
    if (err) console.error(err);
  },
  warn: (msg: string) => console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`)
};

interface LearningMetricData {
  calculatedAt: Date;
  lssCurrent: number;
  ktlCurrent: number;
  lfCurrent: number;
  lsbCurrent: number;
  lss: number;
}

// 生成逼真的学习趋势数据
function generateTrendData(days: number, startLSS: number): LearningMetricData[] {
  const data: LearningMetricData[] = [];
  const now = new Date();

  // 初始化 EWMA 参数
  let ktl = startLSS;
  let lf = startLSS;

  const KTL_LAMBDA = 0.95;
  const LF_LAMBDA = 0.70;

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(Math.floor(Math.random() * 10) + 8);
    date.setMinutes(Math.floor(Math.random() * 60));

    let lss: number;
    const dayIndex = days - i;

    if (dayIndex <= 2) {
      lss = 4 + Math.random() * 2;
    } else if (dayIndex <= 4) {
      lss = 5 + Math.random() * 2;
    } else if (dayIndex === 5) {
      lss = 6 + Math.random() * 2;
    } else {
      lss = 4 + Math.random() * 2;
    }

    lss += (Math.random() - 0.5);
    lss = Math.min(10, Math.max(0, lss));

    ktl = KTL_LAMBDA * ktl + (1 - KTL_LAMBDA) * lss;
    lf = LF_LAMBDA * lf + (1 - LF_LAMBDA) * lss;

    if (dayIndex > 2) {
      lf += 0.2 * (dayIndex / days);
    }

    const lsb = ktl - lf;

    data.push({
      calculatedAt: date,
      lssCurrent: parseFloat(lss.toFixed(3)),
      ktlCurrent: parseFloat(ktl.toFixed(3)),
      lfCurrent: parseFloat(lf.toFixed(3)),
      lsbCurrent: parseFloat(lsb.toFixed(3)),
      lss: parseFloat(lss.toFixed(3)),
    });
  }

  return data;
}

// 生成 lssHistory 用于图表显示
function generateLSSHistory(trendData: LearningMetricData[]): Array<{ date: string; score: number }> {
  return trendData.map(item => ({
    date: item.calculatedAt.toISOString(),
    score: Math.round(item.lss * 10) // 转换为0-100范围
  }));
}

// 生成 sessionHistory 用于图表显示
function generateSessionHistory(trendData: LearningMetricData[]): Array<{
  date: string;
  taskId?: string;
  durationMinutes: number;
  lssScore: number;
  completed: boolean;
}> {
  return trendData.map(item => ({
    date: item.calculatedAt.toISOString(),
    durationMinutes: Math.floor(30 + Math.random() * 60), // 30-90分钟
    lssScore: Math.round(item.lss * 10),
    completed: Math.random() > 0.2 // 80%完成率
  }));
}

async function seedLearningMetrics() {
  try {
    logger.info('开始生成学习趋势数据...');

    // 查找 JWT 测试用户
    let user = await prisma.users.findFirst({
      where: { email: 'jwttest@example.com' }
    });

    if (!user) {
      logger.warn('未找到 jwttest@example.com 用户，查找替代用户...');
      user = await prisma.users.findFirst();

      if (!user) {
        logger.error('没有用户存在，请先创建用户');
        return;
      }
    }

    const userId = user.id;
    logger.info(`找到用户: ${user.name} (${user.email})`);

    // 清除现有数据
    await prisma.learning_metrics.deleteMany({
      where: { userId }
    });

    logger.info(`已清除用户 ${user.name} 的旧数据`);

    // 生成7天数据
    const trendData = generateTrendData(7, 5);

    // 生成用于图表的历史数据
    const lssHistory = generateLSSHistory(trendData);
    const sessionHistory = generateSessionHistory(trendData);

    logger.info(`生成 lssHistory: ${lssHistory.length} 条`);
    logger.info(`生成 sessionHistory: ${sessionHistory.length} 条`);

    // 只保留最新的一条记录（用于实时数据）
    // 但包含完整的历史数据在 JSON 字段中
    const latestMetric = trendData[trendData.length - 1];

await prisma.learning_metrics.create({
        data: {
          id: uuidv4(),
          userId,
          metricType: 'daily',
          value: latestMetric.lssCurrent,
          calculatedAt: latestMetric.calculatedAt,
          lssCurrent: latestMetric.lssCurrent,
          ktlCurrent: latestMetric.ktlCurrent,
          lfCurrent: latestMetric.lfCurrent,
          lsbCurrent: latestMetric.lsbCurrent,
          lssHistory: JSON.stringify(lssHistory)
        }
      });

    logger.info(`✅ 成功生成学习指标数据`);

    // 输出数据概览
    console.log('\n📊 学习趋势数据：');
    trendData.forEach((item, index) => {
      const lsbStatus = item.lsbCurrent >= 2 ? '+' : '-';
      console.log(
        `Day ${index + 1} | ${item.calculatedAt.toISOString().split('T')[0]} | ` +
        `LSS: ${item.lssCurrent.toFixed(2)} | ` +
        `KTL: ${item.ktlCurrent.toFixed(2)} | ` +
        `LF: ${item.lfCurrent.toFixed(2)} | ` +
        `LSB: ${item.lsbCurrent.toFixed(2)} ${lsbStatus}`
      );
    });

    console.log('\n📊 趋势分析：');
    const avgLSB = trendData.reduce((sum, item) => sum + item.lsbCurrent, 0) / trendData.length;
    console.log(`  平均 LSB: ${avgLSB.toFixed(2)}`);
    console.log(`  当前 LSB: ${trendData[trendData.length - 1].lsbCurrent.toFixed(2)}`);

    if (avgLSB >= 4) {
      console.log(`  状态: 🟢 学习状态极佳`);
    } else if (avgLSB >= 2) {
      console.log(`  状态: 🟡 学习状态正常`);
    } else {
      console.log(`  状态: 🔴 学习状态偏低，建议调整`);
    }

    console.log('\n📈 lssHistory 数据（用于图表）:');
    lssHistory.slice(0, 3).forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.date} -> score: ${item.score}`);
    });
    console.log(`  ... 共 ${lssHistory.length} 条记录`);

  } catch (error) {
    logger.error('生成学习趋势数据失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 运行脚本
seedLearningMetrics()
  .then(() => {
    logger.info('✨ 学习趋势数据生成完成！');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ 脚本执行失败:', error);
    process.exit(1);
  });
