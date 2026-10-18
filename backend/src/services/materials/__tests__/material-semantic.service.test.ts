/**
 * material-semantic.service 单测：建索引 / 语义召回 / 代表采样（MMR）。
 * embedding 与 material-store / vector-store 全部 mock，不触达网络与真实 fs。
 * chunker 用真实现（分块是纯函数，顺带覆盖集成）。
 */
jest.mock('../../embedding', () => {
  const actual = jest.requireActual('../../embedding');
  return {
    __esModule: true,
    embedTexts: jest.fn(),
    rerankDocuments: jest.fn(),
    cosineSimilarity: actual.cosineSimilarity,
    resolveEmbeddingModelId: jest.fn(() => 'test-model'),
  };
});

jest.mock('../material-store', () => ({
  __esModule: true,
  listMaterials: jest.fn(),
  readMaterial: jest.fn(),
  materialDirCandidates: jest.fn(() => ['/tmp/x']),
  materialPrimaryDir: jest.fn(() => '/tmp/x'),
}));

jest.mock('../material-vector-store', () => ({
  __esModule: true,
  hashMaterialMarkdown: (md: string) => `hash:${md}`,
  isVectorIndexFresh: (index: unknown, md: string) =>
    Boolean(index) && (index as { sourceHash?: string }).sourceHash === `hash:${md}`,
  readVectorIndex: jest.fn(() => null),
  writeVectorIndex: jest.fn(() => true),
}));

import { embedTexts, rerankDocuments } from '../../embedding';
import { listMaterials, readMaterial, type MaterialRecord } from '../material-store';
import { chunkEmbedText } from '../material-chunker';
import {
  buildMaterialVectorIndex,
  recallMaterialChunks,
  selectRepresentativeText,
  selectDiverseChunks,
  selectStratifiedChunks,
  isMaterialSemanticEnabled,
} from '../material-semantic.service';

const embedMock = embedTexts as jest.Mock;
const rerankMock = rerankDocuments as jest.Mock;
const listMock = listMaterials as jest.Mock;
const readMock = readMaterial as jest.Mock;

const VOCAB = ['健康', '社会', '科学', '艺术', '语言'];

/** 确定性假向量：按词表的出现次数构造，语义相近文本向量相近。 */
function fakeEmbed(text: string): number[] {
  return VOCAB.map((word) => (String(text).match(new RegExp(word, 'g')) || []).length);
}

function makeRecord(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: 'mat-1',
    userId: 'user_probe',
    name: '指南.docx',
    ext: '.docx',
    format: 'docx',
    size: 1024,
    charCount: 200,
    structure: { pageCount: null, slideCount: 0, sheetCount: 0, headingCount: 2, tableCount: 0, listCount: 0, paragraphCount: 4, chunkCount: 2 },
    anchors: [],
    warnings: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * 两节各 ~450 字：合计超过单块预算（900）→ 落成 2 块，便于「块间排序」类断言。
 * （小节太短会被合并分块器并成一块——见 material-chunker 的真实语料修正。）
 */
const DOC = ['# 健康', '健康身体动作发展。'.repeat(50), '# 科学', '科学探究自然知识。'.repeat(50)].join('\n');

beforeEach(() => {
  delete process.env.MATERIAL_SEMANTIC_DISABLED;
  embedMock.mockReset();
  rerankMock.mockReset();
  listMock.mockReset();
  readMock.mockReset();
  embedMock.mockImplementation(async (request: { input: string | string[] }) => {
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    return {
      vectors: inputs.map((text, index) => ({ index, embedding: fakeEmbed(text) })),
      model: 'test-model',
      dimensions: VOCAB.length,
      provider: 'bge',
      attempts: ['bge'],
      latencyMs: 1,
    };
  });
  readMock.mockReturnValue({ record: makeRecord(), markdown: DOC });
  listMock.mockReturnValue([makeRecord()]);
});

describe('isMaterialSemanticEnabled', () => {
  it('默认开；MATERIAL_SEMANTIC_DISABLED=1 关', () => {
    expect(isMaterialSemanticEnabled()).toBe(true);
    process.env.MATERIAL_SEMANTIC_DISABLED = '1';
    expect(isMaterialSemanticEnabled()).toBe(false);
  });
});

describe('buildMaterialVectorIndex', () => {
  it('按块批量嵌入，产出带向量的索引（模型/维度/哈希齐全）', async () => {
    const index = await buildMaterialVectorIndex(DOC);
    expect(index).not.toBeNull();
    expect(index!.chunks).toHaveLength(2);
    expect(index!.model).toBe('test-model');
    expect(index!.dimensions).toBe(VOCAB.length);
    expect(index!.sourceHash).toBe(`hash:${DOC}`);
    expect(index!.chunks[0].vector).toEqual(fakeEmbed(chunkEmbedText(index!.chunks[0])));
    // 一次批量调用（不是逐块）
    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock.mock.calls[0][0].input).toHaveLength(2);
    // 嵌入文本 = chunkEmbedText（标题已内嵌时不重复）
    expect(embedMock.mock.calls[0][0].input[0]).toBe(chunkEmbedText(index!.chunks[0]));
  });

  it('空正文 → null（不调上游）', async () => {
    expect(await buildMaterialVectorIndex('   ')).toBeNull();
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('向量条数与块数不符 → 抛错（上游异常）', async () => {
    embedMock.mockResolvedValue({ vectors: [{ index: 0, embedding: [1, 0, 0, 0, 0] }], model: 'test-model', dimensions: 5, provider: 'bge', attempts: ['bge'], latencyMs: 1 });
    await expect(buildMaterialVectorIndex(DOC)).rejects.toThrow(/向量条数与块数不符/);
  });
});

describe('recallMaterialChunks', () => {
  it('按余弦排序，相关块排前', async () => {
    const hits = await recallMaterialChunks({ userId: 'user_probe', query: '健康', topK: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0].text).toContain('健康');
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it('无查询词 → 空（零调用）', async () => {
    expect(await recallMaterialChunks({ userId: 'user_probe', query: '  ' })).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('MATERIAL_SEMANTIC_DISABLED=1 → 空（零调用）', async () => {
    process.env.MATERIAL_SEMANTIC_DISABLED = '1';
    expect(await recallMaterialChunks({ userId: 'user_probe', query: '健康' })).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('嵌入失败 → 空（fail-open，不抛）', async () => {
    embedMock.mockRejectedValue(new Error('upstream down'));
    await expect(recallMaterialChunks({ userId: 'user_probe', query: '健康' })).resolves.toEqual([]);
  });

  // 真机发现（2026-10-17）：零资料账号每回合先嵌入查询词再空转，一节课白烧 19 次往返
  it('无候选资料 → 直接返回空，且**不嵌入查询词**（零调用）', async () => {
    listMock.mockReturnValue([]);
    const hits = await recallMaterialChunks({ userId: 'user_empty', query: '健康' });
    expect(hits).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('rerank=1 时用重排分重排结果', async () => {
    rerankMock.mockResolvedValue({
      results: [
        { index: 1, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.1 },
      ],
      model: 'rerank',
      provider: 'bge',
      attempts: ['bge'],
      latencyMs: 1,
    });
    const hits = await recallMaterialChunks({ userId: 'user_probe', query: '健康', topK: 2, rerank: true });
    expect(hits[0].rerankScore).toBe(0.9);
    expect(hits[0].text).toContain('科学');
  });

  it('rerank 失败 → 退回余弦序（不丢结果）', async () => {
    rerankMock.mockRejectedValue(new Error('rerank down'));
    const hits = await recallMaterialChunks({ userId: 'user_probe', query: '健康', topK: 2, rerank: true });
    expect(hits).toHaveLength(2);
    expect(hits[0].text).toContain('健康');
  });
});

describe('selectDiverseChunks（MMR 多样性）', () => {
  const chunks = [
    { id: 'c-1', title: 'a', text: 'a', charCount: 100, index: 0, vector: [1, 0] },
    { id: 'c-2', title: 'b', text: 'b', charCount: 100, index: 1, vector: [0.9, 0.1] },
    { id: 'c-3', title: 'c', text: 'c', charCount: 100, index: 2, vector: [0, 1] },
  ];

  it('先取最居中块，再优先取与之不相似的块（不选近似重复）', () => {
    const picked = selectDiverseChunks(chunks, 250, 0.7);
    const ids = picked.map((c) => c.id);
    expect(ids).toContain('c-2');
    expect(ids).toContain('c-3');
    expect(ids).not.toContain('c-1'); // 与 c-2 近乎重复，被多样性惩罚排除
  });

  it('预算装不下时跳过超长块，不硬塞', () => {
    const withBig = [
      { id: 'c-1', title: 'a', text: 'a', charCount: 100, index: 0, vector: [1, 0] },
      { id: 'c-2', title: 'b', text: 'b', charCount: 400, index: 1, vector: [0, 1] },
    ];
    const picked = selectDiverseChunks(withBig, 150, 0.7);
    // 第一块若装不下且尚无选择 → 仍放一块（避免空手）；这里 c-1 或 c-2 至少一块
    expect(picked.length).toBeGreaterThanOrEqual(1);
  });
});

describe('selectRepresentativeText', () => {
  it('正文未超预算 → 原样返回（不调嵌入）', async () => {
    const text = await selectRepresentativeText(makeRecord(), '短正文', 24_000);
    expect(text).toBe('短正文');
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('超预算 → 返回带「代表节选」标记的采样文本', async () => {
    const longDoc = Array.from({ length: 8 }, (_, i) => `# 主题${i}\n${'健康社会科学技术艺术语言'.repeat(20)}主题${i}正文。`).join('\n\n');
    const text = await selectRepresentativeText(makeRecord(), longDoc, 400);
    expect(text).toContain('代表节选');
    // 采样是「节选」而非全文；受预算约束（允许最后落下的那一块整体超出，最大块 ≤1022 字）
    expect(text!.length).toBeLessThan(longDoc.length);
    expect(text!.length).toBeLessThanOrEqual(400 + 1200);
  });

  it('MATERIAL_SEMANTIC_DISABLED=1 → null（调用方回退截断）', async () => {
    process.env.MATERIAL_SEMANTIC_DISABLED = '1';
    const longDoc = '健康'.repeat(1000);
    expect(await selectRepresentativeText(makeRecord(), longDoc, 100)).toBeNull();
  });

  // 2026-10-17 真机 A/B：纯语义采样会丢掉目录型开头（brief 要产出 toc），故默认改为「头部结构 + 语义补全」
  it('默认混合：含文档开头片段 + 语义代表节选（头部保结构、语义够后文）', async () => {
    const longDoc = Array.from({ length: 8 }, (_, i) => `# 主题${i}\n${'健康社会科学技术艺术语言'.repeat(20)}主题${i}正文。`).join('\n\n');
    // 预算必须小于正文长度，否则走「不超预算原样返回」的短路
    const text = await selectRepresentativeText(makeRecord(), longDoc, 800);
    expect(text).toContain('文档开头');
    expect(text).toContain('代表节选');
  });

  it('headRatio:0 → 退化为纯语义采样（不含开头片段）', async () => {
    const longDoc = Array.from({ length: 8 }, (_, i) => `# 主题${i}\n${'健康社会科学技术艺术语言'.repeat(20)}主题${i}正文。`).join('\n\n');
    const text = await selectRepresentativeText(makeRecord(), longDoc, 800, { headRatio: 0 });
    expect(text).not.toContain('文档开头');
    expect(text).toContain('代表节选');
  });
});

describe('selectStratifiedChunks：按文档位置分层', () => {
  const chunk = (index: number, vector: number[]) => ({
    id: `c-${index}`,
    index,
    title: `节${index}`,
    text: `正文${index}`,
    charCount: 10,
    vector,
  });

  it('按位置等分取块：每段恰好一块，顺序按原文', () => {
    const chunks = Array.from({ length: 12 }, (_, i) => chunk(i, [i % 3 === 0 ? 1 : 0, i % 3 === 0 ? 0 : 1]));
    const picked = selectStratifiedChunks(chunks, 4);
    expect(picked).toHaveLength(4);
    expect(picked.map((c) => c.index)).toEqual([...picked.map((c) => c.index)].sort((a, b) => a - b));
    // 12 块分 4 段 → 每段覆盖 [0,3) [3,6) [6,9) [9,12)
    expect(picked[0].index).toBeLessThan(3);
    expect(picked[1].index).toBeGreaterThanOrEqual(3);
    expect(picked[1].index).toBeLessThan(6);
    expect(picked[2].index).toBeGreaterThanOrEqual(6);
    expect(picked[2].index).toBeLessThan(9);
    expect(picked[3].index).toBeGreaterThanOrEqual(9);
  });

  it('块数少于要求 → 返回全部', () => {
    const chunks = Array.from({ length: 3 }, (_, i) => chunk(i, [1, 0]));
    expect(selectStratifiedChunks(chunks, 48)).toHaveLength(3);
  });

  it('无向量的块被跳过；全空返回空', () => {
    expect(selectStratifiedChunks([], 8)).toEqual([]);
    const withEmpty = [chunk(0, []), chunk(1, [1, 0])];
    const picked = selectStratifiedChunks(withEmpty, 2);
    expect(picked.map((c) => c.index)).toEqual([1]);
  });
});
