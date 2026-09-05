// 统一会话清理：登出 / 会话失效时清空全部用户本地状态
// 集中管理键清单，避免各处清理逻辑遗漏（历史问题：v2_goal_*、projection_* 未清）
import { clearProjectionToken } from './projection';

export const GOAL_CONVERSATION_CID_KEY = 'v2_goal_cid';
export const GOAL_CONVERSATION_MSGS_KEY = 'v2_goal_msgs';

export function clearUserLocalState(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('wenflow_session');
  // 目标规划会话内容（含隐私对话）随登出一并清除
  localStorage.removeItem(GOAL_CONVERSATION_CID_KEY);
  localStorage.removeItem(GOAL_CONVERSATION_MSGS_KEY);
  // 投影令牌（真实凭据）登出必清
  clearProjectionToken();
}
