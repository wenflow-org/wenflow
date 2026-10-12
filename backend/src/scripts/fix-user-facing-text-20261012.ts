/**
 * 存量数据修复：用户可见文本的内部痕迹（2026-10-12 走查 llp_1791817016486_mot0ov1 发现）
 *
 * 三类修复（只动用户可见字段，不动生成输入/结构）：
 *   1. 内部流程术语「回捞」→「回顾」：subtasks.title/description、milestones.title/description/goal
 *      （实测 24 条任务标题、39 条里程碑描述命中）。
 *   2. 阶段描述的旧「容量说明」文案 → 学习者口径「时间说明」
 *      （旧句引用内部字段名「补充说明」且「加密」歧义；新文案见 stage-fill-note.ts）。
 *   3. learning_paths.description 第三人称内部分析（「他都拿不准」「本人」）→ 模板 summary（学习者口径）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/fix-user-facing-text-20261012.ts            # dry-run（默认，只统计）
 *   npx ts-node --transpile-only src/scripts/fix-user-facing-text-20261012.ts --apply    # 落库（先 VACUUM INTO 备份）
 */
import 'dotenv/config';
import prisma from '../config/database';
import { sanitizeUserFacingText } from '../services/learning/user-facing-text';
import { logger } from '../utils/logger';

export interface FixArgs {
  apply: boolean;
}

export function parseFixArgs(argv: string[]): FixArgs {
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else throw new Error(`未知参数：${arg}`);
  }
  return { apply };
}

/** 旧「容量说明」→ 学习者口径「时间说明」（保留两个数字，重写句式） */
export function rewriteLegacyFillNote(text: string): { text: string; rewritten: boolean } {
  const legacy = /容量说明：本阶段按你的时间预算约 (\d+) 小时，当前拆出的学习任务合计约 (\d+) 小时；如需更完整的练习量，可在补充说明里要求加密。/;
  const matched = text.match(legacy);
  if (!matched) return { text, rewritten: false };
  const fresh = `时间说明：这一阶段按你的时间预算约 ${matched[1]} 小时规划，目前拆出的学习任务合计约 ${matched[2]} 小时；如果想让这一阶段练得更充分，可以在学习过程中告诉我，我会再补充任务。`;
  return { text: text.replace(legacy, fresh), rewritten: true };
}

/** 第三人称内部分析标记（命中且模板有 summary 时才替换） */
const THIRD_PERSON_MARKERS = /本人|他都|该用户|用户都拿不准/;

function parseTemplateSummary(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const summary = parsed?.summary;
    return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { apply } = parseFixArgs(process.argv.slice(2));
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    subtasksTitle: 0,
    subtasksDescription: 0,
    milestonesTitle: 0,
    milestonesDescription: 0,
    milestonesGoal: 0,
    fillNoteRewritten: 0,
    pathDescriptionThirdPerson: 0,
    samples: [] as string[],
  };

  // 备份必须发生在任何写入之前（WAL 安全：copyFileSync 会漏未 checkpoint 的事务，用 VACUUM INTO）
  if (apply) {
    const backupPath = `prisma/dev.db.bak-${Date.now()}`;
    await prisma.$executeRawUnsafe(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    logger.info('[fix-user-facing-text] 备份完成', { backupPath });
    (summary as Record<string, unknown>).backupPath = backupPath;
  }

  // 1) 任务标题/描述
  const subtasks = await prisma.subtasks.findMany({ select: { id: true, title: true, description: true } });
  for (const row of subtasks) {
    const title = sanitizeUserFacingText(row.title);
    const description = sanitizeUserFacingText(row.description);
    if (title.replaced.length > 0) {
      summary.subtasksTitle += 1;
      if (summary.samples.length < 8) summary.samples.push(`subtask.title ${row.id}: ${row.title} → ${title.text}`);
      if (apply) await prisma.subtasks.update({ where: { id: row.id }, data: { title: title.text } });
    }
    if (description.replaced.length > 0) {
      summary.subtasksDescription += 1;
      if (apply) await prisma.subtasks.update({ where: { id: row.id }, data: { description: description.text } });
    }
  }

  // 2) 里程碑标题/描述/goal（描述同时处理旧容量说明文案）
  const milestones = await prisma.milestones.findMany({ select: { id: true, title: true, description: true, goal: true } });
  for (const row of milestones) {
    const title = sanitizeUserFacingText(row.title);
    const goal = sanitizeUserFacingText(row.goal);
    const sanitized = sanitizeUserFacingText(row.description);
    const note = rewriteLegacyFillNote(sanitized.text);
    if (title.replaced.length > 0) {
      summary.milestonesTitle += 1;
      if (apply) await prisma.milestones.update({ where: { id: row.id }, data: { title: title.text } });
    }
    if (goal.replaced.length > 0) {
      summary.milestonesGoal += 1;
      if (apply) await prisma.milestones.update({ where: { id: row.id }, data: { goal: goal.text } });
    }
    if (sanitized.replaced.length > 0 || note.rewritten) {
      summary.milestonesDescription += 1;
      if (note.rewritten) summary.fillNoteRewritten += 1;
      if (apply) await prisma.milestones.update({ where: { id: row.id }, data: { description: note.text } });
    }
  }

  // 3) 路径描述第三人称 → 模板 summary
  const paths = await prisma.learning_paths.findMany({ select: { id: true, description: true, aiPromptTemplate: true } });
  for (const row of paths) {
    const desc = typeof row.description === 'string' ? row.description : '';
    if (!desc || !THIRD_PERSON_MARKERS.test(desc)) continue;
    const summaryText = parseTemplateSummary(row.aiPromptTemplate);
    if (!summaryText || THIRD_PERSON_MARKERS.test(summaryText)) continue;
    summary.pathDescriptionThirdPerson += 1;
    if (summary.samples.length < 12) summary.samples.push(`path.description ${row.id}: ${desc.slice(0, 40)}… → ${summaryText.slice(0, 40)}…`);
    if (apply) await prisma.learning_paths.update({ where: { id: row.id }, data: { description: summaryText } });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error('[fix-user-facing-text] 失败：', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
