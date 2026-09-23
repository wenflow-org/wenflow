/* eslint-disable no-console */
import 'dotenv/config';
import systemPrisma from '../src/config/system-database';
(async () => {
  const rows: any[] = await (systemPrisma as any).agent_prompts.findMany({
    where: { agentId: 'skill:kc-mapper' },
    select: { version: true, status: true, publishedAt: true, name: true },
    orderBy: { version: 'desc' },
    take: 4,
  });
  for (const r of rows) console.log(`v${r.version}  status=${r.status}  published=${r.publishedAt?.toISOString?.() ?? '-'}  name=${r.name}`);
})().catch((e) => console.error('ERR', e.message)).finally(() => (systemPrisma as any).$disconnect());
