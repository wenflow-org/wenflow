import {
  DEFAULT_DAILY_LOAD_LIMIT,
  getDailyState,
  quotaDateKey,
  reserveDailyQuota,
  resolveDailyLoadLimit,
  reviewDailyQuotaKey,
  type ReviewQuotaDeps,
} from '../review-quota.service';

function build(over: Partial<ReviewQuotaDeps> = {}) {
  const writes = { write: jest.fn().mockResolvedValue({}) };
  const deps: ReviewQuotaDeps = {
    read: jest.fn().mockResolvedValue(null),
    write: writes.write,
    ...over,
  };
  return { deps, writes };
}

const stored = (payload: any) => ({ payload: JSON.stringify(payload) });

describe('额度口径', () => {
  it('日期按 UTC 日（与 goal_scheduling_ledger 同口径）', () => {
    expect(quotaDateKey(new Date('2026-09-16T00:00:00Z'))).toBe('2026-09-16');
    expect(quotaDateKey(new Date('2026-09-16T23:59:59Z'))).toBe('2026-09-16');
    expect(reviewDailyQuotaKey('u1', '2026-09-16')).toBe('review-daily-quota-v1:u1:2026-09-16');
  });

  it('上限默认 6.0（≈3 节课 × 会话基准预算 2.0），env 可覆盖、非法值回落', () => {
    const saved = process.env.REVIEW_DAILY_LOAD_LIMIT;
    delete process.env.REVIEW_DAILY_LOAD_LIMIT;
    expect(resolveDailyLoadLimit()).toBe(DEFAULT_DAILY_LOAD_LIMIT);
    process.env.REVIEW_DAILY_LOAD_LIMIT = '4.5';
    expect(resolveDailyLoadLimit()).toBe(4.5);
    process.env.REVIEW_DAILY_LOAD_LIMIT = 'abc';
    expect(resolveDailyLoadLimit()).toBe(DEFAULT_DAILY_LOAD_LIMIT);
    process.env.REVIEW_DAILY_LOAD_LIMIT = '-3';
    expect(resolveDailyLoadLimit()).toBe(DEFAULT_DAILY_LOAD_LIMIT);
    if (saved === undefined) delete process.env.REVIEW_DAILY_LOAD_LIMIT;
    else process.env.REVIEW_DAILY_LOAD_LIMIT = saved;
  });
});

describe('getDailyState', () => {
  it('没有账本 → 今天还没接过，额度全量', async () => {
    const { deps } = build();
    const state = await getDailyState('u1', { now: new Date('2026-09-16T10:00:00Z'), deps, limitLoad: 6 });
    expect(state).toMatchObject({ date: '2026-09-16', limitLoad: 6, usedLoad: 0, remainingLoad: 6, reservedKeys: [] });
  });

  it('有账本 → 汇总已用额度与已接概念（跨会话）', async () => {
    const { deps } = build({
      read: jest.fn().mockResolvedValue(stored({
        schemaVersion: 'review-daily-quota-v1',
        date: '2026-09-16',
        userId: 'u1',
        limitLoad: 6,
        usedLoad: 3.5,
        usedCount: 2,
        sessions: [
          { sessionId: 's1', load: 2, count: 1, keys: ['A'], at: '2026-09-16T01:00:00Z' },
          { sessionId: 's2', load: 1.5, count: 1, keys: ['B'], at: '2026-09-16T02:00:00Z' },
        ],
      })),
    });
    const state = await getDailyState('u1', { now: new Date('2026-09-16T10:00:00Z'), deps, limitLoad: 6 });
    expect(state).toMatchObject({ usedLoad: 3.5, usedCount: 2, remainingLoad: 2.5 });
    expect(state.reservedKeys.sort()).toEqual(['A', 'B']);
  });

  it('脏 payload / 读取抛错 → 当作"没接过"（不抛错）', async () => {
    expect(await getDailyState('u1', { deps: build({ read: jest.fn().mockResolvedValue({ payload: '{bad' }) }).deps }))
      .toMatchObject({ usedLoad: 0 });
    expect(await getDailyState('u1', { deps: build({ read: jest.fn().mockRejectedValue(new Error('down')) }).deps }))
      .toMatchObject({ usedLoad: 0, remainingLoad: DEFAULT_DAILY_LOAD_LIMIT });
  });
});

describe('reserveDailyQuota', () => {
  it('首次记账：写入 usedLoad/usedCount/sessions', async () => {
    const { deps, writes } = build();
    const state = await reserveDailyQuota('u1', {
      sessionId: 's1', load: 2.5, keys: ['A', 'B'],
    }, { now: new Date('2026-09-16T10:00:00Z'), deps, limitLoad: 6 });
    expect(state).toMatchObject({ usedLoad: 2.5, usedCount: 2, remainingLoad: 3.5 });
    const written = JSON.parse(writes.write.mock.calls[0][0].create.payload);
    expect(written.sessions).toHaveLength(1);
    expect(written.sessions[0]).toMatchObject({ sessionId: 's1', load: 2.5, count: 2, keys: ['A', 'B'] });
  });

  it('同一会话重复记账 → 幂等（重试/重复开课不重复计数）', async () => {
    const existing = {
      schemaVersion: 'review-daily-quota-v1', date: '2026-09-16', userId: 'u1', limitLoad: 6,
      usedLoad: 2.5, usedCount: 2,
      sessions: [{ sessionId: 's1', load: 2.5, count: 2, keys: ['A', 'B'], at: '2026-09-16T09:00:00Z' }],
    };
    const { deps, writes } = build({ read: jest.fn().mockResolvedValue(stored(existing)) });
    const state = await reserveDailyQuota('u1', { sessionId: 's1', load: 2.5, keys: ['A', 'B'] }, { deps, limitLoad: 6 });
    expect(state?.usedLoad).toBe(2.5);
    expect(writes.write).not.toHaveBeenCalled();
  });

  it('多节课累加：第二节课把当日额度吃掉（这就是"顺延"的来源）', async () => {
    const existing = {
      schemaVersion: 'review-daily-quota-v1', date: '2026-09-16', userId: 'u1', limitLoad: 6,
      usedLoad: 5, usedCount: 3,
      sessions: [{ sessionId: 's1', load: 5, count: 3, keys: ['A', 'B', 'C'], at: '2026-09-16T09:00:00Z' }],
    };
    const { deps } = build({ read: jest.fn().mockResolvedValue(stored(existing)) });
    const state = await reserveDailyQuota('u1', { sessionId: 's2', load: 1, keys: ['D'] }, { deps, limitLoad: 6 });
    expect(state).toMatchObject({ usedLoad: 6, usedCount: 4, remainingLoad: 0 });
  });

  it('跨日互不影响：新的一天读到的是空账本', async () => {
    const { deps } = build({
      read: jest.fn().mockImplementation(async (key: string) => (key.endsWith('2026-09-16') ? stored({
        schemaVersion: 'review-daily-quota-v1', date: '2026-09-16', userId: 'u1', limitLoad: 6,
        usedLoad: 6, usedCount: 4, sessions: [],
      }) : null)),
    });
    expect((await getDailyState('u1', { now: new Date('2026-09-16T23:00:00Z'), deps }))?.remainingLoad).toBe(0);
    expect((await getDailyState('u1', { now: new Date('2026-09-17T00:10:00Z'), deps }))?.remainingLoad).toBe(6);
  });

  it('空 keys 或 load<=0 → 不记账（只回读状态）', async () => {
    const { deps, writes } = build();
    await reserveDailyQuota('u1', { sessionId: 's1', load: 0, keys: ['A'] }, { deps });
    await reserveDailyQuota('u1', { sessionId: 's2', load: 2, keys: [] }, { deps });
    expect(writes.write).not.toHaveBeenCalled();
  });

  it('写入失败 → 返回 null、不抛错（记账不该阻断开课）', async () => {
    const { deps } = build({ write: jest.fn().mockRejectedValue(new Error('db down')) });
    await expect(reserveDailyQuota('u1', { sessionId: 's1', load: 2, keys: ['A'] }, { deps })).resolves.toBeNull();
  });
});
