/**
 * vlab.ts 纯逻辑测试：会话推进阶段映射 / 卡顿判定 / 质量徽章提取 / 运行历史窗口常量
 */
import { describe, expect, it } from 'vitest';
import {
  sessionStageIndex,
  stallState,
  extractQuality,
  latestRunTs,
  VLAB_STAGES,
  VLAB_STAGE_LABELS,
  VLAB_STALL_MINUTES,
  STORY_RUN_RECENT_N,
  RUNS_TAB_WINDOW,
} from '../vlab';

describe('vlab.sessionStageIndex（V2 阶段映射：Goal→Path→Learn→Wrapup）', () => {
  it('后端 currentStage 原文归一为四段下标', () => {
    expect(sessionStageIndex('goal')).toBe(0);
    expect(sessionStageIndex('path')).toBe(1);
    expect(sessionStageIndex('teaching')).toBe(2);
    expect(sessionStageIndex('learn')).toBe(2);
    expect(sessionStageIndex('wrapup')).toBe(3);
    expect(sessionStageIndex('Wrapup')).toBe(3);
  });

  it('无法识别 → -1（不点亮任何段）', () => {
    expect(sessionStageIndex('')).toBe(-1);
    expect(sessionStageIndex(undefined)).toBe(-1);
    expect(sessionStageIndex(null)).toBe(-1);
    expect(sessionStageIndex('whatever')).toBe(-1);
  });

  it('VLAB_STAGES 与标签一一对应', () => {
    expect(VLAB_STAGES).toEqual(['goal', 'path', 'learn', 'wrapup']);
    expect(VLAB_STAGE_LABELS.goal).toBe('Goal');
    expect(VLAB_STAGE_LABELS.learn).toBe('Learn');
  });
});

describe('vlab.stallState（V2 卡顿高亮：运行中且久无事件）', () => {
  const now = new Date('2026-08-13T12:00:00').getTime();

  it('非运行中会话 → 永不标记卡顿', () => {
    expect(stallState({ status: 'completed', updatedAt: '2026-08-13T11:00:00' }, now)).toEqual({ stalled: false, idleMins: 0 });
    expect(stallState(null, now)).toEqual({ stalled: false, idleMins: 0 });
    expect(stallState({ status: 'running', updatedAt: '' }, now)).toEqual({ stalled: false, idleMins: 0 });
  });

  it('运行中且刚有事件 → 不卡顿', () => {
    const s = stallState({ status: 'running', updatedAt: '2026-08-13T11:59:00' }, now);
    expect(s).toEqual({ stalled: false, idleMins: 1 });
  });

  it('运行中且超过 VLAB_STALL_MINUTES 无事件 → 疑似卡顿', () => {
    const s = stallState({ status: 'running', updatedAt: '2026-08-13T11:30:00' }, now);
    expect(s.stalled).toBe(true);
    expect(s.idleMins).toBe(30);
  });

  it('updatedAt 缺失回退 createdAt', () => {
    const s = stallState({ status: 'running', createdAt: '2026-08-13T11:50:00' }, now);
    expect(s.idleMins).toBe(10);
  });

  it('阈值常量 ≥ 1 分钟（可配置性锚点）', () => {
    expect(VLAB_STALL_MINUTES).toBe(5);
  });
});

describe('vlab.extractQuality（V3 质量徽章：最近一次裁判 / 保真分）', () => {
  const sessions = [
    {
      id: 's1',
      stageResults: JSON.stringify({
        blackbox: {
          refereeReports: [
            { evaluatedAt: '2026-08-12T10:00:00', report: { scores: { overall: 62 } } },
            { evaluatedAt: '2026-08-13T09:00:00', report: { scores: { overall: 78 } } }
          ],
          actorAuditReports: [
            { evaluatedAt: '2026-08-13T09:05:00', report: { scores: { overall: 81 } } }
          ]
        }
      })
    },
    { id: 's2', stageResults: null }
  ];

  it('取最近一次评估（按 evaluatedAt 新者胜），裁判与保真各自独立', () => {
    const q = extractQuality(sessions as unknown as Array<Record<string, unknown>>);
    expect(q.referee?.score).toBe(78);
    expect(q.referee?.evaluatedAt).toBe('2026-08-13T09:00:00');
    expect(q.fidelity?.score).toBe(81);
    expect(q.fidelity?.evaluatedAt).toBe('2026-08-13T09:05:00');
  });

  it('无黑盒评估 / 无 stageResults → null（徽章显示「未评估」）', () => {
    expect(extractQuality([])).toEqual({ referee: null, fidelity: null });
    expect(extractQuality([{ id: 'x', stageResults: '{}' }] as unknown as Array<Record<string, unknown>>)).toEqual({ referee: null, fidelity: null });
    // 有报告但 overall 缺失 → 忽略
    expect(
      extractQuality([
        { id: 'y', stageResults: { blackbox: { refereeReports: [{ evaluatedAt: '2026-08-13T09:00:00', report: { scores: {} } }] } } }
      ] as unknown as Array<Record<string, unknown>>)
    ).toEqual({ referee: null, fidelity: null });
  });

  it('stageResults 同时支持字符串与对象形态', () => {
    const q = extractQuality([
      {
        id: 'z',
        stageResults: {
          blackbox: { refereeReports: [{ evaluatedAt: '2026-08-13T08:00:00', report: { scores: { overall: 90 } } }] }
        }
      }
    ] as unknown as Array<Record<string, unknown>>);
    expect(q.referee?.score).toBe(90);
  });
});

describe('vlab.运行历史去重窗口（D1）', () => {
  it('故事卡 = 最近 3 条摘要；运行 tab = 全量窗口 50', () => {
    expect(STORY_RUN_RECENT_N).toBe(3);
    expect(RUNS_TAB_WINDOW).toBe(50);
  });
});

describe('vlab.latestRunTs', () => {
  it('updatedAt 优先，createdAt 兜底，非法 → 0', () => {
    expect(latestRunTs({ updatedAt: '2026-08-13T10:00:00', createdAt: '2026-08-13T09:00:00' })).toBe(new Date('2026-08-13T10:00:00').getTime());
    expect(latestRunTs({ createdAt: '2026-08-13T09:00:00' })).toBe(new Date('2026-08-13T09:00:00').getTime());
    expect(latestRunTs(null)).toBe(0);
    expect(latestRunTs({ updatedAt: 'nope' })).toBe(0);
  });
});
