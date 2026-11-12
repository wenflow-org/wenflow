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
  readPluginChannelOrder,
  readPluginProviderField,
  readPluginProviderSecret,
  resetPluginProviderConfigCache,
  savePluginProviderConfig,
  PluginProviderConfigError,
} from '../plugin-providers.service';

const ENV_KEYS = ['SEARCH_API_KEY', 'FETCH_API_KEY', 'TAVILY_API_KEY', 'EXA_API_KEY', 'DASHSCOPE_API_KEY', 'IMAGE_API_KEY', 'SEARCH_PROVIDER', 'FETCH_PROVIDER'];
const originalEnv: Record<string, string | undefined> = {};
let storedValue: string | null = null;
/** pluginProviderOrders 那一行（通道优先级）单独存，mock 按 key 分开 */
let ordersValue: string | null = null;

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
    ordersValue = null;
    findUnique.mockImplementation(async (args: any) => {
      const key = args?.where?.key;
      if (key === 'pluginProviderOrders') {
        return ordersValue ? { key, value: ordersValue } : null;
      }
      return storedValue ? { key: 'pluginProviders', value: storedValue } : null;
    });
    upsert.mockImplementation(async (args: any) => {
      if (args?.where?.key === 'pluginProviderOrders') ordersValue = args.update.value;
      else storedValue = args.update.value;
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

  it('没有界面配置时按环境变量展示：provider 已配置、内置地址不进视图', async () => {
    await loadPluginProviderConfig();
    const view = await getPluginProviderConfig('web');
    expect(view.channels.map((c) => c.id)).toEqual(['search', 'fetch']);
    /* 2026-11-07 用户「支持自定义第三方端点 / 调整尝试顺序」：
       2026-11-04 写死的顺序恢复可排，优先级回到「平台保存 → 通道环境变量 → 目录默认」。
       本用例设了 SEARCH_PROVIDER=tinyfish,tavily，所以 exa 不在链上。 */
    expect(view.channels.every((c) => c.orderFixed)).toBe(false);
    /* 2026-11-10 用户「搜索，决策，都不做链式降级了」：搜索通道 single，
       环境变量给了两家人也只取第一家；抓取仍是降级链，两家都在。 */
    expect(view.channels[0].single).toBe(true);
    expect(view.channels[0].order).toEqual(['tinyfish']);
    expect(view.channels[1].single).toBe(false);
    expect(view.channels[1].order).toEqual(['tinyfish', 'tavily']);
    const tinyfish = view.providers.find((p) => p.id === 'tinyfish');
    expect(tinyfish?.configured).toBe(true);
    expect(tinyfish?.keySource).toBe('env');
    expect(tinyfish?.keyHint).toBe('····1234');
    // 端点恢复可写：界面给「密钥 + 搜索地址 + 抓取地址」三项
    expect(tinyfish?.fields.map((f) => f.key)).toEqual(['searchEndpoint', 'fetchEndpoint', 'apiKey']);
    // 内置值仍按 环境变量 → 目录默认 解析（部署侧镜像的逃生口）
    expect(readPluginProviderField('web', 'tinyfish', 'searchEndpoint')).toBe('https://api.search.tinyfish.ai');
    // 决策没配 key → 未配置；opencode 允许 public 默认值，单独判为可用
    const decision = await getPluginProviderConfig('decision');
    expect(decision.providers.find((p) => p.id === 'alibaba')?.configured).toBe(false);
    expect(decision.providers.find((p) => p.id === 'opencode')?.configured).toBe(true);
    // 决策不是内置顺序：仍可由用户排
    expect(decision.channels.some((c) => c.orderFixed)).toBe(false);
  });

  it('保存：密钥落密文表，运行时 getter 立即生效', async () => {
    await loadPluginProviderConfig();
    await savePluginProviderConfig('web', { providers: { tinyfish: { apiKey: 'secret-key-123' } } });

    expect(setProviderSecret).toHaveBeenCalledWith('plugin:web:tinyfish', 'secret-key-123', 'SEARCH_API_KEY');
    // 联网只剩密钥可写：没有非密钥字段，就不该给平台设置写出 provider 块
    const providerUpsert = upsert.mock.calls.find((c: any[]) => c[0].where.key === 'pluginProviders')!;
    expect(JSON.parse(providerUpsert[0].update.value).web).toBeUndefined();
    // 密钥仍在环境变量里（mock 未返回 DB 密钥）
    expect(readPluginProviderSecret('web', 'tinyfish')).toBe('search-key-1234');
  });

  it('联网的端点与通道顺序都可改，且运行时立即读到新值', async () => {
    await loadPluginProviderConfig();
    await savePluginProviderConfig('web', {
      providers: { tinyfish: { searchEndpoint: 'https://proxy.example/search' } },
      orders: { search: ['tavily', 'tinyfish'] },
    });
    // 端点：写进平台设置，运行时 getter 立刻返回覆盖值（第三方 / 反代 / 自建都走这一条）
    expect(readPluginProviderField('web', 'tinyfish', 'searchEndpoint')).toBe('https://proxy.example/search');
    // 抓取地址没改过，仍按目录默认解析
    expect(readPluginProviderField('web', 'tinyfish', 'fetchEndpoint')).toBe('https://api.fetch.tinyfish.ai');
    // 搜索不做链式降级：保存的顺序只留第一家（Tavily）
    expect(readPluginChannelOrder('web', 'search')).toEqual(['tavily']);
  });

  it('清空端点 = 回到目录默认（不把空串写成覆盖值）', async () => {
    storedValue = JSON.stringify({ web: { tinyfish: { searchEndpoint: 'https://old-proxy.example/search' } } });
    await loadPluginProviderConfig();
    expect(readPluginProviderField('web', 'tinyfish', 'searchEndpoint')).toBe('https://old-proxy.example/search');

    await savePluginProviderConfig('web', { providers: { tinyfish: { searchEndpoint: '' } } });
    expect(readPluginProviderField('web', 'tinyfish', 'searchEndpoint')).toBe('https://api.search.tinyfish.ai');
  });

  /* ---------- 通道优先级（2026-10-26 用户「用户可以自己配置优先级」） ----------
     联网的搜索 / 抓取 2026-11-04 起顺序内置，这里改用决策通道（仍可排）验证同一套机制。 */

  it('通道优先级：保存后平台顺序优先，并随视图下发（用抓取链验证，搜索/决策已改单档）', async () => {
    await loadPluginProviderConfig();
    await savePluginProviderConfig('web', { orders: { fetch: ['exa', 'tavily'] } });
    expect(readPluginChannelOrder('web', 'fetch')).toEqual(['exa', 'tavily']);
    const view = await getPluginProviderConfig('web');
    expect(view.channels.find((c) => c.id === 'fetch')?.order).toEqual(['exa', 'tavily']);
  });

  /* 2026-11-10 用户「搜索，决策，都不做链式降级了」：单档通道只落第一家，运行时链长恒为 1 */
  it('搜索 / 决策不做链式降级：保存多家只留第一家', async () => {
    await loadPluginProviderConfig();
    await savePluginProviderConfig('decision', { orders: { decision: ['cloudflare', 'alibaba'] } });
    expect(readPluginChannelOrder('decision', 'decision')).toEqual(['cloudflare']);
    await savePluginProviderConfig('web', { orders: { search: ['exa', 'tavily'] } });
    expect(readPluginChannelOrder('web', 'search')).toEqual(['exa']);
  });

  it('通道优先级：未知 provider / 未知通道被拒，空数组 = 删掉覆盖回落默认', async () => {
    await loadPluginProviderConfig();
    await expect(savePluginProviderConfig('decision', { orders: { decision: ['bing'] } }))
      .rejects.toThrow(/未知 provider/);
    await expect(savePluginProviderConfig('decision', { orders: { nope: ['alibaba'] } }))
      .rejects.toThrow(/未知通道/);
    await savePluginProviderConfig('web', { orders: { fetch: ['exa'] } });
    expect(readPluginChannelOrder('web', 'fetch')).toEqual(['exa']);
    await savePluginProviderConfig('web', { orders: { fetch: [] } });
    // 空数组 = 删覆盖，回落到环境变量 FETCH_PROVIDER=tinyfish,tavily
    expect(readPluginChannelOrder('web', 'fetch')).toEqual(['tinyfish', 'tavily']);
  });

  it('通道优先级：重复 provider 只算一次', async () => {
    await loadPluginProviderConfig();
    await savePluginProviderConfig('web', { orders: { fetch: ['exa', 'exa', 'tavily'] } });
    expect(readPluginChannelOrder('web', 'fetch')).toEqual(['exa', 'tavily']);
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
    // 地址字段只在非内置的插件上可写，校验照旧
    await expect(
      savePluginProviderConfig('image', { providers: { agnes: { endpoint: 'api.example.com' } } })
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
