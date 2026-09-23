/* eslint-disable no-console */
/**
 * kc-mapper 重跑的影响面评估（只读）：哪些路径重跑安全，哪些会被"身份断裂"打到。
 *
 * 背景：重跑会用新契约产出全新的 KC 名（实测新旧完全同名交集 = 0），
 * 物化时经概念注册表解析 → 生成**新的 conceptId**；而这条路径既有的
 * memory_traces / misconception_ledger 仍指向旧的 conceptId → 图上掌握度归零。
 */
import 'dotenv/config';
import prisma from '../src/config/database';

async function main() {
  const p = prisma as any;
  const paths = await p.learning_paths.findMany({
    where: { aiPromptTemplate: { contains: 'kcAnnotation' } },
    select: { id: true, userId: true, title: true, aiPromptTemplate: true, status: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`含 kcAnnotation 的路径：${paths.length}\n`);

  const rows: Array<{ id: string; title: string; kcs: number; edges: number; traces: number; miscons: number; risk: string }> = [];
  for (const path of paths) {
    let tpl: any = {}; try { tpl = JSON.parse(path.aiPromptTemplate); } catch { continue; }
    const ann = tpl?.kcAnnotation;
    if (!ann) continue;
    const kcs = (ann.conceptKcs || []).reduce((a: number, g: any) => a + ((g?.kcs || []).length as number), 0);
    const edges = Array.isArray(ann.kcGraph?.edges) ? ann.kcGraph.edges.length : 0;
    const [traces, miscons] = await Promise.all([
      p.memory_traces.count({ where: { userId: path.userId, pathId: path.id } }),
      p.misconception_ledger.count({ where: { userId: path.userId, conceptId: { not: null } } }),
    ]);
    const risk = traces > 0 ? '⚠️ 有痕迹（重跑会孤儿化）' : '✅ 无痕迹（可安全重跑）';
    rows.push({ id: path.id, title: String(path.title ?? '').slice(0, 20), kcs, edges, traces, miscons, risk });
  }

  const safe = rows.filter((r) => r.traces === 0);
  const risky = rows.filter((r) => r.traces > 0);
  console.log(`合计 ${rows.length} 条：可安全重跑 ${safe.length}，有痕迹需迁移 ${risky.length}`);
  console.log(`受影响痕迹总数：${risky.reduce((a, r) => a + r.traces, 0)}\n`);

  console.log('⚠️ 有痕迹的路径（重跑会打断「痕迹→图节点」的 join）：');
  for (const r of risky.sort((a, b) => b.traces - a.traces).slice(0, 15)) {
    console.log(`  ${r.traces.toString().padStart(3)} 痕迹  ${r.kcs.toString().padStart(3)} KC  ${r.id}  ${r.title}`);
  }
  console.log('\n✅ 无痕迹的路径（前 15）：');
  for (const r of safe.slice(0, 15)) console.log(`   ${r.kcs.toString().padStart(3)} KC  ${r.id}  ${r.title}`);
}
main().catch((e) => console.error('ERR', e)).finally(() => (prisma as any).$disconnect());
