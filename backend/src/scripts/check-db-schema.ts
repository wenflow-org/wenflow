import prisma from '../config/database';

async function checkSchema() {
  try {
    const user = await prisma.users.findFirst({
      where: { email: 'jwttest@example.com' }
    });

    if (!user) {
      console.log('❌ 用户不存在');
      return;
    }

    const metric = await prisma.learning_metrics.findFirst({
      where: { userId: user.id },
      orderBy: { calculatedAt: 'desc' }
    });

    if (!metric) {
      console.log('❌ 没有指标数据');
      return;
    }

    console.log('📊 LearningMetric 字段：');
    console.log('  id:', metric.id);
    console.log('  userId:', metric.userId);
    console.log('  calculatedAt:', metric.calculatedAt);
    console.log('  lssCurrent:', metric.lss);
    console.log('  ktlCurrent:', metric.ktl);
    console.log('  lfCurrent:', metric.lf);
    console.log('  lsbCurrent:', metric.lsb);
    console.log('  lssHistory:', metric.lssHistory ? '有数据' : 'null');
  } catch (error) {
    console.error('查询出错:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSchema();
