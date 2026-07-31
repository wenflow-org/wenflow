import dotenv from 'dotenv';
import prisma from '../config/database';

dotenv.config();

/**
 * 一次性回填：把既有虚拟学习者账号标记为 users.isVirtualLearner = true，
 * 使生产统计（/api/admin/overview/stats 等）可以排除合成数据。
 * 新建的虚拟学习者已在创建路由中直接设置该标记。
 */
async function backfillVirtualUserMarkers() {
  const profiles = await prisma.virtual_learner_profiles.findMany({
    select: {
      id: true,
      userId: true,
    },
  });

  let scanned = 0;
  let marked = 0;
  let skipped = 0;

  for (const profile of profiles) {
    scanned += 1;
    const user = await prisma.users.findUnique({
      where: { id: profile.userId },
      select: { id: true, isVirtualLearner: true },
    });
    if (!user) {
      skipped += 1;
      continue;
    }
    if (user.isVirtualLearner) {
      skipped += 1;
      continue;
    }
    await prisma.users.update({
      where: { id: user.id },
      data: { isVirtualLearner: true, updatedAt: new Date() },
    });
    marked += 1;
  }

  console.log(JSON.stringify({
    success: true,
    scanned,
    marked,
    skipped,
  }, null, 2));
}

backfillVirtualUserMarkers()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
