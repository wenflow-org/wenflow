/**
 * material-collector 单测（全 mock：无网络、无 LLM）。
 *
 * 覆盖：
 * - 正常采集出 pack（含 sourceTier / provenance / ttl 透传）
 * - 部分成功（单条 URL 失败不影响其余 → partial）
 * - not_found 显式返回（检索空 / 抓取全失败 / suspicious 全丢）
 * - 无引文要点被丢弃（且全丢时显式 not_found）
 * - suspicious 结果被丢弃
 * - sourceTier 分级 + 域白名单优先
 * - goal→path 接线缝导出（collectMaterialForGoal / hasMaterialNeed）
 */
jest.mock('../../../services/search', () => ({ searchWeb: jest.fn() }));
jest.mock('../../../services/fetch', () => ({ fetchWeb: jest.fn() }));

import { searchWeb } from '../../../services/search';
import { fetchWeb } from '../../../services/fetch';
import type { SearchResponse, SearchResultItem } from '../../../services/search/types';
import type { FetchContentItem, FetchResponse } from '../../../services/fetch/types';
import {
  classifySourceTier,
  collectMaterialForGoal,
  collectMaterialPack,
  executeMaterialCollector,
  hasMaterialNeed,
  rankSources,
} from '../index';
import type { MaterialExtractionDraft } from '../index';

const searchWebMock = searchWeb as jest.Mock;
const fetchWebMock = fetchWeb as jest.Mock;

const FIXED_NOW = () => new Date('2026-01-02T03:04:05.000Z');

/** DI 假 provider：单测不触达真实 search/fetch/LLM */
function makeDeps(overrides: {
  search?: (query: unknown, options?: unknown) => Promise<SearchResponse>;
  fetch?: (request: unknown, options?: unknown) => Promise<FetchResponse>;
  extract?: ((input: unknown) => Promise<MaterialExtractionDraft | null>) | undefined;
}) {
  return {
    searchWeb: jest.fn(overrides.search ?? (async () => searchResponse([]))),
    fetchWeb: jest.fn(overrides.fetch ?? (async () => fetchResponse([]))),
    extract: jest.fn(overrides.extract ?? (async () => null)),
  };
}

function searchItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    position: 0,
    title: '指南',
    url: 'https://www.moe.gov.cn/jyb_sjzl/guide',
    snippet: '摘要',
    provider: 'tinyfish',
    ...overrides,
  };
}

function searchResponse(results: SearchResultItem[]): SearchResponse {
  return { query: 'q', provider: 'tinyfish', attempts: ['tinyfish'], latencyMs: 1, page: 0, results };
}

function contentItem(overrides: Partial<FetchContentItem> = {}): FetchContentItem {
  return {
    url: 'https://www.moe.gov.cn/jyb_sjzl/guide',
    title: '指南正文',
    text: '指南指出：为深入贯彻教育方针，特制定本指南。健康领域包含身心状况、动作发展。',
    provider: 'tinyfish',
    ...overrides,
  };
}

function fetchResponse(results: FetchContentItem[], errors: FetchResponse['errors'] = []): FetchResponse {
  return { results, errors, provider: 'tinyfish', attempts: ['tinyfish'], latencyMs: 1 };
}

const baseNeed = { title: '《3-6 岁儿童学习与发展指南》' };

describe('material-collector 编排', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('正常采集出 pack（sourceTier 分级 + provenance 对齐 + ttl 透传）', async () => {
    const deps = makeDeps({
      search: async () => searchResponse([searchItem()]),
      fetch: async () => fetchResponse([contentItem()]),
      extract: async (): Promise<MaterialExtractionDraft> => ({
        title: '《3-6 岁儿童学习与发展指南》',
        publisher: '教育部',
        tldr: '教育部发布的学前教育指导文件。',
        sections: [{ title: '健康领域', summary: '身心状况与动作发展' }],
        keyPoints: [
          { text: '健康领域包含身心状况、动作发展', quote: '健康领域包含身心状况、动作发展' },
        ],
      }),
    });

    const result = await collectMaterialPack(baseNeed, { deps, now: FIXED_NOW });

    expect(result.status).toBe('ok');
    expect(result.pack).not.toBeNull();
    expect(result.pack?.sourceTier).toBe('official');
    expect(result.pack?.publisher).toBe('教育部');
    expect(result.pack?.fetchedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(result.pack?.sourceUrl).toBe('https://www.moe.gov.cn/jyb_sjzl/guide');
    expect(result.pack?.keyPoints).toHaveLength(1);
    expect(result.provenance).toEqual([
      {
        pointId: 'p-1',
        sourceUrl: 'https://www.moe.gov.cn/jyb_sjzl/guide',
        quote: '健康领域包含身心状况、动作发展',
      },
    ]);
    expect(result.coverage).toEqual({ covered: ['健康领域'], missing: [] });

    // 依赖注入：不触达真实 search/fetch（jest.mock 的 services 未被调用）
    expect(searchWebMock).not.toHaveBeenCalled();
    expect(fetchWebMock).not.toHaveBeenCalled();
  });

  it('ttl 缓存复用参数透传 + 候选去重（同 URL 只抓一次）', async () => {
    const deps = makeDeps({
      search: async (query) =>
        searchResponse([
          searchItem({ position: 0 }),
          searchItem({ position: 1, url: 'https://www.moe.gov.cn/jyb_sjzl/guide' }), // 与首条重复
          searchItem({ position: 2, url: 'https://www.nhc.gov.cn/guide2' }),
          query === 'q2' ? searchItem({ position: 0, url: 'https://www.nhc.gov.cn/guide2' }) : searchItem(),
        ]),
      fetch: async () => fetchResponse([contentItem()]),
      extract: async () => ({
        keyPoints: [{ text: '要点', quote: '健康领域包含身心状况、动作发展' }],
      }),
    });

    await collectMaterialPack(baseNeed, { deps, queries: ['q1', 'q2'], ttlSeconds: 3600, now: FIXED_NOW });

    const fetchCall = deps.fetchWeb.mock.calls[0] as [{ ttl?: number; urls: string[] }];
    expect(fetchCall[0].ttl).toBe(3600);
    expect(new Set(fetchCall[0].urls).size).toBe(fetchCall[0].urls.length);
    expect(fetchCall[0].urls).toEqual([
      'https://www.moe.gov.cn/jyb_sjzl/guide',
      'https://www.nhc.gov.cn/guide2',
    ]);
  });

  it('部分成功：单条 URL 抓取失败不影响其余 → partial', async () => {
    const deps = makeDeps({
      search: async () =>
        searchResponse([
          searchItem({ position: 0, url: 'https://www.moe.gov.cn/a' }),
          searchItem({ position: 1, url: 'https://www.nhc.gov.cn/b' }),
        ]),
      fetch: async () =>
        fetchResponse([contentItem({ url: 'https://www.moe.gov.cn/a' })], [
          { url: 'https://www.nhc.gov.cn/b', code: 'target_http_error', message: '404' },
        ]),
      extract: async () => ({
        keyPoints: [{ text: '要点', quote: '健康领域包含身心状况、动作发展' }],
      }),
    });

    const result = await collectMaterialPack(baseNeed, { deps, now: FIXED_NOW });

    expect(result.status).toBe('partial');
    expect(result.pack?.keyPoints).toHaveLength(1);
    expect(result.notes.some((note) => note.includes('抓取失败') && note.includes('nhc.gov.cn'))).toBe(true);
  });

  it('not_found 显式返回：检索空 → pack=null，不使用模型记忆', async () => {
    const deps = makeDeps({ search: async () => searchResponse([]) });
    const result = await collectMaterialPack(baseNeed, { deps, now: FIXED_NOW });

    expect(result.status).toBe('not_found');
    expect(result.pack).toBeNull();
    expect(result.provenance).toEqual([]);
    expect(result.notes.some((note) => note.includes('not_found'))).toBe(true);
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('not_found 显式返回：抓取全部失败 → pack=null', async () => {
    const deps = makeDeps({
      search: async () => searchResponse([searchItem()]),
      fetch: async () =>
        fetchResponse([], [{ url: 'https://www.moe.gov.cn/jyb_sjzl/guide', code: 'timeout', message: 'timed out' }]),
    });
    const result = await collectMaterialPack(baseNeed, { deps, now: FIXED_NOW });

    expect(result.status).toBe('not_found');
    expect(result.pack).toBeNull();
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('suspicious 结果被丢弃：只有可疑正文 → not_found', async () => {
    const deps = makeDeps({
      search: async () => searchResponse([searchItem()]),
      fetch: async () => fetchResponse([contentItem({ suspicious: true, text: '二进制乱码' })]),
      extract: jest.fn(),
    });
    const result = await collectMaterialPack(baseNeed, { deps, now: FIXED_NOW });

    expect(result.status).toBe('not_found');
    expect(result.pack).toBeNull();
    expect(result.notes.some((note) => note.includes('suspicious'))).toBe(true);
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('suspicious 结果被丢弃：可疑 + 正常 → 用正常那条', async () => {
    const deps = makeDeps({
      search: async () =>
        searchResponse([
          searchItem({ position: 0, url: 'https://www.moe.gov.cn/good' }),
          searchItem({ position: 1, url: 'https://www.nhc.gov.cn/binary' }),
        ]),
      fetch: async () =>
        fetchResponse([
          contentItem({ url: 'https://www.nhc.gov.cn/binary', suspicious: true, text: '乱码' }),
          contentItem({ url: 'https://www.moe.gov.cn/good' }),
        ]),
      extract: async () => ({
        keyPoints: [{ text: '要点', quote: '健康领域包含身心状况、动作发展' }],
      }),
    });
    const result = await collectMaterialPack(baseNeed, { deps, now: FIXED_NOW });

    expect(result.pack?.sourceUrl).toBe('https://www.moe.gov.cn/good');
    expect(result.notes.some((note) => note.includes('suspicious'))).toBe(true);
  });

  it('无引文要点被丢弃：缺 cite/quote 的要点不进 pack（硬规则②）', async () => {
    const deps = makeDeps({
      search: async () => searchResponse([searchItem()]),
      fetch: async () => fetchResponse([contentItem()]),
      extract: async () => ({
        sections: [{ title: '健康领域', summary: '身心状况' }],
        keyPoints: [
          { text: '有引文要点', quote: '健康领域包含身心状况、动作发展' },
          { text: '无引文要点' }, // 缺 quote/cite → 丢弃
          { text: '引文对不上', quote: '这句话在正文里根本不存在' }, // 校验失败 → 丢弃
        ],
      }),
    });

    const result = await collectMaterialPack(baseNeed, { deps, now: FIXED_NOW });

    expect(result.pack?.keyPoints).toHaveLength(1);
    expect(result.pack?.keyPoints[0].text).toBe('有引文要点');
    expect(result.provenance).toHaveLength(1);
    expect(result.notes.some((note) => note.includes('缺引文'))).toBe(true);
    expect(result.notes.some((note) => note.includes('原样找到'))).toBe(true);
  });

  it('无引文要点被丢弃：全部无引文 → 显式 not_found', async () => {
    const deps = makeDeps({
      search: async () => searchResponse([searchItem()]),
      fetch: async () => fetchResponse([contentItem()]),
      extract: async () => ({ keyPoints: [{ text: '无引文要点' }] }),
    });
    const result = await collectMaterialPack(baseNeed, { deps, now: FIXED_NOW });

    expect(result.status).toBe('not_found');
    expect(result.pack).toBeNull();
    expect(result.notes.some((note) => note.includes('无引文要点不得进入 pack'))).toBe(true);
  });

  it('文档：unit test 直接走 DI，不依赖 jest.mock 也能跑（services 为 mock 防误触网）', () => {
    expect(searchWebMock).toBeDefined();
    expect(fetchWebMock).toBeDefined();
  });
});

describe('material-collector 选源分级', () => {
  it('classifySourceTier：官方/标准 > 教材 > 权威机构 > 社区', () => {
    expect(classifySourceTier('https://www.moe.gov.cn/a')).toBe('official');
    expect(classifySourceTier('https://www.iso.org/standard/1')).toBe('standard');
    expect(classifySourceTier('https://www.pku.edu.cn/a')).toBe('textbook');
    expect(classifySourceTier('https://www.who.int/a')).toBe('authority');
    expect(classifySourceTier('https://zhuanlan.zhihu.com/p/1')).toBe('community');
    expect(classifySourceTier('https://example.com/a')).toBe('unknown');
  });

  it('rankSources：域白名单优先；无白名单时按 tier 降序', () => {
    const results = [searchItem({ position: 0, url: 'https://example.com/a' }), searchItem({ position: 1, url: 'https://www.moe.gov.cn/b' })];
    expect(rankSources(results, {})[0].url).toBe('https://www.moe.gov.cn/b');
    expect(rankSources(results, { whitelist: ['example.com'] })[0].url).toBe('https://example.com/a');
  });

  it('rankSources：黑名单（内容农场）直接丢弃', () => {
    const results = [searchItem({ position: 0, url: 'https://wenku.baidu.com/view/1' }), searchItem({ position: 1, url: 'https://www.moe.gov.cn/b' })];
    const ranked = rankSources(results, {});
    expect(ranked.map((item) => item.url)).toEqual(['https://www.moe.gov.cn/b']);
  });
});

describe('material-collector goal→path 接线缝', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hasMaterialNeed：识别 needsMaterial（顶层 / visibleSummary / understanding）', () => {
    expect(hasMaterialNeed({ needsMaterial: { title: 'x' } })).toBe(true);
    expect(hasMaterialNeed({ visibleSummary: { needsMaterial: { title: 'x' } } })).toBe(true);
    expect(hasMaterialNeed({ understanding: { needsMaterial: [{ title: 'x' }] } })).toBe(true);
    expect(hasMaterialNeed({ needsMaterial: null })).toBe(false);
    expect(hasMaterialNeed({ needsMaterial: { title: '   ' } })).toBe(false);
    expect(hasMaterialNeed({})).toBe(false);
  });

  it('collectMaterialForGoal：逐条采集并保序返回', async () => {
    const deps = makeDeps({
      search: async () => searchResponse([searchItem()]),
      fetch: async () => fetchResponse([contentItem()]),
      extract: async () => ({ keyPoints: [{ text: '要点', quote: '健康领域包含身心状况、动作发展' }] }),
    });

    const results = await collectMaterialForGoal(
      [{ title: 'A' }, { title: '  ' }, { title: 'B' }],
      { deps, now: FIXED_NOW }
    );

    expect(results).toHaveLength(2); // 空 title 被过滤
    expect(results.every((result) => result.status === 'ok')).toBe(true);
    expect(deps.extract).toHaveBeenCalledTimes(2);
  });

  it('executeMaterialCollector：not_found 是合法业务结果（success 仍为 true）', async () => {
    const deps = makeDeps({ search: async () => searchResponse([]) });
    const result = await executeMaterialCollector({ need: baseNeed, deps, now: FIXED_NOW });

    expect(result.success).toBe(true);
    expect(result.output?.status).toBe('not_found');
  });
});
