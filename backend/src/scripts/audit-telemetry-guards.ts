/**
 * 遥测护栏（#83 P-59）：把「看不见的退化」变成可判定的退出码。
 *
 * 两条判据（PROMPT_CACHE_OPTIMIZATION.md §4.3 / BACKLOG §8）：
 * 1. `finishReason='length'`：输出被 maxTokens 截断（退化信号的直接证据）；
 * 2. 缓存遥测自相矛盾：`promptCacheMissTokens=0 && promptCacheHitTokens>0`，但
 *    `promptTokens - promptCacheHitTokens > 1000`——既然有 1000+ token 既不算命中也不算未命中，
 *    说明上游/网关的回传字段不可信，缓存命中率读数是假健康。
 *
 * 用法：npm run telemetry:guards [-- --hours 24] [-- --limit 20]
 * 退出码：0 = 窗口内零命中；1 = 有命中（打印样本，接 CI/巡检即可报警）。
 */
import prisma from '../config/database';

interface AttemptRow {
  id: string;
  traceId: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  finishReason: string | null;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
  startedAt: Date;
}

function argValue(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const hours = argValue('hours', 24);
  const limit = argValue('limit', 20);
  const since = new Date(Date.now() - hours * 3600_000);

  const attempts = await prisma.llm_execution_attempts.findMany({
    where: { startedAt: { gte: since } },
    select: {
      id: true,
      traceId: true,
      requestedModel: true,
      resolvedModel: true,
      promptTokens: true,
      completionTokens: true,
      finishReason: true,
      promptCacheHitTokens: true,
      promptCacheMissTokens: true,
      startedAt: true,
    },
    orderBy: { startedAt: 'desc' },
  }) as AttemptRow[];

  const truncated = attempts.filter((row) => row.finishReason === 'length');
  const suspiciousCache = attempts.filter((row) => {
    const hit = row.promptCacheHitTokens ?? 0;
    const miss = row.promptCacheMissTokens ?? 0;
    const prompt = row.promptTokens ?? 0;
    return hit > 0 && miss === 0 && prompt - hit > 1000;
  });

  const sample = (rows: AttemptRow[]) => rows.slice(0, limit).map((row) => ({
    id: row.id,
    traceId: row.traceId,
    model: row.resolvedModel || row.requestedModel,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    finishReason: row.finishReason,
    startedAt: row.startedAt.toISOString(),
  }));

  const report = {
    windowHours: hours,
    scanned: attempts.length,
    guards: {
      lengthTruncated: { count: truncated.length, sample: sample(truncated) },
      cacheTelemetryContradiction: { count: suspiciousCache.length, sample: sample(suspiciousCache) },
    },
  };
  console.log(JSON.stringify(report, null, 2));

  if (truncated.length > 0 || suspiciousCache.length > 0) {
    console.error(
      `[telemetry:guards] 命中退化信号：length 截断 ${truncated.length} 条，缓存遥测矛盾 ${suspiciousCache.length} 条`,
    );
    process.exitCode = 1;
  } else {
    console.log('[telemetry:guards] OK：窗口内无 length 截断、无缓存遥测矛盾');
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[telemetry:guards] 执行失败', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 2;
});
