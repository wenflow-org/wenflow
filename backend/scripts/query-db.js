const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  console.log('=== 最近 10 条 learning_metrics ===');
  const metrics = await prisma.learning_metrics.findMany({ orderBy: { calculatedAt: 'desc' }, take: 10 });
  metrics.forEach(m => console.log(${m.userId} | lss=, ktl=, lf=, lsb= | ));
  console.log('\n=== 所有用户 ===');
  const users = await prisma.users.findMany({ select: { id: true, name: true, email: true } });
  users.forEach(u => console.log(${u.id} |  | ));
  await prisma.();
}
main().catch(console.error);
