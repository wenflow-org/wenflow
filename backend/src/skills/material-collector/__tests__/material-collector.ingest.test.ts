/**
 * material-collector 联网入库回填单测（活的 path 批次 A）：
 * pack.materialId 回填 / 入库失败 fail-open / 未传 userId 保持旧行为 / notes 记录入库动作。
 */
import type { FetchContentItem, FetchResponse } from '../../../services/fetch/types';
import type { SearchResponse, SearchResultItem } from '../../../services/search/types';
import {
  collectMaterialPack,
  type MaterialCollectorProviderDeps,
  type MaterialExtractionDraft,
} from '../index';

function searchItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    position: 0,
    title: '指南全文',
    url: 'https://www.moe.gov.cn/jyb_sjzl/guide',
    snippet: '摘要',
    provider: 'tinyfish',
    ...overrides,
  };
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

function draft(): MaterialExtractionDraft {
  return {
    title: '《3-6 岁儿童学习与发展指南》',
    publisher: '教育部',
    keyPoints: [
      { text: '健康领域包含身心状况、动作发展', cite: '健康领域包含身心状况、动作发展' },
    ],
    notes: [],
  } as unknown as MaterialExtractionDraft;
}

function makeDeps(overrides: Partial<MaterialCollectorProviderDeps> = {}): MaterialCollectorProviderDeps {
  const search = overrides.searchWeb ?? (async (): Promise<SearchResponse> => ({
    query: 'q', provider: 'tinyfish', attempts: ['tinyfish'], latencyMs: 1, page: 0,
    results: [searchItem()],
  }));
  const fetch = overrides.fetchWeb ?? (async (): Promise<FetchResponse> => ({
    results: [contentItem()], errors: [], provider: 'tinyfish', attempts: ['tinyfish'], latencyMs: 1,
  }));
  return {
    searchWeb: jest.fn(search),
    fetchWeb: jest.fn(fetch),
    extract: overrides.extract ?? jest.fn(async () => draft()),
    ingestWebMaterial: overrides.ingestWebMaterial
      ?? jest.fn(async () => ({ record: { id: 'web-rec-1', name: '指南', charCount: 40 }, deduped: false })),
  };
}

describe('material-collector 联网入库回填（批次 A）', () => {
  it('入库成功 → pack.materialId 回填 + notes 记录入库动作', async () => {
    const deps = makeDeps();
    const result = await collectMaterialPack({ title: '《3-6 岁儿童学习与发展指南》' }, { deps, userId: 'user_collect1' });
    expect(result.status).toBe('ok');
    expect(result.pack?.materialId).toBe('web-rec-1');
    expect(result.notes.join(' ')).toContain('联网资料已入库');
    expect(deps.ingestWebMaterial).toHaveBeenCalledTimes(1);
    // 携带的是**全文**（非 6000 字截断版）与最终 URL
    const call = (deps.ingestWebMaterial as jest.Mock).mock.calls[0][0];
    expect(call.userId).toBe('user_collect1');
    expect(call.url).toBe('https://www.moe.gov.cn/jyb_sjzl/guide');
    expect(call.text).toContain('健康领域包含身心状况');
  });

  it('入库返回 null（闸门拒收）→ pack 照常交付，materialId 不回填，notes 记录原因', async () => {
    const deps = makeDeps({ ingestWebMaterial: jest.fn(async () => null) });
    const result = await collectMaterialPack({ title: '《3-6 岁儿童学习与发展指南》' }, { deps, userId: 'user_collect2' });
    expect(result.status).toBe('ok');
    expect(result.pack?.materialId ?? null).toBeNull();
    expect(result.notes.join(' ')).toContain('闸门拒收');
  });

  it('入库抛错 → fail-open，pack 照常交付', async () => {
    const deps = makeDeps({ ingestWebMaterial: jest.fn(async () => { throw new Error('disk full'); }) });
    const result = await collectMaterialPack({ title: '《3-6 岁儿童学习与发展指南》' }, { deps, userId: 'user_collect3' });
    expect(result.status).toBe('ok');
    expect(result.pack?.materialId ?? null).toBeNull();
    expect(result.notes.join(' ')).toContain('fail-open');
  });

  it('未传 userId → 不调用入库（行为与批次 A 之前一致）', async () => {
    const deps = makeDeps();
    const result = await collectMaterialPack({ title: '《3-6 岁儿童学习与发展指南》' }, { deps });
    expect(result.status).toBe('ok');
    expect(deps.ingestWebMaterial).not.toHaveBeenCalled();
    expect(result.pack?.materialId ?? null).toBeNull();
  });
});
