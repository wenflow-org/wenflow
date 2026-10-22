/* eslint-disable no-console -- 只读运营报表：输出走 stdout */
/**
 * 历史 pathReview 缺口盘点（只读，2026-10-22 审计 P1-1 后续）。
 *
 * 决策：301 条修复前生成的路径不自动重跑评审。pathReview 是生成期 LLM 质检快照，
 * 重跑会改写已交付路径的生成元数据且成本高；本脚本只把缺口按状态摊开，供运营决定
 * 是否对单条路径另行复评。
 */
import 'dotenv/config';
import prisma from '../config/database';

function parseJson(raw: unknown): { pathReview?: unknown } | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value as { pathReview?: unknown } : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const paths = await prisma.learning_paths.findMany({
    select: { id: true, status: true, aiPromptTemplate: true },
  });

  const byStatus: Record<string, { total: number; reviewed: number; missing: number }> = {};
  const missingIds: string[] = [];
  for (const path of paths) {
    const status = path.status || 'unknown';
    const bucket = byStatus[status] || { total: 0, reviewed: 0, missing: 0 };
    bucket.total += 1;
    const template = parseJson(path.aiPromptTemplate);
    if (template?.pathReview) {
      bucket.reviewed += 1;
    } else {
      bucket.missing += 1;
      missingIds.push(path.id);
    }
    byStatus[status] = bucket;
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    decision: 'legacy pathReview 不回填；新生成路径由修复后的 path-reviewer 写入',
    totals: {
      paths: paths.length,
      reviewed: paths.length - missingIds.length,
      missing: missingIds.length,
    },
    byStatus,
    missingSample: missingIds.slice(0, 20),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[audit-path-review-backlog] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
