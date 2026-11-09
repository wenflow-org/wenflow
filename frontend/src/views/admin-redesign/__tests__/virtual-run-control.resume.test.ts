/**
 * @vitest-environment node
 *
 * 列表「继续」的语义（2026-11-09 运营流程核查）：
 * 课堂内暂停（teaching.paused）是自动循环的停止信号——旧实现只调 autopilotStart，
 * 循环第一轮就 markStopped，界面报「已继续」但一行不动。这里钉住「先清 paused、再启动」，
 * 以及各失败分支的归类（409 可忽略 / 已在跑 / 真失败）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getVirtualLearnerStories: vi.fn(),
  resumeVirtualSession: vi.fn(),
  autopilotStart: vi.fn(),
  autopilotStop: vi.fn(),
  terminateVirtualSessions: vi.fn(),
}));

vi.mock('@/api/adminApi', () => ({ adminVirtualLearnersApi: api }));
vi.mock('../live', () => ({
  errMsg: (e: unknown) => {
    const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string };
    return err?.response?.data?.error?.message || err?.message || '';
  },
}));

import { resumeAutopilotOf } from '../virtualRunControl';

const stories = (runs: Array<{ sessionId: string; status?: string }>) => ({
  data: { data: { stories: runs.map((r, i) => ({ id: `st-${i}`, title: `故事 ${i}`, latestRun: r })) } },
});

const httpError = (message: string, status = 409) =>
  Object.assign(new Error(message), { response: { status, data: { error: { message } } } });

describe('resumeAutopilotOf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.resumeVirtualSession.mockResolvedValue({ data: {} });
    api.autopilotStart.mockResolvedValue({ data: {} });
  });

  it('先清课堂内暂停、再启动自动驾驶（顺序不能反，否则循环立刻又停）', async () => {
    api.getVirtualLearnerStories.mockResolvedValue(stories([{ sessionId: 's1', status: 'running' }]));
    const calls: string[] = [];
    api.resumeVirtualSession.mockImplementation(async () => { calls.push('resume'); return { data: {} }; });
    api.autopilotStart.mockImplementation(async () => { calls.push('start'); return { data: {} }; });

    const result = await resumeAutopilotOf('p1');

    expect(calls).toEqual(['resume', 'start']);
    expect(result).toEqual({ done: 1, skipped: 0, failed: 0 });
  });

  it('goal/path 阶段（created 会话）resume 409 属预期，仍要启动自动驾驶', async () => {
    api.getVirtualLearnerStories.mockResolvedValue(stories([{ sessionId: 's1', status: 'created' }]));
    api.resumeVirtualSession.mockRejectedValue(httpError('会话状态为 created，仅运行中可恢复'));

    const result = await resumeAutopilotOf('p1');

    expect(api.autopilotStart).toHaveBeenCalledWith('s1', { target: 'final' });
    expect(result).toEqual({ done: 1, skipped: 0, failed: 0 });
  });

  it('已清 paused 且自动驾驶仍在跑（已有全自动运行）→ 算已继续，不是跳过', async () => {
    api.getVirtualLearnerStories.mockResolvedValue(stories([{ sessionId: 's1', status: 'running' }]));
    api.autopilotStart.mockRejectedValue(httpError('已有全自动运行', 400));

    const result = await resumeAutopilotOf('p1');

    expect(result).toEqual({ done: 1, skipped: 0, failed: 0 });
  });

  it('resume 无标志可清（409）且自动驾驶已在跑 → 真正的跳过', async () => {
    api.getVirtualLearnerStories.mockResolvedValue(stories([{ sessionId: 's1', status: 'created' }]));
    api.resumeVirtualSession.mockRejectedValue(httpError('会话状态为 created，仅运行中可恢复'));
    api.autopilotStart.mockRejectedValue(httpError('已有全自动运行', 400));

    const result = await resumeAutopilotOf('p1');

    expect(result).toEqual({ done: 0, skipped: 1, failed: 0 });
  });

  it('resume 的非预期错误不吞（走真失败分支）', async () => {
    api.getVirtualLearnerStories.mockResolvedValue(stories([{ sessionId: 's1', status: 'running' }]));
    api.resumeVirtualSession.mockRejectedValue(httpError('数据库连接失败', 500));

    const result = await resumeAutopilotOf('p1');

    expect(api.autopilotStart).not.toHaveBeenCalled();
    expect(result).toEqual({ done: 0, skipped: 0, failed: 1 });
  });

  it('已终止会话不碰（完成/放弃/失败）', async () => {
    api.getVirtualLearnerStories.mockResolvedValue(stories([
      { sessionId: 's1', status: 'completed' },
      { sessionId: 's2', status: 'abandoned' },
    ]));

    const result = await resumeAutopilotOf('p1');

    expect(api.resumeVirtualSession).not.toHaveBeenCalled();
    expect(api.autopilotStart).not.toHaveBeenCalled();
    expect(result).toEqual({ done: 0, skipped: 2, failed: 0 });
  });
});
