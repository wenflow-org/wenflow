/* eslint-disable no-console -- 只读诊断：痕迹名 vs 标注 KC 名的漂移 */
/**
 * 只读诊断：教学期写入的 `memory_traces.conceptKey` 与路径标注里的 KC 名**漂移有多大**。
 *
 * 动机：实测 `lp_1790131532130_b34jgo5` 的 3 条痕迹里，有 2 条的 conceptKey **根本不在**
 * 该路径当前的 kcAnnotation 里（`判断两元素间成立的对齐关系类型` vs 标注的
 * `识别两个元素间成立的对齐关系类型`）。追溯写入侧：`SessionFinalizationService.collectReviewOutcomes`
 * 取的是 `session.knowledgeState[].name` —— 即**教学模型自己写的 knowledge.points 名字**，
 * 不是标注里的原名字。于是 `resolveConceptIdSafe` 给"改写过的名字"建了**新概念** → 图上幽灵节点。
 *
 * 本脚本量化三档：
 *   A 精确命中标注 KC 名（归一化后相等）
 *   B 与某个标注 KC 名共享一段长公共子串（≥8 字，说明是改写而非另一个能力）
 *   C 都不占（模型改写幅度大，或本就来自概念级回落）
 *
 * 用法：npx ts-node --transpile-only scripts/q-trace-name-drift.ts
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { normalizeConceptKey } from '../src/services/memory/concept-key';

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

interface AnnotationLike {
  kcGraph?: { nodes?: Array<{ name?: unknown }> } | null;
  conceptKcs?: Array<{ kcs?: Array<{ name?: unknown }> }> | null;
}

function annotationKcNames(ann: AnnotationLike | null | undefined): string[] {
  const out: string[] = [];
  for (const g of arr<{ kcs?: Array<{ name?: unknown }> }>(ann?.conceptKcs)) {
    for (const k of arr<{ name?: unknown }>(g?.kcs)) {
      const n = String(k?.name ?? '').trim();
      if (n) out.push(n);
    }
  }
  for (const n of arr<{ name?: unknown }>(ann?.kcGraph?.nodes)) {
    const name = String(n?.name ?? '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 最长公共子串长度（中文短串，O(n·m) 足够） */
function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

async function main() {
  const rows = await prisma.learning_paths.findMany({
    where: { aiPromptTemplate: { contains: 'kcAnnotation' } },
    select: { id: true, userId: true, title: true, aiPromptTemplate: true },
  });

  let traces = 0;
  let exact = 0;
  let near = 0;
  let neither = 0;
  const perPath: Array<Record<string, unknown>> = [];
  const samples: Array<Record<string, unknown>> = [];
  const nearSamples: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    let tpl: { kcAnnotation?: AnnotationLike } | null = null;
    try { tpl = JSON.parse(row.aiPromptTemplate || '{}'); } catch { continue; }
    const ann = tpl?.kcAnnotation;
    if (!ann) continue;
    const names = annotationKcNames(ann);
    const normSet = new Set(names.map((n) => normalizeConceptKey(n)));

    const traceRows = await prisma.memory_traces.findMany({
      where: { userId: row.userId, pathId: row.id },
      select: { conceptKey: true, conceptId: true },
    });
    if (traceRows.length === 0) continue;

    let pExact = 0; let pNear = 0; let pNeither = 0;
    for (const t of traceRows) {
      traces += 1;
      const key = String(t.conceptKey || '');
      const norm = normalizeConceptKey(key);
      if (normSet.has(norm)) { exact += 1; pExact += 1; continue; }
      let bestLen = 0; let bestName = '';
      for (const n of names) {
        const l = longestCommonSubstring(norm, normalizeConceptKey(n));
        if (l > bestLen) { bestLen = l; bestName = n; }
      }
      if (bestLen >= 8) {
        near += 1; pNear += 1;
        if (nearSamples.length < 12) {
          nearSamples.push({ path: String(row.title ?? '').slice(0, 20), traceKey: key, annotation: bestName, commonLen: bestLen });
        }
      } else {
        neither += 1; pNeither += 1;
        if (samples.length < 12) {
          samples.push({ path: String(row.title ?? '').slice(0, 20), traceKey: key, bestAnnotation: bestName, commonLen: bestLen });
        }
      }
    }
    perPath.push({ path: String(row.title ?? '').slice(0, 22), id: row.id, traces: traceRows.length, exact: pExact, near: pNear, neither: pNeither, kcNames: names.length });
  }

  console.log(JSON.stringify({
    traces,
    exactInAnnotation: exact,
    nearMiss_commonSubstring_ge8: near,
    neither,
    exactRate: traces ? +(exact / traces).toFixed(3) : null,
    nearRate: traces ? +(near / traces).toFixed(3) : null,
    neitherRate: traces ? +(neither / traces).toFixed(3) : null,
    nearSamples,
    perPath: perPath.sort((a, b) => Number(b.traces) - Number(a.traces)),
    neitherSamples: samples,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
