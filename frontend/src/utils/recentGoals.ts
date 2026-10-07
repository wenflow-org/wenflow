/** Account-scoped storage for the goal-planning recent-session list. */
import {
  getRecentGoalsStorage,
  setRecentGoalsStorage,
} from './sessionCleanup';

export interface RecentGoalEntry {
  id: string;
  preview: string;
  at: number;
}

function parseRecentGoals(raw: string | null): RecentGoalEntry[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const entries: RecentGoalEntry[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Partial<RecentGoalEntry>;
    if (typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) continue;
    if (typeof item.preview !== 'string' || typeof item.at !== 'number' || !Number.isFinite(item.at)) continue;
    seen.add(item.id);
    entries.push({ id: item.id, preview: item.preview, at: item.at });
    if (entries.length === 5) break;
  }
  return entries;
}

/** Read only the current user's list. IDs are checked by the ownership-protected API on navigation. */
export function loadRecentGoalsForUser(userId: string | null): RecentGoalEntry[] {
  if (!userId) return [];
  try {
    return parseRecentGoals(getRecentGoalsStorage(userId));
  } catch {
    setRecentGoalsStorage(userId, '[]');
    return [];
  }
}

export function rememberRecentGoalForUser(
  userId: string | null,
  entry: RecentGoalEntry,
): RecentGoalEntry[] {
  if (!userId || !entry.id) return [];
  let existing: RecentGoalEntry[] = [];
  try {
    existing = parseRecentGoals(getRecentGoalsStorage(userId));
  } catch {
    // Replace malformed data with the newly recorded entry.
  }
  const next = [entry, ...existing.filter((item) => item.id !== entry.id)].slice(0, 5);
  try { setRecentGoalsStorage(userId, JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
  return next;
}

export function forgetRecentGoalForUser(userId: string | null, id: string): RecentGoalEntry[] {
  if (!userId || !id) return [];
  let existing: RecentGoalEntry[] = [];
  try {
    existing = parseRecentGoals(getRecentGoalsStorage(userId));
  } catch {
    // Malformed storage is replaced with an empty list below.
  }
  const next = existing.filter((item) => item.id !== id);
  try { setRecentGoalsStorage(userId, JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
  return next;
}
