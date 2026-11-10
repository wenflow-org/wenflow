/**
 * 「可继续的课堂」活跃度分档（2026-11-03）。
 *
 * 分档阈值复用断线恢复窗口 RECOVERY_WINDOW_MS（48h）——同一份注释写着
 * 「超过则视为新会话，避免『几天前的课』被当成进行中」，两处口径必须一致。
 */
import { activityOf, projectActiveSession } from '../session-activity';
import { RECOVERY_WINDOW_MS } from '../teaching-session-lifecycle';

const HOUR = 60 * 60 * 1000;
const now = Date.parse('2026-11-03T12:00:00.000Z');
const ago = (ms: number) => new Date(now - ms);

describe('activityOf', () => {
  it('刚动过 / 窗口内 → 进行中', () => {
    expect(activityOf(ago(0), now)).toBe('active');
    expect(activityOf(ago(30 * 60 * 1000), now)).toBe('active');
    expect(activityOf(ago(RECOVERY_WINDOW_MS - HOUR), now)).toBe('active');
  });

  it('恰好卡在窗口边界 → 进行中（闭区间）', () => {
    expect(activityOf(ago(RECOVERY_WINDOW_MS), now)).toBe('active');
  });

  it('超出窗口 → 空闲中', () => {
    expect(activityOf(ago(RECOVERY_WINDOW_MS + HOUR), now)).toBe('idle');
    expect(activityOf(ago(10 * 24 * HOUR), now)).toBe('idle');
  });

  it('没有读数（null/undefined/坏值）→ 空闲中，不让无读数冒充进行中', () => {
    expect(activityOf(null, now)).toBe('idle');
    expect(activityOf(undefined, now)).toBe('idle');
    expect(activityOf(new Date('nonsense'), now)).toBe('idle');
  });

  it('时间戳比"现在"还新（写库/应用时钟毫秒级偏移）→ 按进行中，不误伤刚落的这条消息', () => {
    expect(activityOf(new Date(now + 2000), now)).toBe('active');
  });
});

describe('projectActiveSession', () => {
  const base = {
    id: 's_1', subject: '英语', topic: '时态', startTime: ago(3 * HOUR), messageCount: 6,
  };

  it('lastActiveAt 原样透出（面板空闲档要显示「最近活跃多久前」）', () => {
    const t = ago(50 * HOUR);
    const out = projectActiveSession({ ...base, lastActiveAt: t }, now);
    expect(out.lastActiveAt).toEqual(t);
    expect(out.activity).toBe('idle');
    expect(out.sessionId).toBe('s_1');
    expect(out.messageCount).toBe(6);
  });

  it('进行中的课照常给出分档', () => {
    const out = projectActiveSession({ ...base, lastActiveAt: ago(HOUR) }, now);
    expect(out.activity).toBe('active');
  });

  it('已超时结束的课（endTime 非空）即便最近活跃在恢复窗口内，也不冒充「进行中」', () => {
    // 2026-11-04：timeout 行必然带 endTime；旧口径只按 lastActiveAt 分区，会把已中断的旧课标成
    // 「进行中」（与顶部「上次那节是超时中断」互相矛盾）。
    const out = projectActiveSession(
      { ...base, lastActiveAt: ago(HOUR), endTime: ago(2 * HOUR) },
      now,
    );
    expect(out.activity).toBe('idle');
  });
});
