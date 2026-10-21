import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeMaterial, type MaterialRecord } from '../material-store';
import { materialSelectionTokens, selectMaterials } from '../material-selection.service';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenflow-material-selection-'));
  process.env.MATERIAL_UPLOAD_DIR = root;
});

afterEach(() => {
  delete process.env.MATERIAL_UPLOAD_DIR;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // 清理失败不影响断言
  }
});

function makeRecord(input: {
  name: string;
  createdAt: string;
  headings?: string[];
  origin?: 'upload' | 'web';
  userId?: string;
}): MaterialRecord {
  return {
    id: crypto.randomUUID(),
    userId: input.userId || 'user-1',
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
    createdAt: input.createdAt,
    origin: input.origin,
  };
}

describe('selectMaterials', () => {
  it('有目标查询时按相关性选，而不是按上传时间取最新', () => {
    const olderRelevant = makeRecord({
      name: '公司合规手册.md',
      createdAt: '2026-10-01T00:00:00.000Z',
      headings: ['合规风险管理', '员工行为准则'],
    });
    const newerIrrelevant = makeRecord({
      name: '摄影构图笔记.md',
      createdAt: '2026-10-10T00:00:00.000Z',
      headings: ['三分法', '景深'],
    });
    const newestIrrelevant = makeRecord({
      name: '云服务选型.md',
      createdAt: '2026-10-12T00:00:00.000Z',
      headings: ['IaaS', 'PaaS', 'SaaS'],
    });
    for (const record of [olderRelevant, newerIrrelevant, newestIrrelevant]) {
      writeMaterial(record, '正文');
    }

    const selection = selectMaterials({
      userId: 'user-1',
      query: '合规 风险 员工行为',
      limit: 1,
    });

    expect(selection.strategy).toBe('relevance');
    expect(selection.hasPhraseHit).toBe(true);
    expect(selection.total).toBe(3);
    expect(selection.selected.map((record) => record.name)).toEqual(['公司合规手册.md']);
    expect(selection.omitted.map((record) => record.name)).toEqual(['云服务选型.md', '摄影构图笔记.md']);
  });

  it('≥4 字片段命中的资料排前：即使 bigram 分更低、上传更旧', () => {
    // 「员工行为」是查询里唯一的 ≥4 字 run，原样出现在标题里 → phrase 命中
    const phraseHit = makeRecord({
      name: '行为细则.md',
      createdAt: '2026-10-01T00:00:00.000Z',
      headings: ['员工行为'],
    });
    // 与查询共享 4 个 bigram（工行/行为/合规/风险）但不含「员工行为」连续片段
    const bigramOnly = makeRecord({
      name: '职工行为手册.md',
      createdAt: '2026-10-10T00:00:00.000Z',
      headings: ['合规风险台账'],
    });
    writeMaterial(phraseHit, '正文');
    writeMaterial(bigramOnly, '正文');

    const selection = selectMaterials({
      userId: 'user-1',
      query: '合规 风险 员工行为',
      limit: 2,
    });

    expect(selection.hasPhraseHit).toBe(true);
    expect(selection.strategy).toBe('relevance');
    expect(selection.selected.map((record) => record.name)).toEqual(['行为细则.md', '职工行为手册.md']);
  });

  it('只有 bigram 命中、没有 ≥4 字片段时：hasPhraseHit=false，strategy 仍按 bigram 判 relevance，排序按时间', () => {
    // 旧资料 bigram 命中更多（工行/行为/合规/风险），新资料只命中「风险」——都无「员工行为」片段
    const higherScoreOlder = makeRecord({
      name: '职工行为手册.md',
      createdAt: '2026-10-01T00:00:00.000Z',
      headings: ['合规风险台账'],
    });
    const lowerScoreNewer = makeRecord({
      name: '风险台账.md',
      createdAt: '2026-10-10T00:00:00.000Z',
      headings: ['风险登记'],
    });
    writeMaterial(higherScoreOlder, '正文');
    writeMaterial(lowerScoreNewer, '正文');

    const selection = selectMaterials({
      userId: 'user-1',
      query: '合规 风险 员工行为',
      limit: 2,
    });

    expect(selection.hasPhraseHit).toBe(false);
    // 2026-10-21 对比裁决：片段命中只是排序加权，relevance/recent 判定沿用 bigram 口径
    expect(selection.strategy).toBe('relevance');
    // 无片段命中时不按分数排序，退回时间序
    expect(selection.selected.map((record) => record.name)).toEqual(['风险台账.md', '职工行为手册.md']);
  });

  it('查询词与资料无任何命中时退回 recent 不变（hasPhraseHit=false）', () => {
    const older = makeRecord({ name: '摄影构图笔记.md', createdAt: '2026-10-01T00:00:00.000Z' });
    const newer = makeRecord({ name: '云服务选型.md', createdAt: '2026-10-10T00:00:00.000Z' });
    writeMaterial(older, '正文');
    writeMaterial(newer, '正文');

    const selection = selectMaterials({ userId: 'user-1', query: '量子物理导论', limit: 1 });
    expect(selection.strategy).toBe('recent');
    expect(selection.hasPhraseHit).toBe(false);
    expect(selection.selected[0].name).toBe('云服务选型.md');
  });

  it('没有查询词时退回最近上传优先', () => {
    const older = makeRecord({ name: '旧资料.md', createdAt: '2026-10-01T00:00:00.000Z' });
    const newer = makeRecord({ name: '新资料.md', createdAt: '2026-10-10T00:00:00.000Z' });
    writeMaterial(older, '旧正文');
    writeMaterial(newer, '新正文');

    const selection = selectMaterials({ userId: 'user-1', limit: 1 });
    expect(selection.strategy).toBe('recent');
    expect(selection.selected[0].name).toBe('新资料.md');
  });

  it('默认排除联网入库资料，includeWeb 才纳入', () => {
    const upload = makeRecord({ name: '上传.pdf', createdAt: '2026-10-01T00:00:00.000Z' });
    const web = makeRecord({
      name: '联网.md',
      createdAt: '2026-10-10T00:00:00.000Z',
      origin: 'web',
    });
    writeMaterial(upload, '上传正文');
    writeMaterial(web, '联网正文');

    expect(selectMaterials({ userId: 'user-1', limit: 5 }).selected.map((r) => r.name)).toEqual([
      '上传.pdf',
    ]);
    expect(
      selectMaterials({ userId: 'user-1', limit: 5, includeWeb: true }).selected.map((r) => r.name)
    ).toEqual(['联网.md', '上传.pdf']);
  });

  it('limit=0 时不选任何资料，但 total/omitted 仍完整', () => {
    const record = makeRecord({ name: '资料.md', createdAt: '2026-10-01T00:00:00.000Z' });
    writeMaterial(record, '正文');
    const selection = selectMaterials({ userId: 'user-1', limit: 0 });
    expect(selection.selected).toEqual([]);
    expect(selection.omitted).toHaveLength(1);
    expect(selection.total).toBe(1);
  });

  it('中文按字符 bigram 分词，能命中未连续出现的词', () => {
    const tokens = materialSelectionTokens('合规风险管理');
    expect(tokens.has('合规')).toBe(true);
    expect(tokens.has('风险')).toBe(true);
    expect(tokens.has('管理')).toBe(true);
  });
});
