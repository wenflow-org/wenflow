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

describe('useCheckpointFlow：简答带选项的提交载荷', () => {
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

  it('按选项提交时同时补 answerText，兼容旧后端的 short_answer 分支', async () => {
    const session = ref({ sessionId: 's1', revision: 0 });
    const flow = useCheckpointFlow(session, ref(false), ref(false));
    flow.checkpoint.value = {
      id: 'cp-mixed',
      type: 'short_answer',
      question: 'I am ______ on the server specs',
      options: [
        { id: 'A', text: 'waiting for' },
        { id: 'B', text: 'waiting on' },
      ],
      allowSkip: true,
    };
    flow.selectedOptions.value = ['B'];
    apiMock.streamSubmitCheckpoint.mockResolvedValue({ passed: true, feedback: '答对了', revision: 1 });

    await flow.submitCheckpoint();

    expect(apiMock.streamSubmitCheckpoint).toHaveBeenCalledWith(
      's1',
      'cp-mixed',
      { selectedOptionIds: ['B'], answerText: 'waiting on' },
      0,
      expect.anything(),
    );
    flow.disposeCheckpoint();
  });
});
