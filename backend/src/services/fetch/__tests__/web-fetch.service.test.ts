jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { resolveFetchProviderOrder } from '../providers';
import { fetchWeb } from '../web-fetch.service';
import { FetchError } from '../types';
import type {
  FetchContentItem,
  FetchProvider,
  FetchProviderId,
  FetchProviderResult,
  FetchRequest,
} from '../types';

function item(provider: FetchProviderId, index = 0): FetchContentItem {
  return {
    url: `https://example.com/${index}`,
    title: `title-${index}`,
    text: 'x'.repeat(100),
    provider,
  };
}

function fakeProvider(
  id: FetchProviderId,
  fetchImpl: (request: FetchRequest) => Promise<FetchProviderResult>,
  configured = true
): FetchProvider {
  return { id, isConfigured: () => configured, fetch: jest.fn(fetchImpl) };
}

describe('fetchWeb 编排', () => {
  it('入参不合法时抛 FETCH_REQUEST_INVALID（不触达 provider）', async () => {
    const provider = fakeProvider('tinyfish', async () => ({ results: [], errors: [] }));

    await expect(
      fetchWeb({ urls: [] }, { providers: { tinyfish: provider } })
    ).rejects.toMatchObject({ code: 'FETCH_REQUEST_INVALID' });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('非 http/https 的 URL 被拒绝', async () => {
    await expect(fetchWeb({ urls: ['ftp://example.com'] })).rejects.toMatchObject({
      code: 'FETCH_REQUEST_INVALID',
    });
  });

  it('超过 10 条 URL 被拒绝', async () => {
    await expect(
      fetchWeb({ urls: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`) })
    ).rejects.toMatchObject({ code: 'FETCH_REQUEST_INVALID' });
  });

  it('条件请求仅允许单 URL', async () => {
    await expect(
      fetchWeb({ urls: ['https://a.com', 'https://b.com'], ifNoneMatch: 'W/"x"' })
    ).rejects.toMatchObject({ code: 'FETCH_REQUEST_INVALID' });
  });

  it('没有可用 provider 时抛 FETCH_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = fakeProvider('tinyfish', async () => ({ results: [], errors: [] }), false);

    await expect(
      fetchWeb({ urls: ['https://a.com'] }, { providerOrder: ['tinyfish'], providers: { tinyfish: provider } })
    ).rejects.toMatchObject({ code: 'FETCH_PROVIDER_NOT_CONFIGURED' });
  });

  it('首选 provider 失败时按顺序降级，并记录 attempts', async () => {
    const failing = fakeProvider('tinyfish', () =>
      Promise.reject(new FetchError('FETCH_UPSTREAM_UNAVAILABLE', 'upstream down'))
    );
    const fallback = fakeProvider('tavily', async () => ({ results: [item('tavily')], errors: [] }));

    const result = await fetchWeb(
      { urls: ['https://a.com'] },
      { providerOrder: ['tinyfish', 'tavily'], providers: { tinyfish: failing, tavily: fallback } }
    );

    expect(result.provider).toBe('tavily');
    expect(result.attempts).toEqual(['tinyfish', 'tavily']);
    expect(result.results).toHaveLength(1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('provider 一条都没抓到（结果为空）时继续降级到下一个', async () => {
    const empty = fakeProvider('tinyfish', async () => ({
      results: [],
      errors: [{ url: 'https://a.com', code: 'target_http_error', message: 'boom' }],
    }));
    const fallback = fakeProvider('tavily', async () => ({ results: [item('tavily')], errors: [] }));

    const result = await fetchWeb(
      { urls: ['https://a.com'] },
      { providerOrder: ['tinyfish', 'tavily'], providers: { tinyfish: empty, tavily: fallback } }
    );

    expect(result.provider).toBe('tavily');
    expect(result.attempts).toEqual(['tinyfish', 'tavily']);
  });

  it('部分成功即返回（errors 与 results 并存，不降级）', async () => {
    const partial = fakeProvider('tinyfish', async () => ({
      results: [item('tinyfish')],
      errors: [{ url: 'https://bad.com', code: 'target_http_error', message: 'boom' }],
    }));
    const fallback = fakeProvider('tavily', async () => ({ results: [item('tavily')], errors: [] }));

    const result = await fetchWeb(
      { urls: ['https://a.com', 'https://bad.com'] },
      { providerOrder: ['tinyfish', 'tavily'], providers: { tinyfish: partial, tavily: fallback } }
    );

    expect(result.provider).toBe('tinyfish');
    expect(result.attempts).toEqual(['tinyfish']);
    expect(result.results).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(fallback.fetch).not.toHaveBeenCalled();
  });

  it('所有 provider 都只返回空结果时抛 FETCH_ALL_URLS_FAILED，并带明细', async () => {
    const empty = fakeProvider('tinyfish', async () => ({
      results: [],
      errors: [{ url: 'https://a.com', code: 'target_http_error', message: 'boom' }],
    }));

    await expect(
      fetchWeb({ urls: ['https://a.com'] }, { providerOrder: ['tinyfish'], providers: { tinyfish: empty } })
    ).rejects.toMatchObject({ code: 'FETCH_ALL_URLS_FAILED' });
  });

  it('全部失败时抛出最后一个 FetchError', async () => {
    const provider = fakeProvider('tinyfish', () =>
      Promise.reject(new FetchError('FETCH_UPSTREAM_TIMEOUT', 'timeout'))
    );

    await expect(
      fetchWeb({ urls: ['https://a.com'] }, { providerOrder: ['tinyfish'], providers: { tinyfish: provider } })
    ).rejects.toMatchObject({ code: 'FETCH_UPSTREAM_TIMEOUT' });
  });

  it('未在构建中实现的 provider 被跳过', async () => {
    const provider = fakeProvider('tinyfish', async () => ({ results: [item('tinyfish')], errors: [] }));

    const result = await fetchWeb(
      { urls: ['https://a.com'] },
      { providerOrder: ['exa', 'tinyfish'], providers: { tinyfish: provider } }
    );

    expect(result.attempts).toEqual(['tinyfish']);
  });

  it('归一化后的参数（trim）传给 provider', async () => {
    const provider = fakeProvider('tinyfish', async () => ({ results: [item('tinyfish')], errors: [] }));

    await fetchWeb(
      { urls: ['  https://a.com  '] },
      { providerOrder: ['tinyfish'], providers: { tinyfish: provider } }
    );

    expect(provider.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['https://a.com'] }),
      expect.anything()
    );
  });
});

describe('resolveFetchProviderOrder', () => {
  it('未配置时回退到已实现 provider 的默认顺序', () => {
    expect(resolveFetchProviderOrder('')).toEqual(['tinyfish', 'tavily', 'exa']);
  });

  it('解析逗号分隔的降级链并去重', () => {
    expect(resolveFetchProviderOrder('tinyfish, tavily ,tinyfish')).toEqual(['tinyfish', 'tavily']);
  });

  it('未知 provider 直接报错', () => {
    expect(() => resolveFetchProviderOrder('bing')).toThrow(FetchError);
    expect(() => resolveFetchProviderOrder('bing')).toThrow(/未知的抓取 provider/);
  });
});
