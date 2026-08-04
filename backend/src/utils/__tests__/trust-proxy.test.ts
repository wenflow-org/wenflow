import express from 'express'
import type { Server } from 'http'
import { resolveTrustProxySetting } from '../trust-proxy'

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
