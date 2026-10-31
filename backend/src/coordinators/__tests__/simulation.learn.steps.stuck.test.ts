/**
 * 卡死判定（课堂探针 2026-10-21）纯函数单测。
 *
 * 目的：一道收不了尾的课不要烧满回合上限——连续多回合教师不给收束信号、掌握度不再变化、
 * 判决持续判错，四者同时成立才提前收课；任一条件缺数据即 fail-open。
 */
import {
  appendClosureTrace,
  appendStuckAttributionEntry,
  evaluateStuckClosure,
  LEARN_STUCK_MASTERY_EPSILON,
  LEARN_STUCK_MIN_TURNS,
  LEARN_STUCK_TRACE_WINDOW,
  STUCK_ATTRIBUTION_CAP,
  type ClosureTraceEntry,
} from '../simulation.learn.steps';

const entry = (turn: number, teacherReady: boolean, judgeFalse: boolean, mastery: number | null): ClosureTraceEntry => ({
  turn,
  teacherReady,
  judgeFalse,
  mastery,
});

describe('evaluateStuckClosure', () => {
  it('回合数不足下限时不判定卡死', () => {
    const trace = [entry(3, false, true, 0.4), entry(4, false, true, 0.4), entry(5, false, true, 0.4)];
    const verdict = evaluateStuckClosure({ trace, totalTurns: LEARN_STUCK_MIN_TURNS - 1 });
    expect(verdict.stuck).toBe(false);
  });

  it('窗口内出现教师收束信号 → 不判定卡死', () => {
    const trace = [entry(8, false, true, 0.4), entry(9, true, true, 0.4), entry(10, false, true, 0.4)];
    const verdict = evaluateStuckClosure({ trace, totalTurns: 10 });
    expect(verdict.stuck).toBe(false);
  });

  it('掌握度仍在变化 → 不判定卡死', () => {
    const trace = [entry(8, false, true, 0.4), entry(9, false, true, 0.55), entry(10, false, true, 0.7)];
    const verdict = evaluateStuckClosure({ trace, totalTurns: 10 });
    expect(verdict.stuck).toBe(false);
    expect(verdict.masteryDelta).toBeGreaterThan(LEARN_STUCK_MASTERY_EPSILON);
  });

  it('判错次数不足 → 不判定卡死', () => {
    const trace = [entry(8, false, false, 0.4), entry(9, false, false, 0.4), entry(10, false, true, 0.4)];
    const verdict = evaluateStuckClosure({ trace, totalTurns: 10 });
    expect(verdict.stuck).toBe(false);
    expect(verdict.judgeFalseCount).toBe(1);
  });

  it('四条件同时成立 → 判定卡死并给出归因', () => {
    const trace = [entry(8, false, true, 0.42), entry(9, false, true, 0.41), entry(10, false, true, 0.4)];
    const verdict = evaluateStuckClosure({ trace, totalTurns: 10 });
    expect(verdict.stuck).toBe(true);
    expect(verdict.reason).toBe('non-convergence');
    expect(verdict.masteryDelta).toBeCloseTo(0.02, 5);
    expect(verdict.judgeFalseCount).toBe(3);
  });

  it('模拟器没给掌握度时 fail-open（不提前收课）', () => {
    const trace = [entry(8, false, true, null), entry(9, false, true, null), entry(10, false, true, null)];
    const verdict = evaluateStuckClosure({ trace, totalTurns: 10 });
    expect(verdict.stuck).toBe(false);
    expect(verdict.masteryDelta).toBeNull();
  });

  it('轨迹为空/坏数据时不抛错', () => {
    expect(evaluateStuckClosure({ trace: null, totalTurns: 99 }).stuck).toBe(false);
    expect(evaluateStuckClosure({ trace: [{ bad: true } as unknown as ClosureTraceEntry], totalTurns: 99 }).stuck).toBe(false);
  });
});

describe('appendClosureTrace', () => {
  it('只保留最近 window 条', () => {
    const prior = [entry(1, false, false, 0.1), entry(2, false, false, 0.2), entry(3, false, false, 0.3)];
    const next = appendClosureTrace(prior, entry(4, false, true, 0.3));
    expect(next).toHaveLength(LEARN_STUCK_TRACE_WINDOW);
    expect(next.map((item) => item.turn)).toEqual([2, 3, 4]);
  });

  it('丢弃坏条目，不影响追加', () => {
    const next = appendClosureTrace([{ nope: 1 } as unknown as ClosureTraceEntry], entry(5, false, true, 0.2));
    expect(next).toEqual([entry(5, false, true, 0.2)]);
  });
});

/**
 * 卡死归因的 append-only 落点（2026-10-21）：此前只写 taskRuntime/session log，
 * 下一次 restart-learning 整包重写 teaching 后归因全丢（当晚 8 次非收敛只剩 endReason）。
 */
describe('appendStuckAttributionEntry', () => {
  const record = (at: string): Parameters<typeof appendStuckAttributionEntry>[1] => ({
    at,
    taskId: 'task-1',
    taskTitle: '任务',
    turns: 9,
    reason: 'non-convergence',
    masteryDelta: 0.01,
    judgeFalseCount: 2,
    trace: [entry(9, false, true, 0.4)],
  });

  it('空/非法 prior → 只保留新条目', () => {
    expect(appendStuckAttributionEntry(null, record('t1'))).toEqual([record('t1')]);
    expect(appendStuckAttributionEntry({ not: 'array' }, record('t1'))).toEqual([record('t1')]);
    expect(appendStuckAttributionEntry([42, 'x', null], record('t1'))).toEqual([record('t1')]);
  });

  it('按时间追加，保留最近 cap 条', () => {
    let list: ReturnType<typeof appendStuckAttributionEntry> = [];
    for (let i = 0; i < 25; i += 1) list = appendStuckAttributionEntry(list, record(`t${i}`));
    expect(list).toHaveLength(STUCK_ATTRIBUTION_CAP);
    expect(list[0].at).toBe('t5');
    expect(list[list.length - 1].at).toBe('t24');
  });

  it('自定义 cap 生效（非法 cap 回落默认）', () => {
    expect(appendStuckAttributionEntry([record('t1')], record('t2'), 1).map((x) => x.at)).toEqual(['t2']);
    expect(appendStuckAttributionEntry([record('t1')], record('t2'), 0)).toHaveLength(2);
  });
});
