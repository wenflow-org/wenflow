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
 * 持久化（2026-10-08 止血挖掘模式②）：事件落 dev.db `degradation_events`（惰性建表、
 * fire-and-forget、失败静默退化为日志+进程内计数）——进程内 Map 只作即热快照，
 * 历史回看走 DB（audit-degradation-rate.ts --db）。
 *
 * 注意：本文件由 Track A 维护；Track B 只读引用，不要在本文件里加 Track B 的领域逻辑。
 */
import { logger } from '../utils/logger';
import prisma from '../config/database';

export type DegradationFaultCategory =
  | 'NETWORK_TIMEOUT'
  | 'SCHEMA_VIOLATION'
  | 'RATE_LIMITED'
  | 'UPSTREAM_EMPTY'
  | 'DB_READ_FAILED'
  | 'PARSE_FAILED'
  | 'MODEL_ARITHMETIC_MISMATCH'
  /** 模型把答案键（expectedKeywords 要点）写进了学生可见文本（题干/选项/hint/reply）——照抄即可骗过判分 */
  | 'MODEL_ANSWER_LEAK'
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

/** 进程内即热计数（按 source 聚合）；持久化与历史回看见下方落库段。 */
const counters = new Map<string, number>();

/** 记录一次降级：结构化日志 + 进程内计数 + **落库**（可回看、可跨进程聚合），返回补全 `at` 的遥测对象。 */
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
  persistDegradationEvent(record);
  return record;
}

// ── 落库（2026-10-08 止血挖掘模式②：观测易失 → 持久化）─────────────────────────
// 进程内 Map 重启清零、多实例不可见（模块头注释自认「无指标基建的最小可观测手段」）。
// 落库纪律：遥测**绝不**因自身的存储失败而影响业务调用方——建表与写入全部
// fire-and-forget + 吞错（写不进去时行为退化为原状：日志+进程内计数）。
let tableReady: Promise<void> | null = null;

function ensureDegradationTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS degradation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        faultCategory TEXT NOT NULL,
        severity TEXT NOT NULL,
        impactedDimensions TEXT,
        mitigationApplied TEXT,
        rootCauseMessage TEXT,
        at TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      )`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_degradation_events_source_at ON degradation_events(source, createdAt)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_degradation_events_category ON degradation_events(faultCategory)`;
    })().catch((error) => {
      // 建表失败：放弃本次落库并复位，下次事件重试
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

function persistDegradationEvent(record: DegradationTelemetry): void {
  void ensureDegradationTable()
    .then(() => prisma.$executeRaw`INSERT INTO degradation_events
      (source, faultCategory, severity, impactedDimensions, mitigationApplied, rootCauseMessage, at, createdAt)
      VALUES (${record.source}, ${record.faultCategory}, ${record.severity},
              ${JSON.stringify(record.impactedDimensions ?? [])}, ${record.mitigationApplied},
              ${record.rootCauseMessage}, ${record.at}, ${Date.now()})`)
    .catch(() => {
      /* 遥测落库失败静默：进程内计数与结构化日志仍在（退化即原状） */
    });
}

/** 供 health-center / DNR 脚本读取的进程内计数快照（按 source 聚合）。 */
export function snapshotDegradationCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

/** 历史降级事件回看（DB 口径；表空/查询失败返回 null，由调用方回退日志口径）。 */
export async function readDegradationEvents(sinceMs: number): Promise<Array<{
  source: string;
  faultCategory: string;
  severity: string;
  mitigationApplied: string;
  rootCauseMessage: string | null;
  at: string;
}> | null> {
  try {
    await ensureDegradationTable();
    const rows = await prisma.$queryRaw<Array<{
      source: string; faultCategory: string; severity: string;
      mitigationApplied: string; rootCauseMessage: string | null; at: string;
    }>>`SELECT source, faultCategory, severity, mitigationApplied, rootCauseMessage, at
        FROM degradation_events WHERE createdAt >= ${sinceMs} ORDER BY createdAt DESC LIMIT 5000`;
    return rows;
  } catch {
    return null;
  }
}

/** 仅测试用：清空计数。 */
export function resetDegradationCounters(): void {
  counters.clear();
}

/** 便捷构造：把 error 归一成可读消息。 */
export function degradationCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
