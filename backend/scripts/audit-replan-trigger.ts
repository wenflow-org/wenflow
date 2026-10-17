#!/usr/bin/env node
/**
 * 完课建议（replan）触发率拆解（#57，只读）
 *
 * 目的：把「触发率极低」拆成两件事——
 *  ① 建议有没有被生成（teaching_sessions.advisory 的 recommendation/reasonCodes 分布）；
 *  ② 生成了有没有被执行（learning_paths.aiPromptTemplate 里的 replanSnapshots）。
 * 同时暴露 deadline 锚的真伪：deadlineText 说「未明确」却落了 deadline 的行就是凭空硬锚。
 *
 * 用法：cd backend && npx ts-node --transpile-only scripts/audit-replan-trigger.ts [--json]
 */
import prisma from '../src/config/database';
import { isDeadlineExplicitlyUnspecified } from '../src/services/learning/deadline-text';

const AS_JSON = process.argv.includes('--json');

async function main() {
  const sessions = await prisma.teaching_sessions.findMany({
    where: { advisory: { not: null } },
    select: { id: true, advisory: true },
  });
  const recommendation = new Map<string, number>();
  const reasonCode = new Map<string, number>();
  let shouldSuggest = 0;
  for (const session of sessions) {
    let advisory: Record<string, unknown> | null = null;
    try { advisory = JSON.parse(String(session.advisory)); } catch { continue; }
    if (!advisory) continue;
    if (advisory.shouldSuggest === true) shouldSuggest += 1;
    const rec = String(advisory.recommendation ?? 'unknown');
    recommendation.set(rec, (recommendation.get(rec) || 0) + 1);
    for (const code of Array.isArray(advisory.reasonCodes) ? advisory.reasonCodes : []) {
      const key = String(code);
      reasonCode.set(key, (reasonCode.get(key) || 0) + 1);
    }
  }

  const paths = await prisma.learning_paths.findMany({
    select: { id: true, deadline: true, deadlineText: true, aiPromptTemplate: true },
  });
  let withDeadline = 0;
  let fabricatedDeadline = 0;
  let executedReplan = 0;
  for (const path of paths) {
    if (path.deadline) withDeadline += 1;
    if (path.deadline && isDeadlineExplicitlyUnspecified(String(path.deadlineText || ''))) fabricatedDeadline += 1;
    if (path.aiPromptTemplate && String(path.aiPromptTemplate).includes('replanSnapshots')) {
      try {
        const template = JSON.parse(String(path.aiPromptTemplate));
        const snapshots = Array.isArray(template?.replanSnapshots) ? template.replanSnapshots : [];
        if (snapshots.length > 0) executedReplan += 1;
      } catch { /* 模板损坏时跳过 */ }
    }
  }

  const result = {
    sessionsWithAdvisory: sessions.length,
    shouldSuggest,
    recommendation: Object.fromEntries(Array.from(recommendation.entries()).sort((a, b) => b[1] - a[1])),
    reasonCodes: Object.fromEntries(Array.from(reasonCode.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)),
    deadline: { paths: paths.length, withDeadline, fabricatedDeadline },
    executedReplanPaths: executedReplan,
  };
  if (AS_JSON) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`[replan-trigger] 带建议会话 ${result.sessionsWithAdvisory} 条（shouldSuggest ${shouldSuggest}）`);
    console.log('[replan-trigger] recommendation:', JSON.stringify(result.recommendation));
    console.log('[replan-trigger] reasonCodes(top10):', JSON.stringify(result.reasonCodes));
    console.log(`[replan-trigger] deadline：${withDeadline}/${paths.length} 条有值，其中凭空硬锚（文本自述未明确）${fabricatedDeadline} 条`);
    console.log(`[replan-trigger] 真正执行过重排的路径：${executedReplan} 条`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[replan-trigger] 失败：', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
