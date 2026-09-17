jest.mock('../../../utils/safe-http', () => {
  class UnsafeUrlError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnsafeUrlError';
    }
  }
  return { safeHttpRequest: jest.fn(), UnsafeUrlError };
});

import { safeHttpRequest, UnsafeUrlError } from '../../../utils/safe-http';
import {
  buildTinyFishRequestUrl,
  normalizeTinyFishResults,
  TinyFishSearchProvider,
  type TinyFishProviderConfig,
} from '../providers/tinyfish';

const requestMock = safeHttpRequest as jest.Mock;

const CONFIG: TinyFishProviderConfig = {
  endpoint: 'https://api.search.tinyfish.ai',
  apiKey: 'sk-test-key',
  timeoutMs: 20_000,
};

function okResponse(data: unknown) {
  return { status: 200, statusText: 'OK', headers: {}, url: '', data };
}

describe('TinyFishSearchProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('未配置 apiKey 时 isConfigured=false，调用抛 SEARCH_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = new TinyFishSearchProvider({ ...CONFIG, apiKey: '' });

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_NOT_CONFIGURED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('构造 GET 请求：参数映射到 query string，携带 X-API-Key，公网策略', async () => {
    requestMock.mockResolvedValue(okResponse({ results: [], total_results: 0, page: 0 }));
    const provider = new TinyFishSearchProvider(CONFIG);

    await provider.search({
      query: 'web automation tools',
      location: 'US',
      language: 'en',
      recencyMinutes: 60,
      domainType: 'news',
      includeDomains: ['a.com', 'b.com'],
      excludeDomains: ['spam.com'],
      page: 1,
      purpose: '写一篇工具综述',
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [rawUrl, options] = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    const parsed = new URL(rawUrl);
    expect(parsed.origin + parsed.pathname).toBe('https://api.search.tinyfish.ai/');
    expect(parsed.searchParams.get('query')).toBe('web automation tools');
    expect(parsed.searchParams.get('location')).toBe('US');
    expect(parsed.searchParams.get('language')).toBe('en');
    expect(parsed.searchParams.get('recency_minutes')).toBe('60');
    expect(parsed.searchParams.get('domain_type')).toBe('news');
    expect(parsed.searchParams.get('include_domains')).toBe('a.com,b.com');
    expect(parsed.searchParams.get('exclude_domains')).toBe('spam.com');
    expect(parsed.searchParams.get('page')).toBe('1');
    expect(parsed.searchParams.get('purpose')).toBe('写一篇工具综述');
    expect(parsed.searchParams.get('after_date')).toBeNull();

    expect(options.method).toBe('GET');
    expect(options.privateNetworkPolicy).toBe('public-only');
    expect((options.headers as Record<string, string>)['X-API-Key']).toBe('sk-test-key');
  });

  it('归一化结果：丢弃无 url 项、回填 position、截断 maxResults', async () => {
    requestMock.mockResolvedValue(
      okResponse({
        results: [
          { position: 2, site_name: 'x.com', title: 'T', snippet: 'S', url: 'https://x.com' },
          { title: 'no url' },
        ],
        total_results: 1,
        page: 0,
      })
    );
    const provider = new TinyFishSearchProvider(CONFIG);

    const result = await provider.search({ query: 'q', maxResults: 1 });

    expect(result.results).toEqual([
      {
        position: 2,
        title: 'T',
        url: 'https://x.com',
        snippet: 'S',
        siteName: 'x.com',
        provider: 'tinyfish',
      },
    ]);
    expect(result.totalResults).toBe(1);
    expect(result.page).toBe(0);
  });

  it('缺 position 时用序号回填', async () => {
    requestMock.mockResolvedValue(
      okResponse({ results: [{ title: 'a', url: 'https://a.com' }, { title: 'b', url: 'https://b.com' }] })
    );
    const provider = new TinyFishSearchProvider(CONFIG);

    const result = await provider.search({ query: 'q' });

    expect(result.results.map((item) => item.position)).toEqual([1, 2]);
  });

  it('HTTP 非 2xx 抛 SEARCH_UPSTREAM_HTTP_ERROR 并携带 status', async () => {
    requestMock.mockResolvedValue({ status: 429, statusText: 'Too Many Requests', headers: {}, url: '', data: {} });
    const provider = new TinyFishSearchProvider(CONFIG);

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_UPSTREAM_HTTP_ERROR',
      status: 429,
    });
  });

  it('超时错误映射为 SEARCH_UPSTREAM_TIMEOUT', async () => {
    requestMock.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const provider = new TinyFishSearchProvider(CONFIG);

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_UPSTREAM_TIMEOUT',
    });
  });

  it('URL 被安全策略拒绝时映射为 SEARCH_UPSTREAM_UNAVAILABLE', async () => {
    requestMock.mockRejectedValue(new UnsafeUrlError('blocked'));
    const provider = new TinyFishSearchProvider(CONFIG);

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_UPSTREAM_UNAVAILABLE',
    });
  });

  it('未提供可选参数时不写入空 query string', () => {
    const url = new URL(buildTinyFishRequestUrl(CONFIG, { query: 'only query' }));

    expect([...url.searchParams.keys()]).toEqual(['query']);
  });

  it('normalizeTinyFishResults 对异常输入返回空数组', () => {
    expect(normalizeTinyFishResults({})).toEqual([]);
    expect(normalizeTinyFishResults({ results: 'not-an-array' })).toEqual([]);
  });
});
