/**
 * 模型供应商编辑接口（`/api/admin/model-providers`）：错误映射、平台通道特例、
 * 两个「真实调用」端点的护栏（无模型/无密钥时不发请求）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mockSecretRows = new Map<string, { providerId: string; apiKey: string; apiKeyEnv: string | null }>();
const mockSetAuditAction = jest.fn();
const mockSafeHttpRequest = jest.fn();
const mockTestConnection = jest.fn();
const mockGetConfig = jest.fn();

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    provider_secrets: {
      findUnique: async ({ where }: { where: { providerId: string } }) => mockSecretRows.get(where.providerId) ?? null,
      findMany: async () => [...mockSecretRows.values()],
      upsert: async ({ where, create, update }: any) => {
        mockSecretRows.set(where.providerId, { providerId: where.providerId, apiKey: update.apiKey ?? create.apiKey, apiKeyEnv: null });
      },
      deleteMany: async ({ where }: { where: { providerId: string } }) => {
        mockSecretRows.delete(where.providerId);
      }
    }
  }
}));

jest.mock('../../../utils/secret-crypto', () => ({
  __esModule: true,
  encryptSecret: (value: string) => `wfsec:v1:test:${Buffer.from(value, 'utf-8').toString('base64')}`,
  decryptSecret: (value: string) =>
    value.startsWith('wfsec:v1:test:') ? Buffer.from(value.slice('wfsec:v1:test:'.length), 'base64').toString('utf-8') : null
}));

jest.mock('../../../middleware/audit-context', () => ({
  __esModule: true,
  setAuditAction: (...args: unknown[]) => mockSetAuditAction(...args),
  setAuditBefore: jest.fn(),
  setAuditAfter: jest.fn()
}));

jest.mock('../../../utils/safe-http', () => ({
  __esModule: true,
  safeHttpRequest: (...args: unknown[]) => mockSafeHttpRequest(...args)
}));

jest.mock('../../../services/apiConfig.service', () => ({
  __esModule: true,
  default: {
    testConnection: (...args: unknown[]) => mockTestConnection(...args),
    getConfig: () => mockGetConfig()
  }
}));

import router from '../model-providers';
import { invalidateProviderSecretCache } from '../../../services/provider-secrets.service';
import { reloadLlmProvidersIfChanged } from '../../../config/models.config';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-providers-route-test-'));
const tempConfig = path.join(tmpDir, 'llm-providers.json');

const FIXTURE = {
  providers: {
    platform: { name: '平台', recommended: true, models: { 'm-chat': { label: 'M Chat', tier: 'chat' } } },
    custom: {
      name: '自建通道',
      baseUrl: 'https://api.example.com/v1',
      apiKeyEnv: 'CUSTOM_KEY',
      models: { 'cm-1': { label: 'CM 1', tier: 'chat' } }
    }
  },
  defaults: { chat: 'm-chat', reasoning: 'm-chat' }
};

function createRes(): any {
  const res: any = { status: jest.fn(), json: jest.fn(), locals: {} };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function handlerFor(method: 'get' | 'post' | 'patch' | 'delete', routePath: string) {
  const layer = (router as any).stack.find(
    (l: any) => l.route && l.route.path === routePath && l.route.methods[method]
  );
  if (!layer) throw new Error(`没有找到路由 ${method.toUpperCase()} ${routePath}`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<void>;
}

beforeAll(() => {
  process.env.LLM_PROVIDERS_CONFIG = tempConfig;
});

beforeEach(() => {
  // 注册表路径是**进程级**环境变量（同一 worker 里别的测试文件也会改它），每个用例都重新钉住
  process.env.LLM_PROVIDERS_CONFIG = tempConfig;
  fs.writeFileSync(tempConfig, `${JSON.stringify(FIXTURE, null, 2)}\n`, 'utf-8');
  mockSecretRows.clear();
  mockSetAuditAction.mockClear();
  mockSafeHttpRequest.mockReset();
  mockTestConnection.mockReset();
  mockGetConfig.mockReset();
  invalidateProviderSecretCache();
  mockGetConfig.mockResolvedValue({ apiUrl: 'https://platform.example.com/v1', apiKey: 'platform-key', defaultTemperature: 0.7, defaultMaxTokens: 256 });
  reloadLlmProvidersIfChanged(true);
});

afterAll(() => {
  delete process.env.LLM_PROVIDERS_CONFIG;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/admin/model-providers', () => {
  it('回吐视图与文件状态', async () => {
    const res = createRes();
    await handlerFor('get', '/')({ params: {}, body: {} }, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ registry: expect.objectContaining({ path: tempConfig }) }) })
    );
  });
});

describe('PATCH /:id（平台通道特例）', () => {
  it('平台通道：地址与密钥字段被剥掉，只接受展示名/说明/启用位', async () => {
    const res = createRes();
    await handlerFor('patch', '/:id')(
      { params: { id: 'platform' }, body: { name: '平台（改）', baseUrl: 'https://evil.example.com/v1', apiKeyEnv: 'MY_KEY', apiKey: 'sk-should-be-ignored' } },
      res
    );
    const file = JSON.parse(fs.readFileSync(tempConfig, 'utf-8'));
    expect(file.providers.platform.name).toBe('平台（改）');
    expect(file.providers.platform.baseUrl).toBeUndefined();
    expect(file.providers.platform.apiKeyEnv).toBeUndefined();
    expect(mockSecretRows.size).toBe(0);
    expect(mockSetAuditAction).toHaveBeenCalledWith(res, 'model-provider-update', { targetType: 'model-provider', targetId: 'platform' });
  });
});

describe('错误映射', () => {
  it('自建供应商被清空地址 → 400 + code=invalid', async () => {
    const res = createRes();
    await handlerFor('patch', '/:id')({ params: { id: 'custom' }, body: { baseUrl: '' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'invalid', error: expect.stringContaining('服务地址不能清空') }));
  });

  it('未知供应商 → 404 + code=not-found', async () => {
    const res = createRes();
    await handlerFor('delete', '/:id')({ params: { id: 'ghost' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'not-found' }));
  });

  it('写成功时把告警一起回吐（前端要展示）', async () => {
    // 删掉别名引用的模型 → 保存成功但带告警
    const file = JSON.parse(fs.readFileSync(tempConfig, 'utf-8'));
    file.aliases = { chat: ['cm-1'] };
    fs.writeFileSync(tempConfig, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
    reloadLlmProvidersIfChanged(true);
    const res = createRes();
    await handlerFor('delete', '/:id/models/:modelId')({ params: { id: 'custom', modelId: 'cm-1' }, body: {} }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.warnings.join(' ')).toContain('别名「chat」');
  });
});

describe('真实调用端点', () => {
  it('供应商没有模型时拒绝测试（不发请求）', async () => {
    const file = JSON.parse(fs.readFileSync(tempConfig, 'utf-8'));
    file.providers.custom.models = {};
    fs.writeFileSync(tempConfig, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
    reloadLlmProvidersIfChanged(true);
    const res = createRes();
    await handlerFor('post', '/:id/test')({ params: { id: 'custom' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('先添加一个') }));
    expect(mockSafeHttpRequest).not.toHaveBeenCalled();
  });

  it('没有密钥时拒绝测试与拉取（不发请求）', async () => {
    const testRes = createRes();
    await handlerFor('post', '/:id/test')({ params: { id: 'custom' }, body: {} }, testRes);
    expect(testRes.status).toHaveBeenCalledWith(400);
    expect(testRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('密钥') }));

    const pullRes = createRes();
    await handlerFor('post', '/:id/models/pull')({ params: { id: 'custom' }, body: {} }, pullRes);
    expect(pullRes.status).toHaveBeenCalledWith(400);
    expect(mockTestConnection).not.toHaveBeenCalled();
    expect(mockSafeHttpRequest).not.toHaveBeenCalled();
  });

  it('有密钥时用它自己的地址发一次真实调用，回显耗时与原文', async () => {
    mockSecretRows.set('custom', { providerId: 'custom', apiKey: 'wfsec:v1:test:c2stZ2F0ZXdheS1rZXk=', apiKeyEnv: 'CUSTOM_KEY' });
    invalidateProviderSecretCache();
    mockSafeHttpRequest.mockResolvedValue({ status: 200, statusText: 'OK', data: { model: 'cm-1', choices: [{ message: { content: '可以' } }], usage: { total_tokens: 5 } } });
    const res = createRes();
    await handlerFor('post', '/:id/test')({ params: { id: 'custom' }, body: {} }, res);
    const [endpoint, options] = mockSafeHttpRequest.mock.calls[0];
    expect(endpoint).toBe('https://api.example.com/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer sk-gateway-key');
    expect(options.body.model).toBe('cm-1');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ content: '可以', model: 'cm-1' }) })
    );
  });

  it('上游报错时回显原文（不是「测试失败」四个字）', async () => {
    mockSecretRows.set('custom', { providerId: 'custom', apiKey: 'wfsec:v1:test:c2stZ2F0ZXdheS1rZXk=', apiKeyEnv: 'CUSTOM_KEY' });
    invalidateProviderSecretCache();
    mockSafeHttpRequest.mockResolvedValue({ status: 401, statusText: 'Unauthorized', data: { error: { message: 'invalid api key: xxx' } } });
    const res = createRes();
    await handlerFor('post', '/:id/test')({ params: { id: 'custom' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid api key: xxx' }));
  });

  it('拉取模型列表：走既有 testConnection，并回吐已登记项', async () => {
    mockSecretRows.set('custom', { providerId: 'custom', apiKey: 'wfsec:v1:test:c2stZ2F0ZXdheS1rZXk=', apiKeyEnv: 'CUSTOM_KEY' });
    invalidateProviderSecretCache();
    mockTestConnection.mockResolvedValue({ success: true, models: ['cm-1', 'cm-2'], modelsCount: 2 });
    const res = createRes();
    await handlerFor('post', '/:id/models/pull')({ params: { id: 'custom' }, body: {} }, res);
    expect(mockTestConnection).toHaveBeenCalledWith('https://api.example.com/v1', 'sk-gateway-key');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { models: ['cm-1', 'cm-2'], registered: ['cm-1'] } }));
  });
});
