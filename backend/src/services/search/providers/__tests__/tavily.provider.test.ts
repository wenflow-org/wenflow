jest.mock('../../../../utils/safe-http', () => {
  class UnsafeUrlError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnsafeUrlError';
    }
  }
  return { safeHttpRequest: jest.fn(), UnsafeUrlError };
});

import { safeHttpRequest } from '../../../../utils/safe-http';
import {
  buildTavilyRequestBody,
  normalizeTavilyResults,
  TavilySearchProvider,
  toTavilyTimeRange,
  type TavilyProviderConfig,
} from '../tavily';

const requestMock = safeHttpRequest as jest.Mock;

const CONFIG: TavilyProviderConfig = {
  endpoint: 'https://api.tavily.com/search',
  apiKey: 'tvly-test-key',
  timeoutMs: 20_000,
};

function okResponse(data: unknown) {
  return { status: 200, statusText: 'OK', headers: {}, url: '', data };
}

describe('TavilySearchProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('未配置 apiKey 时 isConfigured=false，调用抛 SEARCH_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = new TavilySearchProvider({ ...CONFIG, apiKey: '' });

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_NOT_CONFIGURED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('POST JSON + Bearer 认证，参数按 Tavily 契约映射', async () => {
    requestMock.mockResolvedValue(okResponse({ results: [] }));
    const provider = new TavilySearchProvider(CONFIG);

    await provider.search({
      query: 'ai news',
      maxResults: 5,
      domainType: 'news',
      recencyMinutes: 60,
      includeDomains: ['a.com'],
      excludeDomains: ['spam.com'],
      language: 'zh',
    });

    const [url, options] = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.tavily.com/search');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer tvly-test-key');
    expect(options.privateNetworkPolicy).toBe('public-only');

    const body = options.body as Record<string, unknown>;
    expect(body).toMatchObject({
      query: 'ai news',
      // 未显式传 depth 时默认 advanced（basic 对实体型查询相关性显著劣化）
      search_depth: 'advanced',
      max_results: 5,
      topic: 'news',
      time_range: 'day',
      include_domains: ['a.com'],
      exclude_domains: ['spam.com'],
      language: 'zh',
    });
  });

  it('recencyMinutes 映射为粗粒度 time_range', () => {
    expect(toTavilyTimeRange(30)).toBe('day');
    expect(toTavilyTimeRange(1440)).toBe('day');
    expect(toTavilyTimeRange(2880)).toBe('week');
    expect(toTavilyTimeRange(20_000)).toBe('month');
    expect(toTavilyTimeRange(1_000_000)).toBe('year');
  });

  it('depth 缺省为 advanced，可显式降级为 basic', () => {
    expect(buildTavilyRequestBody({ query: 'q' })).toMatchObject({ search_depth: 'advanced' });
    expect(buildTavilyRequestBody({ query: 'q', depth: 'advanced' })).toMatchObject({ search_depth: 'advanced' });
    expect(buildTavilyRequestBody({ query: 'q', depth: 'basic' })).toMatchObject({ search_depth: 'basic' });
  });

  it('日期过滤映射为 start_date / end_date 并开启 published_date', () => {
    const body = buildTavilyRequestBody({ query: 'q', afterDate: '2026-01-01', beforeDate: '2026-02-01' });

    expect(body).toMatchObject({
      start_date: '2026-01-01',
      end_date: '2026-02-01',
      include_published_date: true,
    });
  });

  it('domainType=research_paper 抛 SEARCH_PROVIDER_UNSUPPORTED', async () => {
    const provider = new TavilySearchProvider(CONFIG);

    await expect(provider.search({ query: 'q', domainType: 'research_paper' })).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_UNSUPPORTED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('page>0 抛 SEARCH_PROVIDER_UNSUPPORTED', () => {
    expect(() => buildTavilyRequestBody({ query: 'q', page: 1 })).toThrow(/不支持 page 分页/);
  });

  it('归一化结果：content→snippet、published_date→publishedAt、按 hostname 派生 siteName', async () => {
    requestMock.mockResolvedValue(
      okResponse({
        results: [
          {
            title: 'T',
            url: 'https://example.com/a',
            content: 'C',
            score: 0.8,
            published_date: 'Tue, 11 Mar 2025 17:00:00 GMT',
          },
          { title: 'no url' },
        ],
      })
    );
    const provider = new TavilySearchProvider(CONFIG);

    const result = await provider.search({ query: 'q' });

    expect(result.results).toEqual([
      {
        position: 1,
        title: 'T',
        url: 'https://example.com/a',
        snippet: 'C',
        siteName: 'example.com',
        publishedAt: 'Tue, 11 Mar 2025 17:00:00 GMT',
        score: 0.8,
        provider: 'tavily',
      },
    ]);
    expect(result.page).toBe(0);
  });

  it('HTTP 非 2xx 抛 SEARCH_UPSTREAM_HTTP_ERROR 并携带 status', async () => {
    requestMock.mockResolvedValue({ status: 432, statusText: 'Plan Limit', headers: {}, url: '', data: {} });
    const provider = new TavilySearchProvider(CONFIG);

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_UPSTREAM_HTTP_ERROR',
      status: 432,
    });
  });

  it('超时映射为 SEARCH_UPSTREAM_TIMEOUT', async () => {
    requestMock.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const provider = new TavilySearchProvider(CONFIG);

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_UPSTREAM_TIMEOUT',
    });
  });

  it('normalizeTavilyResults 对异常输入返回空数组', () => {
    expect(normalizeTavilyResults({})).toEqual([]);
    expect(normalizeTavilyResults({ results: 'nope' })).toEqual([]);
  });
});
