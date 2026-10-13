/**
 * 总览状态条「结论 → 动作」对齐 + 排查下钻参数（2026-10-13 运营走查 O3 / F4）。
 *
 * O3：结论写「需要关注：今日失败 17 次」时，右端动作此前硬编码「查看健康中心」——
 *     把人送到系统检查清单，在那里找不到这 17 条失败。动作须按结论口径派生。
 * F4：事故卡「去排查」此前不带时间窗，落到执行日志的默认窗（今天）而事故卡口径是
 *     「近 7 天 · 200 条采样」→ 实测得到一页空态。下钻必须显式带上 range。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { intent, investigateAgent, investigateTodayFailures, intentQueryParams, statusActionOf } from '../store';

describe('statusActionOf（结论行动作归属）', () => {
  it('讲「今日失败」→ 去执行日志排查', () => {
    expect(statusActionOf('需要关注：今日失败 17 次')).toBe('investigate-today');
  });

  it('讲「今日成功率」→ 去执行日志排查（bad / warn 两档同一口径）', () => {
    expect(statusActionOf('需要关注：今日成功率 91.4%')).toBe('investigate-today');
    expect(statusActionOf('需要关注：今日成功率 76%')).toBe('investigate-today');
  });

  it('讲运平稳 / 空闲 / 未就绪 → 维持健康中心入口', () => {
    expect(statusActionOf('运行平稳')).toBe('health');
    expect(statusActionOf('系统空闲')).toBe('health');
    expect(statusActionOf('统计尚未就绪')).toBe('health');
    expect(statusActionOf('')).toBe('health');
  });
});

describe('排查下钻参数', () => {
  beforeEach(() => {
    intent.agentFilter = '';
    intent.statusFilter = '';
    intent.errorCategory = '';
    intent.timeRange = '';
    intent.traceId = '';
    intent.sessionId = '';
    intent.traceFocus = false;
    intent.tab = '';
  });

  it('F4：事故卡「去排查」带近 7 天时间窗（与卡片口径同源，不落空态）', () => {
    investigateAgent('teaching-turn');
    expect(intent.scene).toBe('execution-logs');
    expect(intent.statusFilter).toBe('err');
    expect(intentQueryParams('execution-logs')).toMatchObject({
      agent: 'teaching-turn',
      status: 'err',
      range: 'week'
    });
  });

  it('O3：状态条「今日失败」下钻按今天（与结论口径同源）', () => {
    investigateTodayFailures();
    expect(intent.scene).toBe('execution-logs');
    expect(intent.statusFilter).toBe('err');
    expect(intent.agentFilter).toBe('');
    expect(intentQueryParams('execution-logs')).toMatchObject({ status: 'err', range: 'today' });
  });

  it('下钻不吃上一条深链的残留（会话/链路/tab 全清）', () => {
    intent.sessionId = 's-old';
    intent.traceId = 't-old';
    intent.traceFocus = true;
    intent.tab = 'trace';
    investigateTodayFailures();
    expect(intent.sessionId).toBe('');
    expect(intent.traceId).toBe('');
    expect(intent.traceFocus).toBe(false);
    expect(intent.tab).toBe('');
  });
});
