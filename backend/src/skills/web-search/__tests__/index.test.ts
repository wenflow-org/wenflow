jest.mock('../../../services/search', () => ({ searchWeb: jest.fn() }));

import { searchWeb } from '../../../services/search';
import { SearchError } from '../../../services/search/types';
import type { SearchResponse } from '../../../services/search/types';
import { executeWebSearch, webSearchDefinition } from '../index';

const searchWebMock = searchWeb as jest.Mock;

function providerResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: 'ai news',
    results: [
      {
        position: 1,
        title: 'T',
        url: 'https://example.com',
        snippet: 'S',
        siteName: 'example.com',
        provider: 'tinyfish',
      },
    ],
    totalResults: 1,
    page: 0,
    provider: 'tinyfish',
    attempts: ['tinyfish'],
    latencyMs: 42,
    ...overrides,
  };
}

describe('web-search skill', () => {
  beforeEach(() => {
    searchWebMock.mockReset();
  });

  it('定义满足户口簿约定（handler-only / retrieval）', () => {
    expect(webSearchDefinition.name).toBe('web-search');
    expect(webSearchDefinition.category).toBe('retrieval');
    expect(webSearchDefinition.status).toBe('working');
    expect(webSearchDefinition.inputSchema.properties.query.required).toBe(true);
  });

  it('query 为空时直接失败，不触达 searchWeb', async () => {
    const result = await executeWebSearch({ query: '   ' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WEB_SEARCH_QUERY_REQUIRED');
    expect(searchWebMock).not.toHaveBeenCalled();
  });

  it('成功时透传统一结果结构', async () => {
    searchWebMock.mockResolvedValue(providerResponse());

    const result = await executeWebSearch({ query: 'ai news', maxResults: 5 });

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      query: 'ai news',
      provider: 'tinyfish',
      attempts: ['tinyfish'],
      page: 0,
      totalResults: 1,
    });
    expect(result.output?.results).toHaveLength(1);
    expect(searchWebMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'ai news', maxResults: 5 }),
      expect.anything()
    );
  });

  it('把 SearchError 映射为可读的 skill 错误码', async () => {
    searchWebMock.mockRejectedValue(new SearchError('SEARCH_PROVIDER_NOT_CONFIGURED', 'no key'));

    const result = await executeWebSearch({ query: 'q' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SEARCH_PROVIDER_NOT_CONFIGURED');
    expect(result.error?.message).toContain('SEARCH_API_KEY');
  });

  it('未知异常回落为 WEB_SEARCH_EXECUTION_FAILED', async () => {
    searchWebMock.mockRejectedValue(new Error('boom'));

    const result = await executeWebSearch({ query: 'q' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WEB_SEARCH_EXECUTION_FAILED');
  });
});
