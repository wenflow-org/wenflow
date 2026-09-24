/**
 * material-brief 惰性编排单测（Document Summary Index 摘要节点的确定性编排层）：
 * 缓存命中不重生成 / 未生成时调用 LLM 并落盘 / 失败 fail-open / 并发在途去重。
 * material-store 与 LLM 环节均 mock（不触达 fs / 网络）。
 */
jest.mock('../../../skills/material-brief', () => ({
  __esModule: true,
  generateMaterialBriefDraft: jest.fn(),
}));

jest.mock('../material-store', () => ({
  __esModule: true,
  readMaterial: jest.fn(),
  updateRecord: jest.fn(),
}));

import { generateMaterialBriefDraft } from '../../../skills/material-brief';
import { readMaterial, updateRecord } from '../material-store';
import {
  getOrGenerateMaterialBrief,
  collectBriefsWithDeadline,
} from '../material-brief.service';
import type { MaterialRecord } from '../material-store';
import type { MaterialBrief } from '../../../skills/material-brief/types';

const generateMock = generateMaterialBriefDraft as jest.Mock;
const readMaterialMock = readMaterial as jest.Mock;
const updateRecordMock = updateRecord as jest.Mock;

function makeRecord(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: 'mat-1',
    userId: 'user_probe',
    name: '指南.docx',
    ext: '.docx',
    format: 'docx',
    size: 1024,
    charCount: 5000,
    structure: { pageCount: null, slideCount: 0, sheetCount: 0, headingCount: 5, tableCount: 0, listCount: 0, paragraphCount: 10, chunkCount: 5 },
    anchors: [],
    warnings: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const brief: MaterialBrief = {
  docType: '课程标准',
  subject: '3-6 岁儿童学习与发展指南',
  audience: '教师与家长',
  overview: '按五大领域×三个年龄段描述典型发展表现。',
  toc: [{ title: '一、健康', gist: '身体与动作发展' }],
  coreConcepts: ['五大领域'],
  naturalDivisions: ['按五大领域', '按年龄段'],
};

beforeEach(() => {
  generateMock.mockReset();
  readMaterialMock.mockReset();
  updateRecordMock.mockReset();
  readMaterialMock.mockReturnValue({ record: makeRecord(), markdown: '正文内容'.repeat(100) });
});

describe('material-brief 惰性编排', () => {
  it('记录已带 brief：直接返回缓存，不调 LLM、不落盘', async () => {
    const cached = getOrGenerateMaterialBrief(makeRecord({ brief }));
    await expect(cached).resolves.toBe(brief);
    expect(generateMock).not.toHaveBeenCalled();
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it('未生成：调 LLM 生成并持久化（brief + briefGeneratedAt）', async () => {
    generateMock.mockResolvedValue({ status: 'ok', brief, notes: [] });
    const record = makeRecord();
    await expect(getOrGenerateMaterialBrief(record)).resolves.toEqual(brief);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0][0].name).toBe('指南.docx');
    expect(updateRecordMock).toHaveBeenCalledTimes(1);
    const [userId, id, patch] = updateRecordMock.mock.calls[0];
    expect(userId).toBe('user_probe');
    expect(id).toBe('mat-1');
    expect(patch.brief).toEqual(brief);
    expect(typeof patch.briefGeneratedAt).toBe('string');
  });

  it('LLM 失败：fail-open 返回 null、不落盘', async () => {
    generateMock.mockRejectedValue(new Error('LLM down'));
    await expect(getOrGenerateMaterialBrief(makeRecord())).resolves.toBeNull();
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it('not_found：返回 null、不落盘', async () => {
    generateMock.mockResolvedValue({ status: 'not_found', brief: null, notes: ['乱码'] });
    await expect(getOrGenerateMaterialBrief(makeRecord())).resolves.toBeNull();
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it('并发在途去重：同资料并发请求只触发一次生成', async () => {
    generateMock.mockResolvedValue({ status: 'ok', brief, notes: [] });
    const record = makeRecord();
    const [a, b] = await Promise.all([
      getOrGenerateMaterialBrief(record),
      getOrGenerateMaterialBrief(record),
    ]);
    expect(a).toEqual(brief);
    expect(b).toEqual(brief);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('collectBriefsWithDeadline：deadline 内返回结果；超长正文附截断标记', async () => {
    generateMock.mockResolvedValue({ status: 'ok', brief, notes: [] });
    readMaterialMock.mockReturnValue({ record: makeRecord(), markdown: '长'.repeat(30_000) });
    const result = await collectBriefsWithDeadline([makeRecord()], 5_000);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(brief);
    const request = generateMock.mock.calls[0][0];
    expect(request.markdown).toContain('已截断');
  });
});
