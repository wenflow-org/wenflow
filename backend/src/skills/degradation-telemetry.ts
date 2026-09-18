/**
 * 降级遥测（Wave1 · Track A 共享接口）
 *
 * 背景：项目里大量 `catch { return null/[]/{} }` 的"静默失败"——下游把缺失当"存在但未知"
 * 继续推理，产出看起来自信、实际失真的结论（虚拟链路尤其明显：画像/到期线索读不到时
 * 记忆快照静默变空，被当成"这个人没有记忆"）。
 *
 * 约定：**允许降级，不允许未打标的降级**。任何"读取失败→保底值"的位置都必须过这里，
 * 产出结构化遥测（供日志、health-center、DNR 统计消费）。
 *
 * 注意：本文件由 Track A 维护；Track B 只读引用，不要在本文件里加 Track B 的领域逻辑。
 */
import { logger } from '../utils/logger';

export type DegradationFaultCategory =
  | 'NETWORK_TIMEOUT'
  | 'SCHEMA_VIOLATION'
  | 'RATE_LIMITED'
  | 'UPSTREAM_EMPTY'
  | 'DB_READ_FAILED'
  | 'PARSE_FAILED'
  | 'UNKNOWN';

export type DegradationSeverity = 'P1_CRITICAL' | 'P2_DEGRADED' | 'P3_NOTICE';

export interface DegradationTelemetry {
  /** 发生模块，如 'virtual-lab/learner-memory' */
  source: string;
  faultCategory: DegradationFaultCategory;
  severity: DegradationSeverity;
  /** 受损的数据维度/字段 */
  impactedDimensions: string[];
  /** 实际保底动作，如 'return-empty-snapshot' */
  mitigationApplied: string;
  rootCauseMessage?: string | null;
  at: string; // ISO
}

/** 进程内计数（无指标基建的最小可观测手段；按 source 聚合） */
const counters = new Map<string, number>();

/** 记录一次降级：结构化日志 + 进程内计数，返回补全 `at` 的遥测对象。 */
export function recordDegradation(fault: Omit<DegradationTelemetry, 'at'>): DegradationTelemetry {
  const record: DegradationTelemetry = {
    ...fault,
    rootCauseMessage: typeof fault.rootCauseMessage === 'string' ? fault.rootCauseMessage.slice(0, 500) : fault.rootCauseMessage ?? null,
    at: new Date().toISOString(),
  };
  counters.set(record.source, (counters.get(record.source) ?? 0) + 1);
  logger.warn('[degradation] 降级已记录', {
    source: record.source,
    faultCategory: record.faultCategory,
    severity: record.severity,
    impactedDimensions: record.impactedDimensions,
    mitigationApplied: record.mitigationApplied,
    rootCauseMessage: record.rootCauseMessage,
  });
  return record;
}

/** 供 health-center / DNR 脚本读取的进程内计数快照（按 source 聚合）。 */
export function snapshotDegradationCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

/** 仅测试用：清空计数。 */
export function resetDegradationCounters(): void {
  counters.clear();
}

/** 便捷构造：把 error 归一成可读消息。 */
export function degradationCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
