/* eslint-disable no-console */
/**
 * KC ↔ task 基数关系实测（只读）
 * 回答：一个 task 对应几个 KC？一个 KC 被几个 task 复用？KC 在概念之间是否复用？
 * 用法：npx ts-node --transpile-only scripts/q-kc-cardinality.ts [--path=<id>] [--dump]
 */
import 'dotenv/config';
import prisma from '../src/config/database';

const onlyPath = process.argv.find((a) => a.startsWith('--path='))?.slice('--path='.length) || null;
const dump = process.argv.includes('--dump');

interface Link { taskTitle?: string; linkedKCs?: string[]; kcIds?: string[]; linkedKcIds?: string[]; kcs?: string[] }
const kcIdsOf = (l: Link): string[] => l.linkedKCs ?? l.kcIds ?? l.linkedKcIds ?? l.kcs ?? [];

async function main() {
  const p = prisma as any;
  const paths = await p.learning_paths.findMany({
    where: { aiPromptTemplate: { contains: 'kcAnnotation' }, ...(onlyPath ? { id: onlyPath } : {}) },
    select: { id: true, title: true, aiPromptTemplate: true, userId: true },
    orderBy: { createdAt: 'desc' },
    take: onlyPath ? 1 : 40,
  });
  console.log(`含 kcAnnotation 的路径：${paths.length}\n`);

  const globalKcToTasks = new Map<string, Set<string>>();
  const rows: Array<{ id: string; title: string; tasks: number; kcs: number; perTask: number[]; shared: number; conceptCount: number }> = [];

  for (const path of paths) {
    let tpl: any = {};
    try { tpl = JSON.parse(path.aiPromptTemplate); } catch { continue; }
    const ann = tpl?.kcAnnotation;
    if (!ann) continue;
    const links: Link[] = Array.isArray(ann.taskKcLinks) ? ann.taskKcLinks : [];
    const nodes: any[] = Array.isArray(ann.kcGraph?.nodes) ? ann.kcGraph.nodes : [];
    const nameOf = new Map<string, string>();
    for (const n of nodes) if (n?.kcId) nameOf.set(String(n.kcId), String(n.name ?? n.kcId));

    const perTask: number[] = [];
    const kcTasks = new Map<string, Set<string>>();
    for (const l of links) {
      const ids = kcIdsOf(l).map(String);
      perTask.push(ids.length);
      const task = String(l.taskTitle ?? '?');
      for (const id of ids) {
        const bucket = kcTasks.get(id) ?? new Set<string>();
        bucket.add(task);
        kcTasks.set(id, bucket);
        const g = globalKcToTasks.get(id) ?? new Set<string>();
        g.add(`${path.id}:${task}`);
        globalKcToTasks.set(id, g);
      }
    }
    const shared = [...kcTasks.values()].filter((s) => s.size > 1).length;
    rows.push({
      id: path.id, title: String(path.title ?? '').slice(0, 22),
      tasks: links.length, kcs: kcTasks.size, perTask,
      shared, conceptCount: Array.isArray(ann.conceptKcs) ? ann.conceptKcs.length : 0,
    });

    if (dump || onlyPath) {
      console.log(`=== ${path.id}｜${path.title}`);
      console.log(`  任务数=${links.length}  KC 节点总数(kcGraph)=${nodes.length}  被任务引用的 KC=${kcTasks.size}  conceptKcs 组=${Array.isArray(ann.conceptKcs) ? ann.conceptKcs.length : 0}`);
      console.log(`  kcGraph.edges=${Array.isArray(ann.kcGraph?.edges) ? ann.kcGraph.edges.length : 0}`);
      console.log('  task → KCs:');
      for (const l of links) {
        const ids = kcIdsOf(l).map(String);
        console.log(`    · ${String(l.taskTitle ?? '?').slice(0, 30)}  →  [${ids.length}] ${ids.map((i) => nameOf.get(i) ?? i).join(' / ').slice(0, 110)}`);
      }
      console.log('  KC → 被哪些任务引用:');
      for (const [id, tasks] of kcTasks) {
        console.log(`    · ${String(nameOf.get(id) ?? id).slice(0, 34)}  ←  ${tasks.size} 任务${tasks.size > 1 ? ' ★复用' : ''}`);
      }
      const groups: any[] = Array.isArray(ann.conceptKcs) ? ann.conceptKcs : [];
      if (groups.length) {
        console.log('  conceptKcs（核心概念 → 它的 KCs）:');
        for (const g of groups) {
          const kcs = Array.isArray(g?.kcs) ? g.kcs : [];
          console.log(`    · ${String(g?.conceptId ?? '?')} ← [${kcs.length}] ${kcs.map((k: any) => String(k?.name ?? k?.kcId ?? '?')).join(' / ').slice(0, 110)}`);
        }
      }
      console.log('');
      if (onlyPath) break;
    }
  }

  const allPerTask = rows.flatMap((r) => r.perTask);
  const dist = (arr: number[]) => {
    const m = new Map<number, number>();
    for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}个:${v}`).join('  ');
  };
  console.log('### 汇总（' + rows.length + ' 条路径）');
  console.log(`每任务 KC 数分布：${dist(allPerTask)}`);
  console.log(`平均每任务 ${(allPerTask.reduce((a, b) => a + b, 0) / Math.max(1, allPerTask.length)).toFixed(2)} 个 KC`);
  const avgTasks = rows.reduce((a, r) => a + r.tasks, 0) / Math.max(1, rows.length);
  const avgKc = rows.reduce((a, r) => a + r.kcs, 0) / Math.max(1, rows.length);
  console.log(`平均每路径 ${avgTasks.toFixed(1)} 任务 / ${avgKc.toFixed(1)} 个不同 KC / ${(rows.reduce((a, r) => a + r.conceptCount, 0) / Math.max(1, rows.length)).toFixed(1)} 个核心概念`);
  const reused = rows.reduce((a, r) => a + r.shared, 0);
  const totalKcInstances = rows.reduce((a, r) => a + r.kcs, 0);
  console.log(`被 >1 任务引用的 KC（路径内复用）：${reused} / ${totalKcInstances} = ${(100 * reused / Math.max(1, totalKcInstances)).toFixed(0)}%`);
}
main().catch((e) => console.error('ERR', e)).finally(() => (prisma as any).$disconnect());
