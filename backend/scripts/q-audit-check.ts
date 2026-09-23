/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
import { getMisconceptionConsolidationAudit } from '../src/services/learner/misconception-ledger.service';
(async () => {
  const p = prisma as any;
  const u = await p.users.findFirst({ where: { name: { contains: '[case] 3-6岁' } }, select: { id: true } });
  const audit = await getMisconceptionConsolidationAudit(u.id);
  console.log('audit:', audit ? {
    mode: audit.mode, scannedRows: audit.scannedRows, groups: audit.groups.length,
    deletedCount: audit.deletedCount, ungroupedRows: audit.ungroupedRows,
    deletedSample: audit.groups[0]?.deletedRows.length,
  } : null);
  if (audit?.groups[0]) {
    console.log('group0 label=', audit.groups[0].canonicalLabel, 'occurrence=', audit.groups[0].mergedFields.occurrenceCount);
    console.log('可回溯的被删行快照示例:', String(audit.groups[0].deletedRows[0]?.hypothesis).slice(0, 60));
    console.log('该组被删行数=', audit.groups[0].deletedRows.length);
  }
})().catch((e) => console.error('ERR', e.message)).finally(() => (prisma as any).$disconnect());
