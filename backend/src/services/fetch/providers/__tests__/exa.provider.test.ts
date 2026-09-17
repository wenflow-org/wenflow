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
  buildExaFetchBody,
  normalizeExaFetchResults,
  ExaFetchProvider,
  type ExaFetchConfig,
} from '../exa';

const requestMock = safeHttpRequest as jest.Mock;

const CONFIG: ExaFetchConfig = {
  endpoint: 'https://api.exa.ai/contents',
  apiKey: 'exa-test-key',
  timeoutMs: 60_000,
};

function okResponse(data: unknown) {
  return { status: 200, statusText: 'OK', headers: {}, url: '', data };
}

describe('ExaFetchProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('未配置 apiKey 时 isConfigured=false，调用抛 FETCH_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = new ExaFetchProvider({ ...CONFIG, apiKey: '' });

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_PROVIDER_NOT_CONFIGURED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('POST JSON + x-api-key，markdown 映射为 text:true', async () => {
    requestMock.mockResolvedValue(okResponse({ results: [] }));
    const provider = new ExaFetchProvider(CONFIG);

    await provider.fetch({ urls: ['https://a.com'], format: 'markdown' });

    const [url, options] = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.exa.ai/contents');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['x-api-key']).toBe('exa-test-key');
    expect(options.privateNetworkPolicy).toBe('public-only');
    expect(options.body).toEqual({ urls: ['https://a.com'], text: true });
  });

  it('format=html 映射为 html:true', () => {
    expect(buildExaFetchBody({ urls: ['https://a.com'], format: 'html' })).toEqual({
      urls: ['https://a.com'],
      html: true,
    });
  });

  it('format=json / imageLinks / 选择器 / ttl / 条件请求 抛 FETCH_PROVIDER_UNSUPPORTED', () => {
    expect(() => buildExaFetchBody({ urls: ['https://a.com'], format: 'json' })).toThrow(/不支持 format=json/);
    expect(() => buildExaFetchBody({ urls: ['https://a.com'], imageLinks: true })).toThrow(/不支持 imageLinks/);
    expect(() => buildExaFetchBody({ urls: ['https://a.com'], includeSelectors: ['article'] })).toThrow(/选择器/);
    expect(() => buildExaFetchBody({ urls: ['https://a.com'], ttl: 0 })).toThrow(/缓存 ttl/);
    expect(() => buildExaFetchBody({ urls: ['https://a.com'], ifModifiedSince: 'x' })).toThrow(/条件请求/);
  });

  it('归一化结果：status 非 success 归入 errors，其余进 results', () => {
    const result = normalizeExaFetchResults(
      {
        results: [
          { url: 'https://a.com', title: 'T', text: '正文'.repeat(40), author: 'A', publishedDate: '2026-01-01', status: 'success' },
          { url: 'https://bad.com', status: 'error', error: 'CRAWL_NOT_FOUND' },
        ],
      },
      'markdown'
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      url: 'https://a.com',
      title: 'T',
      author: 'A',
      publishedAt: '2026-01-01',
      format: 'text',
      provider: 'exa',
    });
    expect(result.errors).toEqual([{ url: 'https://bad.com', code: 'CRAWL_NOT_FOUND', message: 'CRAWL_NOT_FOUND' }]);
  });

  it('format=html 时取 html 字段并如实回报 format=html', () => {
    const result = normalizeExaFetchResults(
      { results: [{ url: 'https://a.com', html: '<p>' + 'x'.repeat(80) + '</p>', text: 'ignored' }] },
      'html'
    );

    expect(result.results[0].format).toBe('html');
    expect(result.results[0].text).toContain('<p>');
  });

  it('异常输入返回空结果', () => {
    expect(normalizeExaFetchResults({})).toEqual({ results: [], errors: [] });
    expect(normalizeExaFetchResults({ results: 'nope' })).toEqual({ results: [], errors: [] });
  });

  it('HTTP 非 2xx 抛 FETCH_UPSTREAM_HTTP_ERROR 并携带 status', async () => {
    requestMock.mockResolvedValue({ status: 402, statusText: 'Payment Required', headers: {}, url: '', data: {} });
    const provider = new ExaFetchProvider(CONFIG);

    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_UPSTREAM_HTTP_ERROR',
      status: 402,
    });
  });
});
