/**
 * live.ts 纯逻辑测试：时间格式化 / 错误文案 / 短 ID / 侧栏徽章推导
 * （数据拉取链路已被 AdminConsole 冒烟覆盖，此处只测纯函数与可推导 computed）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timeAgo, errMsg, shortId, liveNavBadges, alarmNavBadges, liveVirtuals, liveSkillProfiles, liveExtraProfiles, liveAnnouncements, totalPagesOf, mapLogsToSpans, gatewayPairWindowMs, mergeSpanPages } from '../live';
import { liveSpans } from '../store';
import type { TraceSpan } from '../store';

describe('live.timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T12:00:00').getTime());
  });
  afterEach(() => vi.useRealTimers());

  it('空值 / 非法值 → 从未', () => {
    expect(timeAgo()).toBe('从未');
    expect(timeAgo(null)).toBe('从未');
    expect(timeAgo('not-a-date')).toBe('从未');
  });

  it('未来时间 / 1 分钟内 → 刚刚', () => {
    expect(timeAgo('2026-08-13T12:00:30')).toBe('刚刚');
    expect(timeAgo('2026-08-13T11:59:40')).toBe('刚刚');
  });

  it('分钟 / 小时 / 天分级', () => {
    expect(timeAgo('2026-08-13T11:55:00')).toBe('5 分钟前');
    expect(timeAgo('2026-08-13T10:00:00')).toBe('2 小时前');
    expect(timeAgo('2026-08-12T10:00:00')).toBe('昨天');
    expect(timeAgo('2026-08-08T12:00:00')).toBe('5 天前');
  });

  it('超过 30 天 → 本地化日期', () => {
    expect(timeAgo('2026-07-01T12:00:00')).toMatch(/\//);
  });
});

describe('live.errMsg', () => {
  it('axios 风格嵌套 error.message 提取', () => {
    expect(
      errMsg({ response: { data: { error: { message: '字段冲突' } } } })
    ).toBe('字段冲突');
  });

  it('字符串 error 直出', () => {
    expect(errMsg({ response: { data: { error: '权限不足' } } })).toBe('权限不足');
  });

  it('401 → admin 登录提示', () => {
    expect(errMsg({ response: { status: 401 } })).toBe('需要 admin 登录');
  });

  it('普通 message / 未知 → 兜底', () => {
    expect(errMsg({ message: 'boom' })).toBe('boom');
    expect(errMsg(undefined)).toBe('网络错误');
  });
});

describe('live.shortId', () => {
  it('短 ID 原样返回', () => {
    expect(shortId('abc')).toBe('abc');
  });

  it('长 ID 头尾截断 + 省略号', () => {
    const id = 'a'.repeat(40);
    expect(shortId(id)).toBe('aaaaaaaaaaaa…aaaaaa');
    expect(shortId(id, 8, 4)).toBe('aaaaaaaa…aaaa');
  });
});

describe('live.liveNavBadges（侧栏徽章推导）', () => {
  beforeEach(() => {
    liveVirtuals.value = [];
    liveSkillProfiles.value = [];
    liveExtraProfiles.value = [];
    liveAnnouncements.value = [];
    liveSpans.value = [];
  });

  it('无动态数据时仅 addons 由静态外挂能力清单兜底（size=3）', () => {
    expect(liveNavBadges.value).toEqual({ addons: '3' });
  });

  it('按域填充计数徽章', () => {
    liveVirtuals.value = [{ id: 'v1' } as never, { id: 'v2' } as never];
    liveSkillProfiles.value = [{ id: 's1' } as never, { id: 's2' } as never, { id: 's3' } as never];
    liveExtraProfiles.value = [{ id: 'e1' } as never];
    liveAnnouncements.value = [
      { status: 'published' } as never,
      { status: 'draft' } as never
    ];
    liveSpans.value = [
      { status: 'err' } as TraceSpan,
      { status: 'ok' } as TraceSpan,
      { status: 'err' } as TraceSpan
    ];
    expect(liveNavBadges.value).toEqual({
      'virtual-learners': '2',
      skills: '3',
      // addons = liveExtra 数量优先；为 0 时由静态清单兜底（size=3）
      addons: '1',
      announcements: '1',
      'execution-logs': '2'
    });
  });

  it('执行日志是报警徽章场景', () => {
    expect(alarmNavBadges.has('execution-logs')).toBe(true);
  });
});

describe('live.totalPagesOf（传统分页总页数：筛选口径 total / 每页条数，方案 A）', () => {
  it('整除：total 恰好是 pageSize 倍数 → total/pageSize 页', () => {
    expect(totalPagesOf(90, 30)).toBe(3);
    expect(totalPagesOf(378, 30)).toBe(13);
  });

  it('有余数向上取整：默认 7 天视图 1570/30 → 53 页（旧「加载更多 52 次」的量级根源）', () => {
    expect(totalPagesOf(1570, 30)).toBe(53);
  });

  it('total 为 0 或小于 pageSize → 至少 1 页（页码器永不显示「第 0 / 0 页」）', () => {
    expect(totalPagesOf(0, 30)).toBe(1);
    expect(totalPagesOf(12, 30)).toBe(1);
  });

  it('pageSize 非法（0/负）按 1 收敛，避免除零', () => {
    expect(totalPagesOf(30, 0)).toBe(30);
    expect(totalPagesOf(60, -5)).toBe(60);
  });

  it('不同每页条数档位：378 条在 15/50/100 下的页数', () => {
    expect(totalPagesOf(378, 15)).toBe(26);
    expect(totalPagesOf(378, 50)).toBe(8);
    expect(totalPagesOf(378, 100)).toBe(4);
  });
});

describe('live.mapLogsToSpans（P1 消息列语义 + 网关配对 + 状态映射）', () => {
  it('detail 为错误摘要而非 timeAgo 相对时间（时间语义收敛到时间列）', () => {
    const spans1 = mapLogsToSpans([
      { id: '1', createdAt: '2026-08-13T11:55:00', status: 'error', errorMessage: 'RATE_LIMITED：请求过于频繁' }
    ]);
    expect(spans1[0].detail).toBe('RATE_LIMITED：请求过于频繁');
    expect(spans1[0].detail).not.toMatch(/前|昨天/);
    expect(spans1[0].status).toBe('err');
  });

  it('成功行 detail 为空串（不再出现「3 分钟前」这类相对时间）', () => {
    const spans1 = mapLogsToSpans([{ id: '2', createdAt: '2026-08-13T11:55:00', status: 'success' }]);
    expect(spans1[0].detail).toBe('');
    expect(spans1[0].status).toBe('ok');
  });

  it('timeout → warn 映射', () => {
    const spans1 = mapLogsToSpans([{ id: '3', status: 'timeout' }]);
    expect(spans1[0].status).toBe('warn');
  });

  it('skill 行 + 同 trace 时间相近的网关行 → 合并为一行且携带 gatewayDurMs', () => {
    const spans1 = mapLogsToSpans([
      { id: 'g1', traceId: 'tr:abc', createdAt: '2026-08-13T10:00:00.000', executionLayer: 'api-gateway', durationMs: 80, status: 'success' },
      { id: 's1', traceId: 'tr:abc', createdAt: '2026-08-13T10:00:00.300', executionLayer: 'skill', durationMs: 1200, status: 'success', agentId: 'skill:teaching-turn', model: 'deepseek-v4-pro' }
    ]);
    expect(spans1).toHaveLength(1);
    expect(spans1[0].gatewayDurMs).toBe(80);
    expect(spans1[0].agent).toBe('teaching-turn');
    expect(spans1[0].model).toBe('deepseek-v4-pro');
  });

  it('model / sessionId 透传到 span（供模型独立列展示）', () => {
    const spans1 = mapLogsToSpans([
      { id: 'm1', status: 'success', model: 'deepseek-v4-flash', sessionId: 'sess_1', agentId: 'skill:goal-conversation' }
    ]);
    expect(spans1[0].model).toBe('deepseek-v4-flash');
    expect(spans1[0].sessionId).toBe('sess_1');
  });

  it('W2 修窗：长调用下网关与 skill 时间差远超 1500ms 仍合并（窗口随调用时长缩放）', () => {
    // 实测场景：网关 11.4s / skill 25.6s，两条记录写出时间差 4.2s > 固定窗口 1500ms
    const spans1 = mapLogsToSpans([
      { id: 'g1', traceId: 'tr:long', createdAt: '2026-08-13T10:00:00.000', executionLayer: 'api-gateway', durationMs: 11400, status: 'success' },
      { id: 's1', traceId: 'tr:long', createdAt: '2026-08-13T10:00:04.200', executionLayer: 'skill', durationMs: 25600, status: 'success', agentId: 'skill:virtual-learner-learn-turn-simulator' }
    ]);
    expect(spans1).toHaveLength(1);
    expect(spans1[0].gatewayDurMs).toBe(11400);
    expect(spans1[0].agent).toBe('virtual-learner-learn-turn-simulator');
  });

  it('W2 修窗：短调用仍受 1500ms 兜底窗口约束（长耗时网关行不误配短 skill 行）', () => {
    const spans1 = mapLogsToSpans([
      // 同 trace 两条调用：第一条网关 60s（skill 行缺失），第二条 skill 200ms 与前者时间差 3s
      { id: 'g1', traceId: 'tr:guard', createdAt: '2026-08-13T10:00:00.000', executionLayer: 'api-gateway', durationMs: 60000, status: 'success' },
      { id: 's1', traceId: 'tr:guard', createdAt: '2026-08-13T10:00:03.000', executionLayer: 'skill', durationMs: 200, status: 'success', agentId: 'skill:teaching-turn' }
    ]);
    // skill 行 200ms → 窗口 = max(1500, 200) = 1500ms < 3s → 不配对，两行独立
    expect(spans1).toHaveLength(2);
    expect(spans1.find((x) => x.execLayer === 'api-gateway')?.gatewayDurMs).toBeUndefined();
  });

  it('W2 修窗：window 下限 1500ms，且随两记录 durationMs 较小值缩放', () => {
    expect(gatewayPairWindowMs(200, 100)).toBe(1500);
    expect(gatewayPairWindowMs(25600, 11400)).toBe(11400);
    expect(gatewayPairWindowMs(3000, 8000)).toBe(3000);
  });
});

describe('live.mergeSpanPages（W1 瀑布服务端分页追加：去重 + 跨页同 trace 重算 startMs）', () => {
  const span = (id: string, traceId: string, ts: number, startMs: number, durationMs: number, extra: Partial<TraceSpan> = {}): TraceSpan => ({
    id, traceId, ts, startMs, durationMs, status: 'ok' as const,
    kind: 'call' as const, agent: 'a', stage: 's', title: 't', detail: '', ...extra
  });

  it('按 span id 去重（新页覆盖旧行），样本内重复 id 不双列', () => {
    const existing = [
      span('a1', 'tr:1', 1000, 0, 100),
      span('b1', 'tr:1', 1200, 200, 50)
    ];
    const incoming = [
      span('b1', 'tr:1', 1200, 999, 55),
      span('c1', 'tr:1', 1500, 0, 80)
    ];
    const merged = mergeSpanPages(existing, incoming);
    expect(merged).toHaveLength(3);
    expect(merged.find((x) => x.id === 'b1')?.durationMs).toBe(55);
  });

  it('跨页同 trace：新页行 startMs 以该 trace 最早 ts 为起点重算（不再按页内局部起点偏移）', () => {
    const existing = [
      span('a1', 'tr:x', 10_000, 0, 100)
    ];
    const incoming = [
      span('d1', 'tr:x', 10_400, 0, 300)
    ];
    const merged = mergeSpanPages(existing, incoming);
    expect(merged.find((x) => x.id === 'a1')?.startMs).toBe(0);
    expect(merged.find((x) => x.id === 'd1')?.startMs).toBe(400);
  });
});
