/**
 * 虚拟会话日志缓冲（`virtual_sessions.logs` 的**字节预算**封顶）。
 *
 * 背景：虚拟会话的 `logs` 是**追加式**的，一条 `teaching-response` 可含整段 AI 回复 +
 * 分析 + 知识点，单条最大实测 123 KB。dev 库里出现过**单行 31.9 MB**（765 条，其中
 * teaching-response 占 31.13 MB）——整表 92 MB 几乎全在这里。
 *
 * 为什么按字节而不是按条数：单条大小差两个数量级（几 B ~ 123 KB），按条数封顶仍可能
 * 留下几十 MB。按"从最新往前累计到预算"封顶，则**列大小有硬上界**，且保留的总是最新现场。
 */

/** 默认每个会话的 logs 字节预算（2 MB） */
export const DEFAULT_SIMULATION_LOG_MAX_BYTES = 2 * 1024 * 1024;

export function resolveSimulationLogMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SIMULATION_LOG_MAX_BYTES;
  if (!raw || raw.trim() === '') return DEFAULT_SIMULATION_LOG_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 64 * 1024) return DEFAULT_SIMULATION_LOG_MAX_BYTES;
  return Math.floor(parsed);
}

/**
 * 保留**最新的**若干条日志，使序列化总长不超过 `maxBytes`。
 * 最新的那一条无论多大都保留（否则会裁成空、丢掉当前现场）。
 */
export function boundSimulationLog<T>(logs: T[], maxBytes: number = resolveSimulationLogMaxBytes()): T[] {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  const budget = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_SIMULATION_LOG_MAX_BYTES;
  const kept: T[] = [];
  let total = 0;
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const entry = logs[index];
    let size = 0;
    try { size = JSON.stringify(entry)?.length ?? 0; } catch { size = 0; }
    // 至少保留最新一条；其后按预算从新到旧保留
    if (kept.length > 0 && total + size > budget) break;
    kept.push(entry);
    total += size;
  }
  return kept.reverse();
}

/** 追加一条日志并按字节预算封顶（写入路径统一入口） */
export function appendSimulationLog<T>(
  logs: T[],
  entry: T,
  maxBytes: number = resolveSimulationLogMaxBytes(),
): T[] {
  return boundSimulationLog([...(Array.isArray(logs) ? logs : []), entry], maxBytes);
}
