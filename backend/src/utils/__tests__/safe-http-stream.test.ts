import { PassThrough } from 'stream'

jest.mock('dns/promises', () => ({ lookup: jest.fn() }))
jest.mock('axios', () => ({
  __esModule: true,
  default: { request: jest.fn() }
}))

const canAccessPrivateNetworkMock = jest.fn()
jest.mock('../../services/runtime-network-policy.service', () => ({
  canAccessPrivateNetwork: (...args: unknown[]) => canAccessPrivateNetworkMock(...args)
}))

import axios from 'axios'
import { lookup } from 'dns/promises'
import {
  SafeHttpAbortError,
  SafeHttpBodyLimitError,
  SafeHttpTimeoutError,
  safeHttpStreamRequest
} from '../safe-http'

const lookupMock = lookup as jest.Mock
const requestMock = axios.request as jest.Mock

const streamResponse = (status: number, body?: (stream: PassThrough) => void, headers: Record<string, string> = {}) => {
  const stream = new PassThrough()
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'content-type': 'text/event-stream', ...headers },
    data: stream,
    body: stream
  } as any
}

describe('safeHttpStreamRequest', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    canAccessPrivateNetworkMock.mockReset()
    canAccessPrivateNetworkMock.mockReturnValue(true)
    lookupMock.mockReset()
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    requestMock.mockReset()
  })

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('响应头先于响应体回调 onHeaders，流结束后返回累计字节数', async () => {
    const response = streamResponse(200)
    response.data.write('data: a\n\n')
    response.data.write('data: b\n\n')
    response.data.end()
    requestMock.mockResolvedValue(response)

    const onHeaders = jest.fn()
    const onChunk = jest.fn()
    const result = await safeHttpStreamRequest('https://example.com/v1/chat/completions', {
      method: 'POST',
      body: { stream: true },
      onHeaders,
      onChunk
    })

    expect(onHeaders).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': 'text/event-stream' }))
    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(result.status).toBe(200)
    expect(result.totalBytes).toBe(18)
  })

  it('超过累计字节上限时抛 SafeHttpBodyLimitError 并中断', async () => {
    const response = streamResponse(200)
    requestMock.mockResolvedValue(response)

    const promise = safeHttpStreamRequest('https://example.com/v1/chat/completions', {
      method: 'POST',
      maxResponseBytes: 10,
      onChunk: () => {}
    })
    // 先挂载断言再触发数据流，避免拒绝先于 handler 注册
    const assertion = expect(promise).rejects.toBeInstanceOf(SafeHttpBodyLimitError)

    response.data.write(Buffer.alloc(6, 97))
    await new Promise((resolve) => setImmediate(resolve))
    response.data.write(Buffer.alloc(6, 97))

    await assertion
  })

  it('空闲超时：收到首块数据后无后续数据即抛 SafeHttpTimeoutError', async () => {
    const response = streamResponse(200)
    requestMock.mockResolvedValue(response)

    const promise = safeHttpStreamRequest('https://example.com/v1/chat/completions', {
      method: 'POST',
      idleTimeoutMs: 50,
      timeoutMs: 1000,
      onChunk: () => {}
    })
    const assertion = expect(promise).rejects.toBeInstanceOf(SafeHttpTimeoutError)

    response.data.write('data: x\n\n')
    await assertion
  }, 5000)

  it('调用方 abort 中断流并抛 SafeHttpAbortError', async () => {
    const response = streamResponse(200)
    requestMock.mockResolvedValue(response)

    const controller = new AbortController()
    const promise = safeHttpStreamRequest('https://example.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      onChunk: () => {}
    })
    const assertion = expect(promise).rejects.toBeInstanceOf(SafeHttpAbortError)

    response.data.write('data: x\n\n')
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()

    await assertion
  })

  it('TTFT 超时（响应头未就绪）抛 SafeHttpTimeoutError', async () => {
    requestMock.mockImplementation(() => new Promise(() => {}))
    await expect(safeHttpStreamRequest('https://example.com/v1/chat/completions', {
      method: 'POST',
      timeoutMs: 50
    })).rejects.toBeInstanceOf(SafeHttpTimeoutError)
  })

  it('私网策略 public-only 拒绝内网地址', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.8', family: 4 }])
    await expect(safeHttpStreamRequest('https://internal.example.com/v1/chat/completions', {
      method: 'POST',
      privateNetworkPolicy: 'public-only'
    })).rejects.toThrow('域名解析到了当前调用不允许访问的本机或局域网地址')
  })
})
