/* eslint-disable no-console -- 只读运营报表：输出走 stdout */
/**
 * P1-7 建议确认→执行漏斗（只读，2026-10-22 审计）。
 *
 * 口径：
 * - 生成：有 advisory 且 shouldSuggest=true 的课堂会话；
 * - 处置：advisory.learnerResponse.action（keep/later/preview/adopt）；
 * - 执行：learnerResponse.action=adopt 或路径上存在 replanReason（真重排已完成）。
 *
 * 只读出报告，不改任何数据。adopt 档从 2026-10-22 起由完课卡/学习状态页在 replan 成功后回写。
 */
import 'dotenv/config';
import prisma from '../config/database';

function parseJson(raw: unknown): Record<string, any> | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const [sessions, replannedPaths] = await Promise.all([
    prisma.teaching_sessions.findMany({
      where: { advisory: { not: null } },
      select: { id: true, status: true, advisory: true },
    }),
    prisma.learning_paths.findMany({
      where: { replanReason: { not: null } },
      select: { id: true, replanReason: true, replanTriggerSource: true },
    }),
  ]);

  const actions: Record<string, number> = {};
  let suggested = 0;
  let responded = 0;
  let adopted = 0;
  let unanswered = 0;
  for (const session of sessions) {
    const advisory = parseJson(session.advisory);
    if (advisory?.shouldSuggest !== true) continue;
    suggested += 1;
    const action = advisory?.learnerResponse?.action;
    if (!action) {
      unanswered += 1;
      continue;
    }
    responded += 1;
    actions[action] = (actions[action] || 0) + 1;
    if (action === 'adopt') adopted += 1;
  }

  const replanByTrigger: Record<string, number> = {};
  for (const path of replannedPaths) {
    const trigger = path.replanTriggerSource || 'unknown';
    replanByTrigger[trigger] = (replanByTrigger[trigger] || 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    advisories: {
      totalWithAdvisory: sessions.length,
      suggested,
      responded,
      unanswered,
      actions,
      adopted,
    },
    replans: {
      total: replannedPaths.length,
      byTrigger: replanByTrigger,
    },
    /* 执行档 = 明确 adopt 或已发生 replan；两者取并集会给出去重前上界，仅作运营参考。 */
    funnel: {
      suggested,
      responded,
      explicitAdopt: adopted,
      replanExecuted: replannedPaths.length,
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error('[audit-advisory-funnel] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
