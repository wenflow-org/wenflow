/**
 * 「按创建时间清理」候选的筛选口径（2026-11-09 从清理向导客户端判定改服务端）。
 *
 * 判定规则（与向导文案逐项对应）：
 *   - 建号时间早于保留期（cutoff 由调用方按 keepDays 算）；
 *   - **当前没有在推进的会话**（运行态用 `classifySessionRunPhase` 判：autopilot 状态是唯一真值，
 *     新会话在 goal/path 阶段还是 created，不能用 session.status 近似）；
 *   - 保留名单（tags）不在这里过滤——它是运营当场敲的文本，由界面按输入实时过滤。
 *
 * 抽成纯函数是为了可测：这段逻辑此前长在前端组件里，只对「当前载入页」的行生效，
 * 列表一次最多 1000 行 ⇒ 超出的同龄实例静默漏删（向导报 3 人、库里还有几百）。
 */
import { classifySessionRunPhase } from './session-run-phase';

/** 库里的实例行（`listCleanupCandidatesBefore` 的返回形状） */
export interface AgedInstanceRow {
  id: string;
  createdAt: Date;
  tags: string | null;
  users?: { name: string | null } | null;
  _count?: { sessions: number } | null;
}

/** 非终态会话（`findLiveSessionsByProfiles` 的返回形状，取判定所需字段） */
export interface LiveSessionRow {
  status?: string | null;
  stageResults?: string | null;
  updatedAt?: Date | string | null;
  virtualProfileId: string;
}

export interface CleanupCandidateView {
  id: string;
  name: string;
  createdAt: string;
  sessions: number;
  tags: string[];
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 选出可清理的实例：在跑的豁免、其余按建号时间升序（最先建的排前面，运营一眼看出清谁）。
 * 返回 `candidates` 与 `runningCount`（豁免数，界面摘要用）。
 */
export function selectCleanupCandidates(
  aged: readonly AgedInstanceRow[],
  liveSessions: readonly LiveSessionRow[],
  staleBefore: Date
): { candidates: CleanupCandidateView[]; runningCount: number } {
  const runningProfileIds = new Set(
    liveSessions
      .filter((session) => classifySessionRunPhase(session, staleBefore) === 'running')
      .map((session) => session.virtualProfileId)
  );
  const candidates = aged
    .filter((row) => !runningProfileIds.has(row.id))
    .map((row) => ({
      id: row.id,
      name: row.users?.name ?? row.id.slice(0, 8),
      createdAt: row.createdAt.toISOString(),
      sessions: row._count?.sessions ?? 0,
      tags: parseTags(row.tags),
    }));
  return { candidates, runningCount: runningProfileIds.size };
}
