const mockSave = jest.fn();
const mockList = jest.fn();
const mockRead = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../services/materials/material-upload.service', () => ({
  __esModule: true,
  saveUploadedMaterial: (...args: any[]) => mockSave(...args),
  listMaterials: (...args: any[]) => mockList(...args),
  readMaterial: (...args: any[]) => mockRead(...args),
  deleteMaterial: (...args: any[]) => mockDelete(...args),
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), info: jest.fn() } }));

import router from '../materials.routes';

function getRouteHandler(method: 'post' | 'get' | 'delete', routePath: string) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === routePath && item.route?.methods?.[method]
  );
  if (!layer) throw new Error(`Route not found: ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function createRequest(overrides: Record<string, unknown> = {}) {
  return { user: { userId: 'user-1' }, params: {}, body: {}, ...overrides } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/materials', () => {
  it('未认证 → 401', async () => {
    const res = createResponse();
    await getRouteHandler('post', '/')(createRequest({ user: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('没带文件 → 400', async () => {
    const res = createResponse();
    await getRouteHandler('post', '/')(createRequest(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: '没有收到文件' });
  });

  it('解析成功 → 200 返回记录', async () => {
    mockSave.mockResolvedValue({ ok: true, record: { id: 'm1', name: '笔记.txt' } });
    const res = createResponse();
    await getRouteHandler('post', '/')(
      createRequest({ file: { originalname: 'notes.txt', buffer: Buffer.from('x') } }),
      res
    );
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', originalName: 'notes.txt' })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'm1', name: '笔记.txt' } });
  });

  it('被拒收 → 400 且带机器可判的 reason', async () => {
    mockSave.mockResolvedValue({ ok: false, reason: 'no_text_layer', message: '没有可提取的文本' });
    const res = createResponse();
    await getRouteHandler('post', '/')(
      createRequest({ file: { originalname: 'scan.pdf', buffer: Buffer.from('x') } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '没有可提取的文本',
      data: { reason: 'no_text_layer' },
    });
  });
});

describe('GET /api/materials', () => {
  it('返回当前用户的资料列表', () => {
    mockList.mockReturnValue([{ id: 'm1' }]);
    const res = createResponse();
    getRouteHandler('get', '/')(createRequest(), res);
    expect(mockList).toHaveBeenCalledWith('user-1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [{ id: 'm1' }] } });
  });
});

describe('DELETE /api/materials/:id', () => {
  it('不存在 → 404', () => {
    mockDelete.mockReturnValue(false);
    const res = createResponse();
    getRouteHandler('delete', '/:id')(createRequest({ params: { id: 'nope' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('删除成功 → 200', () => {
    mockDelete.mockReturnValue(true);
    const res = createResponse();
    getRouteHandler('delete', '/:id')(createRequest({ params: { id: 'm1' } }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'm1' } });
  });
});
