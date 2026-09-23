/* 按来源抽查某学习者的 concept_edges（验证：新生成的路径应带 prerequisite-projection 行） */
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const NAME = process.argv[2] || '[kc]';
(async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT e.pathId AS pathId, e.source AS source, e.relation AS relation, COUNT(*) AS c
       FROM concept_edges e JOIN users u ON u.id = e.userId
      WHERE u.name LIKE ? GROUP BY e.pathId, e.source, e.relation ORDER BY e.pathId, e.source`,
    `%${NAME}%`);
  if (rows.length === 0) console.log('(无匹配学习者的边)');
  for (const r of rows) console.log(`${String(r.pathId).slice(0, 26)} | ${r.source}/${r.relation} = ${Number(r.c)}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
