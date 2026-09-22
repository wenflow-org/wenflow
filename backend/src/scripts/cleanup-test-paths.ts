/* eslint-disable no-console -- 一次性清理 CLI：删除本次验证产生的测试路径 */
/**
 * 2026-09-22 kc-mapper 修复验证过程中经由 trigger-path-generation.ts 产生的合成路径
 * （reviewer_2026 测试账号，均无任何真实学习活动）：3 条 0 子任务空壳 + 1 条 kcMapping=skipped
 * 半成品。删除顺序：subtasks → milestones → path_generation_runs → learning_paths。
 */
import 'dotenv/config';
import prisma from '../config/database';

const PATH_IDS = [
  'lp_1790066229704_9l4csn1',
  'lp_1790066927574_dkvei7g',
  'lp_1790067462612_xfloc2h',
  'lp_1790067597190_kyjxqh9',
];

async function main() {
  for (const id of PATH_IDS) {
    const path = await prisma.learning_paths.findUnique({
      where: { id },
      include: { milestones: { include: { subtasks: true } } },
    });
    if (!path) { console.log(`${id}: 不存在，跳过`); continue; }
    const taskCount = path.milestones.reduce((a, m) => a + m.subtasks.length, 0);
    const sessions = await prisma.teaching_sessions.count({ where: { learningPathId: id } });
    if (sessions > 0) { console.log(`${id}: 有 ${sessions} 个课堂会话，跳过（不删有活动的路径）`); continue; }
    const taskIds = path.milestones.flatMap((m) => m.subtasks.map((t) => t.id));
    if (taskIds.length) await prisma.subtasks.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.milestones.deleteMany({ where: { learningPathId: id } });
    await prisma.path_generation_runs.deleteMany({ where: { learningPathId: id } });
    await prisma.learning_paths.delete({ where: { id } });
    console.log(`${id}: 已删除（${path.milestones.length} 里程碑 / ${taskCount} 子任务）`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('清理失败:', e); process.exit(1); });
