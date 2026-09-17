import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { McpGateway, mcpGateway } from '../McpGateway'

describe('McpGateway filesystem tool', () => {
  let workspace: string
  let gateway: McpGateway
  const previousCwd = process.cwd()

  afterAll(() => {
    mcpGateway.destroy()
  })

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'wenflow-mcp-gateway-'))
    await mkdir(join(workspace, 'uploads'))
    await mkdir(join(workspace, 'uploads-private'))
    await writeFile(join(workspace, 'uploads', 'lesson.txt'), 'lesson')
    await writeFile(join(workspace, 'uploads-private', 'secret.txt'), 'secret')
    const configPath = join(workspace, 'mcp.json')
    await writeFile(configPath, JSON.stringify({
      version: '1',
      description: 'test',
      providers: [],
      tools: [{
        id: 'file-reader',
        name: '文件读取',
        description: 'test',
        type: 'filesystem',
        endpoint: 'local',
        config: { allowedPaths: ['./uploads'], maxFileSize: 8 },
        enabled: true
      }],
      agents: {},
      routing: { strategy: 'priority', fallback: false, healthCheck: { enabled: false, interval: 30000 } }
    }))
    process.chdir(workspace)
    gateway = new McpGateway(configPath)
  })

  afterEach(async () => {
    gateway.destroy()
    process.chdir(previousCwd)
    await rm(workspace, { recursive: true, force: true })
  })

  it('通过 Gateway 读取允许目录内文件', async () => {
    await expect(gateway.callTool('file-reader', { path: './uploads/lesson.txt' }))
      .resolves.toEqual({ content: 'lesson', path: './uploads/lesson.txt' })
  })

  it('通过 Gateway 拒绝前缀目录逃逸', async () => {
    await expect(gateway.callTool('file-reader', { path: './uploads-private/secret.txt' }))
      .rejects.toThrow('允许范围')
  })

  it('拒绝外部配置调用服务器本地工具', async () => {
    await expect(gateway.callConfiguredTool({
      id: 'user-file-reader',
      name: 'user file reader',
      description: 'test',
      type: 'filesystem',
      endpoint: 'local',
      enabled: true
    }, { path: './uploads/lesson.txt' }, { allowLocal: false }))
      .rejects.toThrow('不允许执行服务器本地')
  })
})

describe('McpGateway 配置字段归一（servers → providers）', () => {
  let workspace: string

  afterAll(() => {
    mcpGateway.destroy()
  })

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'wenflow-mcp-legacy-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  async function loadWith(raw: Record<string, unknown>): Promise<{ gateway: McpGateway; configPath: string }> {
    const configPath = join(workspace, 'mcp.json')
    await writeFile(configPath, JSON.stringify(raw))
    return { gateway: new McpGateway(configPath), configPath }
  }

  const routing = { strategy: 'priority', fallback: false, healthCheck: { enabled: false, interval: 30000 } }

  it('旧字段 servers 加载时迁移为 providers，写回后旧键被清除', async () => {
    const { gateway, configPath } = await loadWith({
      version: '1',
      description: 'legacy',
      servers: [{
        id: 'openai', name: 'OpenAI', type: 'openai',
        endpoint: 'https://api.openai.com/v1', apiKey: 'k',
        models: [], defaultModel: 'gpt-4', priority: 1, enabled: true,
        config: { timeout: 1000 }
      }],
      tools: [],
      routing
    })

    expect(gateway.getConfig().providers).toHaveLength(1)
    expect(gateway.getStatus().providers[0]).toMatchObject({ id: 'openai', name: 'OpenAI' })

    await gateway.updateConfig({ tools: [] })
    const onDisk = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(onDisk.servers).toBeUndefined()
    expect(onDisk.providers).toHaveLength(1)

    gateway.destroy()
  })

  it('新字段 providers 生效；两者都缺省时归一为空数组', async () => {
    const { gateway } = await loadWith({
      version: '1',
      description: 'new',
      providers: [{
        id: 'p1', name: 'P1', type: 'openai', endpoint: 'https://p1',
        apiKey: '', models: [], defaultModel: 'm', priority: 1, enabled: true, config: {}
      }],
      tools: [],
      routing
    })
    expect(gateway.getConfig().providers.map((p) => p.id)).toEqual(['p1'])
    gateway.destroy()

    const { gateway: emptyGateway } = await loadWith({
      version: '1', description: 'empty', tools: [], routing
    })
    expect(emptyGateway.getConfig().providers).toEqual([])
    emptyGateway.destroy()
  })
})
