/**
 * Skill 延迟回看（**只读**，不调 LLM、不写库）
 *
 * 用途（走查 P11）：教学单轮体感 30–50s，但"慢在哪一段"此前只能靠感觉。
 * `agent_call_logs.durationMs` 已按 skill 留痕，这里按 skill 出分位数，
 * 用来回答：是 teaching-turn 本身慢，还是被 aux skill（state-review / consolidator /
 * concept-load 等）拖慢，还是被重试放大。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-skill-latency.ts [--days=7] [--user=<id>] [--top=15] [--json]
 */
import 'dotenv/config';
import prisma from '../config/database';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main() {
  const days = Number(arg('days') ?? 7);
  const userId = arg('user');
  const top = Number(arg('top') ?? 15);
  const asJson = process.argv.includes('--json');

  const since = new Date(Date.now() - (Number.isFinite(days) && days > 0 ? days : 7) * 86400000);

  const rows = await prisma.agent_call_logs.findMany({
    where: {
      calledAt: { gte: since },
      ...(userId ? { userId } : {}),
    },
    select: { agentId: true, durationMs: true, success: true },
    take: 20000,
  });

  const bySkill = new Map<string, { durations: number[]; failures: number }>();
  for (const r of rows) {
    if (r.durationMs === null || r.durationMs === undefined) continue;
    const key = r.agentId || '(unknown)';
    const entry = bySkill.get(key) ?? { durations: [], failures: 0 };
    entry.durations.push(Number(r.durationMs) || 0);
    if (r.success === false) entry.failures += 1;
    bySkill.set(key, entry);
  }

  const stats = [...bySkill.entries()]
    .map(([skill, v]) => {
      const sorted = [...v.durations].sort((a, b) => a - b);
      return {
        skill,
        calls: sorted.length,
        failures: v.failures,
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1] ?? 0,
      };
    })
    .sort((a, b) => b.p90 - a.p90)
    .slice(0, Number.isFinite(top) && top > 0 ? top : 15);

  if (asJson) {
    console.log(JSON.stringify({ since: since.toISOString(), userId: userId ?? '(全部用户)', skills: stats }, null, 2));
    return;
  }

  console.log(`== Skill 延迟回看（近 ${days} 天${userId ? ` · ${userId}` : ''}）==`);
  console.log(`按 p90 排序（毫秒）｜样本 ${rows.length} 次调用`);
  console.log('skill'.padEnd(42) + 'calls'.padStart(7) + 'p50'.padStart(9) + 'p90'.padStart(9) + 'p99'.padStart(9) + 'max'.padStart(9) + 'fail'.padStart(6));
  for (const s of stats) {
    console.log(
      s.skill.padEnd(42)
      + String(s.calls).padStart(7)
      + String(s.p50).padStart(9)
      + String(s.p90).padStart(9)
      + String(s.p99).padStart(9)
      + String(s.max).padStart(9)
      + String(s.failures).padStart(6)
    );
  }
  console.log('提示：单轮体感 ≈ 该轮串行调用的 skill 之和（aux skill 与 teaching-turn 同回合触发）。');
}

main()
  .catch((error) => {
    console.error('[audit-skill-latency] 失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
