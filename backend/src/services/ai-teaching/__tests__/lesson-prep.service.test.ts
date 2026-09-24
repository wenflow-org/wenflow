/**
 * n+1 备课编排单测（活的 path 批次 C）：
 * pickNextTask（同阶段/跨阶段/结业）+ ensureWebRefsInLibrary（补采/复用/跳过/上限）。
 * 全 mock：无网络、无落盘、无 DB。
 */
import {
  ensureWebRefsInLibrary,
  pickNextTask,
  type LessonPrepDeps,
  type PrepMilestoneSnapshot,
} from '../lesson-prep.service';
import type { FetchResponse } from '../../fetch/types';

const stage1: PrepMilestoneSnapshot = {
  stageNumber: 1,
  subtasks: [
    { id: 't1-1', status: 'completed', order: 1 },
    { id: 't1-2', status: 'in_progress', order: 2 },
    { id: 't1-3', status: 'todo', order: 3 },
  ],
};
const stage2: PrepMilestoneSnapshot = {
  stageNumber: 2,
  subtasks: [
    { id: 't2-1', status: 'todo', order: 1 },
    { id: 't2-2', status: 'todo', order: 2 },
  ],
};

describe('pickNextTask 下一任务解析', () => {
  it('同阶段：取 order 更大的第一个未完成任务', () => {
    expect(pickNextTask([stage1, stage2], 't1-2')?.id).toBe('t1-3');
  });

  it('跨阶段：本阶段做完，取下一阶段第一个未完成任务', () => {
    expect(pickNextTask([stage1, stage2], 't1-3')?.id).toBe('t2-1');
  });

  it('全部完成（结业）→ null', () => {
    const done: PrepMilestoneSnapshot = {
      stageNumber: 1,
      subtasks: [{ id: 't1-1', status: 'completed', order: 1 }],
    };
    expect(pickNextTask([done], 't1-1')).toBeNull();
  });

  it('completedTaskId 不在任何阶段 → null', () => {
    expect(pickNextTask([stage1, stage2], 'ghost')).toBeNull();
  });

  it('跳过 status=completed 的后续任务', () => {
    const stage: PrepMilestoneSnapshot = {
      stageNumber: 1,
      subtasks: [
        { id: 'a', status: 'in_progress', order: 1 },
        { id: 'b', status: 'completed', order: 2 },
        { id: 'c', status: 'todo', order: 3 },
      ],
    };
    expect(pickNextTask([stage], 'a')?.id).toBe('c');
  });
});

function makeDeps(overrides: Partial<LessonPrepDeps> = {}): LessonPrepDeps {
  const fetch = overrides.fetchWeb ?? (async (): Promise<FetchResponse> => ({
    results: [{
      url: 'https://www.moe.gov.cn/law.html',
      finalUrl: 'https://www.moe.gov.cn/law.html',
      title: '未成年人保护法',
      text: '第一条 为了保护未成年人身心健康……'.repeat(20),
      provider: 'tinyfish',
    }],
    errors: [], provider: 'tinyfish', attempts: ['tinyfish'], latencyMs: 1,
  }));
  return {
    fetchWeb: jest.fn(fetch),
    ingestWebMaterial: overrides.ingestWebMaterial ?? jest.fn(async () => ({ record: { id: 'new-rec', name: '法', charCount: 5000 }, deduped: false })),
    findWebRecordBySourceUrl: overrides.findWebRecordBySourceUrl ?? jest.fn(() => null),
  };
}

const WEB_REF = { materialId: null, sourceUrl: 'https://www.moe.gov.cn/law.html', sectionTitle: '第三章' };
const LIB_REF = { materialId: 'rec-1', sourceUrl: null, sectionTitle: '说明' };

describe('ensureWebRefsInLibrary 备课资料腿', () => {
  it('库未命中 → 定向 fetch + 入库，返回 fetched', async () => {
    const deps = makeDeps({
      ingestWebMaterial: jest.fn(async () => ({ record: { id: 'new-rec', name: '法', charCount: 5000 }, deduped: false })),
    });
    const { fetched, reused } = await ensureWebRefsInLibrary('u1', [WEB_REF, LIB_REF], deps);
    expect(fetched).toEqual(['https://www.moe.gov.cn/law.html']);
    expect(reused).toEqual([]);
    // 已带 materialId 的引用不触发 fetch
    expect(deps.fetchWeb).toHaveBeenCalledTimes(1);
    const request = (deps.fetchWeb as jest.Mock).mock.calls[0][0];
    expect(request.urls).toEqual(['https://www.moe.gov.cn/law.html']);
    expect(request.query).toBeUndefined(); // 备课取整页，非查询片段
  });

  it('库已命中 → 复用不重采', async () => {
    const deps = makeDeps({
      findWebRecordBySourceUrl: jest.fn(() => ({ id: 'have' })),
    });
    const { fetched, reused } = await ensureWebRefsInLibrary('u1', [WEB_REF], deps);
    expect(fetched).toEqual([]);
    expect(reused).toEqual(['https://www.moe.gov.cn/law.html']);
    expect(deps.fetchWeb).not.toHaveBeenCalled();
  });

  it('fetch 无可用正文（suspicious/空）→ 跳过不抛错', async () => {
    const suspiciousResponse = async (): Promise<FetchResponse> => ({
      results: [{
        url: 'https://www.moe.gov.cn/law.html', title: 't', suspicious: true,
        text: '正文', provider: 'tinyfish',
      }],
      errors: [], provider: 'tinyfish', attempts: ['tinyfish'], latencyMs: 1,
    });
    const deps = makeDeps({ fetchWeb: jest.fn(suspiciousResponse) });
    const { fetched } = await ensureWebRefsInLibrary('u1', [WEB_REF], deps);
    expect(fetched).toEqual([]);
  });

  it('补采上限 3 条：超过的部分不处理', async () => {
    const refs = [1, 2, 3, 4].map((i) => ({
      materialId: null,
      sourceUrl: `https://x.example.com/${i}`,
      sectionTitle: null,
    }));
    const deps = makeDeps({
      ingestWebMaterial: jest.fn(async () => ({ record: { id: 'r', name: 'n', charCount: 10 }, deduped: false })),
    });
    await ensureWebRefsInLibrary('u1', refs, deps);
    expect(deps.fetchWeb).toHaveBeenCalledTimes(3);
  });
});
