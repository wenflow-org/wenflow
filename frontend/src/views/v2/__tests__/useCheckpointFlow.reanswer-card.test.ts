import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const apiMock = vi.hoisted(() => ({
  streamSubmitCheckpoint: vi.fn(),
  submitCheckpoint: vi.fn(),
  getSessionDetail: vi.fn(),
}));

vi.mock('@/api/aiTeaching', () => ({ aiTeachingAPI: apiMock }));
vi.mock('@/utils/toast', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

import { useCheckpointFlow } from '../useCheckpointFlow';

/**
 * 答错就地换题面重答（2026-11-22 链路#1 真实课堂走查实锤）：
 * 提交响应带回更新后的待答检查点（#50，同 cpId、答案键已剥离）时，判定窗收起旧卡后
 * 必须把新卡挂回来——否则新题只剩导师正文文本，学员只能抄题手打（绕开代码裁决）
 * 或刷新页面等 /detail 恢复。答对（无 checkpoint 字段）保持原有收卡行为。
 */
const FIRST = {
  id: 'cp-1',
  type: 'single_choice',
  question: '要让第3行当列名，header 应该写几？',
  options: [
    { id: 'A', text: 'header=0' },
    { id: 'B', text: 'header=2' },
    { id: 'C', text: 'header=3' },
  ],
  allowSkip: false,
};
const REARMED = {
  id: 'cp-1',
  type: 'single_choice',
  question: '要让第1行当列名，header 填几？',
  options: [
    { id: 'A', text: 'header=1' },
    { id: 'B', text: 'header=0' },
    { id: 'C', text: 'header=2' },
  ],
  allowSkip: false,
};

function mountFlow(onContractState?: Parameters<typeof useCheckpointFlow>[4]) {
  const session = ref({ sessionId: 's1', revision: 0 });
  const flow = useCheckpointFlow(session, ref(false), ref(false), undefined, onContractState);
  flow.checkpoint.value = { ...FIRST };
  flow.selectedOptions.value = ['A'];
  return { session, flow };
}

describe('useCheckpointFlow：答错重答卡随提交响应回挂', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.streamSubmitCheckpoint.mockReset();
    apiMock.submitCheckpoint.mockReset();
    apiMock.getSessionDetail.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('流式：判定窗收旧卡后，final 带回的重答卡在场且输入已清空', async () => {
    const { flow } = mountFlow();
    apiMock.streamSubmitCheckpoint.mockImplementation(async (_s: string, _c: string, _p: unknown, _r: number, h: any) => {
      h?.onJudgement?.({ passed: false, judgedBy: 'code', detail: null });
      return { passed: false, feedback: '这道没对上——header 要写 2。', revision: 1, checkpoint: { ...REARMED } };
    });

    await flow.submitCheckpoint();
    // 判定窗（900ms）此时已过或仍在途：重挂必须压过收起 timer
    await vi.advanceTimersByTimeAsync(1000);

    expect(flow.checkpoint.value?.id).toBe('cp-1');
    expect(flow.checkpoint.value?.question).toBe('要让第1行当列名，header 填几？');
    expect(flow.selectedOptions.value).toEqual([]);
    expect(flow.answerText.value).toBe('');
    expect(flow.checkpointSubmitting.value).toBe(false);
    flow.disposeCheckpoint();
  });

  it('答对（无 checkpoint 字段）：保持既有行为，判定窗后收卡不回挂', async () => {
    const { flow } = mountFlow();
    apiMock.streamSubmitCheckpoint.mockImplementation(async (_s: string, _c: string, _p: unknown, _r: number, h: any) => {
      h?.onJudgement?.({ passed: true, judgedBy: 'code', detail: null });
      return { passed: true, feedback: '回答正确', revision: 1 };
    });

    await flow.submitCheckpoint();
    await vi.advanceTimersByTimeAsync(1000);

    expect(flow.checkpoint.value).toBeNull();
    flow.disposeCheckpoint();
  });

  it('非流式回退：响应带回重答卡时直接挂卡（不等判定窗）', async () => {
    const { flow } = mountFlow();
    // 收到过 judgement/delta 才能回退——这里模拟「连接层失败且零内容」的传输错
    apiMock.streamSubmitCheckpoint.mockRejectedValue(Object.assign(new Error('transport down'), { transport: true }));
    apiMock.submitCheckpoint.mockResolvedValue({ passed: false, feedback: '这道没答对', revision: 1, checkpoint: { ...REARMED } });

    await flow.submitCheckpoint();
    await vi.advanceTimersByTimeAsync(1000);

    expect(flow.checkpoint.value?.question).toBe('要让第1行当列名，header 填几？');
    expect(flow.checkpointSubmitting.value).toBe(false);
    flow.disposeCheckpoint();
  });

  it('契约四件套随提交响应落到 onContractState（首答即对后契约卡当场跳变）', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { flow } = mountFlow((state) => seen.push({ ...state }));
    apiMock.streamSubmitCheckpoint.mockResolvedValue({
      passed: true,
      feedback: '回答正确',
      revision: 2,
      lessonContract: { coreKcs: [{ name: '调用read_excel读表' }] },
      lessonReport: { met: false, independentCount: 1, requiredIndependent: 1 },
    });

    await flow.submitCheckpoint();

    expect(seen).toHaveLength(1);
    expect(seen[0].lessonReport).toEqual({ met: false, independentCount: 1, requiredIndependent: 1 });
    expect(seen[0].lessonContract).toEqual({ coreKcs: [{ name: '调用read_excel读表' }] });
    // 缺席字段透传 null，宿主按「不动本地值」处理
    expect(seen[0].exitTicket).toBeNull();
    expect(seen[0].branch).toBeNull();
    flow.disposeCheckpoint();
  });
});
