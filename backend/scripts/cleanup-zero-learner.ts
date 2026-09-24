/** 清理 verify-from-zero 本次创建的可丢弃学习者（cascade 删除） */
import 'dotenv/config';
import prisma from '../src/config/database';

const userId = process.argv.find((a) => a.startsWith('--user='))?.slice(7);

async function main() {
  if (!userId) throw new Error('缺少 --user=<id>');
  const before = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, name: true, isVirtualLearner: true } });
  if (!before) { console.log('用户不存在，无需清理:', userId); return; }
  console.log('待清理:', before.id, before.name, 'isVirtualLearner=', before.isVirtualLearner);
  const paths = await prisma.learning_paths.count({ where: { userId } });
  await prisma.users.delete({ where: { id: userId } });
  const after = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
  console.log(`已删除（含 ${paths} 条路径级联）；复查存在 = ${Boolean(after)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
