jest.mock('../../../services/fetch', () => ({ fetchWeb: jest.fn() }));

import { fetchWeb } from '../../../services/fetch';
import { FetchError } from '../../../services/fetch/types';
import type { FetchResponse } from '../../../services/fetch/types';
import { executeWebFetch, webFetchDefinition } from '../index';

const fetchWebMock = fetchWeb as jest.Mock;

function providerResponse(overrides: Partial<FetchResponse> = {}): FetchResponse {
  return {
    results: [
      {
        url: 'https://example.com',
        title: 'T',
        text: '正文',
        provider: 'tinyfish',
      },
    ],
    errors: [],
    provider: 'tinyfish',
    attempts: ['tinyfish'],
    latencyMs: 42,
    ...overrides,
  };
}

describe('web-fetch skill', () => {
  beforeEach(() => {
    fetchWebMock.mockReset();
  });

  it('定义满足户口簿约定（handler-only / retrieval）', () => {
    expect(webFetchDefinition.name).toBe('web-fetch');
    expect(webFetchDefinition.category).toBe('retrieval');
    expect(webFetchDefinition.status).toBe('working');
    expect(webFetchDefinition.inputSchema.properties.urls.required).toBe(true);
  });

  it('urls 为空时直接失败，不触达 fetchWeb', async () => {
    const result = await executeWebFetch({ urls: ['   '] });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WEB_FETCH_URLS_REQUIRED');
    expect(fetchWebMock).not.toHaveBeenCalled();
  });

  it('成功时透传统一结果结构（含 errors）', async () => {
    fetchWebMock.mockResolvedValue(providerResponse());

    const result = await executeWebFetch({ urls: ['https://example.com'], format: 'markdown' });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      provider: 'tinyfish',
      attempts: ['tinyfish'],
    });
    expect(result.output?.results).toHaveLength(1);
    expect(result.output?.errors).toEqual([]);
    expect(fetchWebMock).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['https://example.com'], format: 'markdown' }),
      expect.anything()
    );
  });

  it('把 FetchError 映射为可读的 skill 错误码', async () => {
    fetchWebMock.mockRejectedValue(new FetchError('FETCH_PROVIDER_NOT_CONFIGURED', 'no key'));

    const result = await executeWebFetch({ urls: ['https://a.com'] });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FETCH_PROVIDER_NOT_CONFIGURED');
    expect(result.error?.message).toContain('FETCH_API_KEY');
  });

  it('未知异常回落为 WEB_FETCH_EXECUTION_FAILED', async () => {
    fetchWebMock.mockRejectedValue(new Error('boom'));

    const result = await executeWebFetch({ urls: ['https://a.com'] });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WEB_FETCH_EXECUTION_FAILED');
  });
});
