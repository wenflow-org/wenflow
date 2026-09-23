/* eslint-disable no-console -- 一次性验证 CLI */
/**
 * 验证 kc-annotation → 概念图物化 的**接线**是否真的生效（进程内，不依赖 HTTP/LLM）。
 * 建一条临时路径 + 桩驱动 mapAndPersistKcAnnotation，检查 concept_edges 是否新增，随后清理。
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { mapAndPersistKcAnnotation } from '../src/services/learning/generation/kc-annotation';

const USER = process.env.PROBE_USER || '';

async function main() {
  const user = USER
    ? { id: USER }
    : (await prisma.users.findFirst({ where: { isVirtualLearner: true }, select: { id: true } }));
  if (!user) throw new Error('找不到用户');
  const pathId = `lp_probe_${Date.now()}`;
  await prisma.learning_paths.create({
    data: { id: pathId, userId: user.id, title: '物化探针', name: '物化探针', status: 'active', updatedAt: new Date() },
  });

  const before = await prisma.concept_edges.count({ where: { userId: user.id } });
  const stub = async () => ({
    success: true, quality: 'model' as const,
    output: {
      conceptKcs: [
        { conceptId: 'concept-1', kcs: [{ kcId: 'kc-1a', name: '探针KC甲', taxonomy: 'conceptual', prerequisiteKCs: [] }] },
        { conceptId: 'concept-2', kcs: [{ kcId: 'kc-2a', name: '探针KC乙', taxonomy: 'procedural', prerequisiteKCs: ['kc-1a'] }] },
      ],
      taskKcLinks: [{ taskTitle: '探针任务', linkedKCs: ['kc-1a', 'kc-2a'] }],
      kcGraph: {
        nodes: [{ kcId: 'kc-1a', name: '探针KC甲' }, { kcId: 'kc-2a', name: '探针KC乙' }],
        edges: [{ from: 'kc-1a', to: 'kc-2a', relation: 'prerequisite' }],
      },
    },
  });

  await mapAndPersistKcAnnotation({
    pathId, userId: user.id,
    template: { cognitiveCore: { coreConcepts: [{ id: 'concept-1', name: '探针概念甲' }, { id: 'concept-2', name: '探针概念乙' }] } },
    milestones: [], subtasks: [],
    callSkill: stub as never,
  });

  const edges = await prisma.concept_edges.findMany({
    where: { userId: user.id, pathId }, select: { relation: true, source: true },
  });
  console.log(`[probe] pathId=${pathId} 新增边=${edges.length}（回填前 ${before}）`);
  console.log('[probe] 明细:', JSON.stringify(edges));
  console.log(edges.length >= 3 ? '[probe] ✅ 物化接线生效（1 prerequisite + 2 part_of）' : '[probe] ❌ 物化未生效');

  // 清理：边 + 别名/概念 + 临时路径
  const conceptIds = (await prisma.concept_aliases.findMany({
    where: { userId: user.id, aliasRaw: { in: ['探针KC甲', '探针KC乙', '探针概念甲', '探针概念乙'] } },
    select: { conceptId: true },
  })).map((a) => a.conceptId);
  await prisma.concept_edges.deleteMany({ where: { pathId } });
  await prisma.learning_paths.deleteMany({ where: { id: pathId } });
  if (conceptIds.length) {
    await prisma.concept_aliases.deleteMany({ where: { conceptId: { in: conceptIds } } });
    await prisma.concepts.deleteMany({ where: { id: { in: conceptIds } } });
  }
  console.log('[probe] 已清理');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[probe] 失败:', e); process.exit(1); });
