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
  buildExaRequestBody,
  ExaSearchProvider,
  normalizeExaResults,
  type ExaProviderConfig,
} from '../exa';

const requestMock = safeHttpRequest as jest.Mock;

const CONFIG: ExaProviderConfig = {
  endpoint: 'https://api.exa.ai/search',
  apiKey: 'exa-test-key',
  timeoutMs: 20_000,
};

const NOW = new Date('2026-09-16T12:00:00.000Z');

function okResponse(data: unknown) {
  return { status: 200, statusText: 'OK', headers: {}, url: '', data };
}

describe('ExaSearchProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('未配置 apiKey 时 isConfigured=false，调用抛 SEARCH_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = new ExaSearchProvider({ ...CONFIG, apiKey: '' });

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_NOT_CONFIGURED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('POST JSON + x-api-key，参数按 Exa 契约映射', async () => {
    requestMock.mockResolvedValue(okResponse({ results: [] }));
    const provider = new ExaSearchProvider(CONFIG);

    await provider.search({
      query: 'llm survey',
      maxResults: 7,
      domainType: 'research_paper',
      includeDomains: ['arxiv.org'],
      location: 'us',
    });

    const [url, options] = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.exa.ai/search');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['x-api-key']).toBe('exa-test-key');
    expect(options.privateNetworkPolicy).toBe('public-only');

    const body = options.body as Record<string, unknown>;
    expect(body).toMatchObject({
      query: 'llm survey',
      type: 'auto',
      numResults: 7,
      category: 'publication',
      includeDomains: ['arxiv.org'],
      userLocation: 'US',
      contents: { text: { maxCharacters: 1200 } },
    });
  });

  it('domainType=news 映射为 category=news；web 不带 category', () => {
    expect(buildExaRequestBody({ query: 'q', domainType: 'news' }).category).toBe('news');
    expect(buildExaRequestBody({ query: 'q', domainType: 'web' }).category).toBeUndefined();
  });

  it('日期映射为 ISO 8601 start/endPublishedDate', () => {
    const body = buildExaRequestBody({ query: 'q', afterDate: '2026-01-01', beforeDate: '2026-02-01' });

    expect(body.startPublishedDate).toBe('2026-01-01T00:00:00.000Z');
    expect(body.endPublishedDate).toBe('2026-02-01T23:59:59.999Z');
  });

  it('recencyMinutes 换算为 startPublishedDate', () => {
    const body = buildExaRequestBody({ query: 'q', recencyMinutes: 120 }, NOW);

    expect(body.startPublishedDate).toBe('2026-09-16T10:00:00.000Z');
  });

  it('pubYear 范围换算为起止日期', () => {
    const body = buildExaRequestBody({ query: 'q', domainType: 'research_paper', pubYearMin: 2020, pubYearMax: 2024 });

    expect(body.startPublishedDate).toBe('2020-01-01T00:00:00.000Z');
    expect(body.endPublishedDate).toBe('2024-12-31T23:59:59.999Z');
  });

  it('page>0 抛 SEARCH_PROVIDER_UNSUPPORTED 且不发请求', async () => {
    const provider = new ExaSearchProvider(CONFIG);

    await expect(provider.search({ query: 'q', page: 1 })).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_UNSUPPORTED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('归一化结果：text→snippet 截断、publishedDate 透传', async () => {
    requestMock.mockResolvedValue(
      okResponse({
        results: [
          { title: 'T', url: 'https://arxiv.org/abs/1', text: 'x'.repeat(700), publishedDate: '2023-11-16T01:36:32.547Z' },
          { title: 'no url' },
        ],
      })
    );
    const provider = new ExaSearchProvider(CONFIG);

    const result = await provider.search({ query: 'q' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      position: 1,
      title: 'T',
      url: 'https://arxiv.org/abs/1',
      siteName: 'arxiv.org',
      publishedAt: '2023-11-16T01:36:32.547Z',
      provider: 'exa',
    });
    expect(result.results[0].snippet.endsWith('...')).toBe(true);
    expect(result.results[0].snippet.length).toBe(603);
  });

  it('HTTP 非 2xx 抛 SEARCH_UPSTREAM_HTTP_ERROR 并携带 status', async () => {
    requestMock.mockResolvedValue({ status: 402, statusText: 'Payment Required', headers: {}, url: '', data: {} });
    const provider = new ExaSearchProvider(CONFIG);

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_UPSTREAM_HTTP_ERROR',
      status: 402,
    });
  });

  it('超时映射为 SEARCH_UPSTREAM_TIMEOUT', async () => {
    requestMock.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const provider = new ExaSearchProvider(CONFIG);

    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({
      code: 'SEARCH_UPSTREAM_TIMEOUT',
    });
  });

  it('normalizeExaResults 对异常输入返回空数组', () => {
    expect(normalizeExaResults({})).toEqual([]);
    expect(normalizeExaResults({ results: null })).toEqual([]);
  });
});
