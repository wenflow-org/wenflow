/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
const NAME = process.argv.find((a) => a.startsWith('--name='))?.slice('--name='.length) || '[case] 3-6岁';
(async () => {
  const p = prisma as any;
  const u = await p.users.findFirst({ where: { name: { contains: NAME } }, select: { id: true, name: true } });
  const rows = await p.misconception_ledger.findMany({
    where: { userId: u.id },
    select: { id: true, conceptKey: true, hypothesisHash: true, canonicalLabel: true, occurrenceCount: true, status: true },
    orderBy: { conceptKey: 'asc' },
  });
  console.log(`# rows=${rows.length}`);
  for (const r of rows) console.log(`${r.hypothesisHash}\t${r.occurrenceCount}\t${r.status}\t${r.canonicalLabel ?? 'NULL'}\t${r.conceptKey}`);
})().catch((e) => console.error('ERR', e.message)).finally(() => (prisma as any).$disconnect());
