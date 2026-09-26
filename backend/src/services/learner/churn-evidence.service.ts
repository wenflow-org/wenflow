/**
 * 休眠信号落库（2026-09-26，疲劳→干预闭环第一刀）。
 *
 * 做什么：课末收束时按「本次开课距上次活跃」计算休眠档位（churn-signals 四档）——
 *   - bucket != active → 写一条 learner_evidence（evidenceType='churn:risk'）；
 *   - cooling/dormant → 追加一条站内轻提醒（lost 只记录不打扰——可能已流失的人不发触达）；
 *   - active → 什么都不写（每课一行没有信息量）。
 * 防重：同一用户 7 天内已有 churn:risk 证据则整体跳过（连上几天课不重复提醒/记录）。
 * 「上次活跃」口径与离线审计脚本一致：teaching_sessions.startTime 与 learner_evidence.occurredAt
 * 取较新者（均取早于本次开课的最近一条）。
 * 纪律：churn-signals 是观察性行为代理——CHURN_SIGNAL_CAVEAT 随 payload 落库；
 * 任何失败 fail-open（返回 outcome，不抛），绝不阻断课末收束。
 */
import { prisma } from '../../config/database';
import { computeDormancy, CHURN_SIGNAL_CAVEAT } from './churn-signals';
import { logger } from '../../utils/logger';

const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CHURN_EVIDENCE_TYPE = 'churn:risk';

export interface ChurnRecordOutcome {
  recorded: boolean;
  bucket?: string;
  risk?: number;
  daysSinceActive?: number | null;
  notified?: boolean;
  reason?: string;
}

export async function recordChurnRiskAtFinalize(params: {
  userId: string;
  sessionId: string;
  /** 本次会话开始时间：结算的是「开课时距上次活跃多久」，不是收束时刻 */
  sessionStartAt: Date | string;
  now?: Date;
}): Promise<ChurnRecordOutcome> {
  const at = params.now ?? new Date();
  try {
    if (!params.userId || !params.sessionId) return { recorded: false, reason: 'empty-input' };

    // 防重：7 天窗口内已记录过 → 跳过
    const recent = await prisma.learner_evidence.findFirst({
      where: { userId: params.userId, evidenceType: CHURN_EVIDENCE_TYPE, occurredAt: { gte: new Date(at.getTime() - DEDUPE_WINDOW_MS) } },
      select: { id: true },
    });
    if (recent) return { recorded: false, reason: 'recently-recorded' };

    // 上次活跃：两条时间线取较新者（口径与 audit-churn-signals 一致）
    const [lastSession, lastEvidence] = await Promise.all([
      prisma.teaching_sessions.findFirst({
        where: { userId: params.userId, id: { not: params.sessionId }, startTime: { lt: new Date(params.sessionStartAt) } },
        orderBy: { startTime: 'desc' },
        select: { startTime: true },
      }),
      prisma.learner_evidence.findFirst({
        where: { userId: params.userId, occurredAt: { lt: new Date(params.sessionStartAt) } },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
    ]);
    const lastSessionMs = lastSession?.startTime ? new Date(lastSession.startTime).getTime() : 0;
    const lastEvidenceMs = lastEvidence?.occurredAt ? new Date(lastEvidence.occurredAt).getTime() : 0;
    const lastActiveAt = lastSessionMs > 0 || lastEvidenceMs > 0
      ? new Date(Math.max(lastSessionMs, lastEvidenceMs))
      : null;

    const signal = computeDormancy({ lastActiveAt, now: at });
    if (signal.bucket === 'active') return { recorded: false, bucket: signal.bucket, reason: 'active' };

    const atMs = at.getTime();
    await prisma.learner_evidence.create({
      data: {
        id: `lev_churn_${params.sessionId}_${atMs}`,
        eventId: `churn:${params.userId}:${atMs}`,
        evidenceKey: `churn:risk:${params.userId}:${new Date(atMs).toISOString().slice(0, 10)}`,
        userId: params.userId,
        sessionId: params.sessionId,
        evidenceType: CHURN_EVIDENCE_TYPE,
        occurredAt: at,
        payload: JSON.stringify({
          bucket: signal.bucket,
          risk: signal.risk,
          daysSinceActive: signal.daysSinceActive,
          lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
          caveat: CHURN_SIGNAL_CAVEAT,
        }),
      },
    });

    // 站内轻提醒：cooling/dormant 发（lost 不发——触达可能已流失的人须另行取得同意）
    let notified = false;
    if (signal.bucket === 'cooling' || signal.bucket === 'dormant') {
      await prisma.notifications.create({
        data: {
          userId: params.userId,
          title: signal.bucket === 'cooling' ? '几天没见，学习进度都帮你留着' : '好久不见，路径还在原地等你',
          body: signal.bucket === 'cooling'
            ? '回来从上次结束的地方继续就行，不需要从头开始。'
            : '之前的路径和笔记都还在。可以接着学，也可以重新定一个方向。',
          kind: 'system',
        },
      });
      notified = true;
    }

    logger.info('[churn-evidence] 休眠信号已记录', {
      userId: params.userId,
      sessionId: params.sessionId,
      bucket: signal.bucket,
      risk: signal.risk,
      notified,
    });
    return { recorded: true, bucket: signal.bucket, risk: signal.risk, daysSinceActive: signal.daysSinceActive, notified };
  } catch (error) {
    logger.warn('[churn-evidence] 休眠信号记录失败（fail-open，不阻断收束）', {
      userId: params.userId,
      sessionId: params.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { recorded: false, reason: 'error' };
  }
}
