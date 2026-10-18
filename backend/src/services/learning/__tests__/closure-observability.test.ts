/**
 * 收束事件观测口径单测（#105）。
 * 锁住三件事：只统计收束事件、历史行标 legacy 不猜、轨道×通道矩阵可一眼查「同屏不同源」。
 */
import {
  parseClosureObservation,
  summarizeClosureObservations,
} from '../closure-observability';

describe('parseClosureObservation', () => {
  it('解析新口径：track + completionSource', () => {
    expect(parseClosureObservation('task:completed', JSON.stringify({
      track: 'virtual-learner',
      completionSource: 'vl-assisted',
    }))).toEqual({
      eventType: 'task:completed',
      track: 'virtual-learner',
      completionSource: 'vl-assisted',
    });
  });

  it('2026-10-18 之前的历史行没有 track → legacy（不猜）', () => {
    const parsed = parseClosureObservation('path:completed', JSON.stringify({ pathId: 'p1' }));
    expect(parsed).toEqual({ eventType: 'path:completed', track: 'legacy', completionSource: 'unknown' });
  });

  it('非收束事件不计入（如 lesson:completed / checkpoint:result）', () => {
    expect(parseClosureObservation('lesson:completed', '{}')).toBeNull();
    expect(parseClosureObservation('checkpoint:result', '{}')).toBeNull();
  });

  it('坏 payload 仍算一条（track=legacy、source=unknown），避免静默丢样本', () => {
    expect(parseClosureObservation('task:completed', '{oops')).toEqual({
      eventType: 'task:completed',
      track: 'legacy',
      completionSource: 'unknown',
    });
  });

  it('未知 track 值不当成已知轨道', () => {
    const parsed = parseClosureObservation('task:completed', JSON.stringify({ track: 'quick-learn', completionSource: 'x' }));
    expect(parsed!.track).toBe('legacy');
  });
});

describe('summarizeClosureObservations', () => {
  it('分轨、分通道与矩阵计数', () => {
    const summary = summarizeClosureObservations([
      { eventType: 'task:completed', track: 'human', completionSource: 'teaching-finalize' },
      { eventType: 'task:completed', track: 'human', completionSource: 'human-ui' },
      { eventType: 'task:completed', track: 'virtual-learner', completionSource: 'vl-assisted' },
      { eventType: 'path:completed', track: 'virtual-learner', completionSource: 'vl-assisted' },
      { eventType: 'task:completed', track: 'legacy', completionSource: 'unknown' },
    ]);
    expect(summary.total).toBe(5);
    expect(summary.byTrack).toEqual({ human: 2, 'virtual-learner': 2, unknown: 0, legacy: 1 });
    expect(summary.bySource['vl-assisted']).toBe(2);
    expect(summary.matrix['human|teaching-finalize']).toBe(1);
    expect(summary.matrix['legacy|unknown']).toBe(1);
  });

  it('空输入不产 NaN/undefined', () => {
    const summary = summarizeClosureObservations([]);
    expect(summary.total).toBe(0);
    expect(summary.byTrack).toEqual({ human: 0, 'virtual-learner': 0, unknown: 0, legacy: 0 });
    expect(summary.matrix).toEqual({});
  });
});
