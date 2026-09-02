/**
 * 误解台账服务（G-R-R Phase 2）：跨会话误解生命周期管理
 *
 * 生命周期：suspected（首次观察）→ confirmed（再次出现/佐证）→ addressed（学生后续表现正确）
 * hypothesisHash 作为去重锚点：同一用户+概念+假设文本 → upsert 而非重复插入
 *
 * 写入口：teaching-turn 产出 analysis.misconceptions → processStudentMessage 异步记录
 * 读出口：buildTeachingScenarioContext → 注入 scenario.priorMisconceptions 供教学回合引用
 */
import prisma from '../../config/database';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';

export interface MisconceptionInput {
  conceptKey: string;
  hypothesis: string;
  canonicalLabel?: string | null;
  confidence: number;  // 0|25|50|75|100
  evidence?: string;
  status?: string;     // 默认 "suspected"
}

export interface MisconceptionRow {
  id: string;
  userId: string;
  conceptKey: string;
  hypothesis: string;
  canonicalLabel: string | null;
  confidence: number;
  evidence: string | null;
  status: string;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSessionId: string | null;
}

function hashHypothesis(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase().slice(0, 300)).digest('hex').slice(0, 16);
}

/** 批量记录误解：upsert 按 (userId, conceptKey, hypothesisHash) 去重；best-effort，失败不抛 */
export async function recordMisconceptions(
  userId: string,
  sessionId: string,
  items: MisconceptionInput[],
): Promise<void> {
  if (!items || items.length === 0) return;
  try {
    const now = new Date();
    for (const item of items) {
      const hash = hashHypothesis(item.hypothesis);
      const existing = await prisma.misconception_ledger.findUnique({
        where: {
          userId_conceptKey_hypothesisHash: { userId, conceptKey: item.conceptKey, hypothesisHash: hash },
        },
        select: { id: true, status: true, occurrenceCount: true },
      });
      const confidence = [0, 25, 50, 75, 100].includes(item.confidence) ? item.confidence : 50;
      if (existing) {
        // 再次出现 → 升为 confirmed（除非已 addressed）
        const newStatus = existing.status === 'suspected' ? 'confirmed' : existing.status;
        await prisma.misconception_ledger.update({
          where: { id: existing.id },
          data: {
            confidence,
            evidence: item.evidence ?? undefined,
            status: newStatus,
            occurrenceCount: { increment: 1 },
            lastSeenAt: now,
            lastSessionId: sessionId,
          },
        });
      } else {
        await prisma.misconception_ledger.create({
          data: {
            id: `ml_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            userId,
            conceptKey: item.conceptKey,
            hypothesisHash: hash,
            hypothesis: item.hypothesis.trim().slice(0, 300),
            canonicalLabel: item.canonicalLabel?.trim().slice(0, 200) ?? null,
            confidence,
            evidence: item.evidence?.trim().slice(0, 300) ?? null,
            status: item.status || 'suspected',
            lastSessionId: sessionId,
          },
        });
      }
    }
  } catch (error) {
    logger.warn('[misconception-ledger] 误解记录失败（best-effort，不阻断回合）', {
      userId,
      sessionId,
      count: items.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 获取指定概念的活跃误解（status != addressed），最近 N 条 */
export async function getActiveForConcepts(
  userId: string,
  conceptKeys: string[],
  limit = 5,
): Promise<MisconceptionRow[]> {
  if (!conceptKeys || conceptKeys.length === 0) return [];
  try {
    return await prisma.misconception_ledger.findMany({
      where: {
        userId,
        conceptKey: { in: conceptKeys },
        status: { not: 'addressed' },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
    });
  } catch (error) {
    logger.warn('[misconception-ledger] 查询误解失败', { userId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}