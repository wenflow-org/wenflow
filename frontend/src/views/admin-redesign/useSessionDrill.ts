/**
 * 会话列表下钻共享（TeachingSessions / GoalConversations 同构复用）。
 * 真实会话与控制台数据契约不兼容（座舱仅服务虚拟会话），三跳转提供轻量深链：
 * - goLearner：学习者画像（openSubPage learner）
 * - goTrace：执行日志 Trace 按 sessionId 归组（openSession）
 * - goConsole：真实会话只读座舱（openSubPage session-real）
 * 各页关闭抽屉逻辑不同（URL 参数名 session/goal），由调用方传入 closeDetail。
 */
import { openSubPage, openSession } from './store'

/** 下钻行最小结构（两页自有 Row 仅需 id/userId 即可触发跳转） */
export interface SessionDrillRow {
  id?: string
  userId?: string
}

export interface SessionDrillActions {
  goLearner: (r: SessionDrillRow) => void
  goTrace: (r: SessionDrillRow) => void
  goConsole: (r: SessionDrillRow) => void
}

/** 生成三跳转动作：closeDetail 由页面提供（关闭抽屉 + 清 URL 参数），动作内部先关闭再跳转 */
export function useSessionDrill(closeDetail: () => void): SessionDrillActions {
  function goLearner(r: SessionDrillRow) {
    if (!r.userId) return
    closeDetail()
    openSubPage('learner', r.userId)
  }
  function goTrace(r: SessionDrillRow) {
    closeDetail()
    openSession(r.id || '')
  }
  function goConsole(r: SessionDrillRow) {
    if (!r.id) return
    closeDetail()
    openSubPage('session-real', r.id)
  }
  return { goLearner, goTrace, goConsole }
}
