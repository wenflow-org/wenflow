/**
 * 控制台启动失败分类（2026-11-11 用户截图优化）：
 * 「会话已吊销或过期」曾被当成数据服务故障，正文写「数据服务没有正常响应」并给出无用的「重试」。
 * 登录态问题必须走「重新登录」出口；只有真正的服务/网络故障才给重试。
 */
import { describe, expect, it } from 'vitest'
import { isAdminAuthError } from '../adminSessionError'

describe('adminSessionError', () => {
  it('会话吊销 / 过期 / 401 归为登录态问题', () => {
    expect(isAdminAuthError('会话已吊销或过期')).toBe(true)
    expect(isAdminAuthError('401 Unauthorized')).toBe(true)
    expect(isAdminAuthError('登录已过期，请重新登录')).toBe(true)
    expect(isAdminAuthError('权限已失效')).toBe(true)
    expect(isAdminAuthError('session revoked')).toBe(true)
  })

  it('网络 / 服务故障不归为登录态问题（仍给重试出口）', () => {
    expect(isAdminAuthError('Failed to fetch')).toBe(false)
    expect(isAdminAuthError('请求超时（30s）')).toBe(false)
    expect(isAdminAuthError('服务暂时不可用')).toBe(false)
    expect(isAdminAuthError('')).toBe(false)
  })
})
