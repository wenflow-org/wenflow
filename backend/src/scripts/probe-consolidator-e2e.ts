/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * concept-consolidator 端到端探针（审计 P1 §2.4 末条）。
 *
 * 实测失败画像（近 7 天 197 次）：44 CALLER_ABORTED（调用方取消，非提示词缺陷）、
 * 42 `response does not contain valid JSON object`、10 契约缺字段（merges/ambiguous 必填）。
 * 后两类与 D1/D3 同类，故同样修：补 onValidationFail 纠偏（此前只有 maxAttempts，
 * 重试等于把同样的 prompt 再发一遍）+ coerceParse 把缺失的数组字段收敛为 []。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-consolidator-e2e.ts [--runs=2]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { auxSkillDefinitionMap, executeSkill } from '../skills';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const CANDIDATES = [
  { conceptKey: '离开前翻页立好', label: '离开前翻页立好' },
  { conceptKey: '离开前翻页立好：动作先于评价', label: '离开前翻页立好：动作先于评价' },
  { conceptKey: '回来后的第一眼第一手交给已翻开的书', label: '回来后的第一眼第一手交给已翻开的书' },
  { conceptKey: '回来后第一手落到哪里', label: '回来后第一手落到哪里' },
  { conceptKey: 'CAP 定理', label: 'CAP 定理' },
];

async function stats(): Promise<string> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await prisma.prompt_call_logs.groupBy({
    by: ['errorCode'],
    where: { agentId: 'skill:concept-consolidator', success: false, createdAt: { gte: since } },
    _count: { _all: true },
  });
  return rows.map((r) => `${r.errorCode}×${r._count._all}`).join(' | ') || '(无失败)';
}

async function main() {
  const runs = Math.max(1, Number(arg('runs') || 2));
  console.log('[probe] 调用前（近 7 天失败）：', await stats());

  const def = (auxSkillDefinitionMap as any)['concept-consolidator'];
  if (!def) throw new Error('找不到 concept-consolidator 定义');

  let ok = 0;
  for (let i = 0; i < runs; i += 1) {
    const startedAt = new Date();
    try {
      const result: any = await executeSkill(def, { candidates: CANDIDATES } as any);
      const out = result?.output || result;
      ok += 1;
      console.log(`[probe] #${i + 1} 成功 | merges=${JSON.stringify(out?.merges?.length ?? null)} ambiguous=${JSON.stringify(out?.ambiguous?.length ?? null)} dropCandidates=${JSON.stringify(out?.dropCandidates?.length ?? null)}`);
    } catch (error) {
      console.log(`[probe] #${i + 1} 失败 | ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
    const rows = await prisma.prompt_call_logs.findMany({
      where: { agentId: 'skill:concept-consolidator', createdAt: { gte: startedAt } },
      select: { success: true, errorMessage: true, promptAttemptCount: true },
    });
    for (const row of rows) {
      console.log(`[probe]   本次日志：success=${row.success} attempts=${row.promptAttemptCount}${row.errorMessage ? ` err=${row.errorMessage}` : ''}`);
    }
  }

  console.log('[probe] 调用后（近 7 天失败）：', await stats());
  console.log(ok === runs ? '[probe] PASS 全部成功产出' : `[probe] CHECK ${ok}/${runs}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
