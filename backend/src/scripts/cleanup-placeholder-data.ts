#!/usr/bin/env node
/**
 * T-05 占位数据治理（#109，本地开发库；默认 dry-run）
 *
 * 两类占位数据：
 *  ① `concept-N` 占位键（克隆路径把本地序号带进概念身份）——进不了任何正式读数，
 *     但会以内部 id 形态出现在概念图/记忆表里。清理：删概念行 + 记忆痕 + 引用它们的边。
 *  ② 历史占位负荷行（`learning_metrics.sourceKey LIKE 'task-completion:%'`）——本轮起写侧
 *     会打 `metadata.synthetic=true`，历史行没有该标记；这里按同一口径回填，
 *     让读侧能统一过滤（不改数值、不删行——部分课只有这一条负荷记录）。
 *
 * 用法：
 *   cd backend && npx ts-node --transpile-only src/scripts/cleanup-placeholder-data.ts          # 只报计划
 *   cd backend && npx ts-node --transpile-only src/scripts/cleanup-placeholder-data.ts --apply  # 执行
 */
import 'dotenv/config';
import prisma from '../config/database';

const APPLY = process.argv.includes('--apply');
const PLACEHOLDER_RE = /^concept-\d+$/i;
/**
 * 写侧开始打 `metadata.synthetic=true` 的落地时刻（提交 a11d6937，2026-10-18T14:54:45Z）。
 * 只回填此前的行：该时刻之后按写侧语义**真实测量**的 task-completion 行可能本就未被标
 * synthetic，重跑脚本若无脑补标，会把真实负荷冒充成合成值（#109 ④）。
 */
const SYNTHETIC_FLAG_WRITE_SIDE_SINCE_MS = Date.parse('2026-10-18T14:54:45Z');

async function main() {
  const concepts = await prisma.concepts.findMany({
    where: { canonicalLabel: { startsWith: 'concept-' } },
    select: { id: true, canonicalLabel: true, userId: true },
  });
  const placeholderConcepts = concepts.filter((concept) => PLACEHOLDER_RE.test(String(concept.canonicalLabel || '')));
  const placeholderIds = placeholderConcepts.map((concept) => concept.id);

  const traces = await prisma.memory_traces.findMany({
    where: { conceptKey: { startsWith: 'concept-' } },
    select: { id: true, conceptKey: true, userId: true },
  });
  const placeholderTraces = traces.filter((trace) => PLACEHOLDER_RE.test(String(trace.conceptKey || '')));

  const metrics = await prisma.learning_metrics.findMany({
    where: { sourceKey: { startsWith: 'task-completion:' } },
    select: { id: true, metadata: true, recordedAt: true },
  });
  const metricsNeedingFlag = metrics.filter((row) => {
    // 写侧落标之后的行不在历史回填范围（避免把真实测量误标成 synthetic）
    if (row.recordedAt && row.recordedAt.getTime() >= SYNTHETIC_FLAG_WRITE_SIDE_SINCE_MS) return false;
    try {
      const parsed = row.metadata ? JSON.parse(String(row.metadata)) : null;
      return !parsed || parsed.synthetic !== true;
    } catch { return true; }
  });

  const edges = placeholderIds.length
    ? await prisma.concept_edges.findMany({
        where: { OR: [{ fromConceptId: { in: placeholderIds } }, { toConceptId: { in: placeholderIds } }] },
        select: { id: true },
      })
    : [];

  console.log(`[placeholder] 概念行 ${placeholderConcepts.length} 条：${placeholderConcepts.map((c) => c.canonicalLabel).join(', ') || '-'}`);
  console.log(`[placeholder] 记忆痕 ${placeholderTraces.length} 条：${placeholderTraces.map((t) => t.conceptKey).join(', ') || '-'}`);
  console.log(`[placeholder] 引用占位概念的边 ${edges.length} 条`);
  console.log(`[placeholder] 待回填 synthetic=true 的占位负荷行 ${metricsNeedingFlag.length} 条（共 ${metrics.length} 条 task-completion 行）`);

  if (!APPLY) {
    console.log('[placeholder] dry-run：未做任何修改（加 --apply 执行）');
    await prisma.$disconnect();
    return;
  }

  let deletedEdges = 0;
  let deletedTraces = 0;
  let deletedConcepts = 0;
  let flagged = 0;
  if (edges.length) {
    const result = await prisma.concept_edges.deleteMany({ where: { id: { in: edges.map((edge) => edge.id) } } });
    deletedEdges = result.count;
  }
  if (placeholderTraces.length) {
    const result = await prisma.memory_traces.deleteMany({ where: { id: { in: placeholderTraces.map((trace) => trace.id) } } });
    deletedTraces = result.count;
  }
  if (placeholderIds.length) {
    const result = await prisma.concepts.deleteMany({ where: { id: { in: placeholderIds } } });
    deletedConcepts = result.count;
  }
  for (const row of metricsNeedingFlag) {
    let parsed: Record<string, unknown> = {};
    try { parsed = row.metadata ? JSON.parse(String(row.metadata)) : {}; } catch { parsed = {}; }
    await prisma.learning_metrics.update({
      where: { id: row.id },
      data: { metadata: JSON.stringify({ ...parsed, synthetic: true }) },
    });
    flagged += 1;
  }
  console.log(`[placeholder] 已清理：边 ${deletedEdges} / 记忆痕 ${deletedTraces} / 概念 ${deletedConcepts}；回填 synthetic ${flagged}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[placeholder] 失败：', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
