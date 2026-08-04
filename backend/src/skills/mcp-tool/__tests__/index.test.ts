export {}

const getUserMcpRuntimeConfig = jest.fn()
const callConfiguredTool = jest.fn()
const callTool = jest.fn()
const getTool = jest.fn()

jest.mock('../../../services/mcp/user-mcp-config.service', () => ({
  getUserMcpRuntimeConfig,
  isLocalMcpTool: (tool: { endpoint?: string }) => (
    typeof tool?.endpoint === 'string' && tool.endpoint.trim().toLowerCase() === 'local'
  )
}))

jest.mock('../../../core/mcp/McpGateway', () => ({
  mcpGateway: { callConfiguredTool, callTool, getTool }
}))

import { runWithContext } from '../../../gateway/api-gateway/context'
import { executeMcpTool } from '../index'

describe('mcp-tool capability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getUserMcpRuntimeConfig.mockResolvedValue(null)
    callConfiguredTool.mockResolvedValue({ remote: true })
    callTool.mockResolvedValue({ platform: true })
    getTool.mockReturnValue({
      id: 'platform-search',
      endpoint: 'https://platform.example/search',
      userAccessible: true,
      enabled: true
    })
  })

  it('用户配置工具优先于平台静态工具', async () => {
    const tool = {
      id: 'search',
      name: 'search',
      description: 'search',
      type: 'search',
      endpoint: 'https://tools.example/search',
      apiKey: 'secret',
      enabled: true
    }
    getUserMcpRuntimeConfig.mockResolvedValue({
      tools: [tool],
      servers: [],
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: null
    })

    const result = await runWithContext({ userId: 'user-1' }, () => executeMcpTool({
      toolId: 'search',
      params: { query: 'test' }
    }))

    expect(result).toEqual(expect.objectContaining({
      success: true,
      output: { toolId: 'search', source: 'user', result: { remote: true } }
    }))
    expect(callConfiguredTool).toHaveBeenCalledWith(tool, { query: 'test' }, {
      allowLocal: false,
      privateNetworkPolicy: 'public-only'
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('拒绝用户声明服务器本地工具', async () => {
    getUserMcpRuntimeConfig.mockResolvedValue({
      tools: [{ id: 'file-reader', endpoint: ' LOCAL ', enabled: true }],
      servers: [],
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: null
    })

    const result = await runWithContext({ userId: 'user-1' }, () => executeMcpTool({
      toolId: 'file-reader',
      params: { path: 'secret.txt' }
    }))

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'MCP_USER_LOCAL_TOOL_FORBIDDEN' })
    }))
    expect(callConfiguredTool).not.toHaveBeenCalled()
    expect(callTool).not.toHaveBeenCalled()
  })

  it('无用户工具且允许 fallback 时调用平台静态工具', async () => {
    getTool.mockReturnValue({
      id: 'platform-search',
      endpoint: 'https://platform.example/search',
      userAccessible: true,
      enabled: true
    })
    getUserMcpRuntimeConfig.mockResolvedValue({
      tools: [],
      servers: [],
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: null
    })
    callConfiguredTool.mockResolvedValueOnce({ platform: true })

    const result = await runWithContext({ userId: 'user-1' }, () => executeMcpTool({
      toolId: 'platform-search',
      params: { query: 'lesson' }
    }))

    expect(result).toEqual(expect.objectContaining({
      success: true,
      output: { toolId: 'platform-search', source: 'platform', result: { platform: true } }
    }))
    expect(callConfiguredTool).toHaveBeenCalledWith(expect.objectContaining({
      id: 'platform-search'
    }), { query: 'lesson' }, {
      allowLocal: false,
      privateNetworkPolicy: 'public-only'
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('普通用户不能通过 fallback 调用平台服务器本地工具', async () => {
    getUserMcpRuntimeConfig.mockResolvedValue(null)
    getTool.mockReturnValue({ id: 'file-reader', endpoint: 'local', enabled: true })

    const result = await runWithContext({ userId: 'user-1', userRole: 'user' }, () => executeMcpTool({
      toolId: 'file-reader',
      params: { path: './uploads/lesson.txt' }
    }))

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'MCP_TOOL_NOT_FOUND' })
    }))
    expect(callTool).not.toHaveBeenCalled()
  })

  it('平台远程工具未显式开放时普通用户不能调用', async () => {
    getUserMcpRuntimeConfig.mockResolvedValue(null)
    getTool.mockReturnValue({
      id: 'platform-search',
      endpoint: 'https://platform.example/search',
      userAccessible: false,
      enabled: true
    })

    const result = await runWithContext({ userId: 'user-1', userRole: 'user' }, () => executeMcpTool({
      toolId: 'platform-search',
      params: { query: 'lesson' }
    }))

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'MCP_TOOL_NOT_FOUND' })
    }))
    expect(callTool).not.toHaveBeenCalled()
  })

  it('管理员上下文可以调用未公开的平台本地工具', async () => {
    getTool.mockReturnValue({ id: 'file-reader', endpoint: 'local', enabled: true })
    callTool.mockResolvedValueOnce({ content: 'ok' })

    const result = await runWithContext({ userId: 'admin-1', userRole: 'admin' }, () => executeMcpTool({
      toolId: 'file-reader',
      params: { path: './uploads/lesson.txt' }
    }))

    expect(result).toEqual(expect.objectContaining({
      success: true,
      output: { toolId: 'file-reader', source: 'platform', result: { content: 'ok' } }
    }))
    expect(callTool).toHaveBeenCalledWith('file-reader', {
      path: './uploads/lesson.txt'
    }, { signal: undefined })
  })

  it('用户关闭 fallback 后不访问平台静态工具', async () => {
    getUserMcpRuntimeConfig.mockResolvedValue({
      tools: [],
      servers: [],
      routingStrategy: 'priority',
      fallbackEnabled: false,
      healthCheck: null
    })

    const result = await runWithContext({ userId: 'user-1' }, () => executeMcpTool({ toolId: 'missing' }))

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'MCP_TOOL_NOT_FOUND' })
    }))
    expect(callTool).not.toHaveBeenCalled()
  })

  it('无效历史用户工具阻止静默 fallback 到平台同名工具', async () => {
    getUserMcpRuntimeConfig.mockResolvedValue({
      tools: [],
      invalidToolIds: ['platform-search'],
      servers: [],
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: null
    })
    const result = await runWithContext({ userId: 'user-1', userRole: 'user' }, () => executeMcpTool({
      toolId: 'platform-search',
      params: { query: 'lesson' }
    }))

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: { code: 'MCP_TOOL_CONFIG_INVALID', message: 'MCP 工具配置无效' }
    }))
    expect(getTool).not.toHaveBeenCalled()
    expect(callConfiguredTool).not.toHaveBeenCalled()
  })

  it('损坏的整个 tools 配置阻止所有平台 fallback', async () => {
    getUserMcpRuntimeConfig.mockResolvedValue({
      tools: [],
      toolsConfigInvalid: true,
      servers: [],
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: null
    })

    const result = await runWithContext({ userId: 'user-1', userRole: 'user' }, () => executeMcpTool({
      toolId: 'platform-search',
      params: { query: 'lesson' }
    }))

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: { code: 'MCP_TOOL_CONFIG_INVALID', message: 'MCP 工具配置无效' }
    }))
    expect(getTool).not.toHaveBeenCalled()
  })

  it('拒绝非对象工具参数', async () => {
    const result = await executeMcpTool({ toolId: 'search', params: [] as any })

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: { code: 'MCP_TOOL_PARAMS_INVALID', message: 'MCP params 必须是对象' }
    }))
    expect(getUserMcpRuntimeConfig).not.toHaveBeenCalled()
  })

  it('拒绝 null 工具参数', async () => {
    const result = await executeMcpTool({ toolId: 'search', params: null as any })

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: { code: 'MCP_TOOL_PARAMS_INVALID', message: 'MCP params 必须是对象' }
    }))
    expect(getUserMcpRuntimeConfig).not.toHaveBeenCalled()
  })
})
