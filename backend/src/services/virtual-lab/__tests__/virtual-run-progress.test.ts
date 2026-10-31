/**
 * 「进行中」列多会话进度（2026-10-18 用户走查）：一个虚拟学习者可同时跑多条路径，
 * 列表此前只取 running[0]。本测试锁住：逐条输出、运行在前暂停在后、最近写入优先、
 * 任务数逐条、无响应只标运行中的那一条、窗口上限。
 */
import {
  ACTIVE_RUNS_LIMIT,
  deriveActiveRuns,
  deriveRecentRuns,
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

describe('deriveRecentRuns（没有活跃运行时的历史摘要，按学习路径归并）', () => {
  it('同一路径的多次运行只保留最近一次；不同路径各一条；目标阶段（无路径）单独成组', () => {
    const r = deriveRecentRuns([
      // 路径 A 的两次运行：老的一次应被折叠
      session({ id: 'a-old', status: 'abandoned', learningPathId: 'path-A', updatedAt: '2026-10-10T00:00:00Z', currentStage: 'path', stageResults: '{}' }),
      session({ id: 'a-new', status: 'completed', learningPathId: 'path-A', updatedAt: '2026-10-12T00:00:00Z', currentStage: 'learn', completedTasks: 5, totalTasks: 20, stageResults: '{}' }),
      // 路径 B
      session({ id: 'b-1', status: 'failed', learningPathId: 'path-B', updatedAt: '2026-10-11T00:00:00Z', currentStage: 'path' }),
      // 还没产出路径的目标阶段运行
      session({ id: 'goal-1', status: 'abandoned', learningPathId: null, updatedAt: '2026-10-13T00:00:00Z', currentStage: 'goal' }),
    ]);
    expect(r.total).toBe(3);
    // 组间按最近写入倒序：目标阶段（13 号）→ 路径 A（12 号）→ 路径 B（11 号）
    expect(r.runs.map((x) => x.sessionId)).toEqual(['goal-1', 'a-new', 'b-1']);
    expect(r.runs.map((x) => x.pathId)).toEqual([null, 'path-A', 'path-B']);
    // 折叠后取的是最近那次运行的任务数与终态
    const a = r.runs.find((x) => x.pathId === 'path-A')!;
    expect(a.taskDone).toBe(5);
    expect(a.taskTotal).toBe(20);
    expect(a.status).toBe('completed');
    expect(a.updatedAt).toBe('2026-10-12T00:00:00.000Z');
  });

  it('上限只影响返回条数，total 仍是全部路径数（前端用差出「+N 条路径」）', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((p, i) =>
      session({ id: `s-${p}`, learningPathId: `path-${p}`, updatedAt: `2026-10-1${i}T00:00:00Z` })
    );
    const r = deriveRecentRuns(many, 2);
    expect(r.runs).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.runs.map((x) => x.pathId)).toEqual(['path-E', 'path-D']);
  });

  it('没有会话 → 空摘要（前端据此显示「未运行」而不是「最近」）', () => {
    const r = deriveRecentRuns([]);
    expect(r.total).toBe(0);
    expect(r.runs).toEqual([]);
  });
});
