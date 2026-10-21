/**
 * FSRS 复习校准审计（#104）：预测保持率 vs 实测复习结果（只读、零 LLM、不写库）
 *
 * 数据来源（两条预测通道，均取**复习发生前**的预测值）：
 *  1. 复习课（mode=review）：开课时 `sessionArtifacts.initialKnowledgeState` 里的到期点
 *     （status='review'，progress=round(预测保持率×100)）；
 *  2. 日常课课内温故：`sessionArtifacts.memoryWarmup.items[].retention`（0-1）。
 * 实测来源：`learner_evidence(type='review:completed')` 的 payload
 *   { conceptKey, rating: again|hard|good|easy, status, elapsedDays }（ReviewCompletedConsumer 落库）。
 *
 * 口径：
 *  - 实测值（回忆成功度）：easy/good=1、hard=0.5、again=0（与 FSRS 成绩档的二分倾向一致；
 *    hard 给半分为刻度保留，不把"勉强想起"当完整成功也不当失败）；
 *  - 比值 = 实测均值 / 预测均值；#104 判据：比值偏离 1 超过 0.2，或任一预测箱的
 *    |实测均值 − 预测均值| > 0.15 → 偏离；
 *  - 校准曲线：预测分箱 [0,0.2)...[0.8,1.0]，逐箱给 n / 预测均值 / 实测均值 / 偏差；
 *  - 样本量：<200 对只登记（"样本不足"），≥200 才给"可用/偏离"结论；
 *    #104 目标规模为千级（含 failed 象限）。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-review-calibration.ts
 *   npx ts-node --transpile-only src/scripts/audit-review-calibration.ts --days=90 --json
 *   npx ts-node --transpile-only src/scripts/audit-review-calibration.ts --user=<userId>
 */
import 'dotenv/config';
import prisma from '../config/database';

interface CliOptions {
  days: number;
  userId: string | null;
  json: boolean;
  minPairs: number;
}

interface PredictionSource {
  sessionId: string;
  userId: string;
  mode: string;
  createdAt: Date;
  predicted: Map<string, number>;
  source: 'review-seed' | 'warmup' | 'mixed';
}

interface CalibrationPair {
  sessionId: string;
  userId: string;
  conceptKey: string;
  predicted: number;
  actual: number;
  rating: string;
  elapsedDays: number | null;
  source: string;
}

const ACTUAL_BY_RATING: Record<string, number> = {
  again: 0,
  hard: 0.5,
  good: 1,
  easy: 1,
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { days: 30, userId: null, json: false, minPairs: 200 };
  for (const arg of argv) {
    if (arg.startsWith('--days=')) {
      const value = Number(arg.slice(7));
      if (!Number.isFinite(value) || value <= 0) throw new Error('--days 必须是正数');
      opts.days = value;
      continue;
    }
    if (arg.startsWith('--user=')) {
      opts.userId = arg.slice(7).trim() || null;
      continue;
    }
    if (arg.startsWith('--min-pairs=')) {
      const value = Number(arg.slice(12));
      if (!Number.isFinite(value) || value <= 0) throw new Error('--min-pairs 必须是正数');
      opts.minPairs = value;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('用法：audit-review-calibration.ts [--days=30] [--user=<id>] [--min-pairs=200] [--json]');
      process.exit(0);
    }
    throw new Error(`未知参数：${arg}`);
  }
  return opts;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 从教学会话状态里抽「复习前预测」。纯函数，供单测/复用。 */
export function extractPredictions(session: {
  id: string;
  userId: string;
  mode: string | null;
  createdAt: Date;
  teachingState: unknown;
}): PredictionSource | null {
  const teachingState = asRecord(session.teachingState);
  const artifacts = asRecord(teachingState?.sessionArtifacts);
  if (!artifacts) return null;
  const predicted = new Map<string, number>();
  let sawReviewSeed = false;
  let sawWarmup = false;

  for (const raw of asArray(artifacts.initialKnowledgeState)) {
    const item = asRecord(raw);
    if (!item || item.status !== 'review') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const progress = Number(item.progress);
    if (!name || !Number.isFinite(progress)) continue;
    predicted.set(name, clamp01(progress / 100));
    sawReviewSeed = true;
  }

  const warmup = asRecord(artifacts.memoryWarmup);
  for (const raw of asArray(warmup?.items)) {
    const item = asRecord(raw);
    const key = typeof item?.conceptKey === 'string' ? item.conceptKey.trim() : '';
    const retention = Number(item?.retention);
    if (!key || !Number.isFinite(retention)) continue;
    predicted.set(key, clamp01(retention));
    sawWarmup = true;
  }

  if (predicted.size === 0) return null;
  return {
    sessionId: session.id,
    userId: session.userId,
    mode: session.mode || 'tutor',
    createdAt: session.createdAt,
    predicted,
    source: sawReviewSeed && sawWarmup ? 'mixed' : sawReviewSeed ? 'review-seed' : 'warmup',
  };
}

interface BucketRow {
  label: string;
  n: number;
  predictedMean: number;
  actualMean: number;
  deviation: number;
}

export function bucketPairs(pairs: CalibrationPair[], bucketCount = 5): BucketRow[] {
  const rows: BucketRow[] = [];
  for (let i = 0; i < bucketCount; i += 1) {
    const low = i / bucketCount;
    const high = (i + 1) / bucketCount;
    const bucket = pairs.filter((pair) => {
      if (i === bucketCount - 1) return pair.predicted >= low && pair.predicted <= high;
      return pair.predicted >= low && pair.predicted < high;
    });
    if (bucket.length === 0) {
      rows.push({ label: `[${low.toFixed(1)},${high.toFixed(1)})`, n: 0, predictedMean: 0, actualMean: 0, deviation: 0 });
      continue;
    }
    const predictedMean = bucket.reduce((sum, pair) => sum + pair.predicted, 0) / bucket.length;
    const actualMean = bucket.reduce((sum, pair) => sum + pair.actual, 0) / bucket.length;
    rows.push({
      label: `[${low.toFixed(1)},${high.toFixed(1)})`,
      n: bucket.length,
      predictedMean,
      actualMean,
      deviation: actualMean - predictedMean,
    });
  }
  return rows;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);

  const sessions = await prisma.teaching_sessions.findMany({
    where: {
      createdAt: { gte: since },
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    select: { id: true, userId: true, mode: true, createdAt: true, teachingState: true },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  const predictions: PredictionSource[] = [];
  for (const session of sessions) {
    const extracted = extractPredictions(session as Parameters<typeof extractPredictions>[0]);
    if (extracted) predictions.push(extracted);
  }
  const predictionBySession = new Map(predictions.map((item) => [item.sessionId, item]));

  const evidence = predictionBySession.size === 0
    ? []
    : await prisma.learner_evidence.findMany({
        where: {
          evidenceType: 'review:completed',
          sessionId: { in: Array.from(predictionBySession.keys()) },
          occurredAt: { gte: since },
        },
        select: { sessionId: true, payload: true },
      });

  const pairs: CalibrationPair[] = [];
  let evidenceRows = 0;
  let unpredicted = 0;
  for (const row of evidence) {
    evidenceRows += 1;
    const payload = asRecord(row.payload);
    const source = row.sessionId ? predictionBySession.get(row.sessionId) : undefined;
    const conceptKey = typeof payload?.conceptKey === 'string' ? payload.conceptKey.trim() : '';
    if (!source || !conceptKey) {
      unpredicted += 1;
      continue;
    }
    const predicted = source.predicted.get(conceptKey);
    const rating = typeof payload?.rating === 'string' ? payload.rating : '';
    const actual = ACTUAL_BY_RATING[rating];
    if (predicted === undefined || actual === undefined) {
      unpredicted += 1;
      continue;
    }
    const elapsed = Number(payload?.elapsedDays);
    pairs.push({
      sessionId: source.sessionId,
      userId: source.userId,
      conceptKey,
      predicted,
      actual,
      rating,
      elapsedDays: Number.isFinite(elapsed) ? elapsed : null,
      source: source.source,
    });
  }

  const buckets = bucketPairs(pairs);
  const predictedMean = pairs.length > 0 ? pairs.reduce((sum, pair) => sum + pair.predicted, 0) / pairs.length : 0;
  const actualMean = pairs.length > 0 ? pairs.reduce((sum, pair) => sum + pair.actual, 0) / pairs.length : 0;
  const ratio = predictedMean > 0 ? actualMean / predictedMean : null;
  const ratioDeviation = ratio === null ? null : Math.abs(ratio - 1);
  const maxBucketDeviation = buckets.reduce((max, row) => (row.n > 0 ? Math.max(max, Math.abs(row.deviation)) : max), 0);
  const ratioDeviationExceeded = ratioDeviation !== null && ratioDeviation > 0.2;
  const bucketDeviationExceeded = maxBucketDeviation > 0.15;
  const sampleSufficient = pairs.length >= opts.minPairs;
  const verdict = !sampleSufficient
    ? '样本不足（只登记，不裁决）'
    : ratioDeviationExceeded || bucketDeviationExceeded
      ? '偏离（比值偏离 1 > 0.2 或某箱偏差 > 0.15）'
      : '可用（未越界）';

  const ratingCounts: Record<string, number> = {};
  for (const pair of pairs) ratingCounts[pair.rating] = (ratingCounts[pair.rating] || 0) + 1;

  const result = {
    windowDays: opts.days,
    sessionsScanned: sessions.length,
    sessionsWithPredictions: predictions.length,
    predictionSources: {
      reviewSeed: predictions.filter((item) => item.source === 'review-seed' || item.source === 'mixed').length,
      warmup: predictions.filter((item) => item.source === 'warmup' || item.source === 'mixed').length,
    },
    evidenceRows,
    pairs: pairs.length,
    unpredictedEvidence: unpredicted,
    ratings: ratingCounts,
    predictedMean,
    actualMean,
    ratio,
    ratioDeviation,
    buckets,
    maxBucketDeviation,
    sampleSufficient,
    minPairs: opts.minPairs,
    verdict,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`FSRS 复习校准（#104）｜窗口 ${opts.days} 天${opts.userId ? `｜用户 ${opts.userId}` : ''}`);
  console.log(`  扫描教学会话 ${sessions.length}｜带预测 ${predictions.length}（复习课 ${result.predictionSources.reviewSeed} / 温故 ${result.predictionSources.warmup}）`);
  console.log(`  复习证据 ${evidenceRows} 行｜成对 ${pairs.length} 对｜无法配对 ${unpredicted} 行`);
  console.log(`  成绩分布：${Object.entries(ratingCounts).map(([key, value]) => `${key}=${value}`).join(' ｜ ') || '无'}`);
  if (pairs.length > 0) {
    console.log(`  总览：预测均值 ${predictedMean.toFixed(3)} ｜ 实测均值 ${actualMean.toFixed(3)} ｜ 比值 ${ratio?.toFixed(3)}（偏离 ${ratioDeviation?.toFixed(3)}）`);
    console.log('  校准曲线：');
    for (const row of buckets) {
      if (row.n === 0) { console.log(`    ${row.label}  n=0`); continue; }
      const flag = Math.abs(row.deviation) > 0.15 ? '  ⚠' : '';
      console.log(`    ${row.label}  n=${String(row.n).padStart(4)}  预测 ${row.predictedMean.toFixed(3)}  实测 ${row.actualMean.toFixed(3)}  偏差 ${row.deviation >= 0 ? '+' : ''}${row.deviation.toFixed(3)}${flag}`);
    }
  } else {
    console.log('  无可配对样本：复习课/温故的预测或 review:completed 证据不足。');
  }
  console.log(`  判定：${verdict}（样本门槛 ${opts.minPairs} 对）`);
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error('审计失败：', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => undefined);
    });
}
