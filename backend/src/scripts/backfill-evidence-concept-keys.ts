/**
 * 存量证据概念键回填（F1 修复的存量补账，**只读默认 / --apply 才写**）
 *
 * 背景（R1 H2：全库 0/5955 → 修复后新行带键）：checkpoint 证据 payload 的概念归属
 * （conceptName/conceptKey/conceptSource，见 teaching-checkpoint.ts checkpointConceptPayloadFields）
 * 只对修复后产出的新行生效；存量 checkpoint:result / checkpoint:attempt 行无 conceptKey——
 * 失败证据无概念可挂，掌握聚合与跨课归位失锚。本脚本按「该会话当轮正在教的知识点」回溯派生。
 *
 * 键控口径（与新行逐字节一致）：teaching-turn-engine 产出 pendingCheckpoint 时用
 * `resolveCheckpointConceptAttribution(knowledge.currentPoint)`——即当轮教学点名字经
 * `deriveConceptKeyFromName`（cpt_ + sha256(归一名) 前 16 位，checkpoint-shared.ts 唯一定义点）。
 * 本脚本回溯优先级：
 *   1. teachingState.checkpointHistory 里同 checkpointId 的归属（conceptKey 直用 / conceptName 派生）；
 *   2. 该会话 assistant 消息（teaching_session_messages.payload.knowledgePoint = 当轮教学点）
 *      中 occurredAt 之前最近的一条教学点名；无则取其后最近一条（跨轮容忍）；
 *   3. 会话缺失 / 无任何教学点 → 显式置 `conceptKey: null`（宁缺勿挂占位键，同 checkpoint-shared 纪律）。
 *
 * 幂等：只扫 payload **完全不含** `"conceptKey"` 键的行；回填与置 null 都会写入该键，重跑自动跳过。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/backfill-evidence-concept-keys.ts            # dry-run（默认，不写库）
 *   npx ts-node --transpile-only src/scripts/backfill-evidence-concept-keys.ts --apply    # 写库
 *   可选 --limit=N（只处理前 N 行，试跑用）
 */
import 'dotenv/config';
import prisma from '../config/database';
import { deriveConceptKeyFromName, normalizeConceptName } from '../services/ai-teaching/checkpoint-shared';

/** 回填目标：checkpoint / anchor 两类证据（anchor 存量行均带键，列出以兜底未来缺口） */
const EVIDENCE_TYPES = ['checkpoint:result', 'checkpoint:attempt', 'anchor:result'] as const;

const BATCH_SIZE = 500;

interface EvidenceRow {
  id: string;
  sessionId: string | null;
  payload: string;
  occurredAt: Date;
}

export interface ConceptAttributionResolution {
  /** 回填写入 payload 的三字段；unresolvable 时 conceptKey=null */
  conceptName: string | null;
  conceptKey: string | null;
  conceptSource: 'derived' | null;
  /** 命中来源（统计用） */
  via: 'history-key' | 'history-name' | 'message-point' | 'unresolvable';
}

/**
 * 单行归属解析（纯函数，供单测）。
 * history: checkpointHistory 里同 checkpointId 的归属行（修复前后过渡期的会话才有）；
 * messagePoints: 该会话 assistant 消息的 (timestampMs, 教学点名) 时间线，须已按时间升序。
 */
export function resolveEvidenceConceptAttribution(
  payload: Record<string, unknown>,
  occurredAtMs: number,
  history: Array<Record<string, unknown>>,
  messagePoints: Array<{ at: number; name: string }>,
): ConceptAttributionResolution {
  const checkpointId = typeof payload.checkpointId === 'string' ? payload.checkpointId : '';

  // 1) checkpointHistory 归属（同口径：新行写 conceptKey/conceptName，见 teaching-turn-engine.ts:1040）
  const histEntry = checkpointId
    ? history.find((row) => row?.checkpointId === checkpointId)
    : undefined;
  if (histEntry) {
    if (typeof histEntry.conceptKey === 'string' && histEntry.conceptKey.trim()) {
      return {
        conceptName: typeof histEntry.conceptName === 'string' ? histEntry.conceptName : null,
        conceptKey: histEntry.conceptKey.trim(),
        conceptSource: 'derived',
        via: 'history-key',
      };
    }
    if (typeof histEntry.conceptName === 'string' && normalizeConceptName(histEntry.conceptName)) {
      return {
        conceptName: histEntry.conceptName.trim(),
        conceptKey: deriveConceptKeyFromName(histEntry.conceptName),
        conceptSource: 'derived',
        via: 'history-name',
      };
    }
  }

  // 2) 当轮正在教的知识点：occurredAt 之前最近的教学点；无则其后最近（跨轮容忍）
  if (messagePoints.length > 0) {
    let candidate: { at: number; name: string } | null = null;
    for (const point of messagePoints) {
      if (point.at <= occurredAtMs) candidate = point;
      else break;
    }
    const picked = candidate ?? messagePoints[0];
    if (picked && normalizeConceptName(picked.name)) {
      return {
        conceptName: picked.name,
        conceptKey: deriveConceptKeyFromName(picked.name),
        conceptSource: 'derived',
        via: 'message-point',
      };
    }
  }

  // 3) 回不去：显式置 null（宁缺勿挂占位键）
  return { conceptName: null, conceptKey: null, conceptSource: null, via: 'unresolvable' };
}

/** 会话侧资料：checkpointHistory + assistant 教学点时间线（tsm payload.knowledgePoint） */
async function loadSessionContext(sessionId: string): Promise<{
  history: Array<Record<string, unknown>>;
  messagePoints: Array<{ at: number; name: string }>;
} | null> {
  const session = await prisma.teaching_sessions.findUnique({
    where: { id: sessionId },
    select: { teachingState: true },
  });
  if (!session) return null;

  let history: Array<Record<string, unknown>> = [];
  try {
    const teachingState = session.teachingState ? JSON.parse(session.teachingState) : null;
    history = Array.isArray(teachingState?.checkpointHistory) ? teachingState.checkpointHistory : [];
  } catch {
    history = [];
  }

  const messageRows = await prisma.teaching_session_messages.findMany({
    where: { sessionId, payload: { contains: 'knowledgePoint' } },
    select: { payload: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const messagePoints: Array<{ at: number; name: string }> = [];
  for (const row of messageRows) {
    try {
      const message = JSON.parse(row.payload);
      if (message?.role !== 'assistant') continue;
      const name = typeof message.knowledgePoint === 'string' ? message.knowledgePoint.trim() : '';
      if (!name) continue;
      const at = Date.parse(message.timestamp) || (row.createdAt ? row.createdAt.getTime() : 0);
      messagePoints.push({ at, name });
    } catch {
      // 单行坏 payload 不阻断整场回填
    }
  }
  messagePoints.sort((a, b) => a.at - b.at);
  return { history, messagePoints };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

  console.log(`[backfill-evidence-concept-keys] 模式：${apply ? 'APPLY（写库）' : 'DRY-RUN（默认，不写库）'}`);

  const stats = {
    scanned: 0,
    backfilled: 0,
    setNull: 0,
    byVia: {} as Record<string, number>,
    missingSessions: 0,
  };

  const sessionContextCache = new Map<string, Awaited<ReturnType<typeof loadSessionContext>>>();
  let cursor: string | undefined;

  for (;;) {
    const batch: EvidenceRow[] = await prisma.learner_evidence.findMany({
      // 只扫 payload 完全不含 "conceptKey" 键的行：回填/置 null 后重跑自动跳过（幂等）
      where: {
        evidenceType: { in: [...EVIDENCE_TYPES] },
        NOT: { payload: { contains: '"conceptKey"' } },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, sessionId: true, payload: true, occurredAt: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const row of batch) {
      if (limit !== null && Number.isFinite(limit) && stats.scanned >= limit) break;
      stats.scanned += 1;

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = {};
      }
      if (payload.conceptKey) continue; // 防御：LIKE 漏网的已带键行不重写

      let context: Awaited<ReturnType<typeof loadSessionContext>> = null;
      if (row.sessionId) {
        if (!sessionContextCache.has(row.sessionId)) {
          sessionContextCache.set(row.sessionId, await loadSessionContext(row.sessionId));
        }
        context = sessionContextCache.get(row.sessionId) ?? null;
      }
      if (!context) stats.missingSessions += 1;

      const resolution = resolveEvidenceConceptAttribution(
        payload,
        row.occurredAt ? row.occurredAt.getTime() : 0,
        context?.history ?? [],
        context?.messagePoints ?? [],
      );
      stats.byVia[resolution.via] = (stats.byVia[resolution.via] ?? 0) + 1;
      if (resolution.via === 'unresolvable') {
        stats.setNull += 1;
      } else {
        stats.backfilled += 1;
      }

      if (apply) {
        const nextPayload = JSON.stringify({
          ...payload,
          conceptName: resolution.conceptName,
          conceptKey: resolution.conceptKey,
          conceptSource: resolution.conceptSource,
        });
        await prisma.learner_evidence.update({ where: { id: row.id }, data: { payload: nextPayload } });
      }
    }
    if (limit !== null && Number.isFinite(limit) && stats.scanned >= limit) break;
  }

  console.log('[backfill-evidence-concept-keys] 统计：', JSON.stringify(stats, null, 2));
  console.log(
    apply
      ? `[backfill] 完成：可回填 ${stats.backfilled} 行已写入，回不去 ${stats.setNull} 行已显式置 null。`
      : `[backfill] dry-run 结论：可回填 ${stats.backfilled} 行 / 不可回填（置 null）${stats.setNull} 行。加 --apply 才写库。`,
  );
}

/* 直接运行时才执行；被测试 import 时不跑 */
if (typeof require !== 'undefined' && require.main === module) {
  main()
    .catch((error) => {
      console.error('[backfill-evidence-concept-keys] 失败：', error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
