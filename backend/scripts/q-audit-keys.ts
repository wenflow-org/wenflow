/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
import { misconceptionConsolidationAuditKey, misconceptionConsolidationPreviewKey } from '../src/services/learner/misconception-ledger.service';
(async () => {
  const p = prisma as any;
  const u = await p.users.findFirst({ where: { name: { contains: '[case] 3-6岁' } }, select: { id: true } });
  const rows = await p.learner_projections.findMany({
    where: { projectionKey: { in: [misconceptionConsolidationAuditKey(u.id), misconceptionConsolidationPreviewKey(u.id)] } },
    select: { projectionKey: true, version: true, scope: true, payload: true, generatedAt: true },
  });
  console.log('共存审计键:', rows.length);
  for (const r of rows) {
    const parsed = JSON.parse(r.payload);
    console.log(`  ${r.projectionKey.split(':')[0]} v${r.version} scope=${r.scope} mode=${parsed.mode} groups=${parsed.groups.length} at=${r.generatedAt.toISOString()}`);
  }
})().catch((e) => console.error('ERR', e.message)).finally(() => (prisma as any).$disconnect());
