import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
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
      servers: [],
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
