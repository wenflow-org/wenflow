/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/* eslint-disable no-console -- 一次性回填 CLI：KC 重标注 */
/**
 * KC 重标注（用**当前已发布**的 kc-mapper 契约重跑既有路径）。
 *
 * 为什么需要它：kc-mapper 契约改了（KC 从"任务流程的步骤"改成"可独立习得的能力单元"，见
 * commit fe82ad5e），但既有路径的 `kcAnnotation` 还是旧契约产物，只影响新生成的路径。
 *
 * ⚠️ **身份断裂风险**（实测）：新旧 KC 名**完全同名交集 = 0**，物化时经概念注册表解析会生成
 * **新的 conceptId**；而这条路径既有的 `memory_traces`（带 `pathId`）仍指向旧 conceptId →
 * 重跑后「痕迹→图节点」的 join 会断，图上掌握度归零。
 * 所以本脚本**默认拒绝**重跑有痕迹的路径（要跑得显式给 `--allow-orphan-traces`），
 * 并默认 dry-run（只调模型算新标注，不落库、不物化）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/kc-annotation-refresh.ts --scope=safe        # 预演无痕迹路径
 *   npx ts-node --transpile-only src/scripts/kc-annotation-refresh.ts --scope=safe --apply
 *   npx ts-node --transpile-only src/scripts/kc-annotation-refresh.ts --path=lp_xxx --apply
 */
import 'dotenv/config';
import prisma from '../config/database';
import { mapAndPersistKcAnnotation, type KcAnnotation } from '../services/learning/generation/kc-annotation';

interface Args { path: string | null; scope: 'safe' | 'all'; apply: boolean; allowOrphan: boolean; limit: number | null }
function parseArgs(): Args {
  const out: Args = { path: null, scope: 'safe', apply: false, allowOrphan: false, limit: null };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'path' && v) out.path = v.trim();
    if (k === 'scope' && (v === 'safe' || v === 'all')) out.scope = v;
    if (k === 'apply') out.apply = true;
    if (k === 'allow-orphan-traces') out.allowOrphan = true;
    if (k === 'limit' && v && Number.isFinite(Number(v))) out.limit = Number(v);
  }
  return out;
}

const KC_JOIN = /(并|且|和|还|同时)(?!.*区分)/;
const kcNamesOf = (ann: any): string[] => {
  const nameOf = new Map<string, string>();
  for (const n of ann?.kcGraph?.nodes || []) nameOf.set(String(n.kcId), String(n.name ?? ''));
  const out: string[] = [];
  for (const g of Array.isArray(ann?.conceptKcs) ? ann.conceptKcs : []) {
    for (const k of g?.kcs || []) out.push(String(k?.name ?? nameOf.get(String(k?.kcId)) ?? '?'));
  }
  return out.filter((n) => n && n !== '?');
};
const stat = (names: string[]) => {
  const lens = names.map((n) => n.length).sort((a, b) => a - b);
  return {
    n: names.length,
    median: lens.length ? lens[Math.floor(lens.length / 2)] : 0,
    max: lens.length ? lens[lens.length - 1] : 0,
    over12: names.filter((n) => n.length > 12).length,
    joined: names.filter((n) => KC_JOIN.test(n)).length,
  };
};

async function refreshOne(path: { id: string; userId: string; title: string | null; aiPromptTemplate: string | null }, args: Args) {
  const template = JSON.parse(path.aiPromptTemplate || '{}');
  const oldNames = kcNamesOf(template?.kcAnnotation);

  const milestones = await prisma.milestones.findMany({
    where: { learningPathId: path.id }, orderBy: { order: 'asc' },
    select: { stageNumber: true, title: true, coreConceptName: true, description: true, goal: true },
  });
  const subtasks = await prisma.subtasks.findMany({
    where: { milestones: { learningPathId: path.id } }, orderBy: { order: 'asc' },
    select: { title: true, taskType: true, linkedConceptName: true, knowledgeType: true, cognitiveLevel: true },
  });

  let captured: KcAnnotation | null = null;
  // 物化只 upsert、不清旧边（concept-graph.service 无 delete 步骤）：同一路径重跑会与新标注
  // **叠加**，留下指向旧 KCs 的孤儿边。故刷新前先做**路径内**清边，再重物化。
  const staleEdges = await prisma.concept_edges.count({ where: { userId: path.userId, pathId: path.id } });
  let cleared = 0;
  if (args.apply && staleEdges > 0) {
    const del = await prisma.concept_edges.deleteMany({ where: { userId: path.userId, pathId: path.id } });
    cleared = del.count;
  }
  const result = await mapAndPersistKcAnnotation({
    pathId: path.id,
    userId: path.userId,
    template,
    milestones: milestones.map((m) => ({
      stageNumber: m.stageNumber ?? 0, title: m.title,
      coreConcept: m.coreConceptName, description: m.description, goal: m.goal,
    })),
    subtasks: subtasks.map((t) => ({
      title: t.title, type: t.taskType ?? undefined,
      linkedConcept: t.linkedConceptName, knowledgeType: t.knowledgeType, cognitiveLevel: t.cognitiveLevel,
    })),
    // dry-run：拦住落库与物化，只取模型输出
    ...(args.apply ? {} : {
      persist: async (_id: string, ann: KcAnnotation) => { captured = ann; },
      materialize: async () => ({ prerequisite: 0, partOf: 0, prerequisiteConcept: 0, nodes: 0, skipped: true } as never),
    }),
  });
  const newNames = kcNamesOf(args.apply ? (result ?? null) : captured);
  const a = stat(oldNames); const b = stat(newNames);
  const overlap = oldNames.filter((n) => newNames.includes(n)).length;
  console.log(`\n${path.id}  ${String(path.title ?? '').slice(0, 24)}`);
  console.log(`  旧: KC=${a.n} 中位=${a.median} 最长=${a.max} >12字=${a.over12} 含并列=${a.joined}`);
  console.log(`  新: KC=${b.n} 中位=${b.median} 最长=${b.max} >12字=${b.over12} 含并列=${b.joined}  | 与旧同名交集=${overlap}`);
  console.log(`  ${args.apply ? '已落库+物化' : 'DRY-RUN（未写）'}｜路径内旧边 ${staleEdges} 条，本次清掉 ${cleared} 条`);
}

async function main() {
  const args = parseArgs();
  console.log(`模式=${args.apply ? 'APPLY（写库+物化）' : 'DRY-RUN（只调模型）'}`);

  let paths = await prisma.learning_paths.findMany({
    where: { aiPromptTemplate: { contains: 'kcAnnotation' }, ...(args.path ? { id: args.path } : {}) },
    select: { id: true, userId: true, title: true, aiPromptTemplate: true },
    orderBy: { updatedAt: 'desc' },
  });
  paths = paths.filter((p) => {
    try { return !!JSON.parse(p.aiPromptTemplate || '{}')?.kcAnnotation; } catch { return false; }
  });

  // 痕迹闸门：有痕迹的路径默认不重跑（会孤儿化 master 展示）
  const withTraces: typeof paths = [];
  const target: typeof paths = [];
  for (const p of paths) {
    const t = await prisma.memory_traces.count({ where: { userId: p.userId, pathId: p.id } });
    if (t > 0) withTraces.push(p); else target.push(p);
  }
  console.log(`候选 ${paths.length} 条：无痕迹 ${target.length}，有痕迹 ${withTraces.length}`);
  if (withTraces.length) {
    console.log(`  ${args.allowOrphan ? '⚠️ 已允许' : '⏭ 跳过'}有痕迹的 ${withTraces.length} 条（重跑会打断「痕迹→图节点」join）`);
  }
  let runList = args.scope === 'all' && args.allowOrphan ? [...target, ...withTraces] : target;
  if (args.limit) runList = runList.slice(0, args.limit);
  if (runList.length === 0) { console.log('没有可跑的路径。'); return; }

  for (const p of runList) await refreshOne(p, args);
  console.log(`\n合计处理 ${runList.length} 条。${args.apply ? '' : ' 加 --apply 才落库。'}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
