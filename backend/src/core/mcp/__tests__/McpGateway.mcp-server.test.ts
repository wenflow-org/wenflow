import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

jest.mock('../../../utils/safe-http', () => {
  const actual = jest.requireActual('../../../utils/safe-http')
  return { ...actual, safeHttpRequest: jest.fn() }
})

import { safeHttpRequest } from '../../../utils/safe-http'
import { McpGateway, mcpGateway } from '../McpGateway'

const requestMock = safeHttpRequest as jest.Mock

/** 构造一个 SSE 形态的 JSON-RPC 响应（真 MCP server 的常见返回） */
function sse(message: unknown) {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' },
    data: `event: message\ndata: ${JSON.stringify(message)}\n\n`,
    url: 'https://mcp.example/mcp',
  }
}

/** 按 JSON-RPC method 分派响应，模拟 server 端行为 */
function installMockServer() {
  requestMock.mockImplementation(async (_url: string, options: { body?: { method?: string; id?: number; params?: { name?: string } } }) => {
    const body = options?.body || {}
    switch (body.method) {
      case 'initialize':
        return sse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-06-18', serverInfo: { name: 'mock-mcp', version: '9.9' } },
        })
      case 'notifications/initialized':
        return { status: 202, statusText: 'Accepted', headers: {}, data: '', url: 'x' }
      case 'tools/list':
        return sse({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'tavily_search', description: 'search' }, { name: 'tavily_map' }] },
        })
      case 'tools/call': {
        const toolName = body.params?.name
        if (toolName === 'boom') {
          return sse({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: 'failed' }] } })
        }
        if (toolName === 'rpc-error') {
          return sse({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } })
        }
        return sse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ results: [{ url: 'https://a.example' }] }) }],
            structuredContent: { ok: true },
          },
        })
      }
      default:
        throw new Error(`unexpected method: ${body.method}`)
    }
  })
}

describe('McpGateway 真 MCP server 分支（transport=mcp）', () => {
  let workspace: string
  let gateway: McpGateway

  afterAll(() => {
    mcpGateway.destroy()
  })

  beforeEach(async () => {
    requestMock.mockReset()
    installMockServer()
    workspace = await mkdtemp(join(tmpdir(), 'wenflow-mcp-server-'))
    const configPath = join(workspace, 'mcp.json')
    await writeFile(configPath, JSON.stringify({
      version: '1',
      description: 'test',
      providers: [],
      tools: [
        {
          id: 'tavily',
          name: 'Tavily MCP',
          description: '真 MCP server',
          type: 'mcp',
          transport: 'mcp',
          endpoint: 'https://mcp.example/mcp',
          apiKey: 'secret',
          enabled: true,
          userAccessible: true,
        },
        {
          id: 'http-tool',
          name: '通用 HTTP',
          description: '非 MCP',
          type: 'http',
          endpoint: 'https://http.example/api',
          enabled: true,
        },
      ],
      routing: { strategy: 'priority', fallback: false, healthCheck: { enabled: false, interval: 30000 } },
    }))
    gateway = new McpGateway(configPath)
  })

  afterEach(async () => {
    gateway.destroy()
    await rm(workspace, { recursive: true, force: true })
  })

  it('tools/list 发现工具，并命中缓存（第二次不再请求）', async () => {
    const first = await gateway.listMcpServerTools('tavily')
    expect(first.map((t) => t.name)).toEqual(['tavily_search', 'tavily_map'])

    const callsAfterFirst = requestMock.mock.calls.filter((c) => c[1]?.body?.method === 'tools/list').length
    const second = await gateway.listMcpServerTools('tavily')
    const callsAfterSecond = requestMock.mock.calls.filter((c) => c[1]?.body?.method === 'tools/list').length

    expect(second.map((t) => t.name)).toEqual(['tavily_search', 'tavily_map'])
    expect(callsAfterSecond).toBe(callsAfterFirst)

    // refresh=true 强制重取
    await gateway.listMcpServerTools('tavily', { refresh: true })
    expect(requestMock.mock.calls.filter((c) => c[1]?.body?.method === 'tools/list').length)
      .toBe(callsAfterFirst + 1)
  })

  it('callTool 以 <serverId>:<toolName> 寻址调用并返回 content', async () => {
    const result = await gateway.callTool('tavily:tavily_search', { query: 'x' })
    expect(result.structuredContent).toEqual({ ok: true })
    expect(result.content[0].text).toContain('https://a.example')

    const callArgs = requestMock.mock.calls.find((c) => c[1]?.body?.method === 'tools/call')
    expect(callArgs?.[1]?.body?.params).toEqual({ name: 'tavily_search', arguments: { query: 'x' } })
  })

  it('MCP server 必须带工具名，裸 id 调用报 MCP_TOOL_NAME_REQUIRED', async () => {
    await expect(gateway.callTool('tavily', { query: 'x' }))
      .rejects.toMatchObject({ code: 'MCP_TOOL_NAME_REQUIRED' })
  })

  it('非 MCP 条目做工具发现报 MCP_SERVER_TRANSPORT_MISMATCH', async () => {
    await expect(gateway.listMcpServerTools('http-tool'))
      .rejects.toMatchObject({ code: 'MCP_SERVER_TRANSPORT_MISMATCH' })
  })

  it('上游工具 isError=true 时抛 MCP_UPSTREAM_TOOL_ERROR', async () => {
    await expect(gateway.callTool('tavily:boom', {}))
      .rejects.toMatchObject({ code: 'MCP_UPSTREAM_TOOL_ERROR' })
  })

  it('JSON-RPC error 抛 MCP_JSONRPC_ERROR', async () => {
    await expect(gateway.callTool('tavily:rpc-error', {}))
      .rejects.toMatchObject({ code: 'MCP_JSONRPC_ERROR' })
  })

  it('普通 HTTP 工具（含 id 中带冒号）仍走原路径，不受 MCP 解析影响', async () => {
    // 'http-tool' 非 MCP：精确匹配分支应正常 POST，而不是被当成 MCP 引用
    requestMock.mockResolvedValueOnce({
      status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' },
      data: { echoed: true }, url: 'https://http.example/api',
    })
    const result = await gateway.callTool('http-tool', { ping: 1 })
    expect(result).toEqual({ echoed: true })
    expect(requestMock).toHaveBeenCalledWith('https://http.example/api', expect.objectContaining({ method: 'POST' }))
  })

  it('getStatus 暴露 transport 与已发现工具', async () => {
    await gateway.listMcpServerTools('tavily')
    const status = gateway.getStatus()
    const tavily = status.tools.find((t) => t.id === 'tavily')
    const httpTool = status.tools.find((t) => t.id === 'http-tool')
    expect(tavily?.transport).toBe('mcp')
    expect(tavily?.discoveredTools).toEqual(['tavily_search', 'tavily_map'])
    expect(httpTool?.transport).toBe('http')
    expect(httpTool?.discoveredTools).toBeUndefined()
  })
})
