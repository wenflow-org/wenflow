/**
 * 路径质量评审的后台观察事件（2026-11-21）。
 *
 * 背景：真实/共享路径生成此前在落库前同步等待 `path-reviewer`；低分还会自动重规划一次。
 * 这条路把「模型评审」放进生成主链路后，评审超时/缺字段/低分会延迟甚至阻断路径就绪。
 * 现在改为：
 *
 * - 主链路通过确定性检查后立即落库、启动阶段设计；
 * - 同一事务里登记一条 `path:quality-review`，由 outbox 的**独立泳道**异步消费；
 * - 事件载荷带**不可变路径版本**（本次 core 生成 run id）+ 落库时的路径快照，
 *   观察结果只写回该版本；路径被后续版本覆盖后，迟到任务直接丢弃，不碰新路径。
 *
 * 与 `review:completed`（复习结算）和 `stageResults.path_review`（虚拟学员对方案的反应）
 * 语义不同：本事件只表达**平台路径质量**，不写学员证据/掌握度，也不改路径状态。
 */
import type { DurableDomainEvent } from './contracts';
import { notifyOutboxActivity } from './outbox-wake';
import { createHash } from 'crypto';

export const PATH_QUALITY_REVIEW_EVENT_TYPE = 'path:quality-review' as const;

/** 评审结果的证据来源：平台路径质量评审（与虚拟学员模拟评审分开存证）。 */
export const PATH_REVIEW_REVIEWER_KIND = 'platform_path_quality' as const;

export type PathReviewReviewerKind = typeof PATH_REVIEW_REVIEWER_KIND;

export type PathReviewEventMode = 'observe' | 'replan_experiment';

export interface PathQualityReviewEventData {
  pathId: string;
  userId: string;
  /** 不可变路径版本 = 生成本版本的 core run id。 */
  reviewedGenerationRunId: string;
  reviewerKind: PathReviewReviewerKind;
  /** observe = 普通后台观察；replan_experiment = 显式虚拟实验分组（不影响 durable path）。 */
  mode: PathReviewEventMode;
  requestedBy: 'path-generation' | 'virtual-lab';
  /** 评审配置（阈值/权重/reviewer），用于结果追溯与配置指纹。 */
  reviewConfig: Record<string, unknown>;
  /** 落库时冻结的路径评审输入快照（训练/评测只认这份，不重读新路径）。 */
  snapshot: Record<string, unknown>;
  snapshotHash: string;
  requestedAt: string;
  experiment?: {
    compareReplan?: boolean;
  };
}

export interface EnqueuePathQualityReviewInput extends Omit<PathQualityReviewEventData, 'reviewerKind' | 'requestedAt' | 'snapshotHash'> {
  reviewerKind?: PathReviewReviewerKind;
  requestedAt?: string;
  source?: string;
}

/** 事件 id 由版本派生：同一 core run 重投/重试不会重复入队。 */
export function pathQualityReviewEventId(reviewedGenerationRunId: string): string {
  return `pqr_${reviewedGenerationRunId}`;
}

/** 稳定序列化（对象键排序）→ 快照哈希不受键顺序影响。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function hashPathReviewSnapshot(snapshot: unknown): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

/**
 * 入队所需的最小事务客户端形状（避免 events 层绑定 Prisma 具体类型；
 * 主库 `Prisma.TransactionClient` 结构兼容）。
 */
export interface PathQualityReviewOutboxTx {
  domain_event_outbox: {
    upsert(args: {
      where: { id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

/**
 * 登记后台评审事件（必须在路径落库事务内调用，保证「路径可见」与「评审可消费」同源）。
 *
 * 幂等：id 确定 + upsert 空更新。已存在（含 pending/published/dead）时保持原状——
 * 是否重试由 outbox 自己的尝试计数决定，不受相同事务重放影响。
 */
export async function enqueuePathQualityReviewEvent(
  tx: PathQualityReviewOutboxTx,
  input: EnqueuePathQualityReviewInput,
): Promise<void> {
  if (!input.pathId || !input.reviewedGenerationRunId) {
    throw new Error('PATH_QUALITY_REVIEW_EVENT_INVALID: pathId/reviewedGenerationRunId required');
  }
  const id = pathQualityReviewEventId(input.reviewedGenerationRunId);
  const payload: PathQualityReviewEventData = {
    pathId: input.pathId,
    userId: input.userId,
    reviewedGenerationRunId: input.reviewedGenerationRunId,
    reviewerKind: input.reviewerKind ?? PATH_REVIEW_REVIEWER_KIND,
    mode: input.mode,
    requestedBy: input.requestedBy,
    reviewConfig: input.reviewConfig,
    snapshot: input.snapshot,
    snapshotHash: hashPathReviewSnapshot(input.snapshot),
    requestedAt: input.requestedAt ?? new Date().toISOString(),
    ...(input.experiment ? { experiment: input.experiment } : {}),
  };
  await tx.domain_event_outbox.upsert({
    where: { id },
    create: {
      id,
      eventType: PATH_QUALITY_REVIEW_EVENT_TYPE,
      schemaVersion: 1,
      aggregateType: 'path',
      aggregateId: input.pathId,
      aggregateVersion: null,
      userId: input.userId || null,
      source: input.source || 'learning-service',
      payload: JSON.stringify(payload),
      metadata: JSON.stringify({
        reviewerKind: payload.reviewerKind,
        mode: payload.mode,
        reviewedGenerationRunId: payload.reviewedGenerationRunId,
      }),
      status: 'pending',
      availableAt: new Date(),
      scheduledAt: null,
      occurredAt: new Date(),
    },
    update: {},
  });
  notifyOutboxActivity();
}

export function isPathQualityReviewEvent(event: DurableDomainEvent): event is DurableDomainEvent<PathQualityReviewEventData> {
  return event?.type === PATH_QUALITY_REVIEW_EVENT_TYPE;
}
