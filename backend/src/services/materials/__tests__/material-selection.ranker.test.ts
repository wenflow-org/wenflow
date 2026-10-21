/**
 * selectMaterialsRanked（决策模型重排增强）单测（不触网，decide 注入）。
 *
 * 覆盖 2026-10-21 评测接入的行为约束（EMBEDDING-DECISION-EVAL.md）：
 *   1) 样本不足/显式禁用 → 退回词面序，不调模型；
 *   2) 打分成功 → 按决策分重排，strategy='decision'，选中数量不变；
 *   3) 全部失败 → 词面序兜底（fail-open）；
 *   4) 部分失败 → 有分的按分数排前，无分的保持词面相对序缀后。
 */
import type { MaterialRecord } from '../material-store';
import { selectMaterialsRanked, type DecisionRankFn } from '../material-selection.service';

function makeRecord(input: { id: string; name: string; headings?: string[]; createdAt?: string }): MaterialRecord {
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
    createdAt: input.createdAt || '2026-10-01T00:00:00.000Z',
    origin: 'upload',
  };
}

const QUERY = '学会 Python 基础循环（for/while、range）';

function recordsFixture(): MaterialRecord[] {
  return [
    makeRecord({ id: 'a-loop', name: 'Python 循环入门.md', headings: ['for 循环与 range 函数'], createdAt: '2026-10-01T00:00:00.000Z' }),
    makeRecord({ id: 'b-health', name: '健康饮食指南.md', headings: ['营养搭配'], createdAt: '2026-10-05T00:00:00.000Z' }),
    makeRecord({ id: 'c-photo', name: '摄影构图笔记.md', headings: ['三分法构图'], createdAt: '2026-10-10T00:00:00.000Z' }),
  ];
}

describe('selectMaterialsRanked', () => {
  afterEach(() => {
    delete process.env.MATERIAL_RANK_DECISION_DISABLED;
  });

  it('样本不足 2 条 → 直接词面结果，不调模型', async () => {
    const decideImpl = jest.fn();
    const result = await selectMaterialsRanked({
      userId: 'user-1',
      query: QUERY,
      limit: 3,
      records: [makeRecord({ id: 'a-loop', name: 'Python 循环入门.md' })],
      decideImpl: decideImpl as unknown as DecisionRankFn,
    });
    expect(result.strategy).not.toBe('decision');
    expect(decideImpl).not.toHaveBeenCalled();
  });

  it('显式禁用 → 词面结果', async () => {
    process.env.MATERIAL_RANK_DECISION_DISABLED = '1';
    const decideImpl = jest.fn();
    const result = await selectMaterialsRanked({
      userId: 'user-1',
      query: QUERY,
      limit: 3,
      records: recordsFixture(),
      decideImpl: decideImpl as unknown as DecisionRankFn,
    });
    expect(result.strategy).not.toBe('decision');
    expect(decideImpl).not.toHaveBeenCalled();
  });

  it('打分成功 → 按决策分重排，词面最相关的资料被决策分压后', async () => {
    const decideImpl = jest.fn(async (request: { state: string }) => {
      const state = String(request.state);
      const noul = state.includes('健康饮食') ? 0.92 : state.includes('摄影构图') ? 0.55 : 0.10;
      return { model: 'jev-1.14.0', answers: { relevance: { type: 'noul', noul } } };
    });
    const result = await selectMaterialsRanked({
      userId: 'user-1',
      query: QUERY,
      limit: 3,
      records: recordsFixture(),
      decideImpl: decideImpl as unknown as DecisionRankFn,
    });
    expect(result.strategy).toBe('decision');
    expect(result.selected.map((record) => record.id)).toEqual(['b-health', 'c-photo', 'a-loop']);
    expect(result.total).toBe(3);
    expect(decideImpl).toHaveBeenCalledTimes(3);
    const firstCall = decideImpl.mock.calls[0][0] as unknown as {
      model: string;
      questions: Record<string, { type: string; instructions?: string }>;
    };
    expect(firstCall.model).toBe('jev-1.14.0');
    expect(firstCall.questions.relevance.type).toBe('noul');
    expect(firstCall.questions.relevance.instructions).toContain('泛化词');
  });

  it('全部打分失败 → 词面序兜底（fail-open）', async () => {
    const decideImpl = jest.fn(async () => {
      throw new Error('decision unavailable');
    });
    const result = await selectMaterialsRanked({
      userId: 'user-1',
      query: QUERY,
      limit: 3,
      records: recordsFixture(),
      decideImpl: decideImpl as unknown as DecisionRankFn,
    });
    expect(result.strategy).not.toBe('decision');
    expect(result.selected).toHaveLength(3);
  });

  it('部分失败 → 有分的按分数排前，无分的保持词面相对序缀后', async () => {
    const decideImpl = jest.fn(async (request: { state: string }) => {
      const state = String(request.state);
      if (state.includes('健康饮食')) return { model: 'jev-1.14.0', answers: { relevance: { type: 'noul', noul: 0.9 } } };
      throw new Error('boom');
    });
    const result = await selectMaterialsRanked({
      userId: 'user-1',
      query: QUERY,
      limit: 3,
      records: recordsFixture(),
      decideImpl: decideImpl as unknown as DecisionRankFn,
    });
    expect(result.strategy).toBe('decision');
    expect(result.selected[0].id).toBe('b-health');
    expect(result.selected).toHaveLength(3);
    // 词面序里健康在中间；重排后剩余两条保持原相对序（a-loop 词面命中在前）
    expect(result.selected.slice(1).map((record) => record.id)).toEqual(['a-loop', 'c-photo']);
  });

  it('limit 截断仍然生效（选中数不超过 limit）', async () => {
    const decideImpl = jest.fn(async () => ({
      model: 'jev-1.14.0',
      answers: { relevance: { type: 'noul', noul: 0.9 } },
    }));
    const result = await selectMaterialsRanked({
      userId: 'user-1',
      query: QUERY,
      limit: 1,
      records: recordsFixture(),
      decideImpl: decideImpl as unknown as DecisionRankFn,
    });
    expect(result.selected).toHaveLength(1);
    expect(result.omitted).toHaveLength(2);
    expect(result.strategy).toBe('decision');
  });
});
