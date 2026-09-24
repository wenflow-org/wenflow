/* eslint-disable no-console -- 只读诊断：KC 被任务关联的覆盖率 */
/**
 * 只读诊断：孤立 KC 有多少（2026-09-24 用于给 kc-mapper 加"KC 必须有来路"规则取证）。
 *
 * 口径：
 *   - KCs = kcGraph.nodes（回落 conceptKcs[].kcs）
 *   - linked = taskKcLinks[].linkedKCs 的并集
 *   - orphan = KCs - linked；其中**是某个已关联 KC 的前置**的那些不算孤岛（前置天然不被任务直接关联）
 *
 * 实测（22 条路径 / 266 个 KC）：linked 94%；orphan 16（6%），其中 10 条是已关联 KC 的前置
 * → 真正的硬孤岛只有 6 条（2.3%）。这正是不采用"每个 KC 都必须被任务关联"这条更强规则的原因
 * （那会逼模型硬造任务关联）。
 */
import dotenv from 'dotenv';
import prisma from '../src/config/database';

dotenv.config();

type Kc = { kcId: string; name: string };

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** kcAnnotation 的最小可读视图（诊断用，容忍契约演进） */
interface AnnotationLike {
  kcGraph?: { nodes?: unknown; edges?: unknown } | null;
  conceptKcs?: unknown;
  taskKcLinks?: unknown;
}
interface KcNode { kcId?: unknown; name?: unknown }
interface KcGroup { kcs?: unknown }
interface TaskLink { linkedKCs?: unknown }
interface Edge { from?: unknown; to?: unknown; relation?: unknown }

async function main() {
  const onlyLatest = process.argv.includes('--latest-only');
  const rows = await prisma.learning_paths.findMany({
    select: { id: true, title: true, aiPromptTemplate: true, userId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  let pathsWithAnnotation = 0;
  let totalKc = 0;
  let totalLinked = 0;
  let orphanNoLink = 0;
  let orphanButPrereqOfLinked = 0;
  const perPath: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    let tpl: { kcAnnotation?: AnnotationLike } | null = null;
    try {
      tpl = typeof row.aiPromptTemplate === 'string'
        ? JSON.parse(row.aiPromptTemplate)
        : row.aiPromptTemplate;
    } catch { continue; }
    const ann = tpl?.kcAnnotation;
    if (!ann) continue;

    if (onlyLatest) {
      const key = row.userId || row.id;
      if (seen.has(key)) continue;
      seen.add(key);
    }

    pathsWithAnnotation += 1;

    const byId = new Map<string, Kc>();
    for (const n of asArray<KcNode>(ann?.kcGraph?.nodes)) {
      const id = String(n?.kcId ?? '');
      if (id) byId.set(id, { kcId: id, name: String(n?.name ?? '') });
    }
    for (const c of asArray<KcGroup>(ann?.conceptKcs)) {
      for (const kc of asArray<KcNode>(c?.kcs)) {
        const id = String(kc?.kcId ?? '');
        if (id && !byId.has(id)) byId.set(id, { kcId: id, name: String(kc?.name ?? '') });
      }
    }

    const linked = new Set<string>();
    for (const l of asArray<TaskLink>(ann?.taskKcLinks)) {
      for (const id of asArray<string>(l?.linkedKCs)) linked.add(id);
    }

    const prereqOfLinked = new Set<string>();
    for (const e of asArray<Edge>(ann?.kcGraph?.edges)) {
      if (e?.relation === 'prerequisite' && linked.has(String(e.to))) prereqOfLinked.add(String(e.from));
    }

    const orphans = [...byId.keys()].filter((id) => !linked.has(id));
    const hardOrphans = orphans.filter((id) => !prereqOfLinked.has(id));

    totalKc += byId.size;
    totalLinked += [...byId.keys()].filter((id) => linked.has(id)).length;
    orphanNoLink += orphans.length;
    orphanButPrereqOfLinked += orphans.length - hardOrphans.length;

    if (orphans.length > 0) {
      perPath.push({
        pathId: row.id,
        title: row.title,
        kcCount: byId.size,
        linked: linked.size,
        orphanCount: orphans.length,
        hardOrphanCount: hardOrphans.length,
        hardOrphans: hardOrphans.map((id) => ({ kcId: id, name: byId.get(id)?.name })),
      });
    }
  }

  console.log(JSON.stringify({
    mode: onlyLatest ? 'latest-per-user' : 'all-paths',
    pathsWithAnnotation,
    totalKc,
    totalLinked,
    linkedRate: totalKc ? +(totalLinked / totalKc).toFixed(3) : null,
    orphanNoLink,
    orphanButPrereqOfLinked,
    hardOrphanCount: orphanNoLink - orphanButPrereqOfLinked,
    hardOrphanRate: totalKc ? +((orphanNoLink - orphanButPrereqOfLinked) / totalKc).toFixed(3) : null,
    pathsWithOrphans: perPath.length,
    sample: perPath.slice(0, 8),
  }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
