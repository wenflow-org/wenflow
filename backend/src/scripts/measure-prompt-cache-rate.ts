/* eslint-disable no-console -- 一次性量测 CLI */
/**
 * 提示词前缀缓存命中率量测（2026-09-25 训练局配套）。
 *
 * 口径：llm_execution_attempts.promptCacheHitTokens /(hit+miss)（DeepSeek 自动前缀缓存），
 * 按 skill/agent 聚合（身份在 metadata JSON：skillId || agentId）；可按用户/时间窗过滤，
 * 并输出逐次调用序列，看冷启动（第 1 次 miss）→ 稳定期（hit 稳定）的走势。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/measure-prompt-cache-rate.ts [--userId=xxx] [--sinceMin=180]
 */
import prisma from '../config/database';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main(): Promise<void> {
  const userId = arg('userId');
  const sinceMin = Number(arg('sinceMin') || '180');
  const since = new Date(Date.now() - sinceMin * 60 * 1000);

  const where: Record<string, unknown> = { startedAt: { gte: since } };
  if (userId) where.userId = userId;

  const rows = await prisma.llm_execution_attempts.findMany({
    where,
    select: {
      promptCallId: true,
      promptCacheHitTokens: true,
      promptCacheMissTokens: true,
      promptTokens: true,
      ttftMs: true,
      startedAt: true,
    },
    orderBy: { startedAt: 'asc' },
    take: 10000,
  });

  // 身份在 prompt_call_logs（attempts.metadata 只有请求参数）：promptCallId → agentId
  const callIds = [...new Set(rows.map((r) => r.promptCallId).filter(Boolean))] as string[];
  const agentByCallId = new Map<string, string>();
  for (let i = 0; i < callIds.length; i += 200) {
    const batch = callIds.slice(i, i + 200);
    const logs = await prisma.prompt_call_logs.findMany({
      where: { id: { in: batch } },
      select: { id: true, agentId: true },
    });
    for (const l of logs) agentByCallId.set(l.id, l.agentId);
  }
  const agentOf = (promptCallId: string | null): string =>
    (promptCallId && agentByCallId.get(promptCallId)) || '(unjoined)';

  const byAgent = new Map<string, { hit: number; miss: number; calls: number; ttftSum: number; ttftN: number }>();
  for (const r of rows) {
    const key = agentOf(r.promptCallId);
    const bucket = byAgent.get(key) || { hit: 0, miss: 0, calls: 0, ttftSum: 0, ttftN: 0 };
    bucket.hit += r.promptCacheHitTokens ?? 0;
    bucket.miss += r.promptCacheMissTokens ?? 0;
    bucket.calls += 1;
    if (typeof r.ttftMs === 'number') { bucket.ttftSum += r.ttftMs; bucket.ttftN += 1; }
    byAgent.set(key, bucket);
  }

  const lines: string[] = [];
  lines.push(`窗口: 最近 ${sinceMin} 分钟${userId ? ` | 用户 ${userId}` : ' | 全局'} | 样本 ${rows.length} 次调用`);
  lines.push('');
  lines.push('skill/agent'.padEnd(36) + 'calls'.padEnd(7) + 'hit'.padEnd(10) + 'miss'.padEnd(10) + '命中率'.padEnd(9) + '均TTFT');
  let totalHit = 0;
  let totalMiss = 0;
  const sorted = [...byAgent.entries()].sort((a, b) => (b[1].hit + b[1].miss) - (a[1].hit + a[1].miss));
  for (const [agentId, b] of sorted) {
    const total = b.hit + b.miss;
    const rate = total > 0 ? ((b.hit / total) * 100).toFixed(1) + '%' : '-';
    const ttft = b.ttftN > 0 ? Math.round(b.ttftSum / b.ttftN) + 'ms' : '-';
    lines.push(agentId.slice(0, 34).padEnd(36) + String(b.calls).padEnd(7) + String(b.hit).padEnd(10) + String(b.miss).padEnd(10) + rate.padEnd(9) + ttft);
    totalHit += b.hit;
    totalMiss += b.miss;
  }
  const grand = totalHit + totalMiss;
  lines.push('');
  lines.push(`合计 hit=${totalHit} miss=${totalMiss} 命中率=${grand > 0 ? ((totalHit / grand) * 100).toFixed(1) + '%' : '-'}`);

  if (userId) {
    const trend: string[] = [];
    rows.forEach((r, i) => {
      const hit = r.promptCacheHitTokens ?? 0;
      const miss = r.promptCacheMissTokens ?? 0;
      const t = r.startedAt ? new Date(r.startedAt).toISOString().slice(11, 19) : '--:--:--';
      const status = hit + miss === 0 ? 'no-cache' : hit > 0 ? 'HIT' : 'MISS';
      trend.push(`${String(i + 1).padStart(3)} ${t} ${agentOf(r.promptCallId).slice(0, 24).padEnd(24)} hit=${String(hit).padEnd(6)} miss=${String(miss).padEnd(6)} ${status}`);
    });
    lines.push('\n--- 逐次调用 ---');
    lines.push(...trend);
  }

  console.log(lines.join('\n'));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
