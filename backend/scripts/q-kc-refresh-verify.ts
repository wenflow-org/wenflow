/* eslint-disable no-console */
import 'dotenv/config';
import prisma from '../src/config/database';
import { conceptGraphService } from '../src/services/learner/concept-graph.service';
(async () => {
  const p = prisma as any;
  const refreshed = ['lp_1790075910253_jasxf57', 'lp_1790079575117_2oipxjs', 'lp_1790081485023_di4du53'];
  for (const id of refreshed) {
    const path = await p.learning_paths.findUnique({ where: { id }, select: { userId: true, title: true, aiPromptTemplate: true } });
    const view = await conceptGraphService.buildGraphView(path.userId, { pathId: id });
    const ann = JSON.parse(path.aiPromptTemplate)?.kcAnnotation;
    const names = (ann?.conceptKcs || []).flatMap((g: any) => (g.kcs || []).map((k: any) => k.name));
    console.log(`\n${id}  ${String(path.title).slice(0, 22)}`);
    console.log(`  库内 KC 名（前 6）：${names.slice(0, 6).join(' / ')}`);
    console.log(`  图：节点=${view.meta.nodeCount} 边=${view.meta.edgeCount}`);
    console.log(`  邻近边矩阵：${JSON.stringify(view.edges.reduce((a: any, e: any) => { a[e.relation] = (a[e.relation] ?? 0) + 1; return a; }, {}))}`);
  }
  // 未被触碰的：案例路径（有痕迹）
  const caseId = 'lp_1790149867127_ulb8vl2';
  const casePath = await p.learning_paths.findUnique({ where: { id: caseId }, select: { aiPromptTemplate: true } });
  const caseAnn = JSON.parse(casePath.aiPromptTemplate)?.kcAnnotation;
  const caseNames = (caseAnn?.conceptKcs || []).flatMap((g: any) => (g.kcs || []).map((k: any) => k.name));
  console.log(`\n[对照组] ${caseId}（有痕迹，应保持旧标注）KC=${caseNames.length} 首条=「${caseNames[0]}」`);
  const traces = await p.memory_traces.count({ where: { conceptId: { not: null } } });
  console.log(`  全库带 conceptId 的痕迹=${traces}（未受影响）`);
})().catch((e) => console.error('ERR', e)).finally(() => (prisma as any).$disconnect());
