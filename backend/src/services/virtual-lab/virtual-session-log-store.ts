/**
 * 虚拟会话日志子表存储（`virtual_session_logs`）。
 *
 * 背景（性能审计 2026-09-21 / 大 JSON 增量化）：`virtual_sessions.logs` 单列存全部
 * 轨迹，每次追加「读全量 → parse → push → 整包 stringify 写回」，单会话累计冗余写
 * 达 MB 级（实测曾有单行 31.9MB）。子表化后追加 = INSERT 行，O(新增) 代替 O(全量)。
 *
 * 兼容策略（双读 + 惰性播种）：
 * - 读：侧表有行 → 侧表（权威）；否则回退解析旧 `logs` 列（旧会话零迁移可读）。
 * - 写：首次追加若侧表为空且列非空，先把列内容播种进侧表，成功后列置 null
 *   （原地回收列空间）；此后读永远走侧表。播种以「侧表当前无行」为闸，
 *   播种/置列非事务原子——并发首写最坏重复播种诊断日志，由租约与运维路径串行化兜底。
 * - 字节预算沿用 `SIMULATION_LOG_MAX_BYTES`（默认 2MB/会话，见 simulation-log-buffer），
 *   超出裁最旧行，始终保留最新一条（与旧列封顶语义一致）。
 *
 * `db` 参数供注入式服务（session-reclaim / log-retention 的 this.database）复用。
 */
import prisma from '../../config/database';
import type { SimulationLogEntry } from '../../coordinators/simulation.types';
import { resolveSimulationLogMaxBytes } from './simulation-log-buffer';

export interface VirtualSessionLogStoreClient {
  virtual_sessions: {
    findUnique(args: {
      where: { id: string };
      select: { logs: true };
    }): Promise<{ logs: string | null } | null>;
    update(args: { where: { id: string }; data: { logs: string | null } }): Promise<unknown>;
  };
  virtual_session_logs: {
    findMany(args: {
      where: { sessionId: string };
      orderBy?: { id: 'asc' };
      take?: number;
      select: { id: true; bytes?: true; payload?: true };
    }): Promise<Array<{ id: number; bytes?: number; payload?: string }>>;
    createMany(args: { data: Array<{ sessionId: string; phase: string | null; payload: string; bytes: number }> }): Promise<unknown>;
    deleteMany(args: { where: { id?: { in: number[] } }; sessionId?: string }): Promise<unknown>;
  };
}

function parseLogsField(raw: string | null | undefined): SimulationLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseEntryPayload(payload: string): SimulationLogEntry | null {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toRows(sessionId: string, entries: SimulationLogEntry[]) {
  return entries.filter((entry) => entry && typeof entry === 'object').map((entry) => {
    const payload = JSON.stringify(entry);
    return {
      sessionId,
      phase: typeof (entry as { phase?: unknown }).phase === 'string' ? (entry as { phase: string }).phase : null,
      payload,
      bytes: payload.length
    };
  });
}

/**
 * 就地水合会话行的 logs 字段（同步读点的兼容桥）：
 * 侧表有行 → 用侧表权威内容覆写 `session.logs`（内存对象，不落库）；
 * 旧会话（侧表无行）→ 不动，调用方继续按列解析。
 * 供 admin 路由等「整行取出后同步 parse logs」的读点在入口处调用一次。
 */
export async function hydrateSessionLogsField(
  session: { id: string; logs: string | null },
  db: VirtualSessionLogStoreClient = prisma as unknown as VirtualSessionLogStoreClient
): Promise<void> {
  const existing = await db.virtual_session_logs.findMany({
    where: { sessionId: session.id },
    take: 1,
    select: { id: true }
  });
  if (existing.length === 0) return;
  const logs = await loadSessionLogs(session.id, db);
  session.logs = JSON.stringify(logs);
}

/** 读会话全部日志：侧表有行即权威，否则回退旧 `logs` 列（旧会话零迁移可读） */
export async function loadSessionLogs(
  sessionId: string,
  db: VirtualSessionLogStoreClient = prisma as unknown as VirtualSessionLogStoreClient
): Promise<SimulationLogEntry[]> {
  const rows = await db.virtual_session_logs.findMany({
    where: { sessionId },
    orderBy: { id: 'asc' },
    select: { id: true, payload: true }
  });
  if (rows.length > 0) {
    return rows
      .map((row) => parseEntryPayload(String(row.payload ?? '')))
      .filter((entry): entry is SimulationLogEntry => entry !== null);
  }
  const session = await db.virtual_sessions.findUnique({ where: { id: sessionId }, select: { logs: true } });
  if (!session) return [];
  return parseLogsField(session.logs);
}

/**
 * 追加日志（惰性播种 + INSERT 行 + 字节预算裁最旧行）。
 * 会话不存在时抛错由调用方决定吞吞（coordinator 沿用「先查会话再追加」的旧契约）。
 */
export async function appendSessionLogs(
  sessionId: string,
  entries: SimulationLogEntry[],
  options: { budgetBytes?: number; db?: VirtualSessionLogStoreClient } = {}
): Promise<void> {
  const clean = (entries || []).filter((entry) => entry && typeof entry === 'object');
  if (!clean.length) return;
  const db = options.db ?? (prisma as unknown as VirtualSessionLogStoreClient);
  const budgetBytes = options.budgetBytes ?? resolveSimulationLogMaxBytes();

  const existing = await db.virtual_session_logs.findMany({
    where: { sessionId },
    take: 1,
    select: { id: true }
  });
  if (existing.length === 0) {
    const session = await db.virtual_sessions.findUnique({ where: { id: sessionId }, select: { logs: true } });
    if (!session) throw new Error('模拟会话不存在');
    const legacy = parseLogsField(session.logs);
    if (legacy.length > 0) {
      await db.virtual_session_logs.createMany({ data: toRows(sessionId, legacy) });
      // 播种成功即冻结旧列并原地回收（读已切侧表，列不再被读）
      await db.virtual_sessions.update({ where: { id: sessionId }, data: { logs: null } });
    }
  }
  await db.virtual_session_logs.createMany({ data: toRows(sessionId, clean) });
  await trimSessionLogRows(sessionId, budgetBytes, db);
}

/** 全量替换（重试清 phase、终态化等场景）：删侧表行后按序重建；旧列置 null 冻结 */
export async function replaceSessionLogs(
  sessionId: string,
  entries: SimulationLogEntry[],
  options: { budgetBytes?: number; db?: VirtualSessionLogStoreClient } = {}
): Promise<void> {
  const db = options.db ?? (prisma as unknown as VirtualSessionLogStoreClient);
  const budgetBytes = options.budgetBytes ?? resolveSimulationLogMaxBytes();
  const rows = toRows(sessionId, (entries || []).filter((entry) => entry && typeof entry === 'object'));
  await db.virtual_session_logs.deleteMany({ where: { sessionId } } as never);
  if (rows.length > 0) {
    await db.virtual_session_logs.createMany({ data: rows });
  }
  // 置 null 使「侧表空 → 回退列」的旧会话语义收敛（过滤后为空也成立），并原地回收列空间
  await db.virtual_sessions.update({ where: { id: sessionId }, data: { logs: null } });
  await trimSessionLogRows(sessionId, budgetBytes, db);
}

/**
 * 按字节预算裁最旧行（与 boundSimulationLog 同语义：从最新往前累计，至少保留 1 条）。
 * 返回删除的行数。独立导出供 log-retention 对冷会话复用。
 */
export async function trimSessionLogRows(
  sessionId: string,
  budgetBytes: number,
  db: VirtualSessionLogStoreClient = prisma as unknown as VirtualSessionLogStoreClient
): Promise<number> {
  if (!(budgetBytes > 0)) return 0;
  const rows = await db.virtual_session_logs.findMany({
    where: { sessionId },
    orderBy: { id: 'asc' },
    select: { id: true, bytes: true }
  });
  if (rows.length === 0) return 0;
  let total = 0;
  let keepFrom = rows.length;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const size = Number(rows[index]?.bytes || 0);
    if (keepFrom < rows.length && total + size > budgetBytes) break;
    keepFrom = index;
    total += size;
  }
  if (keepFrom === 0) return 0;
  const staleIds = rows.slice(0, keepFrom).map((row) => row.id);
  const result = await db.virtual_session_logs.deleteMany({ where: { id: { in: staleIds } } });
  return (result as { count?: number })?.count ?? staleIds.length;
}
