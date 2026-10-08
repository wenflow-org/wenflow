/**
 * P1.6 落后触发器（TIME-TRUST-SCHEME-20261001）判据与信号。
 *
 * 判据（judgeDeadlinePace，纯函数）：path 有外部截止（learning_paths.deadline）时，
 * 时间进度百分位（路径起点→截止日线性刻度）与实际完成百分位的偏差 ≥ 0.2（保守起步）
 * 即视为明显失配，产出 deadline_pace_behind 信号；deriveReplanSignal 将其转成
 * 「建议+确认」的重排建议（不自动执行）。判据不适用（无 deadline/无起点/无体量）返回 null。
 */
import {
  deriveReplanSignal,
  judgeDeadlinePace,
  DEADLINE_PACE_BEHIND_CODE,
  DEADLINE_PACE_BEHIND_THRESHOLD,
} from '../LearnerSnapshotService';

// 稳定时钟：起点 2026-10-01，截止 2026-11-01（30 天窗口）
const START = '2026-10-01T00:00:00Z';
const DEADLINE = '2026-11-01T00:00:00Z';

function paceInput(over: {
  deadline?: Date | string | null;
  now?: Date;
  pathStartedAt?: Date | string | null;
  totalTasks?: number;
  completedTasks?: number;
  threshold?: number;
}) {
  return {
    // 「in」判定：允许测试显式传 null/undefined 关掉 deadline
    deadline: 'deadline' in over ? over.deadline : DEADLINE,
    now: over.now ?? new Date('2026-10-16T12:00:00Z'), // 默认恰走 50% 时间（15.5/31 天）
    pathStartedAt: over.pathStartedAt !== undefined ? over.pathStartedAt : START,
    totalTasks: over.totalTasks ?? 20,
    completedTasks: over.completedTasks ?? 6, // 默认完成 30%
    ...(over.threshold !== undefined ? { threshold: over.threshold } : {}),
  };
}

describe('judgeDeadlinePace（deadline × 进度失配判据，纯函数）', () => {
  it('无 deadline → 判据不适用（null），行为与原先一致', () => {
    expect(judgeDeadlinePace(paceInput({ deadline: null }))).toBeNull();
    expect(judgeDeadlinePace(paceInput({ deadline: undefined }))).toBeNull();
    expect(judgeDeadlinePace(paceInput({ deadline: 'not-a-date' }))).toBeNull();
  });

  it('无起点（pathStartedAt 缺失）→ 判据不适用', () => {
    expect(judgeDeadlinePace(paceInput({ pathStartedAt: null }))).toBeNull();
  });

  it('截止窗非法（起点 ≥ 截止 / 起点在未来）→ 判据不适用', () => {
    expect(judgeDeadlinePace(paceInput({ pathStartedAt: '2026-11-01T00:00:00Z' }))).toBeNull();
    expect(judgeDeadlinePace(paceInput({ pathStartedAt: '2026-10-20T00:00:00Z' }))).toBeNull();
  });

  it('无体量（totalTasks=0）→ 判据不适用', () => {
    expect(judgeDeadlinePace(paceInput({ totalTasks: 0 }))).toBeNull();
  });

  it('进度落后：50% 时间 vs 30% 完成 → gap=0.2，达阈值判落后', () => {
    const j = judgeDeadlinePace(paceInput({}))!;
    expect(j.expectedRatio).toBeCloseTo(0.5);
    expect(j.actualRatio).toBeCloseTo(0.3);
    expect(j.gap).toBeCloseTo(0.2);
    expect(j.behind).toBe(true);
  });

  it('阈值边界 0.2 附近：0.199 不判、0.2 恰判、0.201 判', () => {
    // gap = 0.5 - 0.301 = 0.199
    expect(judgeDeadlinePace(paceInput({ completedTasks: 6.02 }))!.behind).toBe(false);
    // gap = 0.5 - 0.3 = 0.2
    expect(judgeDeadlinePace(paceInput({ completedTasks: 6 }))!.behind).toBe(true);
    // gap = 0.5 - 0.299 = 0.201
    expect(judgeDeadlinePace(paceInput({ completedTasks: 5.98 }))!.behind).toBe(true);
  });

  it('进度超前（gap<0）不判落后', () => {
    const j = judgeDeadlinePace(paceInput({ completedTasks: 12 }))!; // 60% 完成 > 50% 时间
    expect(j.gap).toBeLessThan(0);
    expect(j.behind).toBe(false);
  });

  it('已过截止日：时间进度取 1，完成 <0.8 即判落后', () => {
    const j = judgeDeadlinePace(paceInput({ now: new Date('2026-11-10T00:00:00Z'), completedTasks: 10 }))!;
    expect(j.expectedRatio).toBe(1);
    expect(j.behind).toBe(true);
  });

  it('已过截止日但基本完成（≥0.8）不判落后', () => {
    const j = judgeDeadlinePace(paceInput({ now: new Date('2026-11-10T00:00:00Z'), completedTasks: 19 }))!;
    expect(j.expectedRatio).toBe(1);
    expect(j.behind).toBe(false);
  });

  it('阈值可注入（默认 DEADLINE_PACE_BEHIND_THRESHOLD=0.2）', () => {
    expect(DEADLINE_PACE_BEHIND_THRESHOLD).toBe(0.2);
    expect(judgeDeadlinePace(paceInput({ threshold: 0.5 }))!.behind).toBe(false);
  });
});

// deriveReplanSignal 的最小输入（口径与 replan-signal-discrimination.test.ts 一致）
function signalInput(over: {
  deadline?: string | null;
  startedAt?: string | null;
  now?: Date;
  totalTasks?: number;
  completedTasks?: number;
  lf?: number;
  gaps?: Array<{ label: string; severity: string; source?: string }>;
}) {
  return {
    dynamicState: {
      metrics: { lf: over.lf ?? 3, lsb: 2, ktl: 5 },
      recentTrend: 'steady',
      fatigueRisk: 'medium',
    },
    learningControlState: {
      paceMode: 'steady',
      reviewPriority: 'normal',
      checkpointNeed: false,
    },
    knowledgeMemory: {
      globalSignals: { fragileConcepts: [], strugglingConcepts: [], masteredConcepts: [] },
      globalBackground: { blockedFoundations: [] },
      currentPath: {
        prerequisiteGaps: over.gaps ?? [],
        deadline: over.deadline !== undefined ? over.deadline : DEADLINE,
        startedAt: over.startedAt !== undefined ? over.startedAt : START,
        progress: {
          totalTasks: over.totalTasks ?? 20,
          completedTasks: over.completedTasks ?? 6, // 50% 时间 / 30% 完成 → 落后 0.2
        },
      },
    },
    ...(over.now ? { now: over.now } : { now: new Date('2026-10-16T12:00:00Z') }),
  } as never;
}

describe('deriveReplanSignal · deadline_pace_behind（P1.6）', () => {
  it('有 deadline 且明显落后 → medium 建议重排后续（建议+确认，不自动执行）', () => {
    const s = deriveReplanSignal(signalInput({}));
    expect(s.reasonCodes).toContain(DEADLINE_PACE_BEHIND_CODE);
    expect(s.shouldSuggest).toBe(true);
    expect(s.priority).toBe('medium');
    expect(s.recommendation).toBe('resequence');
    expect(s.scope).toBe('downstream_path');
    expect(s.rationale).toContain('截止');
  });

  it('无 deadline 的路径 → 信号不出现，行为与原先一致', () => {
    const s = deriveReplanSignal(signalInput({ deadline: null }));
    expect(s.reasonCodes).not.toContain(DEADLINE_PACE_BEHIND_CODE);
    expect(s.shouldSuggest).toBe(false);
  });

  it('进度不落后（超前）→ 不产信号', () => {
    const s = deriveReplanSignal(signalInput({ completedTasks: 12 }));
    expect(s.reasonCodes).not.toContain(DEADLINE_PACE_BEHIND_CODE);
    expect(s.shouldSuggest).toBe(false);
  });

  it('结构性风险（high）并存时 → high 优先，但落后信号仍保留在 reasonCodes 供观测', () => {
    const s = deriveReplanSignal(signalInput({
      gaps: [{ label: '分组键唯一性', severity: 'high', source: 'graph' }],
    }));
    expect(s.priority).toBe('high');
    expect(s.recommendation).toBe('resequence');
    expect(s.reasonCodes).toContain(DEADLINE_PACE_BEHIND_CODE);
  });

  it('路径已全部完成 → 恒 keep，落后信号不再打扰收尾', () => {
    const s = deriveReplanSignal(signalInput({ completedTasks: 20, totalTasks: 20 }));
    expect(s.shouldSuggest).toBe(false);
    expect(s.recommendation).toBe('keep');
  });
});
