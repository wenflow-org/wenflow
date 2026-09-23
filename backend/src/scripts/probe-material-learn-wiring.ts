/* eslint-disable no-console -- 一次性验收 CLI */
/**
 * 下游 learn 接线验收：给定 pathId，检查资料是否同时到达
 *   ① 学习者侧（`getLearningPath` 顶层 materials）
 *   ② 课堂侧（`resolvePathMaterialsForTeaching` → teaching-turn scenario.materials）
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-material-learn-wiring.ts [pathId]
 */
import 'dotenv/config';

async function main() {
  const pathId = process.argv[2];
  const { prisma } = await import('../config/database');
  const { getLearningPath } = await import('../services/learning/queries/path-views.queries');
  const { resolvePathMaterialsForTeaching } = await import('../services/ai-teaching/TeachingContextBuilder');

  const target = pathId || (await (prisma as any).learning_paths.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  }))?.id;
  if (!target) {
    console.error('没有可用路径');
    process.exitCode = 1;
    return;
  }
  console.log(`pathId = ${target}`);

  const detail: any = await getLearningPath(String(target));
  const learner = detail?.materials;
  console.log(`① 学习者侧（路径详情顶层 materials）：${Array.isArray(learner) ? `${learner.length} 包` : String(learner)}`);
  if (Array.isArray(learner) && learner[0]) {
    console.log(`   首包：${learner[0].title}｜章节 ${learner[0].sections?.length ?? 0}｜要点 ${learner[0].keyPoints?.length ?? 0}`);
    console.log(`   首条引文：${String(learner[0].keyPoints?.[0]?.cite || '').slice(0, 50)}`);
  }

  // ③ 资料引用（materialRefs）：里程碑/任务 → 资料条目（逐字核对后落库）
  const milestones = Array.isArray(detail?.milestones) ? detail.milestones : [];
  const stageRefs = milestones.filter((m: any) => Array.isArray(m.materialRefs) && m.materialRefs.length);
  const taskRefs = milestones.flatMap((m: any) => (Array.isArray(m.subtasks) ? m.subtasks : []))
    .filter((t: any) => Array.isArray(t.materialRefs) && t.materialRefs.length);
  console.log(`③ materialRefs：阶段命中 ${stageRefs.length}/${milestones.length}｜任务命中 ${taskRefs.length}`);
  for (const m of stageRefs.slice(0, 3)) {
    console.log(`   段${m.stageNumber}：${m.materialRefs.map((r: any) => r.sectionTitle || String(r.quote).slice(0, 16)).join(' / ')}`
      + `｜可看原文 ${m.materialRefs.filter((r: any) => r.materialId).length}/${m.materialRefs.length}`);
  }
  for (const t of taskRefs.slice(0, 3)) {
    console.log(`   任务「${String(t.title).slice(0, 20)}」：${t.materialRefs.map((r: any) => r.sectionTitle || String(r.quote).slice(0, 16)).join(' / ')}`);
  }

  const row: any = await (prisma as any).learning_paths.findUnique({
    where: { id: String(target) },
    select: { aiPromptTemplate: true },
  });
  const teaching = resolvePathMaterialsForTeaching(row?.aiPromptTemplate || null);
  console.log(`② 课堂侧（teaching-turn scenario.materials）：${Array.isArray(teaching) ? `${teaching.length} 包` : String(teaching)}`);
  if (Array.isArray(teaching) && teaching[0]) {
    console.log(`   首包：${teaching[0].title}｜章节 ${teaching[0].sections?.length ?? 0}｜要点 ${teaching[0].keyPoints?.length ?? 0}`);
  }

  await (prisma as any).$disconnect();
}

void main().catch((error) => {
  console.error('失败', error);
  process.exitCode = 1;
});
