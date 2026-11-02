/**
 * 检查点讲解回合的停滞看门狗（2026-10-31 用户走查 P0-2）
 *
 * 事故原貌：答对之后卡片显示「回答正确，可继续」，导师讲解要手动刷新才出现。
 * 根因：讲解回合在 `final` 之前可以整段无字节（后端 2~3 分钟实测），而页面 90s 停滞
 * 看门狗只被 `onDelta` 喂；`streamSubmitCheckpoint` 又把后端每 15s 一条的 `: hb`
 * 心跳注释行丢在传输层（sendMessage / continue 都透出了 `onActivity`，唯独这条没有）。
 * 于是健康慢回合准时在 90s 被自家 abort 掐断，讲解丢在服务端。
 *
 * 本文件锁两头：①接上心跳后，慢回合必须把讲解落到屏上；②没有心跳时 90s 仍必须掐断
 * （看门狗不能变成死代码，也不能被改成「永不超时」）。
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

/** 流式提交时页面传给 api 的那组回调（与 streamSubmitCheckpoint 的 handlers 同形） */
type CheckpointStreamHandlers = {
  signal?: AbortSignal;
  onJudgement?: (judgement: { passed: boolean; judgedBy: string; detail: string | null }) => void;
  onDelta?: (text: string) => void;
  onActivity?: () => void;
};

describe('useCheckpointFlow：讲解回合的心跳必须喂到停滞看门狗', () => {
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

  function makeFlow() {
    const session = ref({ sessionId: 's1', revision: 0 });
    const flow = useCheckpointFlow(session, ref(false), ref(false));
    flow.checkpoint.value = {
      id: 'cp-hb',
      type: 'single_choice',
      question: '这一列在程序里该当数字还是文字？',
      options: [
        { id: 'A', text: '数字' },
        { id: 'B', text: '文字' },
      ],
      allowSkip: false,
    };
    flow.selectedOptions.value = ['B'];
    return flow;
  }

  it('讲解 120 秒里只发心跳不发字：讲解仍要落屏，不能停在「回答正确，可继续」', async () => {
    const flow = makeFlow();
    apiMock.submitCheckpoint.mockResolvedValue({ passed: true, revision: 1 });

    apiMock.streamSubmitCheckpoint.mockImplementation(
      (_s: unknown, _c: unknown, _p: unknown, _r: unknown, handlers: CheckpointStreamHandlers) =>
        new Promise((resolve, reject) => {
          handlers.onJudgement?.({ passed: true, judgedBy: 'code', detail: null });
          // 后端 startSseHeartbeat：每 15s 一条 `: hb`，客户端的 onActivity 负责喂狗
          const heartbeat = setInterval(() => handlers.onActivity?.(), 15_000);
          const finish = setTimeout(() => {
            clearInterval(heartbeat);
            resolve({ passed: true, feedback: '讲解正文：数量是数字，备注是文字', revision: 1 });
          }, 120_000);
          handlers.signal?.addEventListener('abort', () => {
            clearInterval(heartbeat);
            clearTimeout(finish);
            // judgement 已经收到过 ⇒ 不是传输层失败（与 sse 的 transport 语义一致）
            reject(Object.assign(new Error('aborted'), { transport: false }));
          });
        }),
    );

    const pending = flow.submitCheckpoint();
    // 只推进到讲解到达之后、卡片 1.2s 自动收起之前（收起会把 feedback 清空）
    await vi.advanceTimersByTimeAsync(120_500);
    await pending;
    expect(flow.checkpointFeedback.value).toContain('讲解正文');
    expect(flow.checkpointPassed.value).toBe(true);
    expect(apiMock.submitCheckpoint).not.toHaveBeenCalled();
    flow.disposeCheckpoint();
  });

  it('反证：完全没有活动时，90 秒仍必须掐断——复现走查里那句「回答正确，可继续」', async () => {
    const flow = makeFlow();
    apiMock.submitCheckpoint.mockResolvedValue({ passed: true, revision: 1 });

    apiMock.streamSubmitCheckpoint.mockImplementation(
      (_s: unknown, _c: unknown, _p: unknown, _r: unknown, handlers: CheckpointStreamHandlers) =>
        new Promise((resolve, reject) => {
          handlers.onJudgement?.({ passed: true, judgedBy: 'code', detail: null });
          // 不出心跳、不出 delta：模拟死连接
          const finish = setTimeout(() => resolve({ passed: true, feedback: '迟到的讲解', revision: 1 }), 120_000);
          handlers.signal?.addEventListener('abort', () => {
            clearTimeout(finish);
            reject(Object.assign(new Error('aborted'), { transport: false }));
          });
        }),
    );

    const pending = flow.submitCheckpoint();
    await vi.advanceTimersByTimeAsync(125_000);
    await pending;

    expect(flow.checkpointFeedback.value).toBe('回答正确，可继续。');
    expect(apiMock.submitCheckpoint).not.toHaveBeenCalled();
    flow.disposeCheckpoint();
  });
});
