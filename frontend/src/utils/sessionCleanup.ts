// 统一会话清理：登出 / 会话失效时清空全部用户本地状态
// 集中管理键清单，避免各处清理逻辑遗漏（历史问题：v2_goal_*、projection_* 未清）
import { clearProjectionToken } from './projection';

/** 旧版未按用户隔离的目标会话缓存键（一次性迁移源；迁移/丢弃后不再写入） */
export const LEGACY_GOAL_CONVERSATION_CID_KEY = 'v2_goal_cid';
export const LEGACY_GOAL_CONVERSATION_MSGS_KEY = 'v2_goal_msgs';

const GOAL_CID_PREFIX = 'v2_goal_cid';
const GOAL_MSGS_PREFIX = 'v2_goal_msgs';

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

/** 清空全部 v2_goal_* 缓存（旧版未作用域键 + 所有账号作用域键），防止切号残留 */
export function clearGoalConversationStorage(): void {
  // 先收集再删除：边遍历边删除会使后续键下标位移，可能漏删（尤其 cid/msgs 相邻时）
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (
      key === LEGACY_GOAL_CONVERSATION_CID_KEY
      || key === LEGACY_GOAL_CONVERSATION_MSGS_KEY
      || key.startsWith(`${GOAL_CID_PREFIX}:`)
      || key.startsWith(`${GOAL_MSGS_PREFIX}:`)
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
  localStorage.removeItem('wenflow_session');
  // 投影令牌（真实凭据）登出必清
  clearProjectionToken();
}
