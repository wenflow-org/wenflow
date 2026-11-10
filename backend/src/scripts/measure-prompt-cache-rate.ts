/* eslint-disable no-console -- 一次性量测 CLI */
/**
 * 提示词前缀缓存命中率量测（2026-09-25 训练局配套；2026-11-08 口径修正）。
 *
 * 口径（重要）：
 *   promptCacheHitTokens 由上游回传；但 **promptCacheMissTokens 大量为 NULL**
 *   （DeepSeek 新版只回 prompt_tokens_details.cached_tokens，不回 uncached_tokens；
 *   实测 2305/3675 行为 NULL）。旧版按 hit/(hit+miss) 计算时 NULL 被当 0，
 *   分母塌成 hit，命中率虚报成 100%（例如 learning-predictor 曾显示 100%）。
 *
 *   故本脚本一律用 **promptTokens 作分母**：cacheRate = hit / promptTokens。
 *   并额外给出两个可指导优化的指标：
 *     - 预热命中率 = 命中调用的 hit / 命中调用的 promptTokens
 *       （≈ 1 - 每轮新增尾部占比；这是「提示词结构还能不能优化」的判据）
 *     - 全 miss 占比 = hit=0 的调用比例（= 冷启动/多通道回声，属基础设施层）
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/measure-prompt-cache-rate.ts [--userId=xxx] [--sinceMin=180]
 */
import prisma from '../config/database';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

interface Bucket {
  hit: number;
  miss: number;
  prompt: number;
  calls: number;
  fullMiss: number;
  warmHit: number;
  warmPrompt: number;
  ttftSum: number;
  ttftN: number;
}

function emptyBucket(): Bucket {
  return { hit: 0, miss: 0, prompt: 0, calls: 0, fullMiss: 0, warmHit: 0, warmPrompt: 0, ttftSum: 0, ttftN: 0 };
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

  const byAgent = new Map<string, Bucket>();
  for (const r of rows) {
    const key = agentOf(r.promptCallId);
    const b = byAgent.get(key) || emptyBucket();
    const hit = r.promptCacheHitTokens ?? 0;
    // 分母用上游回传的 promptTokens（miss 字段缺失时唯一可靠的总量口径）
    const prompt = r.promptTokens ?? ((r.promptCacheHitTokens ?? 0) + (r.promptCacheMissTokens ?? 0));
    b.hit += hit;
    b.miss += r.promptCacheMissTokens ?? Math.max(0, prompt - hit);
    b.prompt += prompt;
    b.calls += 1;
    if (hit === 0) b.fullMiss += 1;
    else { b.warmHit += hit; b.warmPrompt += prompt; }
    if (typeof r.ttftMs === 'number') { b.ttftSum += r.ttftMs; b.ttftN += 1; }
    byAgent.set(key, b);
  }

  const pct = (num: number, den: number): string => (den > 0 ? ((num / den) * 100).toFixed(1) + '%' : '-');

  const lines: string[] = [];
  lines.push(`窗口: 最近 ${sinceMin} 分钟${userId ? ` | 用户 ${userId}` : ' | 全局'} | 样本 ${rows.length} 次调用`);
  lines.push('');
  lines.push(
    'skill/agent'.padEnd(34) + 'calls'.padEnd(7) + '命中率'.padEnd(9) + '预热命中率'.padEnd(11)
    + '全miss占比'.padEnd(11) + '均TTFT',
  );
  let totalHit = 0;
  let totalPrompt = 0;
  let totalWarmHit = 0;
  let totalWarmPrompt = 0;
  let totalCalls = 0;
  let totalFullMiss = 0;
  const sorted = [...byAgent.entries()].sort((a, b) => b[1].prompt - a[1].prompt);
  for (const [agentId, b] of sorted) {
    const ttft = b.ttftN > 0 ? Math.round(b.ttftSum / b.ttftN) + 'ms' : '-';
    lines.push(
      agentId.slice(0, 32).padEnd(34)
      + String(b.calls).padEnd(7)
      + pct(b.hit, b.prompt).padEnd(9)
      + pct(b.warmHit, b.warmPrompt).padEnd(11)
      + pct(b.fullMiss, b.calls).padEnd(11)
      + ttft,
    );
    totalHit += b.hit;
    totalPrompt += b.prompt;
    totalWarmHit += b.warmHit;
    totalWarmPrompt += b.warmPrompt;
    totalCalls += b.calls;
    totalFullMiss += b.fullMiss;
  }
  lines.push('');
  lines.push(
    `合计 hit=${totalHit} prompt=${totalPrompt} 命中率=${pct(totalHit, totalPrompt)}`
    + `（预热命中率=${pct(totalWarmHit, totalWarmPrompt)}，全 miss 占比=${pct(totalFullMiss, totalCalls)}）`,
  );
  lines.push('口径：命中率=hit/promptTokens（miss 字段可为 NULL，不可作分母）；预热命中率=命中调用的 hit/promptTokens。');

  if (userId) {
    const trend: string[] = [];
    rows.forEach((r, i) => {
      const hit = r.promptCacheHitTokens ?? 0;
      const prompt = r.promptTokens ?? ((r.promptCacheHitTokens ?? 0) + (r.promptCacheMissTokens ?? 0));
      const t = r.startedAt ? new Date(r.startedAt).toISOString().slice(11, 19) : '--:--:--';
      const status = prompt === 0 ? 'no-cache' : hit > 0 ? 'HIT' : 'MISS';
      trend.push(`${String(i + 1).padStart(3)} ${t} ${agentOf(r.promptCallId).slice(0, 24).padEnd(24)} prompt=${String(prompt).padEnd(7)} hit=${String(hit).padEnd(6)} ${status}`);
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
