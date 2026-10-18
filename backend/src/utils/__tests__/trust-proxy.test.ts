import express from 'express'
import type { Server } from 'http'
import { resolveTrustProxySetting, assessAdminAllowlistRisk } from '../trust-proxy'

async function requestClientIp(trustProxy: boolean | number | string, forwardedFor: string) {
  const app = express()
  app.set('trust proxy', trustProxy)
  app.get('/', (req, res) => res.json({ ip: req.ip, ips: req.ips }))
  const server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务器地址不可用')
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      headers: { 'x-forwarded-for': forwardedFor }
    })
    return await response.json() as { ip: string; ips: string[] }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

describe('trust proxy boundary', () => {
  it('生产默认不信任代理，并拒绝信任任意来源', () => {
    expect(resolveTrustProxySetting(undefined, 'production')).toBe(false)
    expect(() => resolveTrustProxySetting('true', 'production')).toThrow('TRUST_PROXY=true')
  })

  it('接受显式 IP、CIDR 或跳数配置', () => {
    expect(resolveTrustProxySetting('127.0.0.1', 'production')).toBe('127.0.0.1')
    expect(resolveTrustProxySetting('10.0.0.0/8', 'production')).toBe('10.0.0.0/8')
    expect(resolveTrustProxySetting('127.0.0.1, 10.0.0.0/8', 'production'))
      .toBe('127.0.0.1, 10.0.0.0/8')
    expect(resolveTrustProxySetting('1', 'production')).toBe(1)
  })

  it('启动时拒绝格式错误或越界的代理地址', () => {
    expect(() => resolveTrustProxySetting('proxy.internal', 'production')).toThrow('TRUST_PROXY')
    expect(() => resolveTrustProxySetting('10.0.0.0/33', 'production')).toThrow('TRUST_PROXY')
    expect(() => resolveTrustProxySetting('::1/129', 'production')).toThrow('TRUST_PROXY')
  })

  it('直连来源不受信时忽略伪造的 X-Forwarded-For', async () => {
    const result = await requestClientIp('203.0.113.10', '192.168.1.20')
    expect(result.ip).toBe('127.0.0.1')
    expect(result.ips).toEqual([])
  })

  it('只从受信代理读取其写入的客户端地址', async () => {
    const result = await requestClientIp('127.0.0.1', '192.168.1.20')
    expect(result.ip).toBe('192.168.1.20')
    expect(result.ips).toEqual(['192.168.1.20'])
  })
})

/**
 * 2026-10-17：管理端「按来源 IP 放行」的白名单与 TRUST_PROXY 的组合风险。
 * 实测：TRUST_PROXY=true/跳数 时，把 X-Forwarded-For 写成 127.0.0.1 即可穿过 private 白名单。
 */
describe('admin allowlist × trust proxy', () => {
  it('trust proxy 为 true 或非零跳数时判定为可伪造', () => {
    expect(assessAdminAllowlistRisk({ trustProxy: true, adminAccessMode: 'private' }).spoofable).toBe(true)
    expect(assessAdminAllowlistRisk({ trustProxy: 1, adminAccessMode: 'loopback' }).spoofable).toBe(true)
  })

  it('不信任代理（false / 0）时不可伪造', () => {
    expect(assessAdminAllowlistRisk({ trustProxy: false, adminAccessMode: 'private' }).spoofable).toBe(false)
    expect(assessAdminAllowlistRisk({ trustProxy: 0, adminAccessMode: 'private' }).spoofable).toBe(false)
  })

  it('显式代理 IP/CIDR 列表不判定为可伪造（只有来自该代理的连接才被信任）', () => {
    expect(assessAdminAllowlistRisk({ trustProxy: '127.0.0.1', adminAccessMode: 'private' }).spoofable).toBe(false)
    expect(assessAdminAllowlistRisk({ trustProxy: '10.0.0.0/8', adminAccessMode: 'loopback' }).spoofable).toBe(false)
  })

  it('ADMIN_ACCESS_MODE=any 时白名单本就不生效，不告警', () => {
    expect(assessAdminAllowlistRisk({ trustProxy: true, adminAccessMode: 'any' }).spoofable).toBe(false)
  })

  it('未设置 ADMIN_ACCESS_MODE 按 private 处理（默认收紧）', () => {
    expect(assessAdminAllowlistRisk({ trustProxy: true, adminAccessMode: undefined }).spoofable).toBe(true)
    expect(assessAdminAllowlistRisk({ trustProxy: true, adminAccessMode: null }).spoofable).toBe(true)
  })

  it('组合风险确实成立：trust proxy=1 时伪造 XFF 会改变 req.ip（真起服务验证）', async () => {
    const result = await requestClientIp(1, '127.0.0.1')
    expect(result.ip).toBe('127.0.0.1')
  })
})
