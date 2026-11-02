/**
 * 作答回显（2026-10-31 复验遗留）：后端把学生作答作为 user 消息落库，直播流却从不追加气泡
 * —— 刷新前看不见、刷新后看得见，同一段对话两种样子。
 *
 * 这里锁的是**文本格式必须与后端落库一致**（backend/src/services/ai-teaching/teaching-session-ops.ts
 * resolveCheckpointAnswer）：简答取 answerText；选择题每个选项写成 `${id}. ${text}`，多个用「；」连。
 * 格式一旦漂移，同一条作答在直播态与恢复态会长得不一样。
 */
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

describe('useCheckpointFlow：作答回显文本与后端落库同形', () => {
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

  function makeFlow(checkpoint: Record<string, unknown>) {
    const session = ref({ sessionId: 's1', revision: 0 });
    const flow = useCheckpointFlow(session, ref(false), ref(false));
    flow.checkpoint.value = checkpoint;
    return flow;
  }

  it('选择题：`我的答案：B. 文本`（单选用「；」连接，与后端一致）', async () => {
    const flow = makeFlow({
      id: 'cp-choice',
      type: 'single_choice',
      question: '这一列该当数字还是文字？',
      options: [
        { id: 'A', text: '数字' },
        { id: 'B', text: '文字' },
      ],
      allowSkip: false,
    });
    flow.selectedOptions.value = ['B'];
    apiMock.streamSubmitCheckpoint.mockResolvedValue({ passed: true, feedback: '对', revision: 1 });

    await flow.submitCheckpoint();

    expect(flow.lastAnswerEcho.value).toEqual({ checkpointId: 'cp-choice', text: '我的答案：B. 文字' });
    flow.disposeCheckpoint();
  });

  it('多选：按所选顺序用「；」连接', async () => {
    const flow = makeFlow({
      id: 'cp-multi',
      type: 'multi_choice',
      question: '哪些行不该进日报？',
      options: [
        { id: 'A', text: '日期' },
        { id: 'B', text: '重复表头' },
        { id: 'C', text: '合计' },
      ],
      allowSkip: false,
    });
    flow.selectedOptions.value = ['B', 'C'];
    apiMock.streamSubmitCheckpoint.mockResolvedValue({ passed: true, feedback: '对', revision: 1 });

    await flow.submitCheckpoint();

    expect(flow.lastAnswerEcho.value?.text).toBe('我的答案：B. 重复表头；C. 合计');
    flow.disposeCheckpoint();
  });

  it('简答：回显填写的原文本，不套选项格式', async () => {
    const flow = makeFlow({
      id: 'cp-text',
      type: 'short_answer',
      question: '说说你的理解',
      options: [],
      allowSkip: false,
    });
    flow.answerText.value = '数量是数字，备注是文字';
    apiMock.streamSubmitCheckpoint.mockResolvedValue({ passed: true, feedback: '对', revision: 1 });

    await flow.submitCheckpoint();

    expect(flow.lastAnswerEcho.value?.text).toBe('我的答案：数量是数字，备注是文字');
    flow.disposeCheckpoint();
  });

  it('提交失败时不出回显（不能凭空多一条用户气泡）', async () => {
    const flow = makeFlow({
      id: 'cp-fail',
      type: 'single_choice',
      question: 'q',
      options: [
        { id: 'A', text: 'a' },
        { id: 'B', text: 'b' },
      ],
      allowSkip: false,
    });
    flow.selectedOptions.value = ['A'];
    apiMock.streamSubmitCheckpoint.mockRejectedValue(Object.assign(new Error('提交失败'), { serverError: true }));

    await flow.submitCheckpoint();

    expect(flow.lastAnswerEcho.value).toBeNull();
    flow.disposeCheckpoint();
  });
});
