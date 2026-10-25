import { createServer, Server } from 'http'

const telemetryWriterMock = {
  createLlmAttempt: jest.fn().mockResolvedValue(true),
  createAgentCall: jest.fn().mockResolvedValue(true),
  createPromptCall: jest.fn().mockResolvedValue(true),
}

jest.mock('../../../services/telemetry-writer.service', () => ({
  telemetryWriter: telemetryWriterMock,
}))
jest.mock('../../../config/database', () => ({ __esModule: true, default: {} }))
jest.mock('../../../config/system-database', () => ({ __esModule: true, default: {} }))

process.env.NODE_ENV = 'test'

import { APIExecutor } from '../executor'
import { createRetryBudget } from '../retry-budget'

/**
 * 端到端流式链路（真实 HTTP 传输 + 真实 SSE 解析 + 真实执行器）：
 * 仅 mock 遥测/数据库，safe-http 的 axios 流式路径与 SSRF 防护全部走真实代码。
 */
describe('APIExecutor streaming integration (real transport)', () => {
  let server: Server
  let baseUrl: string
  const seenBodies: any[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        seenBodies.push(JSON.parse(body || '{}'))
        if (req.url === '/v1/chat/completions') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.write('data: {"id":"c-int","model":"m1","choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}\n\n')
          res.write('data: {"id":"c-int","model":"m1","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}\n\n')
          res.write('data: {"id":"c-int","model":"m1","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\n\n')
          res.write('data: [DONE]\n\n')
          res.end()
        } else {
          res.writeHead(404).end()
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  beforeEach(() => {
    seenBodies.length = 0
    telemetryWriterMock.createLlmAttempt.mockClear()
    telemetryWriterMock.createAgentCall.mockClear()
  })

  it('真实 SSE 链路：逐段透传增量、合成 ChatResponse、写遥测', async () => {
    const deltas: string[] = []
    const response = await new APIExecutor().execute(
      {
        providerType: 'openai-compatible',
        providerId: 'int-test',
        endpoint: baseUrl,
        apiKey: 'test-key',
        model: 'm1',
        temperature: 0.2,
        maxTokens: 128,
        privateNetworkPolicy: 'runtime',
        source: 'platform',
      },
      { messages: [{ role: 'user', content: 'hi' }], stream: true },
      { traceId: 'int-stream', onStreamChunk: (delta) => deltas.push(delta), retryBudget: createRetryBudget() }
    )

    expect(deltas).toEqual(['你', '好'])
    expect(response.choices[0].message.content).toBe('你好')
    expect(response.choices[0].finish_reason).toBe('stop')
    expect(response.usage).toEqual({ prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 })
    expect(response.id).toBe('c-int')
    expect(seenBodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(telemetryWriterMock.createLlmAttempt).toHaveBeenCalledTimes(1)
    expect(telemetryWriterMock.createAgentCall).toHaveBeenCalledTimes(1)
  })

  it('空 SSE（无内容增量）→ 关闭思考重试一次后成功（D3 回归）', async () => {
    let calls = 0
    const emptyThenOk = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        seenBodies.push(JSON.parse(body || '{}'))
        calls += 1
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        if (calls === 1) {
          // 实测现场：200 + finish_reason=stop + 0 completion tokens + 无 content？
          res.write('data: {"id":"c-empty","model":"m1","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":0,"total_tokens":2}}\n\n')
        } else {
          res.write('data: {"id":"c-ok","model":"m1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n')
          res.write('data: {"id":"c-ok","model":"m1","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n')
        }
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    await new Promise<void>((resolve) => emptyThenOk.listen(0, '127.0.0.1', resolve))
    const address = emptyThenOk.address() as { port: number }
    const emptyUrl = `http://127.0.0.1:${address.port}`
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    const response = await new APIExecutor().execute(
      {
        providerType: 'openai-compatible',
        providerId: 'int-test-empty',
        endpoint: emptyUrl,
        apiKey: 'test-key',
        model: 'm1',
        temperature: 0.2,
        maxTokens: 128,
        privateNetworkPolicy: 'runtime',
        source: 'platform',
      },
      { messages: [{ role: 'user', content: 'hi' }], stream: true },
      { traceId: 'int-empty-stream', retryBudget: createRetryBudget() }
    )

    expect(response.choices[0].message.content).toBe('ok')
    expect(calls).toBe(2)
    // 重试请求关闭思考（定向纠正「思考吃掉输出预算」）
    expect(seenBodies[1].thinking).toEqual({ type: 'disabled' })
    await new Promise<void>((resolve) => emptyThenOk.close(() => resolve()))
  })

  it('非流式路径（无 stream 标记）仍走缓冲 JSON 解析', async () => {    const serverWithJson = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        seenBodies.push(JSON.parse(body || '{}'))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'c-buffered',
          model: 'm1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'buffered ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }))
      })
    })
    await new Promise<void>((resolve) => serverWithJson.listen(0, '127.0.0.1', resolve))
    const address = serverWithJson.address() as { port: number }
    const jsonUrl = `http://127.0.0.1:${address.port}`

    const response = await new APIExecutor().execute(
      {
        providerType: 'openai-compatible',
        providerId: 'int-test-json',
        endpoint: jsonUrl,
        apiKey: 'test-key',
        model: 'm1',
        temperature: 0.2,
        maxTokens: 128,
        privateNetworkPolicy: 'runtime',
        source: 'platform',
      },
      { messages: [{ role: 'user', content: 'hi' }] },
      { traceId: 'int-buffered', retryBudget: createRetryBudget() }
    )

    expect(response.choices[0].message.content).toBe('buffered ok')
    expect(seenBodies[seenBodies.length - 1].stream).toBeUndefined()
    await new Promise<void>((resolve) => serverWithJson.close(() => resolve()))
  })
})
