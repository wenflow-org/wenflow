/* eslint-disable no-console -- 一次性验证 CLI：kc-mapper 修复后 KC 图是否真实落库 */
/**
 * 2026-09-22 契约 bug 修复验证（完整生成被 path-planning 上游模型退化堵住时的等效触发）：
 * 对一条真实路径调用生产函数 mapAndPersistKcAnnotation（默认依赖 = executeSkillWithResult + prisma 落库），
 * 走与 stage-enrichment 完全相同的 KC 映射→持久化代码路径，然后核对 DB 落库结果。
 */
import 'dotenv/config';
import prisma from '../config/database';
import { mapAndPersistKcAnnotation } from '../services/learning/generation/kc-annotation';
import { parsePathPromptTemplate } from '../services/learning/learning.helpers';

const PATH_ID = process.env.KC_PATH_ID || 'lp_1784510874474_mqwjz8o';

async function main() {
  const path = await prisma.learning_paths.findUnique({
    where: { id: PATH_ID },
    include: { milestones: { include: { subtasks: true }, orderBy: { stageNumber: 'asc' } } },
  });
  if (!path) throw new Error(`路径不存在: ${PATH_ID}`);

  const before = parsePathPromptTemplate(path.aiPromptTemplate);
  console.log(`[before] path=${PATH_ID} name=${path.name}`);
  console.log(`[before] kcAnnotation=${JSON.stringify(before.kcAnnotation ?? null).slice(0, 80)}`);

  const template = parsePathPromptTemplate(path.aiPromptTemplate);
  // KC_STUB=1：上游模型退化期（2026-09-22 14:29 起 deepseek-v4-flash 被网关静默换成 v4.1，
  // 输出 markdown 不合 JSON 契约）用真实输出形状的桩驱动，验证的仍是真 prisma 落库回路。
  const stub = process.env.KC_STUB === '1'
    ? async () => ({
      success: true,
      quality: 'model' as const,
      output: {
        conceptKcs: [
          { conceptId: 'concept-1', kcs: [{ kcId: 'kc-1a', name: '识别多来源报表的列名差异', taxonomy: 'conceptual', prerequisiteKCs: [] }] },
          { conceptId: 'concept-2', kcs: [{ kcId: 'kc-2a', name: '按公共键对齐拼接两个报表', taxonomy: 'procedural', prerequisiteKCs: ['kc-1a'] }] },
        ],
        taskKcLinks: [{ taskTitle: path.milestones[0]?.subtasks?.[0]?.title || '首任务', linkedKCs: ['kc-1a'] }],
        kcGraph: {
          nodes: [
            { kcId: 'kc-1a', name: '识别多来源报表的列名差异', taxonomy: 'conceptual' },
            { kcId: 'kc-2a', name: '按公共键对齐拼接两个报表', taxonomy: 'procedural' },
          ],
          edges: [{ from: 'kc-1a', to: 'kc-2a', relation: 'prerequisite' }],
        },
      },
    })
    : undefined;
  const started = Date.now();
  const ann = await mapAndPersistKcAnnotation({
    pathId: PATH_ID,
    userId: path.userId,
    template,
    milestones: path.milestones.map((m) => ({
      stageNumber: m.stageNumber,
      title: m.title,
      coreConcept: m.coreConceptName || m.coreConceptId,
      description: m.description,
      goal: m.goal,
    })),
    subtasks: path.milestones.flatMap((m) => m.subtasks.map((t) => ({
      title: t.title,
      type: t.taskType,
      linkedConcept: t.linkedConceptId || t.linkedConceptName,
      knowledgeType: t.knowledgeType,
      cognitiveLevel: t.cognitiveLevel,
    }))),
    callSkill: stub as never,
  });
  console.log(`[after] 耗时=${((Date.now() - started) / 1000).toFixed(1)}s 返回=${ann ? '有标注' : 'null'}`);
  if (ann) {
    const graph = ann.kcGraph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
    console.log(`[after] conceptKcs=${ann.conceptKcs?.length ?? 0} taskKcLinks=${ann.taskKcLinks?.length ?? 0} ` +
      `kcGraph.nodes=${graph?.nodes?.length ?? 0} kcGraph.edges=${graph?.edges?.length ?? 0}`);
  }

  // 落库核对：重新读库
  const reloaded = await prisma.learning_paths.findUnique({ where: { id: PATH_ID }, select: { aiPromptTemplate: true } });
  const persisted = parsePathPromptTemplate(reloaded?.aiPromptTemplate || null).kcAnnotation;
  console.log(`[verify] DB kcAnnotation=${persisted ? '已落库' : '仍为 null'}`);
  if (persisted) {
    console.log(`[verify] DB 内 conceptKcs=${persisted.conceptKcs?.length ?? 0} edges=${persisted.kcGraph?.edges?.length ?? 0}`);
    console.log(`[verify] 边样例: ${JSON.stringify(persisted.kcGraph?.edges?.[0] ?? null)}`);
    console.log(`[verify] taskKcLink 样例: ${JSON.stringify(persisted.taskKcLinks?.[0] ?? null)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('[verify] 失败:', e); process.exit(1); });
