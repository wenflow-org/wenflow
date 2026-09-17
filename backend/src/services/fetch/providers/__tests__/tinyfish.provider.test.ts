jest.mock('../../../../utils/safe-http', () => {
  class UnsafeUrlError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnsafeUrlError';
    }
  }
  return { safeHttpRequest: jest.fn(), UnsafeUrlError };
});

import { safeHttpRequest, UnsafeUrlError } from '../../../../utils/safe-http';
import {
  buildTinyFishFetchBody,
  normalizeTinyFishFetchResults,
  TinyFishFetchProvider,
  type TinyFishFetchConfig,
} from '../tinyfish';

const requestMock = safeHttpRequest as jest.Mock;

const CONFIG: TinyFishFetchConfig = {
  endpoint: 'https://api.fetch.tinyfish.ai',
  apiKey: 'sk-test-key',
  timeoutMs: 60_000,
};

function okResponse(data: unknown) {
  return { status: 200, statusText: 'OK', headers: {}, url: '', data };
}

describe('TinyFishFetchProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('未配置 apiKey 时 isConfigured=false，调用抛 FETCH_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = new TinyFishFetchProvider({ ...CONFIG, apiKey: '' });

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_PROVIDER_NOT_CONFIGURED',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('POST JSON + X-API-Key，参数按 TinyFish 契约映射', async () => {
    requestMock.mockResolvedValue(okResponse({ results: [], errors: [] }));
    const provider = new TinyFishFetchProvider(CONFIG);

    await provider.fetch({
      urls: ['https://a.com', 'https://b.com'],
      format: 'markdown',
      includeSelectors: ['article'],
      excludeSelectors: ['.ads'],
      ttl: 0,
      perUrlTimeoutMs: 30_000,
      purpose: '取回教材原文',
      links: true,
      imageLinks: true,
    });

    const [url, options] = requestMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.fetch.tinyfish.ai');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['X-API-Key']).toBe('sk-test-key');
    expect(options.privateNetworkPolicy).toBe('public-only');
    expect(options.maxResponseBytes).toBe(8 * 1024 * 1024);

    expect(options.body).toEqual({
      urls: ['https://a.com', 'https://b.com'],
      format: 'markdown',
      include_selectors: ['article'],
      exclude_selectors: ['.ads'],
      ttl: 0,
      per_url_timeout_ms: 30_000,
      purpose: '取回教材原文',
      links: true,
      image_links: true,
    });
  });

  it('未提供可选参数时请求体只含 urls', () => {
    expect(buildTinyFishFetchBody({ urls: ['https://a.com'] })).toEqual({ urls: ['https://a.com'] });
  });

  it('条件请求参数映射为 if_none_match / if_modified_since / include_etag_and_last_modified', () => {
    const body = buildTinyFishFetchBody({
      urls: ['https://a.com'],
      ifNoneMatch: 'W/"abc"',
      includeValidators: true,
    });

    expect(body).toMatchObject({
      if_none_match: 'W/"abc"',
      include_etag_and_last_modified: true,
    });
  });

  it('归一化结果：字段映射 + 每 URL 失败进 errors（不影响成功项）', () => {
    const result = normalizeTinyFishFetchResults({
      results: [
        {
          url: 'https://a.com',
          final_url: 'https://a.com/final',
          title: 'T',
          description: 'D',
          language: 'zh',
          author: 'A',
          published_date: '2026-01-01',
          text: '正文'.repeat(40),
          format: 'markdown',
          links: ['https://l.com'],
          image_links: ['https://i.com'],
          latency_ms: 123.4,
        },
      ],
      errors: [{ url: 'https://bad.com', error: 'target_http_error', message: 'boom' }],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      url: 'https://a.com',
      finalUrl: 'https://a.com/final',
      title: 'T',
      description: 'D',
      language: 'zh',
      author: 'A',
      publishedAt: '2026-01-01',
      format: 'markdown',
      links: ['https://l.com'],
      imageLinks: ['https://i.com'],
      provider: 'tinyfish',
      latencyMs: 123.4,
    });
    expect(result.results[0].suspicious).toBeUndefined();
    expect(result.errors).toEqual([{ url: 'https://bad.com', code: 'target_http_error', message: 'boom' }]);
  });

  it('二进制垃圾（HTTP 200 但控制字符满屏）被标记 suspicious', () => {
    const result = normalizeTinyFishFetchResults({
      results: [{ url: 'https://a.com/x.doc', text: '\u0000\u0001\u0002'.repeat(500) }],
    });

    expect(result.results[0].suspicious).toBe(true);
  });

  it('内容过短被标记 suspicious', () => {
    const result = normalizeTinyFishFetchResults({ results: [{ url: 'https://a.com', text: 'hi' }] });

    expect(result.results[0].suspicious).toBe(true);
  });

  it('format=json 的结构化对象原样透传且不做可疑判定', () => {
    const tree = { type: 'document', children: [] };
    const result = normalizeTinyFishFetchResults({ results: [{ url: 'https://a.com', text: tree }] });

    expect(result.results[0].text).toEqual(tree);
    expect(result.results[0].suspicious).toBeUndefined();
  });

  it('丢弃无 url 的结果项，异常输入返回空', () => {
    expect(normalizeTinyFishFetchResults({ results: [{ title: 'no url' }] })).toEqual({ results: [], errors: [] });
    expect(normalizeTinyFishFetchResults({})).toEqual({ results: [], errors: [] });
    expect(normalizeTinyFishFetchResults({ results: 'nope' })).toEqual({ results: [], errors: [] });
  });

  it('HTTP 非 2xx 抛 FETCH_UPSTREAM_HTTP_ERROR 并携带 status', async () => {
    requestMock.mockResolvedValue({ status: 429, statusText: 'Too Many Requests', headers: {}, url: '', data: {} });
    const provider = new TinyFishFetchProvider(CONFIG);

    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_UPSTREAM_HTTP_ERROR',
      status: 429,
    });
  });

  it('超时映射为 FETCH_UPSTREAM_TIMEOUT', async () => {
    requestMock.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const provider = new TinyFishFetchProvider(CONFIG);

    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_UPSTREAM_TIMEOUT',
    });
  });

  it('URL 被安全策略拒绝时映射为 FETCH_UPSTREAM_UNAVAILABLE', async () => {
    requestMock.mockRejectedValue(new UnsafeUrlError('blocked'));
    const provider = new TinyFishFetchProvider(CONFIG);

    await expect(provider.fetch({ urls: ['https://a.com'] })).rejects.toMatchObject({
      code: 'FETCH_UPSTREAM_UNAVAILABLE',
    });
  });
});
