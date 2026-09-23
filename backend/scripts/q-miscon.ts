/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
(async () => {
  const p = prisma as any;
  const u = await p.users.findFirst({ where: { name: { contains: '[case] 3-6岁' } }, select: { id: true } });
  const rows = await p.misconception_ledger.findMany({ where: { userId: u.id }, select: { canonicalLabel: true, conceptKey: true, hypothesisHash: true, hypothesis: true, occurrenceCount: true, confidence: true, status: true, conceptId: true } });
  console.log('rows=', rows.length);
  const byLabel: Record<string, any[]> = {};
  for (const r of rows) (byLabel[r.canonicalLabel] ??= []).push(r);
  for (const [label, list] of Object.entries(byLabel)) {
    console.log(`\n「${label}」 x${list.length}`);
    const keys = new Set(list.map((r) => r.conceptKey));
    const hashes = new Set(list.map((r) => r.hypothesisHash));
    console.log(`  distinct conceptKey=${keys.size} distinct hypothesisHash=${hashes.size} sumOccurrenceCount=${list.reduce((a, r) => a + r.occurrenceCount, 0)}`);
    console.log(`  conceptKeys=${JSON.stringify([...keys])}`);
    for (const h of [...hashes].slice(0, 3)) {
      const r = list.find((x) => x.hypothesisHash === h);
      console.log(`   hash=${h} conf=${r.confidence} status=${r.status} hyp=${JSON.stringify(String(r.hypothesis).slice(0, 70))}`);
    }
  }
})().catch((e) => console.error('ERR', e.message)).finally(() => (prisma as any).$disconnect());
