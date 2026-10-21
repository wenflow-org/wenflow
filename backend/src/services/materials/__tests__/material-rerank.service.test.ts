/**
 * rerank 注入闸门单测（不触网，fetch 注入）。
 *
 * 覆盖 2026-10-21 评测接入的四条分支（EMBEDDING-DECISION-EVAL.md）：
 *   1) 未配置/禁用/样本不足 → 闸门不启用，全量放行；
 *   2) 正常打分 → 阈值过滤 + 分数缓存（二次调用不再出网）；
 *   3) HTTP 失败/超时 → fail-open 全量放行；
 *   4) 部分资料无分数 → 无分数的放行（宁漏勿杀）。
 */
import type { MaterialRecord } from '../material-store';
import {
  applyMaterialRerankGate,
  __clearMaterialRerankCacheForTests,
} from '../material-rerank.service';

function makeRecord(input: { id: string; name: string; headings?: string[]; contentHash?: string }): MaterialRecord {
  return {
    id: input.id,
    userId: 'user-1',
    name: input.name,
    ext: '.md',
    format: 'md',
    size: 100,
    charCount: 100,
    structure: {
      pageCount: null,
      slideCount: 0,
      sheetCount: 0,
      headingCount: input.headings?.length || 0,
      tableCount: 0,
      listCount: 0,
      paragraphCount: 1,
      chunkCount: 1,
    },
    anchors: (input.headings || []).map((heading, index) => ({
      heading,
      location: String(index + 1),
      preview: `${heading} 的原文片段`,
    })),
    warnings: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    origin: 'upload',
    contentHash: input.contentHash,
  };
}

const QUERY = '学会 Python 基础循环（for/while、range）';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe('applyMaterialRerankGate', () => {
  beforeEach(() => {
    __clearMaterialRerankCacheForTests();
    delete process.env.MATERIAL_RERANK_GATE_DISABLED;
    delete process.env.MATERIAL_RERANK_GATE_MIN_SCORE;
    delete process.env.RERANK_API_URL;
    process.env.RERANK_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.MATERIAL_RERANK_GATE_DISABLED;
    delete process.env.MATERIAL_RERANK_GATE_MIN_SCORE;
    delete process.env.RERANK_API_URL;
    delete process.env.RERANK_API_KEY;
    __clearMaterialRerankCacheForTests();
  });

  it('未配置 RERANK_API_URL → 闸门不启用，全量放行且不触网', async () => {
    const fetchImpl = jest.fn();
    const a = makeRecord({ id: 'a', name: '循环入门.md', headings: ['for 循环'] });
    const b = makeRecord({ id: 'b', name: '健康饮食.md', headings: ['营养搭配'] });
    const result = await applyMaterialRerankGate({ query: QUERY, records: [a, b], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('not-configured');
    expect(result.kept).toHaveLength(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('显式禁用 → 不启用', async () => {
    process.env.MATERIAL_RERANK_GATE_DISABLED = '1';
    process.env.RERANK_API_URL = 'https://rerank.example/v1/rerank';
    const fetchImpl = jest.fn();
    const result = await applyMaterialRerankGate({
      query: QUERY,
      records: [makeRecord({ id: 'a', name: 'a.md' }), makeRecord({ id: 'b', name: 'b.md' })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.reason).toBe('disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('单条资料 → 不启用（insufficient）', async () => {
    process.env.RERANK_API_URL = 'https://rerank.example/v1/rerank';
    const fetchImpl = jest.fn();
    const result = await applyMaterialRerankGate({
      query: QUERY,
      records: [makeRecord({ id: 'a', name: 'a.md' })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.reason).toBe('insufficient');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('正常打分 → 低于阈值挡下、缓存命中后二次调用不再出网', async () => {
    process.env.RERANK_API_URL = 'https://rerank.example/v1/rerank';
    process.env.MATERIAL_RERANK_GATE_MIN_SCORE = '0.29';
    const relevant = makeRecord({ id: 'rel', name: '循环入门.md', headings: ['for 循环与 range'] });
    const irrelevant = makeRecord({ id: 'irr', name: '健康饮食.md', headings: ['营养搭配'] });
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        results: [
          { index: 0, relevance_score: 0.62 },
          { index: 1, relevance_score: 0.03 },
        ],
      })
    );
    const first = await applyMaterialRerankGate({
      query: QUERY,
      records: [relevant, irrelevant],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(first.applied).toBe(true);
    expect(first.kept.map((record) => record.id)).toEqual(['rel']);
    expect(first.dropped.map((record) => record.id)).toEqual(['irr']);
    expect(first.scores['irr']).toBeCloseTo(0.03);

    const second = await applyMaterialRerankGate({
      query: QUERY,
      records: [relevant, irrelevant],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(second.applied).toBe(true);
    expect(second.kept.map((record) => record.id)).toEqual(['rel']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('HTTP 失败 → fail-open 全量放行', async () => {
    process.env.RERANK_API_URL = 'https://rerank.example/v1/rerank';
    const fetchImpl = jest.fn(async () => jsonResponse({ error: 'boom' }, 500));
    const a = makeRecord({ id: 'a', name: 'a.md' });
    const b = makeRecord({ id: 'b', name: 'b.md' });
    const result = await applyMaterialRerankGate({ query: QUERY, records: [a, b], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.kept).toHaveLength(2);
  });

  it('部分资料无分数 → 无分数的放行（宁漏勿杀）', async () => {
    process.env.RERANK_API_URL = 'https://rerank.example/v1/rerank';
    process.env.MATERIAL_RERANK_GATE_MIN_SCORE = '0.29';
    const low = makeRecord({ id: 'low', name: '低分资料.md' });
    const unscored = makeRecord({ id: 'unscored', name: '无分数资料.md' });
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ results: [{ index: 0, relevance_score: 0.01 }] })
    );
    const result = await applyMaterialRerankGate({
      query: QUERY,
      records: [low, unscored],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.applied).toBe(true);
    expect(result.dropped.map((record) => record.id)).toEqual(['low']);
    expect(result.kept.map((record) => record.id)).toEqual(['unscored']);
  });
});
