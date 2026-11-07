/**
 * #176-4 回归：goal 资料排序的会话级缓存。
 *
 * 病灶：每轮 callAI 前都 `collectGoalUploadedMaterialSummaries(userId, query含本轮userInput)`，
 * 内部 selectMaterialsRanked 在 ≥2 份资料时逐条调决策模型（最多 12 次）。同一会话相邻两轮
 * 资料集合与目标通常没变，这些调用是纯重复。
 *
 * 修复口径（A+C）：按 `(userId, conversationId, surface_goal)` 缓存**排序结果**，以资料集合
 * 指纹判定有效性；集合与目标未变 → 短路复用（不调决策模型）。brief 仍每轮收集，
 * 保证模型可见上下文与修复前一致。
 *
 * 这里用 spy 计数断言「两轮只调一次排序」，并覆盖失效条件（集合变化 / 目标变化 / TTL /
 * 会话清理）与「不带 conversationId 时行为不变」。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const mockListMaterials = jest.fn();
const mockCollectBriefs = jest.fn();
const mockSelectMaterialsRanked = jest.fn();

jest.mock('../../materials/material-store', () => ({
  __esModule: true,
  listMaterials: (...args: any[]) => mockListMaterials(...args),
}));
jest.mock('../../materials/material-brief.service', () => ({
  __esModule: true,
  collectBriefsWithDeadline: (...args: any[]) => mockCollectBriefs(...args),
}));
jest.mock('../../materials/material-selection.service', () => ({
  __esModule: true,
  selectMaterialsRanked: (...args: any[]) => mockSelectMaterialsRanked(...args),
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import type { MaterialRecord } from '../../materials/material-store';
import {
  collectGoalUploadedMaterialSummaries,
  clearGoalMaterialRankCache,
  GOAL_MATERIAL_RANK_CACHE_TTL_MS,
} from '../goal-material-summaries.service';

function makeRecord(id: string, name: string, createdAt = '2026-10-01T00:00:00.000Z'): MaterialRecord {
  return {
    id,
    userId: 'user-1',
    name,
    ext: '.md',
    format: 'md',
    size: 100,
    charCount: 100,
    structure: {
      pageCount: null,
      slideCount: 0,
      sheetCount: 0,
      headingCount: 1,
      tableCount: 0,
      listCount: 0,
      paragraphCount: 1,
      chunkCount: 1,
    },
    anchors: [{ heading: '第一章', location: '1', preview: '片段' }],
    warnings: [],
    createdAt,
    origin: 'upload',
  };
}

const RECORDS = [
  makeRecord('a-python', 'Python 循环入门.md', '2026-10-01T00:00:00.000Z'),
  makeRecord('b-health', '健康饮食指南.md', '2026-10-05T00:00:00.000Z'),
];

/** 按入参 records 返回「选中前 N 份」的选择结果（决策排序本身不在本用例考察范围）。 */
function selectionFor(records: MaterialRecord[], limit: number) {
  return {
    selected: records.slice(0, limit),
    omitted: records.slice(limit),
    total: records.length,
    strategy: 'decision' as const,
    hasPhraseHit: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.GOAL_MATERIAL_RANK_CACHE_TTL_MS;
  clearGoalMaterialRankCache();
  mockListMaterials.mockReturnValue(RECORDS);
  mockCollectBriefs.mockResolvedValue([null, null, null, null, null]);
  mockSelectMaterialsRanked.mockImplementation(async (options: any) =>
    selectionFor(options.records ?? RECORDS, options.limit));
});

describe('#176-4 goal 资料排序会话级缓存', () => {
  it('资料集合与目标未变的两轮只调一次排序（第二轮短路复用）', async () => {
    const options = { conversationId: 'conv-1', surfaceGoal: '学会用 Python 合并订单表' };

    await collectGoalUploadedMaterialSummaries('user-1', '学会用 Python 合并订单表 第一轮提问', options);
    await collectGoalUploadedMaterialSummaries('user-1', '学会用 Python 合并订单表 第二轮的补充说明', options);

    expect(mockSelectMaterialsRanked).toHaveBeenCalledTimes(1);
  });

  it('缓存命中仍每轮收集 brief（模型可见上下文不因缓存而缺摘要）', async () => {
    const options = { conversationId: 'conv-1', surfaceGoal: '学会 Python' };

    mockCollectBriefs.mockResolvedValue([null, null, null, null, null]);
    const first = await collectGoalUploadedMaterialSummaries('user-1', '第一轮', options);
    // 第二轮 brief 已就绪：缓存只复用排序，摘要必须当轮就出现在 payload 里
    mockCollectBriefs.mockResolvedValue([
      {
        docType: '教程',
        subject: 'Python 循环',
        audience: '初学者',
        overview: '覆盖 for/while 与 range。',
        naturalDivisions: ['按语法点'],
        toc: [{ title: '一、for 循环', gist: '循环基本形态' }],
      },
      null,
      null,
      null,
      null,
    ]);
    const second = await collectGoalUploadedMaterialSummaries('user-1', '第二轮', options);

    expect(mockSelectMaterialsRanked).toHaveBeenCalledTimes(1);
    expect(mockCollectBriefs).toHaveBeenCalledTimes(2);
    expect(first[0].brief).toBeNull();
    expect(second[0].brief).toMatchObject({ overview: '覆盖 for/while 与 range。' });
  });

  it('资料集合变化（新增一份上传）→ 重排', async () => {
    const options = { conversationId: 'conv-1', surfaceGoal: '学会 Python' };
    await collectGoalUploadedMaterialSummaries('user-1', '第一轮', options);

    mockListMaterials.mockReturnValue([
      ...RECORDS,
      makeRecord('c-photo', '摄影构图笔记.md', '2026-10-10T00:00:00.000Z'),
    ]);
    await collectGoalUploadedMaterialSummaries('user-1', '第二轮', options);

    expect(mockSelectMaterialsRanked).toHaveBeenCalledTimes(2);
  });

  it('目标（surface_goal）变化 → 重排', async () => {
    await collectGoalUploadedMaterialSummaries('user-1', '第一轮', {
      conversationId: 'conv-1',
      surfaceGoal: '学会 Python',
    });
    await collectGoalUploadedMaterialSummaries('user-1', '第二轮', {
      conversationId: 'conv-1',
      surfaceGoal: '学会摄影构图',
    });

    expect(mockSelectMaterialsRanked).toHaveBeenCalledTimes(2);
  });

  it('TTL 过期 → 重排（缓存不是永久的）', async () => {
    const options = { conversationId: 'conv-1', surfaceGoal: '学会 Python' };
    const base = Date.UTC(2026, 10, 7, 0, 0, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(base);
    try {
      await collectGoalUploadedMaterialSummaries('user-1', '第一轮', options);
      nowSpy.mockReturnValue(base + GOAL_MATERIAL_RANK_CACHE_TTL_MS + 1);
      await collectGoalUploadedMaterialSummaries('user-1', '第二轮', options);
    } finally {
      nowSpy.mockRestore();
    }

    expect(mockSelectMaterialsRanked).toHaveBeenCalledTimes(2);
  });

  it('clearGoalMaterialRankCache(conversationId) 后重排（会话收尾/删除清缓存）', async () => {
    const options = { conversationId: 'conv-1', surfaceGoal: '学会 Python' };
    await collectGoalUploadedMaterialSummaries('user-1', '第一轮', options);
    clearGoalMaterialRankCache('conv-1');
    await collectGoalUploadedMaterialSummaries('user-1', '第二轮', options);

    expect(mockSelectMaterialsRanked).toHaveBeenCalledTimes(2);
  });

  it('不带 conversationId → 不进缓存，行为与修复前一致（每轮都排序）', async () => {
    await collectGoalUploadedMaterialSummaries('user-1', '第一轮');
    await collectGoalUploadedMaterialSummaries('user-1', '第二轮');

    expect(mockSelectMaterialsRanked).toHaveBeenCalledTimes(2);
  });

  it('不同会话各自独立缓存（不会串用别的会话的排序）', async () => {
    await collectGoalUploadedMaterialSummaries('user-1', '第一轮', {
      conversationId: 'conv-1',
      surfaceGoal: '学会 Python',
    });
    await collectGoalUploadedMaterialSummaries('user-1', '第一轮', {
      conversationId: 'conv-2',
      surfaceGoal: '学会 Python',
    });

    expect(mockSelectMaterialsRanked).toHaveBeenCalledTimes(2);
  });
});
