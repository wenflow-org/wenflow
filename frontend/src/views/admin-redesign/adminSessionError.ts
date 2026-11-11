/**
 * 控制台启动失败的分类（2026-11-11 用户截图：诊断写着「会话已吊销或过期」，
 * 正文却说「数据服务没有正常响应」——把登录态问题误报成服务故障，用户只会反复点重试）。
 *
 * live 层失败只保留后端 message，HTTP 状态在进入 bootError 前已丢失，所以按文案判定。
 * 登录态问题的出口是重新登录；其余才是重试 / 排查服务。
 */
const AUTH_ERROR_RE = /权限|登录|401|403|unauthori[sz]ed|forbidden|会话|吊销|过期|失效|session|token/i

export function isAdminAuthError(message: string): boolean {
  return AUTH_ERROR_RE.test(String(message || ''))
}
