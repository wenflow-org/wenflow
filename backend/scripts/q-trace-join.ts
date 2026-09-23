/* eslint-disable no-console */
/**
 * 只读探针：痕迹（memory_traces.conceptId）能不能落到图节点上？
 * 这是「图是否只是好看」的判据——如果掌握度进不了节点，图上就永远是"未评估"。
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { conceptGraphService } from '../src/services/learner/concept-graph.service';

const NAME = process.argv.find((a) => a.startsWith('--name='))?.slice('--name='.length) || '[case] 3-6岁';

async function main() {
  const p = prisma as any;
  const user = await p.users.findFirst({ where: { name: { contains: NAME } }, select: { id: true, name: true } });
  if (!user) throw new Error(`no user ${NAME}`);
  console.log(`user ${user.name} ${user.id}`);

  const traces = await p.memory_traces.findMany({ where: { userId: user.id }, select: { id: true, label: true, conceptId: true, masteryScore: true, stability: true } });
  const traceCids = new Set(traces.map((t: any) => t.conceptId).filter(Boolean));
  console.log(`\ntraces=${traces.length}  distinct conceptId=${traceCids.size}`);

  const view = await conceptGraphService.buildGraphView(user.id, {});
  console.log(`\ngraph: nodes=${view.meta.nodeCount} edges=${view.meta.edgeCount}`);
  const nodeIds = new Set(view.nodes.map((n) => n.id));
  console.log('node levels:', JSON.stringify(view.nodes.reduce((a: any, n: any) => { a[n.level] = (a[n.level] ?? 0) + 1; return a; }, {})));

  let hit = 0;
  for (const t of traces) {
    const inGraph = t.conceptId ? nodeIds.has(t.conceptId) : false;
    if (inGraph) hit += 1;
    console.log(`  trace ${String(t.label).slice(0, 22)} cid=${t.conceptId ?? '—'} inGraph=${inGraph} mastery=${t.masteryScore} stab=${t.stability}`);
  }
  console.log(`\ntrace→node 命中 ${hit}/${traces.length}`);

  // 反向：节点里有多少带掌握度
  const withMastery = view.nodes.filter((n) => n.masteryScore !== null && n.masteryScore !== undefined);
  console.log(`节点带掌握度: ${withMastery.length}/${view.nodes.length}`);
  for (const n of withMastery) console.log(`   ${n.label} mastery=${n.masteryScore} stability=${n.stability}`);

  console.log('\nnodes:');
  for (const n of view.nodes) console.log(`   [${n.level}] ${n.label} (${n.id}) mastery=${n.masteryScore ?? '—'}`);
}
main().catch((e) => console.error('ERR', e)).finally(() => (prisma as any).$disconnect());
