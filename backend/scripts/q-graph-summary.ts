/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
import { conceptGraphService } from '../src/services/learner/concept-graph.service';
const NAME = process.argv.find((a) => a.startsWith('--name='))?.slice('--name='.length) || '[case] 3-6岁';
(async () => {
  const p = prisma as any;
  const u = await p.users.findFirst({ where: { name: { contains: NAME } }, select: { id: true } });
  const view = await conceptGraphService.buildGraphView(u.id, {});
  const byRel: Record<string, number> = {}; const bySrc: Record<string, number> = {};
  for (const e of view.edges) {
    byRel[e.relation] = (byRel[e.relation] ?? 0) + 1;
    const s = (e as any).source ?? '(未记来源)';
    bySrc[s] = (bySrc[s] ?? 0) + 1;
  }
  const lvl: Record<string, number> = {};
  for (const n of view.nodes) lvl[n.level] = (lvl[n.level] ?? 0) + 1;
  const withM = view.nodes.filter((n: any) => n.masteryScore !== null && n.masteryScore !== undefined);
  const cls = { 已掌握: 0, 在学: 0, 脆弱: 0, 未评估: 0 };
  for (const n of view.nodes as any[]) {
    if (n.masteryScore == null) cls.未评估++;
    else if (n.stability === 'fragile' || n.masteryScore < 0.45) cls.脆弱++;
    else if (n.stability === 'stable' || n.masteryScore >= 0.8) cls.已掌握++;
    else cls.在学++;
  }
  console.log('用户级图（不传 pathId）: 节点=%d 边=%d 路径候选=%d', view.meta.nodeCount, view.meta.edgeCount, (view.meta as any).paths?.length ?? 0);
  console.log('节点层级:', JSON.stringify(lvl));
  console.log('边按关系:', JSON.stringify(byRel));
  console.log('边按来源:', JSON.stringify(bySrc));
  console.log('掌握度:', JSON.stringify(cls), '带掌握度节点=', withM.length, '/', view.nodes.length);
})().catch((e) => console.error('ERR', e)).finally(() => (prisma as any).$disconnect());
