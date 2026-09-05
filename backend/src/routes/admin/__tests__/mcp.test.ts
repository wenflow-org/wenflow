const mockGateway = {
  getConfig: jest.fn(),
  getStatus: jest.fn(),
  getTool: jest.fn(),
  updateConfig: jest.fn(),
  callTool: jest.fn(),
};

jest.mock('../../../core/mcp/McpGateway', () => ({
  __esModule: true,
  mcpGateway: mockGateway,
}));
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));

import router from '../mcp';

function getRouteHandler(path: string, method: 'get' | 'post' | 'put' | 'delete') {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('admin MCP routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGateway.getConfig.mockReturnValue({
      tools: [
        { id: 'local-bus', name: '本地总线', type: 'local', endpoint: '', description: '', enabled: true, userAccessible: true },
        { id: 'remote-http', name: '远端服务', type: 'http', endpoint: 'https://example.com/mcp', description: '', enabled: true, apiKey: 'secret-key-123' },
      ],
    });
    mockGateway.getStatus.mockReturnValue({ servers: [], tools: {} });
  });

  it('GET / 列表脱敏：不返回 apiKey 明文，仅 hasApiKey', async () => {
    const handler = getRouteHandler('/', 'get');
    const res = createResponse();
    await handler({}, res);

    const tools = res.json.mock.calls[0][0].data.tools;
    expect(tools).toHaveLength(2);
    const remote = tools.find((t: any) => t.id === 'remote-http');
    expect(remote.hasApiKey).toBe(true);
    expect(remote.apiKey).toBeUndefined();
    const local = tools.find((t: any) => t.id === 'local-bus');
    expect(local.hasApiKey).toBe(false);
    expect(JSON.stringify(tools)).not.toContain('secret-key-123');
  });

  it('POST /tools 校验 ID 格式与必填字段', async () => {
    const handler = getRouteHandler('/tools', 'post');
    let res = createResponse();
    await handler({ body: { id: 'bad id!', name: 'x', endpoint: 'http://x' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    res = createResponse();
    await handler({ body: { id: 'ok-id', name: '', endpoint: 'http://x' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    res = createResponse();
    await handler({ body: { id: 'ok-id', name: 'x', endpoint: '' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGateway.updateConfig).not.toHaveBeenCalled();
  });

  it('POST /tools 拒绝重复 ID', async () => {
    const handler = getRouteHandler('/tools', 'post');
    const res = createResponse();
    await handler({ body: { id: 'remote-http', name: '重复', endpoint: 'http://x' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('已存在') }));
  });

  it('POST /tools 新增成功后原子写配置', async () => {
    const handler = getRouteHandler('/tools', 'post');
    const res = createResponse();
    await handler({
      body: { id: 'new-tool', name: '新工具', type: 'http', endpoint: 'https://mcp.example.com', apiKey: 'k', userAccessible: true },
    }, res);

    expect(mockGateway.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      tools: expect.arrayContaining([expect.objectContaining({ id: 'new-tool', endpoint: 'https://mcp.example.com' })]),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('PUT /tools/:id 更新与清空 apiKey', async () => {
    const handler = getRouteHandler('/tools/:id', 'put');
    const res = createResponse();
    await handler({ params: { id: 'remote-http' }, body: { name: '改名', apiKey: '' } }, res);

    const { tools } = mockGateway.updateConfig.mock.calls[0][0];
    const updated = tools.find((t: any) => t.id === 'remote-http');
    expect(updated.name).toBe('改名');
    expect(updated.apiKey).toBeUndefined();
  });

  it('PUT /tools/:id 不存在返回 404', async () => {
    const handler = getRouteHandler('/tools/:id', 'put');
    const res = createResponse();
    await handler({ params: { id: 'missing' }, body: { name: 'x' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockGateway.updateConfig).not.toHaveBeenCalled();
  });

  it('DELETE /tools/:id 删除并落盘', async () => {
    const handler = getRouteHandler('/tools/:id', 'delete');
    const res = createResponse();
    await handler({ params: { id: 'local-bus' } }, res);
    expect(mockGateway.updateConfig).toHaveBeenCalled();
    const { tools } = mockGateway.updateConfig.mock.calls[0][0];
    expect(tools.find((t: any) => t.id === 'local-bus')).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('DELETE /tools/:id 不存在返回 404', async () => {
    const handler = getRouteHandler('/tools/:id', 'delete');
    const res = createResponse();
    await handler({ params: { id: 'missing' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('POST /tools/:id/test 探测成功返回延迟与预览', async () => {
    mockGateway.getTool.mockReturnValue({ id: 'local-bus', type: 'local' });
    mockGateway.callTool.mockResolvedValue('probe ok');
    const handler = getRouteHandler('/tools/:id/test', 'post');
    const res = createResponse();
    await handler({ params: { id: 'local-bus' } }, res);

    expect(mockGateway.callTool).toHaveBeenCalledWith('local-bus', { probe: true });
    const data = res.json.mock.calls[0][0].data;
    expect(data.ok).toBe(true);
    expect(data.latencyMs).toEqual(expect.any(Number));
    expect(data.preview).toBe('probe ok');
  });

  it('POST /tools/:id/test 调用失败返回 ok:false 与错误信息', async () => {
    mockGateway.getTool.mockReturnValue({ id: 'remote-http', type: 'http' });
    mockGateway.callTool.mockRejectedValue(new Error('connection refused'));
    const handler = getRouteHandler('/tools/:id/test', 'post');
    const res = createResponse();
    await handler({ params: { id: 'remote-http' } }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toContain('connection refused');
  });

  it('POST /tools/:id/test 工具不存在返回 404', async () => {
    mockGateway.getTool.mockReturnValue(null);
    const handler = getRouteHandler('/tools/:id/test', 'post');
    const res = createResponse();
    await handler({ params: { id: 'missing' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
