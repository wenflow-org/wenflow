export {};

/**
 * 插件外部服务配置（联网 / 决策 / 生图）。
 *
 * 守卫三件事：
 * 1. 没有平台配置时按环境变量展示（部署即用，不必先点保存）；
 * 2. 保存后运行时 getter 立刻看到界面值，密钥写密文表而不是平台设置 JSON；
 * 3. 未知插件 / provider / 字段与非法地址被拒绝。
 */
const findUnique = jest.fn();
const upsert = jest.fn();
const resolveProviderApiKey = jest.fn();
const providerSecretSummary = jest.fn();
const setProviderSecret = jest.fn();
const deleteProviderSecret = jest.fn();

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_settings: {
      findUnique: (...args: any[]) => findUnique(...args),
      upsert: (...args: any[]) => upsert(...args),
    },
  },
}));

jest.mock('../provider-secrets.service', () => ({
  resolveProviderApiKey: (...args: any[]) => resolveProviderApiKey(...args),
  providerSecretSummary: (...args: any[]) => providerSecretSummary(...args),
  setProviderSecret: (...args: any[]) => setProviderSecret(...args),
  deleteProviderSecret: (...args: any[]) => deleteProviderSecret(...args),
}));

import {
  getPluginProviderConfig,
  loadPluginProviderConfig,
  readPluginProviderField,
  readPluginProviderSecret,
  resetPluginProviderConfigCache,
  savePluginProviderConfig,
  PluginProviderConfigError,
} from '../plugin-providers.service';

const ENV_KEYS = ['SEARCH_API_KEY', 'FETCH_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY', 'DASHSCOPE_API_KEY', 'IMAGE_API_KEY', 'SEARCH_PROVIDER', 'FETCH_PROVIDER'];
const originalEnv: Record<string, string | undefined> = {};
let storedValue: string | null = null;

describe('plugin-providers（插件外部服务配置）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.SEARCH_API_KEY = 'search-key-1234';
    process.env.TAVILY_API_KEY = 'tavily-key-5678';
    process.env.SEARCH_PROVIDER = 'tinyfish,tavily';
    process.env.FETCH_PROVIDER = 'tinyfish,tavily';
    storedValue = null;
    findUnique.mockImplementation(async () => (storedValue ? { key: 'pluginProviders', value: storedValue } : null));
    upsert.mockImplementation(async (args: any) => {
      storedValue = args.update.value;
      return {};
    });
    resolveProviderApiKey.mockResolvedValue(null);
    providerSecretSummary.mockResolvedValue({ keySource: 'none', keyHint: null });
    setProviderSecret.mockResolvedValue(undefined);
    deleteProviderSecret.mockResolvedValue(undefined);
    resetPluginProviderConfigCache();
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('没有界面配置时按环境变量展示：provider 已配置、链顺序来自环境变量', async () => {
    await loadPluginProviderConfig();
    const view = await getPluginProviderConfig('web');
    expect(view.channels.map((c) => c.id)).toEqual(['search', 'fetch']);
    expect(view.channels[0].order).toEqual(['tinyfish', 'tavily']);
    const tinyfish = view.providers.find((p) => p.id === 'tinyfish');
    expect(tinyfish?.configured).toBe(true);
    expect(tinyfish?.keySource).toBe('env');
    expect(tinyfish?.keyHint).toBe('····1234');
    expect(tinyfish?.fields.find((f) => f.key === 'searchEndpoint')?.placeholder).toBe('https://api.search.tinyfish.ai');
    // 决策没配 key → 未配置；opencode 允许 public 默认值，单独判为可用
    const decision = await getPluginProviderConfig('decision');
    expect(decision.providers.find((p) => p.id === 'alibaba')?.configured).toBe(false);
    expect(decision.providers.find((p) => p.id === 'opencode')?.configured).toBe(true);
  });

  it('保存：非密钥落平台设置，密钥落密文表，运行时 getter 立即生效', async () => {
    await loadPluginProviderConfig();
    await savePluginProviderConfig('web', {
      providers: {
        tinyfish: { searchEndpoint: 'https://proxy.example/search', apiKey: 'secret-key-123' },
        tavily: { searchEndpoint: '' },
      },
    });

    expect(setProviderSecret).toHaveBeenCalledWith('plugin:web:tinyfish', 'secret-key-123', 'SEARCH_API_KEY');
    expect(upsert).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(upsert.mock.calls[0][0].update.value);
    expect(stored.web.tinyfish.searchEndpoint).toBe('https://proxy.example/search');
    // 空串 = 删除覆盖，不该写进平台设置
    expect(stored.web.tavily).toBeUndefined();

    expect(readPluginProviderField('web', 'tinyfish', 'searchEndpoint')).toBe('https://proxy.example/search');
    // 密钥仍在环境变量里（mock 未返回 DB 密钥）
    expect(readPluginProviderSecret('web', 'tinyfish')).toBe('search-key-1234');
  });

  it('平台密文优先于环境变量，视图只回尾号', async () => {
    resolveProviderApiKey.mockImplementation(async (providerId: string) =>
      providerId === 'plugin:web:tavily' ? { apiKey: 'db-tavily-key', source: 'db' } : null
    );
    providerSecretSummary.mockImplementation(async (providerId: string) =>
      providerId === 'plugin:web:tavily' ? { keySource: 'db', keyHint: '····-key' } : { keySource: 'none', keyHint: null }
    );
    await loadPluginProviderConfig();
    const view = await getPluginProviderConfig('web');
    const tavily = view.providers.find((p) => p.id === 'tavily');
    expect(tavily?.keySource).toBe('db');
    expect(tavily?.configured).toBe(true);
    expect(readPluginProviderSecret('web', 'tavily')).toBe('db-tavily-key');
  });

  it('非法地址与未知字段被拒绝', async () => {
    await loadPluginProviderConfig();
    await expect(
      savePluginProviderConfig('web', { providers: { tinyfish: { searchEndpoint: 'api.example.com' } } })
    ).rejects.toBeInstanceOf(PluginProviderConfigError);
    await expect(
      savePluginProviderConfig('web', { providers: { nope: { apiKey: 'x' } } })
    ).rejects.toThrow('未知 provider');
    await expect(
      savePluginProviderConfig('web', { providers: { tinyfish: { mystery: 'x' } } })
    ).rejects.toThrow('未知字段');
    await expect(savePluginProviderConfig('mcp', {})).rejects.toThrow('未知插件');
    expect(upsert).not.toHaveBeenCalled();
  });
});
