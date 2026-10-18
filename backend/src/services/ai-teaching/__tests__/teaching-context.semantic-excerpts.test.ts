/**
 * 课堂侧「章节原文取回」的**语义兜底**接线验收：
 *   - 结构化引用存在但标题/引文都未命中（anchor 退化为 none）→ 用语义召回选块；
 *   - 任务没有任何结构化引用 → 语义召回跨资料兜底；
 *   - 语义层关停 → 行为退回改造前（refs 走头部窗口 / 无 refs 返回 null）。
 * material-store 与语义层均 mock（不触达 fs / 网络）。
 */
jest.mock('../../materials/material-store', () => ({
  __esModule: true,
  readMaterial: jest.fn(),
  listMaterials: jest.fn(() => []),
  updateRecord: jest.fn(),
  writeMaterial: jest.fn(),
  readRecord: jest.fn(),
  deleteMaterial: jest.fn(),
  materialDirCandidates: jest.fn(() => ['/tmp/x']),
  materialPrimaryDir: jest.fn(() => '/tmp/x'),
}));

jest.mock('../../materials/material-semantic.service', () => ({
  __esModule: true,
  isMaterialSemanticEnabled: jest.fn(() => true),
  recallMaterialChunks: jest.fn(),
}));

jest.mock('../../materials/material-web-ingest.service', () => ({
  __esModule: true,
  findWebRecordBySourceUrl: jest.fn(() => null),
}));

import { readMaterial, type MaterialRecord } from '../../materials/material-store';
import { isMaterialSemanticEnabled, recallMaterialChunks } from '../../materials/material-semantic.service';
import { resolveActiveTaskMaterialExcerpts } from '../TeachingContextBuilder';

const readMock = readMaterial as jest.Mock;
const enabledMock = isMaterialSemanticEnabled as jest.Mock;
const recallMock = recallMaterialChunks as jest.Mock;

const MATERIAL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TASK_ID = 'task-1';
const MD = '# 目录\n本文档的正文内容与引用无关的描述文字。';

function makeRecord(): MaterialRecord {
  return {
    id: MATERIAL_ID,
    userId: 'user_probe',
    name: '指南.docx',
    ext: '.docx',
    format: 'docx',
    size: 100,
    charCount: MD.length,
    structure: { pageCount: null, slideCount: 0, sheetCount: 0, headingCount: 1, tableCount: 0, listCount: 0, paragraphCount: 1, chunkCount: 1 },
    anchors: [],
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

function template(refs: unknown[]): string {
  return JSON.stringify({
    sceneFraming: {
      normalizedInput: { version: '1.0', resources: {} },
    },
    materialRefs: { byTask: { [TASK_ID]: refs } },
  });
}

beforeEach(() => {
  readMock.mockReset();
  enabledMock.mockReset();
  recallMock.mockReset();
  enabledMock.mockReturnValue(true);
  readMock.mockReturnValue({ record: makeRecord(), markdown: MD });
});

describe('resolveActiveTaskMaterialExcerpts 语义兜底', () => {
  it('引用存在但标题/引文未命中 → 用语义召回选块（anchor=semantic）', async () => {
    recallMock.mockResolvedValue([
      { materialId: MATERIAL_ID, materialName: '指南.docx', chunkId: 'c-2', title: '# 健康', text: '# 健康\n身体动作发展的原文内容。', score: 0.7 },
    ]);
    const excerpts = await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: template([{ materialId: MATERIAL_ID, sectionTitle: '不存在的章节', quote: '不存在的引文' }]),
      taskId: TASK_ID,
      userId: 'user_probe',
      query: '健康领域的身体动作发展',
    });
    expect(excerpts).toHaveLength(1);
    expect(excerpts![0].anchor).toBe('semantic');
    expect(excerpts![0].excerpt).toContain('身体动作发展');
    expect(recallMock).toHaveBeenCalledTimes(1);
  });

  it('任务无任何引用 + 有查询词 → 跨资料语义兜底', async () => {
    recallMock.mockResolvedValue([
      { materialId: MATERIAL_ID, materialName: '指南.docx', chunkId: 'c-1', title: '# 健康', text: '# 健康\n原文A', score: 0.8 },
      { materialId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', materialName: '标准.pdf', chunkId: 'c-3', title: '# 语言', text: '# 语言\n原文B', score: 0.6 },
    ]);
    const excerpts = await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: template([]),
      taskId: TASK_ID,
      userId: 'user_probe',
      query: '健康与语言领域的发展',
    });
    expect(excerpts).toHaveLength(2);
    expect(excerpts!.every((e) => e.anchor === 'semantic')).toBe(true);
    expect(excerpts!.map((e) => e.materialId)).toEqual([MATERIAL_ID, 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee']);
  });

  it('语义层关停 → 无引用时返回 null（行为与改造前一致）', async () => {
    enabledMock.mockReturnValue(false);
    const excerpts = await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: template([]),
      taskId: TASK_ID,
      userId: 'user_probe',
      query: '健康与语言领域的发展',
    });
    expect(excerpts).toBeNull();
    expect(recallMock).not.toHaveBeenCalled();
  });

  it('语义层关停 → 有引用时退回头部窗口（anchor=none），不调语义', async () => {
    enabledMock.mockReturnValue(false);
    const excerpts = await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: template([{ materialId: MATERIAL_ID, sectionTitle: '不存在的章节', quote: '不存在的引文' }]),
      taskId: TASK_ID,
      userId: 'user_probe',
      query: '健康领域的身体动作发展',
    });
    expect(excerpts).toHaveLength(1);
    expect(excerpts![0].anchor).toBe('none');
    expect(recallMock).not.toHaveBeenCalled();
  });

  it('无查询词 → 不做语义兜底（零调用）', async () => {
    const excerpts = await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: template([]),
      taskId: TASK_ID,
      userId: 'user_probe',
    });
    expect(excerpts).toBeNull();
    expect(recallMock).not.toHaveBeenCalled();
  });

  it('语义召回抛错 → fail-open，退回头部窗口', async () => {
    recallMock.mockRejectedValue(new Error('upstream down'));
    const excerpts = await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: template([{ materialId: MATERIAL_ID, sectionTitle: '不存在的章节', quote: '不存在的引文' }]),
      taskId: TASK_ID,
      userId: 'user_probe',
      query: '健康领域的身体动作发展',
    });
    expect(excerpts).toHaveLength(1);
    // 语义层内部已 fail-open 返回 []，故公式侧仍旧窗口
    expect(excerpts![0].anchor).toBe('none');
  });
});
