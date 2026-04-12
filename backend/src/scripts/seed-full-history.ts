/**
 * 为测试用户创建完整的历史数据
 * 每个 LearningMetric 记录对应一天的数据
 */

import prisma from '../config/database';

const logger = {
  info: (msg: string) => console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`),
  error: (msg: string, err?: any) => {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
    if (err) console.error(err);
  },
  warn: (msg: string) => console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`)
};

async function seedFullHistory() {
  try {
    // 查找 JWT 测试用户
    const user = await prisma.users.findFirst({
      where: { email: 'jwttest@example.com' }
    });

    if (!user) {
      logger.error('未找到用户 jwttest@example.com');
      return;
    }

    const userId = user.id;
    logger.info(`找到用户: ${user.name} (${user.email})`);

    // 清除现有数据
    const deleted = await prisma.learning_metrics.deleteMany({
      where: { userId }
    });
    logger.info(`清除了 ${deleted.count} 条旧记录`);

    // 生成30天的历史数据
    const days = 30;
    const now = new Date();
    const records = [];

    let ktl = 5.0;
    let lf = 5.0;

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);

      // 模拟学习压力变化
      let lss = 4 + Math.random() * 3;
      if (i < 7) {
        // 最近一周压力稍高
        lss += 1;
      }
      lss = Math.min(10, Math.max(0, lss));

      // 计算 KTL
      ktl = 0.95 * ktl + 0.05 * lss;

      // 计算 LF
      lf = 0.85 * lf + 0.15 * lss;

      if (i < 5) {
        lf += 0.3; // 最近几天疲劳累积
      }

      const lsb = ktl - lf;

      // 为这一天创建一条记录
      records.push({
        userId,
        calculatedAt: date,
        lssCurrent: parseFloat(lss.toFixed(3)),
        ktlCurrent: parseFloat(ktl.toFixed(3)),
        lfCurrent: parseFloat(lf.toFixed(3)),
        lsbCurrent: parseFloat(lsb.toFixed(3)),
        lssHistory: JSON.stringify([]),
        sessionHistory: JSON.stringify([])
      });
    }

    // 批量插入
    await prisma.learning_metrics.createMany({
      data: records
    });

    logger.info(`✅ 成功生成 ${records.length} 条历史记录`);

    // 输出摘要
    console.log('\n📊 数据摘要：');
    console.log('  总天数:', records.length);
    console.log('  日期范围:', records[0].calculatedAt.toISOString().split('T')[0], ' 到 ', records[records.length-1].calculatedAt.toISOString().split('T')[0]);
    console.log('\n前5条数据：');
    records.slice(0, 5).forEach((r, idx) => {
      console.log(`  ${idx+1}. ${r.calculatedAt.toISOString().split('T')[0]} | LSS: ${r.lss.toFixed(2)} | LSB: ${r.lsb.toFixed(2)}`);
    });

  } catch (error) {
    logger.error('生成历史数据失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedFullHistory()
  .then(() => {
    logger.info('✨ 完成！');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ 脚本执行失败:', error);
    process.exit(1);
  });
