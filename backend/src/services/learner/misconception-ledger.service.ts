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
import { recordDegradation, degradationCause } from '../../skills/degradation-telemetry';
import { conceptRegistryService } from './concept-registry.service';

/**
 * 解析概念身份（canonical conceptId），best-effort：注册表故障不得阻断误解记录。
 * 设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.4（写入点双写）
 */
async function resolveConceptIdSafe(userId: string, conceptKey: string): Promise<string | null> {
  try {
    const resolved = await conceptRegistryService.resolveConcept(userId, conceptKey, { source: 'write_time' });
    return resolved?.conceptId ?? null;
  } catch (error) {
    logger.warn('[misconception-ledger] 概念身份解析失败（best-effort，conceptId 留空）', {
      userId,
      conceptKey: conceptKey.slice(0, 40),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 读取选项（B1/Q3）：
 * - 默认 `rethrowOnError=false`：内部记结构化降级后返回 []，保持既有"查询失败不阻断"语义；
 * - `rethrowOnError=true`：把错误抛给调用方，让调用方用**自己的 source** 打降级标记并把
 *   "数据不全"带进下游（真实教学侧两处出口用这个，避免把降级计到共享读函数名下）。
 */
export interface ActiveMisconceptionLookupOptions {
  rethrowOnError?: boolean;
}

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
      const conceptId = await resolveConceptIdSafe(userId, item.conceptKey);
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
            ...(conceptId !== null ? { conceptId } : {}),
          },
        });
      } else {
        await prisma.misconception_ledger.create({
          data: {
            id: `ml_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            userId,
            conceptKey: item.conceptKey,
            conceptId,
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
  options: ActiveMisconceptionLookupOptions = {},
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
    // 允许降级，不允许未打标的降级：默认路径记结构化遥测（保留既有 warn 供人读）
    if (options.rethrowOnError) throw error;
    recordDegradation({
      source: 'learner/misconception-ledger',
      faultCategory: 'DB_READ_FAILED',
      severity: 'P2_DEGRADED',
      impactedDimensions: ['misconception.active'],
      mitigationApplied: 'return-empty-active-misconceptions',
      rootCauseMessage: degradationCause(error),
    });
    logger.warn('[misconception-ledger] 查询误解失败', { userId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}