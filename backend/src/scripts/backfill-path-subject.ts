/**
 * 数据回填：修正 learning_paths.subject 被写成目标原文的历史数据。
 *
 * 背景：path-planning 的 analyzeInput 用 `input.goal` 当 subject，导致 learning_paths.subject
 * 常被存成几百字目标原文，污染教学 prompt 的 subject、管理端内容列表，以及 Dashboard
 * 路径卡副标题（V2Dashboard 无 deadlineText 时用 p.subject）。
 *
 * 规则（与 learning.service persistGeneratedPath 同源，用 learning.helpers.resolvePathSubject）：
 *   subject 简洁（<= 24 字）→ 原样保留；否则用清洗后的路径名（title/name）兜底。
 * 仅改 subject，不动 updatedAt（避免用户列表按更新时间重排）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/backfill-path-subject.ts --dry-run   # 只统计（推荐先跑）
 *   npx ts-node --transpile-only src/scripts/backfill-path-subject.ts             # 实际回填
 */
import 'dotenv/config';
import prisma from '../config/database';
import { cleanPathTitle, resolvePathSubject } from '../services/learning/learning.helpers';

export interface BackfillPathSubjectArgs {
  dryRun: boolean;
}

export function parseBackfillPathSubjectArgs(argv: string[]): BackfillPathSubjectArgs {
  const args: BackfillPathSubjectArgs = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const { dryRun } = parseBackfillPathSubjectArgs(process.argv.slice(2));

  const paths = await prisma.learning_paths.findMany({
    select: { id: true, title: true, name: true, subject: true },
  });

  let changed = 0;
  let skipped = 0;
  const preview: string[] = [];

  for (const path of paths) {
    const title = (path.title || path.name || '').trim() || '个性化学习路径';
    const nextSubject = resolvePathSubject(path.subject, cleanPathTitle(title));
    const currentSubject = path.subject || '';
    if (nextSubject === currentSubject) {
      skipped += 1;
      continue;
    }
    changed += 1;
    if (preview.length < 15) {
      preview.push(
        `${path.id}：${currentSubject.length} 字 → 「${nextSubject}」`
      );
    }
    if (!dryRun) {
      await prisma.learning_paths.update({
        where: { id: path.id },
        data: { subject: nextSubject },
      });
    }
  }

  console.log(
    `[backfill-path-subject] mode=${dryRun ? 'dry-run（只统计，未写库）' : 'apply'}` +
    ` total=${paths.length} changed=${changed} unchanged=${skipped}`
  );
  if (preview.length > 0) {
    console.log('[backfill-path-subject] 变更样例：');
    for (const line of preview) console.log(`  ${line}`);
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
