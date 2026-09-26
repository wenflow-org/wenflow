/* eslint-disable no-console -- 验收 CLI：面向人读的输出 */
/**
 * 真实数据验收探针：①churn 休眠证据闭环 ②误解 addressed 结算。
 *
 * 用真实 dev.db 数据验证（2026-09-26 新增的两个课末闭环）：
 *   ① recordChurnRiskAtFinalize：
 *      a) 活跃用户（最近会话 <7d）→ 应跳过（bucket=active）；
 *      b) 休眠用户（最新会话 ≥7d）→ 应写 learner_evidence(churn:risk) + cooling/dormant 发站内通知；
 *      c) 同用户立即重跑 → 应命中 7 天防重跳过；
 *      验证后默认清理本次写入（--keep 保留）。
 *   ② markMisconceptionsAddressed：取真实台账行（suspected/confirmed 各一）→ 结算 → 读回
 *      addressed+resolvedAt → 回滚原状态（不污染真实台账）。
 *
 * 用法（backend/ 下）：npx ts-node --transpile-only src/scripts/verify-churn-and-settlement.ts [--keep]
 */
import 'dotenv/config';
import { prisma } from '../config/database';
import { recordChurnRiskAtFinalize } from '../services/learner/churn-evidence.service';
import { markMisconceptionsAddressed } from '../services/learner/misconception-ledger.service';

const KEEP = process.argv.includes('--keep');
const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}｜${name}｜${detail}`);
}

async function cleanupChurn(userId: string): Promise<void> {
  await prisma.learner_evidence.deleteMany({ where: { userId, evidenceType: 'churn:risk' } });
  await prisma.notifications.deleteMany({
    where: { userId, kind: 'system', title: { in: ['几天没见，学习进度都帮你留着', '好久不见，路径还在原地等你'] } },
  });
}

async function verifyChurn(): Promise<void> {
  console.log('\n──① churn 休眠证据闭环──');
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 60_000);

  // a) 活跃用户：最近会话在 7 天内
  const activeSession = await prisma.teaching_sessions.findFirst({
    where: { startTime: { gte: sevenDaysAgo }, status: 'completed' },
    orderBy: { startTime: 'desc' },
    select: { id: true, userId: true, startTime: true },
  });
  if (!activeSession) {
    record('churn/active 分支', false, '库里没有 7 天内的已完成会话，无法验证');
    return;
  }
  await cleanupChurn(activeSession.userId);
  const activeOutcome = await recordChurnRiskAtFinalize({
    userId: activeSession.userId,
    sessionId: activeSession.id,
    sessionStartAt: activeSession.startTime,
    now,
  });
  record(
    'churn/active 分支：跳过不写',
    activeOutcome.recorded === false && activeOutcome.bucket === 'active',
    JSON.stringify(activeOutcome)
  );

  // b) 休眠用户：其最新会话 ≥7 天前
  const latestPerUser = await prisma.teaching_sessions.groupBy({
    by: ['userId'],
    where: { status: 'completed' },
    _max: { startTime: true },
  });
  const dormant = latestPerUser
    .filter((row) => row._max.startTime && new Date(row._max.startTime) < sevenDaysAgo)
    .sort((a, b) => String(a._max.startTime).localeCompare(String(b._max.startTime)))
    .pop();
  if (!dormant?._max.startTime) {
    record('churn/休眠分支', false, '库里没有最新会话 ≥7 天的用户，无法验证（可放宽 D7 阈值或造数）');
    return;
  }
  const dormantSession = await prisma.teaching_sessions.findFirst({
    where: { userId: dormant.userId, startTime: dormant._max.startTime as Date },
    select: { id: true, userId: true, startTime: true },
  });
  if (!dormantSession) {
    record('churn/休眠分支', false, '会话行读回失败');
    return;
  }
  await cleanupChurn(dormantSession.userId);
  const dormantOutcome = await recordChurnRiskAtFinalize({
    userId: dormantSession.userId,
    sessionId: dormantSession.id,
    sessionStartAt: dormantSession.startTime,
    now,
  });
  const evidence = await prisma.learner_evidence.findFirst({
    where: { userId: dormantSession.userId, evidenceType: 'churn:risk' },
  });
  let payloadCheck = false;
  if (evidence) {
    const payload = JSON.parse(evidence.payload) as { bucket?: string; risk?: number; caveat?: string };
    payloadCheck = payload.bucket === dormantOutcome.bucket && typeof payload.risk === 'number' && !!payload.caveat;
  }
  record(
    'churn/休眠分支：证据写入',
    dormantOutcome.recorded === true && !!evidence && payloadCheck,
    `outcome=${JSON.stringify(dormantOutcome)}｜evidence=${evidence ? '有' : '无'}｜payload口径=${payloadCheck}`
  );
  if (dormantOutcome.notified) {
    const notification = await prisma.notifications.findFirst({
      where: { userId: dormantSession.userId, kind: 'system' },
      orderBy: { createdAt: 'desc' },
    });
    record(
      'churn/休眠分支：站内提醒',
      !!notification && !!notification.body,
      notification ? `title=${notification.title}` : '未找到通知'
    );
  } else {
    record('churn/休眠分支：站内提醒', true, `bucket=${dormantOutcome.bucket}（该档不发提醒，符合设计）`);
  }

  // c) 7 天防重：立即重跑
  const repeatOutcome = await recordChurnRiskAtFinalize({
    userId: dormantSession.userId,
    sessionId: dormantSession.id,
    sessionStartAt: dormantSession.startTime,
    now,
  });
  record(
    'churn/防重：7 天窗口内跳过',
    repeatOutcome.recorded === false && repeatOutcome.reason === 'recently-recorded',
    JSON.stringify(repeatOutcome)
  );

  if (!KEEP) await cleanupChurn(dormantSession.userId);
  console.log(KEEP ? '  （--keep：保留本次写入）' : '  （已清理本次写入的 evidence/notification）');
}

async function verifySettlement(): Promise<void> {
  console.log('\n──② 误解 addressed 结算──');
  const rows = await prisma.misconception_ledger.findMany({
    where: { status: { in: ['suspected', 'confirmed'] } },
    orderBy: { lastSeenAt: 'desc' },
    take: 2,
  });
  if (rows.length === 0) {
    record('settlement/真实行结算', false, '台账无活跃行');
    return;
  }
  const snapshot = rows.map((row) => ({ id: row.id, status: row.status, resolvedAt: row.resolvedAt }));
  const userId = rows[0].userId;
  const conceptKeys = [...new Set(rows.map((row) => row.conceptKey))];

  const settled = await markMisconceptionsAddressed(userId, conceptKeys, { source: 'verify-probe' });
  const after = await prisma.misconception_ledger.findMany({
    where: { userId, conceptKey: { in: conceptKeys } },
    select: { id: true, status: true, resolvedAt: true },
  });
  const allAddressed = after.filter((row) => snapshot.some((snap) => snap.id === row.id))
    .every((row) => row.status === 'addressed' && !!row.resolvedAt);
  record(
    'settlement/真实行结算',
    settled > 0 && allAddressed,
    `结算 ${settled} 行（真实行 ${rows.map((row) => `${row.conceptKey.slice(0, 14)}…/${row.status}`).join(', ')}）→ 读回全部 addressed+resolvedAt=${allAddressed}`
  );

  // 回滚：恢复原状态（不污染真实台账）
  for (const snap of snapshot) {
    await prisma.misconception_ledger.update({
      where: { id: snap.id },
      data: { status: snap.status, resolvedAt: snap.resolvedAt },
    });
  }
  const rolledBack = await prisma.misconception_ledger.findMany({
    where: { id: { in: snapshot.map((snap) => snap.id) } },
    select: { id: true, status: true },
  });
  const rollbackOk = rolledBack.every((row) => {
    const snap = snapshot.find((item) => item.id === row.id);
    return snap ? row.status === snap.status : false;
  });
  record('settlement/回滚原状态', rollbackOk, '真实台账已还原');
}

async function main(): Promise<void> {
  console.log(`[verify] 真实数据验收：churn 闭环 + 误解结算（${KEEP ? '--keep' : '自动清理'}）`);
  await verifyChurn();
  await verifySettlement();
  const failed = results.filter((result) => !result.pass);
  console.log(`\n[verify] 结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) {
    console.log('[verify] 未通过项：');
    for (const result of failed) console.log(`  ✗ ${result.name}｜${result.detail}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

void main().catch((error) => {
  console.error('[verify] 失败', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
