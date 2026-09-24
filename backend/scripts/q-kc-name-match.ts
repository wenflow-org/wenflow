/* eslint-disable no-console -- 只读诊断：新旧 KC 名的可匹配性 */
/**
 * 只读诊断：KC 重跑后，新旧 KC 名之间还有没有**可机械判定**的对应信号。
 *
 * 背景：commit a76cbfac 记录"新旧 KC 名完全同名交集 = 0"，据此判定必须 LLM 出建议。
 * 但"同名交集为 0"只说明**精确相等**没有，不代表**相似度**没有。本脚本实测字符二元组
 * Jaccard 相似度，看能否用代码做保守匹配（代码匹配 = 可审计、零编造风险）。
 *
 * 用法：npx ts-node --transpile-only scripts/q-kc-name-match.ts --limit=3
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { mapAndPersistKcAnnotation, type KcAnnotation } from '../src/services/learning/generation/kc-annotation';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

interface AnnotationLike {
  kcGraph?: { nodes?: Array<{ kcId?: unknown; name?: unknown }> } | null;
  conceptKcs?: Array<{ kcs?: Array<{ kcId?: unknown; name?: unknown }> }> | null;
}

const namesOf = (ann: AnnotationLike | null | undefined): string[] => {
  const byKcId = new Map<string, string>();
  for (const n of ann?.kcGraph?.nodes || []) byKcId.set(String(n.kcId), String(n.name ?? ''));
  const out: string[] = [];
  for (const g of Array.isArray(ann?.conceptKcs) ? ann.conceptKcs : []) {
    for (const k of g?.kcs || []) out.push(String(k?.name ?? byKcId.get(String(k?.kcId)) ?? ''));
  }
  return out.filter(Boolean);
};

/** 字符二元组 Jaccard（中文短串上比词级稳） */
function bigrams(s: string): Set<string> {
  const t = s.replace(/[\s「」『』“”"'（）()【】[\]]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  if (out.size === 0 && t.length === 1) out.add(t);
  return out;
}
function jaccard(a: string, b: string): number {
  const A = bigrams(a); const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / (A.size + B.size - inter);
}

async function main() {
  const limit = Number(arg('limit') || 3);
  const paths = await prisma.learning_paths.findMany({
    where: { aiPromptTemplate: { contains: 'kcAnnotation' } },
    select: { id: true, userId: true, title: true, aiPromptTemplate: true },
    orderBy: { createdAt: 'desc' },
  });

  const withTraces: typeof paths = [];
  for (const p of paths) {
    const n = await prisma.memory_traces.count({ where: { userId: p.userId, pathId: p.id } });
    if (n > 0) withTraces.push(p);
  }
  console.log(`有痕迹路径 ${withTraces.length} 条，取前 ${limit} 条实测\n`);

  const allPairs: Array<{ oldName: string; newName: string; score: number; path: string }> = [];

  for (const path of withTraces.slice(0, limit)) {
    const template = JSON.parse(path.aiPromptTemplate || '{}');
    const oldNames = namesOf(template?.kcAnnotation);

    const milestones = await prisma.milestones.findMany({
      where: { learningPathId: path.id }, orderBy: { order: 'asc' },
      select: { stageNumber: true, title: true, coreConceptName: true, description: true, goal: true },
    });
    const subtasks = await prisma.subtasks.findMany({
      where: { milestones: { learningPathId: path.id } }, orderBy: { order: 'asc' },
      select: { title: true, taskType: true, linkedConceptName: true, knowledgeType: true, cognitiveLevel: true },
    });

    let captured: KcAnnotation | null = null;
    await mapAndPersistKcAnnotation({
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
      persist: async (_id: string, ann: KcAnnotation) => { captured = ann; },
      materialize: async () => ({ prerequisite: 0, partOf: 0, prerequisiteConcept: 0, nodes: 0, skipped: true } as never),
    });

    const newNames = namesOf(captured);
    console.log(`── ${path.id}  ${String(path.title ?? '').slice(0, 24)}`);
    console.log(`   旧 ${oldNames.length} 个 / 新 ${newNames.length} 个，精确同名交集 ${oldNames.filter((n) => newNames.includes(n)).length}`);

    const exact = oldNames.filter((n) => newNames.includes(n));
    if (exact.length) console.log(`   同名: ${exact.join(' | ')}`);

    // 每个新 KC 的最佳旧 KC 候选
    const rows: Array<[string, string, number]> = [];
    for (const nn of newNames) {
      let best: [string, number] = ['', 0];
      for (const on of oldNames) {
        const s = jaccard(on, nn);
        if (s > best[1]) best = [on, s];
      }
      rows.push([nn, best[0], +best[1].toFixed(3)]);
      allPairs.push({ oldName: best[0], newName: nn, score: best[1], path: path.id });
    }
    for (const [nn, on, s] of rows.sort((a, b) => b[2] - a[2])) {
      console.log(`   ${String(s).padEnd(5)} 新「${nn}」 ←→ 旧「${on}」`);
    }
    console.log('');
  }

  const buckets = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  console.log('相似度分布（每档计数）：');
  for (let i = 0; i < buckets.length; i += 1) {
    const lo = buckets[i];
    const hi = i + 1 < buckets.length ? buckets[i + 1] : Infinity;
    const n = allPairs.filter((p) => p.score >= lo && p.score < hi).length;
    console.log(`  [${lo}, ${hi === Infinity ? '1' : hi}) → ${n}`);
  }
  const ge = (t: number) => allPairs.filter((p) => p.score >= t).length;
  console.log(`\n≥0.5 的新 KC：${ge(0.5)}/${allPairs.length}；≥0.4：${ge(0.4)}；≥0.3：${ge(0.3)}；=0：${allPairs.filter((p) => p.score === 0).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
