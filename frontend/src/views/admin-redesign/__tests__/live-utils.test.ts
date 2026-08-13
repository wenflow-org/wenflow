/**
 * live.ts 纯逻辑测试：时间格式化 / 错误文案 / 短 ID / 侧栏徽章推导
 * （数据拉取链路已被 AdminConsole 冒烟覆盖，此处只测纯函数与可推导 computed）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timeAgo, errMsg, shortId, liveNavBadges, alarmNavBadges, liveVirtuals, liveSkillProfiles, liveExtraProfiles, liveAnnouncements, hasMorePages, mapLogsToSpans } from '../live';
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

describe('live.hasMorePages（P0 分页正确性：已加载原始行 < 筛选 total 且本页取满）', () => {
  const PAGE_SIZE = 30;

  it('「仅失败」服务端过滤：第一页取满且有剩余 → true（继续加载）', () => {
    expect(hasMorePages(0, 30, 45, PAGE_SIZE)).toBe(true);
  });

  it('「仅失败」服务端过滤：末页不足一页 → false（不再空转）', () => {
    expect(hasMorePages(30, 15, 45, PAGE_SIZE)).toBe(false);
  });

  it('筛选结果总数 < 页大小：第一页即 false（旧 items.length>=30 判定的空转场景，已消除）', () => {
    expect(hasMorePages(0, 12, 12, PAGE_SIZE)).toBe(false);
  });

  it('空页（服务端无更多数据）→ false，按钮消失', () => {
    expect(hasMorePages(60, 0, 60, PAGE_SIZE)).toBe(false);
  });

  it('网关/skill 配对合并不干扰判定：按原始行数累计，末页取满且已加载 == total → false', () => {
    expect(hasMorePages(0, 30, 90, PAGE_SIZE)).toBe(true);
    expect(hasMorePages(30, 30, 90, PAGE_SIZE)).toBe(true);
    expect(hasMorePages(60, 30, 90, PAGE_SIZE)).toBe(false);
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
});
