#!/usr/bin/env node
/**
 * 内容正确性最小闭环（#47）命令行：**抽样 / 人工标注 / 指标**，只读 + 一条写入口（标注）。
 *
 * 设计意图（见 backend/src/services/ai-teaching/content-correctness.ts 头注释）：
 * 第一版不做自动拦截、不做 LLM 自评（自证回路），只把「教师讲错」这件事变成可观测：
 *   ① `--sample`  按确定性哈希从窗口内的教师回合里抽样（同一条消息每次结论一致）；
 *   ② `--label`   人工看过后写一条标注（落 learner_evidence，可覆盖改判）；
 *   ③ `--metrics` 算检出率（错/已标注）与覆盖率（已标注/抽中），未标注时错误率给 null。
 *
 * 用法（cd backend）：
 *   npx ts-node --transpile-only scripts/content-correctness-review.ts --sample --days 7 --rate 0.05 --limit 40
 *   npx ts-node --transpile-only scripts/content-correctness-review.ts --sample --real-only --days 7 --rate 0.3
 *   npx ts-node --transpile-only scripts/content-correctness-review.ts --label 12345 --verdict incorrect --note "把信度说成效度"
 *   npx ts-node --transpile-only scripts/content-correctness-review.ts --metrics --days 7 --rate 0.05
 *
 * 说明：抽样源是消息侧表 `teaching_session_messages`（新会话权威）；只在旧 `messages`
 * 列里的老会话不参与抽样——那批会话的教师回合已在本次闭环上线前结束。
 */
import prisma from '../src/config/database';
import {
  CONTENT_REVIEW_EVIDENCE_KEY,
  CONTENT_REVIEW_EVIDENCE_TYPE,
  CONTENT_VERDICTS,
  collectSampledTurns,
  computeContentReviewMetrics,
  parseContentReviewLabel,
  serializeContentReviewLabel,
  type ContentReviewLabel,
  type ContentVerdict,
} from '../src/services/ai-teaching/content-correctness';

const args = process.argv.slice(2);

function argValue(name: string, fallback?: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return fallback;
  const value = args[idx + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

const AS_JSON = hasFlag('--json');
const WINDOW_DAYS = Number(argValue('--days', '7')) || 7;
const SAMPLE_RATE = (() => {
  const raw = argValue('--rate', '0.05');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.05;
})();
const LIMIT = Number(argValue('--limit', '40')) || 40;
/** 只抽真人会话（排掉虚拟学习者）——运营抽检的人力优先给真实课堂 */
const REAL_ONLY = hasFlag('--real-only');
const PER_SESSION_CAP = Number(argValue('--per-session', '6')) || 6;

/**
 * 拉取窗口内会话并抽样。计数由 `collectSampledTurns` 在**完整** sessions 上预计算
 * （#120：不随 `LIMIT` 提前结束变化）。
 */
async function collectWindowSample() {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);
  const sessions = await prisma.teaching_sessions.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, userId: true, taskId: true, users: { select: { isVirtualLearner: true } } },
    orderBy: { createdAt: 'desc' },
    take: 400,
  });
  return collectSampledTurns({
    sessions,
    loadMessages: (sessionId) =>
      prisma.teaching_session_messages.findMany({
        where: { sessionId },
        orderBy: { id: 'asc' },
        select: { id: true, payload: true },
      }),
    sampleRate: SAMPLE_RATE,
    limit: LIMIT,
    perSessionCap: PER_SESSION_CAP,
    realOnly: REAL_ONLY,
  });
}

function messageEventId(messageId: number | string): string {
  return `msg:${messageId}`;
}

async function runSample() {
  const { sampled, scannedSessions, realSessions, virtualSessions } = await collectWindowSample();
  if (AS_JSON) {
    console.log(
      JSON.stringify(
        { windowDays: WINDOW_DAYS, rate: SAMPLE_RATE, scannedSessions, realSessions, virtualSessions, realOnly: REAL_ONLY, sampled },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `[content-review] 抽样：窗口 ${WINDOW_DAYS} 天 / rate=${SAMPLE_RATE} / 扫描会话 ${scannedSessions}` +
      `（真人 ${realSessions} / 虚拟学习者 ${virtualSessions}${REAL_ONLY ? '，已按 --real-only 排除虚拟' : ''}） → 抽中 ${sampled.length} 条`,
  );
  for (const turn of sampled) {
    const single = turn.content.replace(/\s+/g, ' ');
    const snippet = single.slice(0, 90);
    console.log(`  #${turn.messageId}  session=${turn.sessionId}  user=${turn.userId}`);
    console.log(`    ${snippet}${single.length > 90 ? '…' : ''}`);
  }
  if (sampled.length) {
    console.log('\n标注示例：');
    console.log(
      `  npx ts-node --transpile-only scripts/content-correctness-review.ts --label ${sampled[0].messageId} --verdict incorrect --note "把A说成B"`,
    );
  }
}

async function runLabel() {
  const messageId = Number(argValue('--label'));
  const verdict = argValue('--verdict') as ContentVerdict | undefined;
  const note = argValue('--note');
  const reviewerUserId = argValue('--reviewer') ?? 'ops';
  if (!Number.isFinite(messageId)) {
    console.error('--label 需要一个消息 id（侧表自增 id，抽样输出里的 #N）');
    process.exit(2);
  }
  if (!verdict || !CONTENT_VERDICTS.includes(verdict)) {
    console.error(`--verdict 必须是 ${CONTENT_VERDICTS.join(' | ')}`);
    process.exit(2);
  }
  const row = await prisma.teaching_session_messages.findUnique({
    where: { id: messageId },
    select: { id: true, sessionId: true, payload: true },
  });
  if (!row) {
    console.error(`消息 ${messageId} 不存在（侧表）`);
    process.exit(2);
  }
  const session = await prisma.teaching_sessions.findUnique({
    where: { id: row.sessionId },
    select: { userId: true, taskId: true, learningPathId: true },
  });
  if (!session) {
    console.error(`消息 ${messageId} 对应的会话 ${row.sessionId} 不存在`);
    process.exit(2);
  }
  const label: ContentReviewLabel = {
    messageId,
    verdict,
    note,
    reviewerUserId,
    labeledAt: new Date().toISOString(),
  };
  await prisma.learner_evidence.upsert({
    where: { eventId_evidenceKey: { eventId: messageEventId(messageId), evidenceKey: CONTENT_REVIEW_EVIDENCE_KEY } },
    create: {
      id: `ev_content_${messageId}`,
      eventId: messageEventId(messageId),
      evidenceKey: CONTENT_REVIEW_EVIDENCE_KEY,
      userId: session.userId,
      pathId: session.learningPathId ?? null,
      taskId: session.taskId,
      sessionId: row.sessionId,
      evidenceType: CONTENT_REVIEW_EVIDENCE_TYPE,
      payload: serializeContentReviewLabel(label),
      confidence: 1,
      occurredAt: new Date(),
    },
    update: {
      payload: serializeContentReviewLabel(label),
      occurredAt: new Date(),
    },
  });
  console.log(`[content-review] 已记录：消息 #${messageId} → ${verdict}${note ? `（${note}）` : ''}`);
}

async function runMetrics() {
  const { sampled, scannedSessions, realSessions, virtualSessions } = await collectWindowSample();
  const ids = sampled.map((turn) => turn.messageId);
  const rows = ids.length
    ? await prisma.learner_evidence.findMany({
        where: {
          evidenceType: CONTENT_REVIEW_EVIDENCE_TYPE,
          eventId: { in: ids.map((id) => messageEventId(id)) },
        },
        select: { payload: true },
      })
    : [];
  const labels = rows
    .map((row) => parseContentReviewLabel(row.payload))
    .filter((label): label is ContentReviewLabel => Boolean(label));
  const metrics = computeContentReviewMetrics({ sampledIds: ids, labels });
  if (AS_JSON) {
    console.log(JSON.stringify({ windowDays: WINDOW_DAYS, rate: SAMPLE_RATE, ...metrics }, null, 2));
    return;
  }
  console.log(
    `[content-review] 指标（窗口 ${WINDOW_DAYS} 天 / rate=${SAMPLE_RATE} / 会话 ${scannedSessions}` +
      `（真人 ${realSessions} / 虚拟 ${virtualSessions}）${REAL_ONLY ? ' / --real-only' : ''}）`,
  );
  console.log(
    `  抽中 ${metrics.sampled} / 已标注 ${metrics.labeled}（覆盖率 ${(metrics.coverage * 100).toFixed(1)}%）`,
  );
  console.log(
    `  判错 ${metrics.incorrect} / 存疑 ${metrics.unsure} / 正确 ${metrics.correct} → 错误率 ${
      metrics.errorRate === null ? 'n/a（尚未标注）' : `${(metrics.errorRate * 100).toFixed(1)}%`
    }`,
  );
  if (metrics.outsideSample > 0) {
    console.log(`  注：${metrics.outsideSample} 条标注落在本次抽样集合之外（窗口漂移，不计入覆盖率）`);
  }
}

async function main() {
  if (hasFlag('--label')) {
    await runLabel();
  } else if (hasFlag('--metrics')) {
    await runMetrics();
  } else if (hasFlag('--sample')) {
    await runSample();
  } else {
    console.error('用法：--sample [--days N --rate R --limit N] | --label <id> --verdict <v> [--note ...] | --metrics');
    process.exit(2);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('[content-review] 失败:', error?.message || error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
