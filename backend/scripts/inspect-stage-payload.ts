/** 只读：检查最近一条 stage-designer 真实载荷（验证 C4 单一资料投递） */
import 'dotenv/config';
import prisma from '../src/config/database';

async function main() {
  const rows = await prisma.prompt_call_logs.findMany({
    where: { agentId: 'skill:stage-designer' },
    select: { userPayload: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log(`最近 ${rows.length} 条 stage-designer 载荷：`);
  let withMaterials = 0;
  for (const row of rows) {
    const raw = row.userPayload || '';
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { /* 非 JSON 跳过 */ }
    const top = parsed?.materials;
    const nested = parsed?.normalizedInput?.resources?.materials;
    const tag = Array.isArray(top) && top.length > 0 ? 'HAS-MATERIALS' : 'no-materials';
    if (tag === 'HAS-MATERIALS') withMaterials += 1;
    console.log(
      `  ${row.createdAt?.toISOString()} | ${tag} | 顶层 materials=${Array.isArray(top) ? `数组(${top.length})` : JSON.stringify(top ?? null)}`
      + ` | 嵌套 resources.materials=${nested === undefined ? 'UNDEFINED（已剥离）' : `STILL PRESENT(${Array.isArray(nested) ? nested.length : '?'})`}`
      + ` | loadTarget=${parsed?.milestone?.loadTarget ?? '(无)'}`,
    );
  }
  console.log(`\n其中带资料的载荷 ${withMaterials} 条`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
