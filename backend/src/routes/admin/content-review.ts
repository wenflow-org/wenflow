/**
 * 内容抽检（#121）：把 #47 的 CLI 闭环接到管理端。
 *
 * - GET  /api/admin/content-review?days=7&rate=0.05&realOnly=0
 *   返回窗口内确定性抽样（教师回合）+ 覆盖率/错误率。
 * - POST /api/admin/content-review/label  { messageId, verdict, note? }
 *   与 CLI 同表同键：learner_evidence / evidenceType=content:correctness:review /
 *   evidenceKey=content-correctness-review / eventId=msg:<id>。两边可互相读取，不建第二套存储。
 *
 * 抽样规则（确定性哈希、每会话上限）全部复用 services/ai-teaching/content-correctness，
 * 管理端只做参数校验与读写，不重写一套口径。
 */
import express from 'express';
import prisma from '../../config/database';
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
} from '../../services/ai-teaching/content-correctness';

const router = express.Router();

const messageEventId = (messageId: number | string) => `msg:${messageId}`;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

async function loadSample(params: { days: number; rate: number; realOnly: boolean; limit: number }) {
  const since = new Date(Date.now() - params.days * 86400000);
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
    sampleRate: params.rate,
    limit: params.limit,
    perSessionCap: 6,
    realOnly: params.realOnly,
  });
}

router.get('/', async (req, res) => {
  try {
    const days = clampInt(req.query.days, 7, 1, 90);
    const rateRaw = Number(req.query.rate);
    const rate = Number.isFinite(rateRaw) && rateRaw > 0 && rateRaw <= 1 ? rateRaw : 0.05;
    const realOnly = String(req.query.realOnly || '') === '1' || String(req.query.realOnly || '') === 'true';
    const limit = clampInt(req.query.limit, 40, 1, 200);

    const { sampled, scannedSessions, realSessions, virtualSessions } = await loadSample({ days, rate, realOnly, limit });
    const ids = sampled.map((turn) => turn.messageId);
    const rows = ids.length
      ? await prisma.learner_evidence.findMany({
          where: {
            evidenceType: CONTENT_REVIEW_EVIDENCE_TYPE,
            eventId: { in: ids.map((id) => messageEventId(id)) },
          },
          select: { eventId: true, payload: true },
        })
      : [];
    const labels = rows
      .map((row) => parseContentReviewLabel(row.payload))
      .filter((label): label is ContentReviewLabel => Boolean(label));
    const labelByMessage = new Map(labels.map((label) => [label.messageId, label]));
    const metrics = computeContentReviewMetrics({ sampledIds: ids, labels });

    res.json({
      success: true,
      data: {
        windowDays: days,
        rate,
        realOnly,
        scannedSessions,
        realSessions,
        virtualSessions,
        ...metrics,
        items: sampled.map((turn) => ({
          messageId: turn.messageId,
          sessionId: turn.sessionId,
          userId: turn.userId,
          content: turn.content,
          label: labelByMessage.get(turn.messageId) || null,
        })),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error?.message || '内容抽检读取失败' } });
  }
});

router.post('/label', async (req, res) => {
  try {
    const messageId = Number(req.body?.messageId);
    const verdict = String(req.body?.verdict || '') as ContentVerdict;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    if (!Number.isFinite(messageId)) {
      return res.status(400).json({ success: false, error: { message: 'messageId 必须是消息侧表自增 id' } });
    }
    if (!CONTENT_VERDICTS.includes(verdict)) {
      return res.status(400).json({ success: false, error: { message: `verdict 必须是 ${CONTENT_VERDICTS.join(' | ')}` } });
    }
    const row = await prisma.teaching_session_messages.findUnique({
      where: { id: messageId },
      select: { id: true, sessionId: true, payload: true },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: { message: '消息不存在（只抽侧表 teaching_session_messages）' } });
    }
    /* 抽检对象只有教师回合：页面只展示 assistant，但直接调接口此前能标学员消息，
       错误率分母会被非教师内容污染。写侧按 payload.role 收口（旧行 role 缺失时放行，保持兼容）。 */
    let role = '';
    try {
      const payload = JSON.parse(String(row.payload || '{}'));
      role = String(payload?.role || '').toLowerCase();
    } catch {
      role = '';
    }
    if (role && !['assistant', 'ai', 'teacher'].includes(role)) {
      return res.status(400).json({ success: false, error: { message: '只允许标注教师回合（assistant）' } });
    }
    const session = await prisma.teaching_sessions.findUnique({
      where: { id: row.sessionId },
      select: { userId: true, taskId: true, learningPathId: true },
    });
    if (!session) {
      return res.status(404).json({ success: false, error: { message: '消息所属会话不存在' } });
    }
    const label: ContentReviewLabel = {
      messageId,
      verdict,
      note: note || undefined,
      reviewerUserId: String(req.user?.userId || 'admin'),
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
    res.json({ success: true, data: { label } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error?.message || '标注失败' } });
  }
});

export default router;
