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
  buildTavilyFetchBody,
  normalizeTavilyFetchResults,
  TavilyFetchProvider,
  type TavilyFetchConfig,
} from '../tavily';

const requestMock = safeHttpRequest as jest.Mock;

const CONFIG: TavilyFetchConfig = {
  endpoint: 'https://api.tavily.com/extract',
  apiKey: 'tvly-test-key',
  timeoutMs: 60_000,
};

function okResponse(data: unknown) {
  return { status: 200, statusText: 'OK', headers: {}, url: '', data };
}

describe('TavilyFetchProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('未配置 apiKey 时 isConfigured=false，调用抛 FETCH_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = new TavilyFetchProvider({ ...CONFIG, apiKey: '' });

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_PROVIDER_NOT_CONFIGURED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('POST JSON + Bearer 认证，body 映射为 urls + extract_depth', async () => {
    requestMock.mockResolvedValue(okResponse({ results: [], failed_results: [] }));
    const provider = new TavilyFetchProvider(CONFIG);

    await provider.fetch({ urls: ['https://a.com'], imageLinks: true });

    const [url, options] = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.tavily.com/extract');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer tvly-test-key');
    expect(options.privateNetworkPolicy).toBe('public-only');
    expect(options.body).toEqual({
      urls: ['https://a.com'],
      extract_depth: 'basic',
      include_images: true,
    });
  });

  it('markdown 是唯一支持的 format，其它 format 抛 FETCH_PROVIDER_UNSUPPORTED', () => {
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], format: 'markdown' })).not.toThrow();
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], format: 'html' })).toThrow(/不支持 format=html/);
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], format: 'json' })).toThrow(/不支持 format=json/);
  });

  it('选择器 / ttl / perUrlTimeoutMs / 条件请求 一律抛 FETCH_PROVIDER_UNSUPPORTED（不静默忽略）', () => {
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], includeSelectors: ['article'] })).toThrow(/选择器/);
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], excludeSelectors: ['.ads'] })).toThrow(/选择器/);
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], ttl: 0 })).toThrow(/缓存 ttl/);
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], perUrlTimeoutMs: 1000 })).toThrow(/perUrlTimeoutMs/);
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], ifNoneMatch: 'W/"x"' })).toThrow(/条件请求/);
    expect(() => buildTavilyFetchBody({ urls: ['https://a.com'], includeValidators: true })).toThrow(/条件请求/);
  });

  it('归一化结果：raw_content→text，failed_results→errors', () => {
    const result = normalizeTavilyFetchResults({
      results: [{ url: 'https://a.com', title: 'T', raw_content: '正文'.repeat(40), images: ['https://i.com', ''] }],
      failed_results: [{ url: 'https://bad.com', error: '404 Not Found' }],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      url: 'https://a.com',
      title: 'T',
      format: 'markdown',
      imageLinks: ['https://i.com'],
      provider: 'tavily',
    });
    expect(result.results[0].text).toContain('正文');
    expect(result.errors).toEqual([{ url: 'https://bad.com', code: '404 Not Found', message: '404 Not Found' }]);
  });

  it('内容过短标记 suspicious', () => {
    const result = normalizeTavilyFetchResults({ results: [{ url: 'https://a.com', raw_content: 'hi' }] });

    expect(result.results[0].suspicious).toBe(true);
  });

  it('异常输入返回空结果', () => {
    expect(normalizeTavilyFetchResults({})).toEqual({ results: [], errors: [] });
    expect(normalizeTavilyFetchResults({ results: 'nope' })).toEqual({ results: [], errors: [] });
  });

  it('HTTP 非 2xx 抛 FETCH_UPSTREAM_HTTP_ERROR 并携带 status', async () => {
    requestMock.mockResolvedValue({ status: 432, statusText: 'Plan Limit', headers: {}, url: '', data: {} });
    const provider = new TavilyFetchProvider(CONFIG);

    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_UPSTREAM_HTTP_ERROR',
      status: 432,
    });
  });

  it('超时映射为 FETCH_UPSTREAM_TIMEOUT', async () => {
    requestMock.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const provider = new TavilyFetchProvider(CONFIG);

    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_UPSTREAM_TIMEOUT',
    });
  });
});
