export {};

/**
 * 插件 provider 单点探测（2026-11-07 用户「每个 provider 给一个测试」）。
 *
 * 守卫三件事：
 * 1. 联网探一家 = 搜索与抓取各探一次（同一家服务两条链，只报搜索通过会漏掉抓取地址配错）；
 * 2. 失败不抛出、不降级：ok=false + 上游原文（弹窗直接展示，网关/额度/鉴权三类错误长得很不一样）；
 * 3. 生图不真的生成（按张计费），只校验地址与密钥就位，并在 detail 里说明。
 */

const searchMock = jest.fn();
const searchConfigured = jest.fn();
const fetchMock = jest.fn();
const fetchConfigured = jest.fn();
const decideMock = jest.fn();
const decideConfigured = jest.fn();
const imageConfigured = jest.fn();
const generateMock = jest.fn();

jest.mock('../search/providers', () => ({
  createSearchProviders: () => ({
    tinyfish: { id: 'tinyfish', isConfigured: searchConfigured, search: searchMock },
  }),
}));
jest.mock('../fetch/providers', () => ({
  createFetchProviders: () => ({
    tinyfish: { id: 'tinyfish', isConfigured: fetchConfigured, fetch: fetchMock },
  }),
}));
jest.mock('../decision/providers', () => ({
  createDecisionProviders: () => ({
    alibaba: { id: 'alibaba', isConfigured: decideConfigured, decide: decideMock },
  }),
}));
jest.mock('../image/providers', () => ({
  createImageProviders: () => ({
    agnes: { id: 'agnes', isConfigured: imageConfigured, generate: generateMock },
  }),
}));

import { probePluginProvider } from '../plugin-provider-probe.service';

beforeEach(() => {
  for (const fn of [searchMock, fetchMock, decideMock, generateMock]) fn.mockReset();
  for (const fn of [searchConfigured, fetchConfigured, decideConfigured, imageConfigured]) fn.mockReset();
});

describe('probePluginProvider', () => {
  it('联网：搜索与抓取都探一次，两条读数合成一句', async () => {
    searchMock.mockResolvedValue({ results: [{ url: 'https://a' }], page: 1 });
    fetchMock.mockResolvedValue({ results: [{ url: 'https://example.com' }], errors: [] });

    const res = await probePluginProvider('web', 'tinyfish');

    expect(res.ok).toBe(true);
    expect(res.detail).toContain('搜索可达，返回 1 条');
    expect(res.detail).toContain('抓取可达，返回 1 页');
    // 探测用的是最小请求：搜索只要 1 条，抓取只取 example.com 一页
    expect(searchMock.mock.calls[0][0]).toMatchObject({ maxResults: 1 });
    expect(fetchMock.mock.calls[0][0]).toMatchObject({ urls: ['https://example.com'] });
  });

  it('联网：抓取返回 0 页时整体判失败（别只看搜索通了就当这家可用）', async () => {
    searchMock.mockResolvedValue({ results: [{ url: 'https://a' }], page: 1 });
    fetchMock.mockResolvedValue({ results: [], errors: [{ url: 'https://example.com', code: 'FETCH_UPSTREAM_HTTP_ERROR', message: '403 Forbidden' }] });

    const res = await probePluginProvider('web', 'tinyfish');

    expect(res.ok).toBe(false);
    expect(res.detail).toBe('403 Forbidden');
  });

  it('失败不抛：返回 ok=false 与上游原文，调用方直接展示', async () => {
    searchMock.mockRejectedValue(new Error('401 Unauthorized'));

    const res = await probePluginProvider('web', 'tinyfish');

    expect(res.ok).toBe(false);
    expect(res.detail).toBe('401 Unauthorized');
  });

  it('决策：回报实际命中的模型与概率', async () => {
    decideMock.mockResolvedValue({ model: 'decision-model-preview', answers: { probe: { type: 'noul', noul: 0.92 } } });

    const res = await probePluginProvider('decision', 'alibaba');

    expect(res.ok).toBe(true);
    expect(res.detail).toContain('decision-model-preview');
    expect(res.detail).toContain('0.92');
    // 探测问题必须是 noul（只要一个概率，不产出自由文本）
    expect(decideMock.mock.calls[0][0].questions.probe.type).toBe('noul');
  });

  it('生图：不发起真实生成（按张计费），只校验配置就位', async () => {
    imageConfigured.mockReturnValue(true);

    const res = await probePluginProvider('image', 'agnes');

    expect(res.ok).toBe(true);
    expect(generateMock).not.toHaveBeenCalled();
    expect(res.detail).toContain('未实际生成');
  });

  it('生图：地址或密钥缺失时判失败', async () => {
    imageConfigured.mockReturnValue(false);

    const res = await probePluginProvider('image', 'agnes');

    expect(res.ok).toBe(false);
    expect(res.detail).toContain('地址或密钥未配置');
  });

  it('目录里没有的 provider 直接拒绝（不能拿目录外的 id 探任意上游）', async () => {
    await expect(probePluginProvider('image', 'agnes')).resolves.toBeDefined();
    await expect(probePluginProvider('image', 'not-a-provider')).rejects.toThrow(/未知 provider/);
  });
});