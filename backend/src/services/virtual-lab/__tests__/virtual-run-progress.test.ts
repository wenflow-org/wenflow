/**
 * 「进行中」列多会话进度（2026-10-18 用户走查）：一个虚拟学习者可同时跑多条路径，
 * 列表此前只取 running[0]。本测试锁住：逐条输出、运行在前暂停在后、最近写入优先、
 * 任务数逐条、无响应只标运行中的那一条、窗口上限。
 */
import {
  ACTIVE_RUNS_LIMIT,
  deriveActiveRuns,
  deriveRunProgress,
  isAutopilotPaused,
} from '../virtual-run-progress';

function session(overrides: Record<string, unknown>) {
  return {
    id: 's',
    status: 'running',
    currentStage: 'learn',
    stageResults: '{}',
    goalConversationId: null,
    learningPathId: null,
    currentTaskId: null,
    completedTasks: 0,
    totalTasks: 0,
    createdAt: '2026-10-18T00:00:00Z',
    updatedAt: '2026-10-18T00:00:00Z',
    ...overrides,
  };
}

describe('deriveRunProgress', () => {
  it('Goal/Path/Learn 三态与任务数从会话行还原（历史行与活跃行共用）', () => {
    const p = deriveRunProgress(session({
      stageResults: JSON.stringify({
        goal: { converged: true },
        path: { success: true },
        teaching: { teachingSessionId: 't1' },
      }),
      completedTasks: 2,
      totalTasks: 25,
    }));
    expect(p).toEqual({ goalReady: true, pathReady: true, learnStarted: true, taskDone: 2, taskTotal: 25 });
  });

  it('缺 stageResults 时回落到会话列（路径 id / 当前任务）且不硬造任务数', () => {
    const p = deriveRunProgress(session({
      stageResults: null,
      goalConversationId: 'g1',
      learningPathId: 'p1',
      currentTaskId: 'task1',
    }));
    expect(p).toEqual({ goalReady: true, pathReady: true, learnStarted: true, taskDone: 0, taskTotal: 0 });
  });

  it('autopilot=stopped 判为暂停；teaching.paused 不影响（那是课程内暂停，不是自动驾驶暂停）', () => {
    expect(isAutopilotPaused(session({ stageResults: '{"autopilot":{"status":"stopped"}}' }))).toBe(true);
    expect(isAutopilotPaused(session({ stageResults: '{"teaching":{"paused":true}}' }))).toBe(false);
  });
});

describe('deriveActiveRuns', () => {
  it('多活跃会话逐条输出：运行在前、暂停在后，同状态按最近写入倒序', () => {
    const runs = deriveActiveRuns([
      session({ id: 'run-old', updatedAt: '2026-10-18T01:00:00Z', completedTasks: 1, totalTasks: 5 }),
      session({ id: 'paused-new', stageResults: '{"autopilot":{"status":"stopped"}}', updatedAt: '2026-10-18T04:00:00Z', completedTasks: 3, totalTasks: 8 }),
      session({ id: 'run-new', updatedAt: '2026-10-18T03:00:00Z', completedTasks: 2, totalTasks: 25 }),
      session({ id: 'done', status: 'completed', updatedAt: '2026-10-18T05:00:00Z' }),
    ]);
    expect(runs.map((r) => [r.sessionId, r.state])).toEqual([
      ['run-new', 'running'],
      ['run-old', 'running'],
      ['paused-new', 'paused'],
    ]);
    expect(runs.map((r) => [r.taskDone, r.taskTotal])).toEqual([[2, 25], [1, 5], [3, 8]]);
  });

  it('无响应只标运行中的那一条（暂停会话无写入是预期）', () => {
    const runs = deriveActiveRuns([
      session({ id: 'stalled', updatedAt: '2026-10-18T01:00:00Z' }),
      session({ id: 'paused', stageResults: '{"autopilot":{"status":"stopped"}}', updatedAt: '2026-10-18T02:00:00Z' }),
    ], new Set(['stalled', 'paused']));
    expect(runs.find((r) => r.sessionId === 'stalled')?.stalled).toBe(true);
    expect(runs.find((r) => r.sessionId === 'paused')?.stalled).toBe(false);
  });

  it('超过逐条上限时只返回最近的前几条（总量由 activeRunTotal 披露）', () => {
    const rows = Array.from({ length: ACTIVE_RUNS_LIMIT + 2 }, (_, i) =>
      session({ id: `s${i}`, updatedAt: `2026-10-18T0${i}:00:00Z` })
    );
    const runs = deriveActiveRuns(rows);
    expect(runs).toHaveLength(ACTIVE_RUNS_LIMIT);
    expect(runs[0].sessionId).toBe(`s${ACTIVE_RUNS_LIMIT + 1}`);
  });

  it('没有活跃会话返回空数组（前端回落「最近」历史进度）', () => {
    expect(deriveActiveRuns([session({ id: 'x', status: 'completed' })])).toEqual([]);
  });
});
