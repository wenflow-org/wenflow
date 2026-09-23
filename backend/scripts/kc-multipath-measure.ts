/* eslint-disable no-console -- 一次性度量 CLI（只读） */
/**
 * 多路径概念图·有用性度量（只读）
 *
 * 回答三件事：
 *   1. 每条路径物化了多少边；跨路径是否共享概念（按 canonical conceptId）；
 *   2. L3 消费面是否真的**有料**：对每个任务的当前概念，`neighbors(in, prerequisite|part_of)`
 *      与 `upstreamClosure` 是否返回非空（空 = 回落旧行为 = 图没被用上）；
 *   3. 痕迹/误解的身份覆盖（跨表 join 的可行性）。
 *
 * 用法：npx ts-node --transpile-only scripts/kc-multipath-measure.ts --name="[kc] 多路径 0923a"
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { conceptRegistryService } from '../src/services/learner/concept-registry.service';
import { conceptGraphService } from '../src/services/learner/concept-graph.service';
import { RELATION_PREREQUISITE, RELATION_PART_OF } from '../src/services/learner/concept-graph.service';

const NAME = process.argv.find((a) => a.startsWith('--name='))?.slice('--name='.length) || '[kc] 多路径';

async function main() {
  const user = await prisma.users.findFirst({ where: { name: { contains: NAME } }, select: { id: true, name: true } });
  if (!user) throw new Error(`找不到学习者：${NAME}`);
  console.log(`\n学习者：${user.name} (${user.id})`);

  const paths = await prisma.learning_paths.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, status: true, aiPromptTemplate: true, createdAt: true },
  });
  console.log(`路径数：${paths.length}`);

  // 每条路径的边 / 节点
  const perPath: Array<{ id: string; title: string | null; prereq: number; partOf: number; nodes: number }> = [];
  for (const p of paths) {
    const edges = await prisma.concept_edges.findMany({ where: { userId: user.id, pathId: p.id }, select: { relation: true } });
    const view = await conceptGraphService.buildGraphView(user.id, { pathId: p.id });
    perPath.push({
      id: p.id,
      title: p.title,
      prereq: edges.filter((e) => e.relation === RELATION_PREREQUISITE).length,
      partOf: edges.filter((e) => e.relation === RELATION_PART_OF).length,
      nodes: view.nodes.length,
    });
  }
  console.log('\n### 每路径图规模');
  for (const x of perPath) console.log(`  ${x.id.slice(0, 24)} | prereq=${x.prereq} partOf=${x.partOf} 节点=${x.nodes} | ${x.title ?? ''}`);

  // 跨路径共享概念（按 canonical conceptId）
  console.log('\n### 跨路径概念共享（按 conceptId）');
  const pathConceptIds = new Map<string, Set<string>>();
  for (const p of paths) {
    const view = await conceptGraphService.buildGraphView(user.id, { pathId: p.id });
    pathConceptIds.set(p.id, new Set(view.nodes.map((n) => n.id)));
  }
  const ids = [...pathConceptIds.keys()];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = pathConceptIds.get(ids[i]!)!; const b = pathConceptIds.get(ids[j]!)!;
      const shared = [...a].filter((x) => b.has(x));
      console.log(`  path#${i + 1} ∩ path#${j + 1} = ${shared.length} 个概念：${shared.slice(0, 8).map((s) => s.slice(0, 12)).join(', ')}`);
    }
  }

  // 轨迹 / 误解身份覆盖
  const traces = await prisma.memory_traces.findMany({ where: { userId: user.id }, select: { conceptId: true, pathId: true } }).catch(() => [] as any[]);
  const miscon = await prisma.misconception_ledger.findMany({ where: { userId: user.id }, select: { conceptId: true } }).catch(() => [] as any[]);
  const traceWithId = traces.filter((t: any) => t.conceptId).length;
  const misconWithId = miscon.filter((m: any) => m.conceptId).length;
  console.log('\n### 身份覆盖');
  console.log(`  memory_traces=${traces.length} 带conceptId=${traceWithId}`);
  console.log(`  misconception_ledger=${miscon.length} 带conceptId=${misconWithId}`);

  // L3 消费面是否有料：对每个未完成任务，看 neighbors(in) / upstreamClosure
  console.log('\n### L3 消费面（当前概念 → 图邻居 / 上游闭包）');
  for (const p of paths) {
    const tasks = await prisma.subtasks.findMany({
      where: { userId: user.id, milestones: { learningPathId: p.id } as any },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, linkedConceptName: true, coreConcept: true, conceptId: true, status: true },
    }).catch(async () => prisma.subtasks.findMany({ where: { userId: user.id }, select: { id: true, title: true, linkedConceptName: true, coreConcept: true, conceptId: true, status: true } }));
    let withNeighbors = 0; let withUpstream = 0; let checked = 0;
    const samples: string[] = [];
    for (const t of tasks.slice(0, 40)) {
      const cname = t.linkedConceptName || t.coreConcept;
      if (!cname) continue;
      checked += 1;
      const resolved = await conceptRegistryService.resolveConcept(user.id, cname, { createIfMissing: false });
      if (!resolved) continue;
      const nb = await conceptGraphService.neighbors(user.id, resolved.conceptId, {
        relations: [RELATION_PREREQUISITE, RELATION_PART_OF], direction: 'in', limit: 3, pathId: p.id,
      });
      const up = await conceptGraphService.upstreamClosure(user.id, resolved.conceptId, { maxDepth: 3, pathId: p.id });
      if (nb.length > 0) withNeighbors += 1;
      if (up.length > 0) withUpstream += 1;
      if (samples.length < 3 && (nb.length > 0 || up.length > 0)) {
        samples.push(`      · ${t.title?.slice(0, 22)} [${cname}] → 邻居=${nb.map((n) => n.label).join('/') || '无'}｜上游=${up.map((u) => `${u.label}@d${u.depth}`).join('/') || '无'}`);
      }
    }
    console.log(`  path ${p.id.slice(0, 22)}: 检查任务=${checked} 有图邻居=${withNeighbors} 有上游闭包=${withUpstream}`);
    for (const s of samples) console.log(s);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
