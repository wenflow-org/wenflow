/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
(async () => {
  const p = prisma as any;
  const ids = ['lp_1790075910253_jasxf57', 'lp_1790079575117_2oipxjs', 'lp_1790081485023_di4du53', 'lp_1790080761403_8g9i1r0'];
  for (const id of ids) {
    const path = await p.learning_paths.findUnique({ where: { id }, select: { userId: true, title: true } });
    const user = await p.users.findUnique({ where: { id: path.userId }, select: { name: true, isVirtualLearner: true } });
    const prof = await p.virtual_learner_profiles.findFirst({ where: { userId: path.userId }, select: { id: true } });
    const traces = await p.memory_traces.count({ where: { userId: path.userId, pathId: id } });
    const paths = await p.learning_paths.count({ where: { userId: path.userId } });
    console.log(`${id}  ${String(path.title).slice(0, 22)}`);
    console.log(`   user=${path.userId}  name=${user?.name ?? '?'}  virtual=${user?.isVirtualLearner}`);
    console.log(`   profileId=${prof?.id ?? '—'}  本路径痕迹=${traces}  该用户路径数=${paths}`);
  }
})().catch((e) => console.error('ERR', e.message)).finally(() => (prisma as any).$disconnect());
