import prisma from '../config/database';

async function checkData() {
  try {
    const user = await prisma.users.findFirst({
      where: { email: 'jwttest@example.com' }
    });

    if (!user) {
      console.log('❌ 用户不存在');
      return;
    }

    console.log('✅ 用户:', user.name, 'ID:', user.id);

    const metrics = await prisma.learning_metrics.findMany({
      where: { userId: user.id },
      orderBy: { calculatedAt: 'desc' }
    });

    console.log('📊 LearningMetric 记录数:', metrics.length);

    if (metrics.length > 0) {
      console.log('\n最新一条:');
      console.log('  Date:', metrics[0].calculatedAt.toISOString());
      console.log('  LSS:', metrics[0].lss);
      console.log('  KTL:', metrics[0].ktl);
      console.log('  LF:', metrics[0].lf);
      console.log('  LSB:', metrics[0].lsb);
    }
  } catch (error) {
    console.error('查询出错:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();
