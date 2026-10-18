/**
 * embedding / rerank 编排测试（注入 fake provider，不触网）。
 * 覆盖：入参校验、provider 降级、批量对齐、余弦相似度、rerank 排序。
 */
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { embedTexts, rerankDocuments, cosineSimilarity } from '../embedding.service';
import { normalizeEmbeddingRequest, normalizeRerankRequest, MAX_TEXT_CHARS } from '../validate';
import { resolveEmbeddingProviderOrder } from '../providers';
import { EmbeddingError } from '../types';
import type {
  EmbeddingProvider,
  EmbeddingProviderId,
  EmbeddingProviderResult,
  EmbeddingRequest,
  RerankProvider,
  RerankProviderResult,
} from '../types';

function fakeEmbed(
  id: EmbeddingProviderId,
  impl: (request: EmbeddingRequest) => Promise<EmbeddingProviderResult>,
  configured = true
): EmbeddingProvider {
  return { id, isConfigured: () => configured, embed: jest.fn(impl) };
}

function fakeRerank(
  id: EmbeddingProviderId,
  impl: () => Promise<RerankProviderResult>,
  configured = true
): EmbeddingProvider & Partial<RerankProvider> {
  return {
    id,
    isConfigured: () => configured,
    embed: jest.fn(async () => ({ vectors: [], model: 'm', dimensions: 0 })),
    rerank: jest.fn(impl),
  };
}

describe('normalizeEmbeddingRequest', () => {
  it('string 与 string[] 都收；空串被拒', () => {
    expect(normalizeEmbeddingRequest({ input: 'x' }).input).toBe('x');
    expect(normalizeEmbeddingRequest({ input: ['a', 'b'] }).input).toEqual(['a', 'b']);
    expect(() => normalizeEmbeddingRequest({ input: '' })).toThrow(EmbeddingError);
    expect(() => normalizeEmbeddingRequest({ input: [] })).toThrow(EmbeddingError);
  });

  it('超长文本被显式拒绝（不静默截断）', () => {
    expect(() => normalizeEmbeddingRequest({ input: 'a'.repeat(MAX_TEXT_CHARS + 1) })).toThrow(/不能超过/);
  });

  it('未知字段被 .strict() 拒绝', () => {
    expect(() => normalizeEmbeddingRequest({ input: 'x', foo: 1 } as unknown as EmbeddingRequest)).toThrow(
      /不支持的字段/
    );
  });
});

describe('embedTexts 编排', () => {
  it('单 provider 成功 → 返回 vectors/dimensions/provider', async () => {
    const provider = fakeEmbed('bge', async (req) => ({
      vectors: (Array.isArray(req.input) ? req.input : [req.input]).map((_, i) => ({ index: i, embedding: [0.1, 0.2] })),
      model: 'BAAI/bge-m3',
      dimensions: 2,
    }));
    const res = await embedTexts({ input: ['a', 'b'] }, { providers: { bge: provider }, providerOrder: ['bge'] });
    expect(res.vectors).toHaveLength(2);
    expect(res.dimensions).toBe(2);
    expect(res.provider).toBe('bge');
    expect(res.attempts).toEqual(['bge']);
  });

  it('入参不合法时不触达 provider', async () => {
    const provider = fakeEmbed('bge', async () => ({ vectors: [], model: 'm', dimensions: 0 }));
    await expect(embedTexts({ input: '' }, { providers: { bge: provider }, providerOrder: ['bge'] })).rejects.toMatchObject({
      code: 'EMBEDDING_REQUEST_INVALID',
    });
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('主 provider 失败 → 降级到后备（保留原始错误码仅当全部失败）', async () => {
    const failing = fakeEmbed('bge', async () => {
      throw new EmbeddingError('EMBEDDING_UPSTREAM_TIMEOUT', 'boom');
    });
    await expect(
      embedTexts({ input: 'x' }, { providers: { bge: failing }, providerOrder: ['bge'] })
    ).rejects.toMatchObject({ code: 'EMBEDDING_UPSTREAM_TIMEOUT' });
  });

  it('无可用 provider → EMBEDDING_PROVIDER_NOT_CONFIGURED', async () => {
    const unconfigured = fakeEmbed('bge', async () => ({ vectors: [], model: 'm', dimensions: 0 }), false);
    await expect(
      embedTexts({ input: 'x' }, { providers: { bge: unconfigured }, providerOrder: ['bge'] })
    ).rejects.toMatchObject({ code: 'EMBEDDING_PROVIDER_NOT_CONFIGURED' });
  });

  it('resolveEmbeddingProviderOrder：未知 provider 直接报错', () => {
    expect(resolveEmbeddingProviderOrder('')).toEqual(['bge']);
    expect(resolveEmbeddingProviderOrder('bge,bge')).toEqual(['bge']);
    expect(() => resolveEmbeddingProviderOrder('nope')).toThrow(/未知的向量化 provider/);
  });

  // 真机回归（2026-10-16）：长文档整篇索引一次发出 >128 条 → 批量超限整批失败
  it('大批量 → 自动按偏好大小分组发出，index 全局对齐', async () => {
    const seenBatches: number[] = [];
    const provider = fakeEmbed('bge', async (req) => {
      const list = Array.isArray(req.input) ? req.input : [req.input];
      seenBatches.push(list.length);
      return {
        vectors: list.map((_, i) => ({ index: i, embedding: [1, 0] })),
        model: 'BAAI/bge-m3',
        dimensions: 2,
      };
    });
    const input = Array.from({ length: 300 }, (_, i) => `文本${i}`);
    const res = await embedTexts({ input }, { providers: { bge: provider }, providerOrder: ['bge'] });

    // 默认偏好 32（不是上限 128）：每组都不超偏好大小，且组数正确
    expect(seenBatches.every((n) => n <= 32)).toBe(true);
    expect(seenBatches).toHaveLength(Math.ceil(300 / 32));
    expect(res.vectors).toHaveLength(300);
    expect(res.vectors.map((v) => v.index)).toEqual(Array.from({ length: 300 }, (_, i) => i)); // 全局偏移无缝
  });

  it('EMBEDDING_BATCH_SIZE 可覆盖偏好大小', async () => {
    process.env.EMBEDDING_BATCH_SIZE = '8';
    try {
      const seenBatches: number[] = [];
      const provider = fakeEmbed('bge', async (req) => {
        const list = Array.isArray(req.input) ? req.input : [req.input];
        seenBatches.push(list.length);
        return { vectors: list.map((_, i) => ({ index: i, embedding: [1, 0] })), model: 'm', dimensions: 2 };
      });
      const res = await embedTexts(
        { input: Array.from({ length: 20 }, (_, i) => `t${i}`) },
        { providers: { bge: provider }, providerOrder: ['bge'] }
      );
      expect(seenBatches).toEqual([8, 8, 4]);
      expect(res.vectors).toHaveLength(20);
    } finally {
      delete process.env.EMBEDDING_BATCH_SIZE;
    }
  });

  // 真机回归（2026-10-16，combined.log 实测 5 次）：大请求让上游 20s 超时 → 整篇索引全废
  it('某组超时 → 自动对半拆重试，最终结果完整（不整篇失败）', async () => {
    const seenBatches: number[] = [];
    const provider = fakeEmbed('bge', async (req) => {
      const list = Array.isArray(req.input) ? req.input : [req.input];
      seenBatches.push(list.length);
      if (list.length > 8) throw new EmbeddingError('EMBEDDING_UPSTREAM_TIMEOUT', '上游超时');
      return { vectors: list.map((_, i) => ({ index: i, embedding: [1, 0] })), model: 'm', dimensions: 2 };
    });
    const res = await embedTexts(
      { input: Array.from({ length: 32 }, (_, i) => `t${i}`) },
      { providers: { bge: provider }, providerOrder: ['bge'] }
    );
    // 顺序执行：32 超时 → 前半 16 再超时 → 8×2 成功；再做后半 16 → 8×2
    expect(seenBatches).toEqual([32, 16, 8, 8, 16, 8, 8]);
    expect(res.vectors).toHaveLength(32);
    expect(res.vectors.map((v) => v.index)).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it('拆分深度用尽仍超时 → 整体失败（有界重试，不无限拆）', async () => {
    let calls = 0;
    const provider = fakeEmbed('bge', async () => {
      calls += 1;
      throw new EmbeddingError('EMBEDDING_UPSTREAM_TIMEOUT', '一直超时');
    });
    await expect(
      embedTexts({ input: Array.from({ length: 32 }, (_, i) => `t${i}`) }, { providers: { bge: provider }, providerOrder: ['bge'] })
    ).rejects.toMatchObject({ code: 'EMBEDDING_UPSTREAM_TIMEOUT' });
    // 深度上限 3 → 32→16→8→4，首个分支失败即向上抛出，故共 4 次调用（有界，不会拆到每条一次）
    expect(calls).toBe(4);
  });

  it('分组中某组失败（非超时）→ 整体失败（不做部分成功）', async () => {
    let call = 0;
    const provider = fakeEmbed('bge', async (req) => {
      call += 1;
      if (call === 2) throw new EmbeddingError('EMBEDDING_UPSTREAM_HTTP_ERROR', 'boom');
      const list = Array.isArray(req.input) ? req.input : [req.input];
      return { vectors: list.map((_, i) => ({ index: i, embedding: [1, 0] })), model: 'm', dimensions: 2 };
    });
    await expect(
      embedTexts({ input: Array.from({ length: 200 }, (_, i) => `t${i}`) }, { providers: { bge: provider }, providerOrder: ['bge'] })
    ).rejects.toMatchObject({ code: 'EMBEDDING_UPSTREAM_HTTP_ERROR' });
  });
});

describe('rerankDocuments 编排', () => {
  it('返回按相关分降序的 results', async () => {
    const provider = fakeRerank('bge', async () => ({
      results: [
        { index: 2, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.5 },
      ],
      model: 'BAAI/bge-reranker-v2-m3',
    }));
    const res = await rerankDocuments(
      { query: '学习理论', documents: ['甲', '乙', '丙'] },
      { providers: { bge: provider }, providerOrder: ['bge'] }
    );
    expect(res.results.map((r) => r.index)).toEqual([2, 0]);
    expect(res.results[0].relevanceScore).toBe(0.9);
  });

  it('topN 超过候选数时被夹到候选数', () => {
    const normalized = normalizeRerankRequest({ query: 'x', documents: ['a', 'b'], topN: 99 });
    expect(normalized.topN).toBe(2);
  });

  it('空 query / 空候选被拒', () => {
    expect(() => normalizeRerankRequest({ query: '', documents: ['a'] })).toThrow(EmbeddingError);
    expect(() => normalizeRerankRequest({ query: 'x', documents: [] })).toThrow(EmbeddingError);
  });
});

describe('cosineSimilarity', () => {
  it('同向量 = 1；正交 = 0；反向量 = -1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 9);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 9);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 9);
  });

  it('零向量返回 0（不除零）', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });

  it('维度不一致抛错', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/同维向量/);
  });
});
