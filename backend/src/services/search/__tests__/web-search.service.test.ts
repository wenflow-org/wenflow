jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { resolveProviderOrder } from '../providers';
import { searchWeb } from '../web-search.service';
import { SearchError } from '../types';
import type {
  SearchProvider,
  SearchProviderId,
  SearchProviderResult,
  SearchQuery,
  SearchResultItem,
} from '../types';

function item(provider: SearchProviderId, index = 0): SearchResultItem {
  return {
    position: index + 1,
    title: `title-${index}`,
    url: `https://example.com/${index}`,
    snippet: `snippet-${index}`,
    provider,
  };
}

function fakeProvider(
  id: SearchProviderId,
  searchImpl: (query: SearchQuery) => Promise<SearchProviderResult>,
  configured = true
): SearchProvider {
  return { id, isConfigured: () => configured, search: jest.fn(searchImpl) };
}

describe('searchWeb 编排', () => {
  it('入参不合法时抛 SEARCH_QUERY_INVALID（不触达 provider）', async () => {
    const provider = fakeProvider('tinyfish', async () => ({ results: [], page: 0 }));

    await expect(
      searchWeb({ query: '   ' }, { providers: { tinyfish: provider } })
    ).rejects.toMatchObject({ code: 'SEARCH_QUERY_INVALID' });
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('recencyMinutes 与 afterDate 互斥', async () => {
    await expect(
      searchWeb({ query: 'q', recencyMinutes: 30, afterDate: '2026-01-01' })
    ).rejects.toMatchObject({ code: 'SEARCH_QUERY_INVALID' });
  });

  it('research_paper 不允许日期过滤', async () => {
    await expect(
      searchWeb({ query: 'q', domainType: 'research_paper', afterDate: '2026-01-01' })
    ).rejects.toMatchObject({ code: 'SEARCH_QUERY_INVALID' });
  });

  it('没有可用 provider 时抛 SEARCH_PROVIDER_NOT_CONFIGURED', async () => {
    const provider = fakeProvider('tinyfish', async () => ({ results: [], page: 0 }), false);

    await expect(
      searchWeb({ query: 'q' }, { providerOrder: ['tinyfish'], providers: { tinyfish: provider } })
    ).rejects.toMatchObject({ code: 'SEARCH_PROVIDER_NOT_CONFIGURED' });
  });

  it('首选 provider 失败时按顺序降级，并记录 attempts', async () => {
    const failing = fakeProvider('tinyfish', () =>
      Promise.reject(new SearchError('SEARCH_UPSTREAM_UNAVAILABLE', 'upstream down'))
    );
    const fallback = fakeProvider('tavily', async () => ({ results: [item('tavily')], totalResults: 1, page: 0 }));

    const result = await searchWeb(
      { query: 'q' },
      {
        providerOrder: ['tinyfish', 'tavily'],
        providers: { tinyfish: failing, tavily: fallback },
      }
    );

    expect(result.provider).toBe('tavily');
    expect(result.attempts).toEqual(['tinyfish', 'tavily']);
    expect(result.results).toHaveLength(1);
    expect(result.query).toBe('q');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('全部失败时抛出最后一个 SearchError', async () => {
    const provider = fakeProvider('tinyfish', () =>
      Promise.reject(new SearchError('SEARCH_UPSTREAM_TIMEOUT', 'timeout'))
    );

    await expect(
      searchWeb({ query: 'q' }, { providerOrder: ['tinyfish'], providers: { tinyfish: provider } })
    ).rejects.toMatchObject({ code: 'SEARCH_UPSTREAM_TIMEOUT' });
  });

  it('未指定 maxResults 时默认截断为 10 条', async () => {
    const many = Array.from({ length: 25 }, (_, index) => item('tinyfish', index));
    const provider = fakeProvider('tinyfish', async () => ({ results: many, page: 0 }));

    const result = await searchWeb(
      { query: 'q' },
      { providerOrder: ['tinyfish'], providers: { tinyfish: provider } }
    );

    expect(result.results).toHaveLength(10);
  });

  it('显式 maxResults 生效', async () => {
    const many = Array.from({ length: 25 }, (_, index) => item('tinyfish', index));
    const provider = fakeProvider('tinyfish', async () => ({ results: many, page: 0 }));

    const result = await searchWeb(
      { query: 'q', maxResults: 3 },
      { providerOrder: ['tinyfish'], providers: { tinyfish: provider } }
    );

    expect(result.results).toHaveLength(3);
  });

  it('未在构建中实现的 provider 被跳过', async () => {
    const provider = fakeProvider('tinyfish', async () => ({ results: [item('tinyfish')], page: 0 }));

    const result = await searchWeb(
      { query: 'q' },
      { providerOrder: ['exa', 'tinyfish'], providers: { tinyfish: provider } }
    );

    expect(result.attempts).toEqual(['tinyfish']);
  });
});

describe('resolveProviderOrder', () => {
  it('未配置时回退到已实现 provider 的默认顺序', () => {
    expect(resolveProviderOrder('')).toEqual(['tinyfish', 'tavily', 'exa']);
  });

  it('解析逗号分隔的降级链并去重', () => {
    expect(resolveProviderOrder('tinyfish, tavily ,tinyfish')).toEqual(['tinyfish', 'tavily']);
  });

  it('未知 provider 直接报错', () => {
    expect(() => resolveProviderOrder('bing')).toThrow(SearchError);
    expect(() => resolveProviderOrder('bing')).toThrow(/未知的搜索 provider/);
  });
});
