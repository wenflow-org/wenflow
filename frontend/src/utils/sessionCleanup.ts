// 统一会话清理：登出 / 会话失效时清空全部用户本地状态
// 集中管理键清单，避免各处清理逻辑遗漏（历史问题：v2_goal_*、projection_* 未清）
import { clearProjectionToken } from './projection';

/** 旧版未按用户隔离的目标会话缓存键（一次性迁移源；迁移/丢弃后不再写入） */
export const LEGACY_GOAL_CONVERSATION_CID_KEY = 'v2_goal_cid';
export const LEGACY_GOAL_CONVERSATION_MSGS_KEY = 'v2_goal_msgs';

const GOAL_CID_PREFIX = 'v2_goal_cid';
const GOAL_MSGS_PREFIX = 'v2_goal_msgs';
const RECENT_GOALS_PREFIX = 'wf_goal_recent';
/** 目标页生成跟踪键前缀：确认后记住 pathId，刷新/重进目标页时凭它恢复「正在生成」pill（P22） */
const GOAL_GEN_PREFIX = 'v2_goal_gen';
/** 旧版未按用户隔离的最近会话列表键；无法证明归属，只能丢弃，不能迁移 */
export const LEGACY_RECENT_GOALS_KEY = RECENT_GOALS_PREFIX;

/** 从 localStorage 读取当前登录用户 id（由 stores/user 写入）；无法解析返回 null */
export function currentUserId(): string | null {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown };
    const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
    return id || null;
  } catch {
    return null;
  }
}

/** 目标会话缓存键：按 userId 作用域，避免同浏览器多账号互相恢复 */
export function goalConversationCidKey(userId: string): string {
  return `${GOAL_CID_PREFIX}:${userId}`;
}

export function goalConversationMsgsKey(userId: string): string {
  return `${GOAL_MSGS_PREFIX}:${userId}`;
}

/** 最近会话摘要键：按 userId 隔离；未作用域旧键不迁移 */
export function recentGoalsKey(userId: string): string {
  return `${RECENT_GOALS_PREFIX}:${userId}`;
}

export function getRecentGoalsStorage(userId: string): string | null {
  return userId ? localStorage.getItem(recentGoalsKey(userId)) : null;
}

export function setRecentGoalsStorage(userId: string, json: string): void {
  if (!userId) return;
  localStorage.setItem(recentGoalsKey(userId), json);
}

export function removeRecentGoalsStorage(userId: string): void {
  if (!userId) return;
  localStorage.removeItem(recentGoalsKey(userId));
}

/** 丢弃旧版共享最近会话列表：其中会话归属不明，绝不能迁移给当前账号 */
export function dropLegacyRecentGoalsStorage(): void {
  localStorage.removeItem(LEGACY_RECENT_GOALS_KEY);
}

/** 读取当前用户缓存的目标会话 ID（未登录返回 null） */
export function getGoalConversationCid(): string | null {
  const id = currentUserId();
  return id ? localStorage.getItem(goalConversationCidKey(id)) : null;
}

export function setGoalConversationCid(cid: string): void {
  const id = currentUserId();
  if (!id || !cid) return;
  localStorage.setItem(goalConversationCidKey(id), cid);
}

/** 读取当前用户缓存的消息列表 JSON（未登录返回 null） */
export function getGoalConversationMsgs(): string | null {
  const id = currentUserId();
  return id ? localStorage.getItem(goalConversationMsgsKey(id)) : null;
}

export function setGoalConversationMsgs(json: string): void {
  const id = currentUserId();
  if (!id) return;
  localStorage.setItem(goalConversationMsgsKey(id), json);
}

/** 删除指定用户（默认当前用户）的目标会话缓存 */
export function removeGoalConversationStorage(userId?: string | null): void {
  const id = userId === undefined ? currentUserId() : userId;
  if (!id) return;
  localStorage.removeItem(goalConversationCidKey(id));
  localStorage.removeItem(goalConversationMsgsKey(id));
}

/** 生成跟踪键：按 userId 作用域（同会话缓存口径） */
export function goalGenTrackingKey(userId: string): string {
  return `${GOAL_GEN_PREFIX}:${userId}`;
}

export interface GoalGenTrackingEntry {
  pathId: string;
  /** 发起这次生成的会话 id（2026-11-06 走查 图4）：入口页要把「生成中」挂回
      「最近会话」中对应的那一行，而不是另起一颗孤立胶囊。老数据没有该字段 → 可选。 */
  conversationId?: string;
  at: number;
}

/** 读取当前用户的生成跟踪（坏数据 / 未登录返回 null，不让恢复流程挂掉） */
export function getGoalGenTracking(userId: string | null): GoalGenTrackingEntry | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(goalGenTrackingKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoalGenTrackingEntry>;
    const pathId = typeof parsed?.pathId === 'string' ? parsed.pathId.trim() : '';
    if (!pathId) return null;
    const conversationId = typeof parsed?.conversationId === 'string' ? parsed.conversationId.trim() : '';
    return {
      pathId,
      ...(conversationId ? { conversationId } : {}),
      at: typeof parsed?.at === 'number' && Number.isFinite(parsed.at) ? parsed.at : 0
    };
  } catch {
    return null;
  }
}

/** 确认拿到 pathId 时写入；生成仍在后端跑时刷新/离页后凭它恢复 pill */
export function setGoalGenTracking(userId: string | null, pathId: string, conversationId?: string | null): void {
  if (!userId || !pathId) return;
  const cid = typeof conversationId === 'string' ? conversationId.trim() : '';
  try {
    localStorage.setItem(goalGenTrackingKey(userId), JSON.stringify({
      pathId,
      ...(cid ? { conversationId: cid } : {}),
      at: Date.now()
    } satisfies GoalGenTrackingEntry));
  } catch { /* 隐私模式忽略 */ }
}

/** 生成已到终态（完成/失败）后清除：下次挂载不再回查、不再显示 pill */
export function clearGoalGenTracking(userId: string | null): void {
  if (!userId) return;
  localStorage.removeItem(goalGenTrackingKey(userId));
}

/** 丢弃旧版未作用域缓存——本地无法核实归属，绝不迁移给当前账号 */
export function dropLegacyGoalConversationStorage(): void {
  localStorage.removeItem(LEGACY_GOAL_CONVERSATION_CID_KEY);
  localStorage.removeItem(LEGACY_GOAL_CONVERSATION_MSGS_KEY);
}

/**
 * 一次性迁移：把旧版未作用域缓存归到当前用户。
 * 仅在应用启动、当前登录用户即缓存写入者时调用（initFromStorage）：
 * 任何登录/注册动作都会先 drop 旧键，因此此处残留的旧键必属当前账号，
 * 不会把上个账号的会话迁移给新账号。无法确认归属时一律丢弃。
 */
export function migrateLegacyGoalConversationStorage(userId: string): void {
  if (!userId) {
    dropLegacyGoalConversationStorage();
    return;
  }
  const legacyCid = localStorage.getItem(LEGACY_GOAL_CONVERSATION_CID_KEY);
  const legacyMsgs = localStorage.getItem(LEGACY_GOAL_CONVERSATION_MSGS_KEY);
  if (legacyCid) localStorage.setItem(goalConversationCidKey(userId), legacyCid);
  if (legacyMsgs) localStorage.setItem(goalConversationMsgsKey(userId), legacyMsgs);
  dropLegacyGoalConversationStorage();
}

/** 清空全部目标对话缓存（旧版未作用域键 + 所有账号作用域键），防止切号残留 */
export function clearGoalConversationStorage(): void {
  // 先收集再删除：边遍历边删除会使后续键下标位移，可能漏删（尤其 cid/msgs 相邻时）
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (
      key === LEGACY_GOAL_CONVERSATION_CID_KEY
      || key === LEGACY_GOAL_CONVERSATION_MSGS_KEY
      || key === LEGACY_RECENT_GOALS_KEY
      || key.startsWith(`${GOAL_CID_PREFIX}:`)
      || key.startsWith(`${GOAL_MSGS_PREFIX}:`)
      || key.startsWith(`${RECENT_GOALS_PREFIX}:`)
      || key.startsWith(`${GOAL_GEN_PREFIX}:`)
    ) {
      keys.push(key);
    }
  }
  for (const key of keys) localStorage.removeItem(key);
}

export function clearUserLocalState(): void {
  // 目标规划会话内容（含隐私对话）：旧版未作用域键 + 各账号作用域键一并清除
  clearGoalConversationStorage();
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  // 档案拉取时间戳与 'user' 同生命周期（user store 的 false 缓存 TTL 依赖）
  localStorage.removeItem('user_fetched_at');
  localStorage.removeItem('wenflow_session');
  // 投影令牌（真实凭据）登出必清
  clearProjectionToken();
}
