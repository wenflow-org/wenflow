/**
 * SessionSecurity 分页回归测试（2026-10-07：分页器统一——「加载更多」累积式改成标准页码器）：
 * 活跃会话行按页切片（默认 15 行/页），页码器在卡脚；历史折叠组不参与分页。
 * 口径：页码器 total = 已加载行窗口的活跃行数；卡头「活跃 N」= 后端全量（counts），
 * 两者不同源，窗口被截断时由分页器 note + 卡头 meta 各自披露。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import SessionSecurity from '../SessionSecurity.vue';
import { chooseFilter, filterOption } from './filter-controls';
import { chooseMkSelect } from '@/components/mk/__tests__/mkSelect';

const h = vi.hoisted(() => ({
  getMe: vi.fn(),
  getSessions: vi.fn(),
  revoke: vi.fn()
}));

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: { getMe: h.getMe },
  adminSessionsApi: { getAdminSessions: h.getSessions, revokeAdminSession: h.revoke, revokeAllAdminSessions: vi.fn() },
  adminAgentsApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminAuditApi: apiObject()
}));

vi.mock('../useConfirm', () => ({
  askConfirm: vi.fn(async () => true),
  doneConfirm: vi.fn(),
  failConfirm: vi.fn()
}));

function fakeSession(
  i: number,
  opts: { revoked?: boolean; expired?: boolean; adminId?: string } = {}
) {
  const now = Date.now();
  return {
    id: `sess-${i}`,
    adminId: opts.adminId || 'admin-1',
    jti: `jti-${i}`,
    ip: '::1',
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) #${i}`,
    remember: true,
    issuedAt: new Date(now - 3600_000).toISOString(),
    expiresAt: new Date(opts.expired ? now - 60_000 : now + 86_400_000).toISOString(),
    lastSeenAt: new Date(now - 60_000).toISOString(),
    revokedAt: opts.revoked ? new Date(now - 60_000).toISOString() : null,
    createdAt: new Date(now - 3600_000).toISOString(),
    // 后端按请求者 jti 打的「当前标签页」标记（#28）：造 #1 为当前会话
    isCurrent: i === 1,
    adminName: opts.adminId === 'admin-2' ? 'auditor' : 'admin',
    adminEmail: opts.adminId === 'admin-2' ? 'auditor@wenflow.local' : 'admin@wenflow.local'
  };
}

async function mountSS(sessions: unknown[], extra: Record<string, unknown> = {}) {
  h.getSessions.mockResolvedValue({ data: { data: { sessions, ...extra } } });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  });
  await router.push('/admin/session-security');
  await router.isReady();
  const w = mount(SessionSecurity, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return w;
}

/** 页码器读数（「共 N 条 · 第 P / T 页」） */
function pagerText(w: Awaited<ReturnType<typeof mountSS>>) {
  return w.find('.mk-pagination').text();
}

/** 状态 pill 的计数徽章（全量口径的唯一可见位置，2026-10-26 起卡头 meta 不再复述） */
function pillCount(w: Awaited<ReturnType<typeof mountSS>>, label: string) {
  return filterOption(w as never, '状态', label).text().match(/（(\d+)）$/)?.[1] ?? '';
}

describe('SessionSecurity 分页（标准页码器）', () => {
  beforeEach(() => {
    h.getMe.mockReset();
    h.getSessions.mockReset();
    h.revoke.mockReset();
    h.revoke.mockResolvedValue({ data: {} });
    h.getMe.mockResolvedValue({ data: { data: { id: 'admin-1' } } });
  });

  it('首屏只渲染每页 15 行，页码器读数与总行数一致', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions);
    expect(w.findAll('.ss-tr').length).toBe(15);
    expect(w.find('.mk-pagination').exists()).toBe(true);
    expect(pagerText(w)).toContain('共 30 条');
    expect(pagerText(w)).toContain('第 1 / 2 页');
  });

  it('点「下一页」渲染第 16-30 行，当前页高亮跟随', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions);
    const next = w.findAll('.mk-pagination__btn').find((b) => b.text() === '下一页')!;
    await next.trigger('click');
    await flushPromises();
    const rows = w.findAll('.ss-tr');
    expect(rows.length).toBe(15);
    // 第 2 页 = 第 16..30 条（顺序按后端返回，未被重排）
    expect(rows[0].text()).toContain('#16');
    expect(rows[14].text()).toContain('#30');
    expect(pagerText(w)).toContain('第 2 / 2 页');
    expect(w.find('.mk-pagination__num--active').text()).toBe('2');
  });

  it('切换每页条数下拉 → 行数与页码器同步', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions);
    await chooseMkSelect(w as never, '每页条数', '30');
    await flushPromises();
    expect(w.findAll('.ss-tr').length).toBe(30);
    expect(pagerText(w)).toContain('第 1 / 1 页');
  });

  it('行数不足一页时仍在卡脚显示读数（共 N 条 · 第 1 / 1 页）', async () => {
    const w = await mountSS(Array.from({ length: 8 }, (_, i) => fakeSession(i + 1)));
    expect(w.findAll('.ss-tr').length).toBe(8);
    expect(pagerText(w)).toContain('共 8 条');
    expect(pagerText(w)).toContain('第 1 / 1 页');
    // 只有一页：上一页/下一页均禁用
    for (const b of w.findAll('.mk-pagination__btn')) {
      expect(b.attributes('disabled')).toBeDefined();
    }
  });

  it('状态筛选切换 → 回到第 1 页', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions, {
      counts: { total: 30, active: 30, expired: 0, revoked: 0 },
      adminCounts: [{ adminId: 'admin-1', total: 30, active: 30, expired: 0, revoked: 0 }]
    });
    const next = w.findAll('.mk-pagination__btn').find((b) => b.text() === '下一页')!;
    await next.trigger('click');
    await flushPromises();
    expect(pagerText(w)).toContain('第 2 / 2 页');
    // 「只看活跃」→ statusFilter 由 '' 变为 'active'
    await chooseFilter(w as never, '状态', '活跃');
    await flushPromises();
    expect(pagerText(w)).toContain('第 1 / 2 页');
  });

  /* B13 F6-1：全量口径与行窗口分离。后端 counts/adminCounts 是作用域全量，
     页面统计/组头/批量下线条数读它；行窗口（sessions）只决定渲染哪些行。 */
  it('统计条/组头/批量下线条数读后端全量 counts，页码器读行窗口并用 note 披露口径', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions, {
      counts: { total: 100, active: 93, expired: 7, revoked: 0 },
      adminCounts: [{ adminId: 'admin-1', total: 100, active: 93, expired: 7, revoked: 0 }],
      window: { limit: 100, returned: 30 }
    });
    // 全量口径住在状态 pills（2026-10-26：卡头 meta 不再复述 pills 已有的数字）
    expect(pillCount(w, '活跃')).toBe('93');
    expect(pillCount(w, '已过期')).toBe('7');
    // 卡头只留 pills 与页码器都说不出的事实：行窗口截断
    expect(w.find('.mk-card__meta').text()).toContain('行列表仅含最近 30 条');
    expect(w.find('.mk-card__meta').text()).not.toContain('个会话');
    // 组头读 adminCounts（非窗口行数）
    expect(w.find('.ss-group__count').text()).toContain('100 个会话');
    expect(w.find('.ss-group__count').text()).toContain('93 个活跃');
    // 页码器分母 = 行窗口（30），note 标明全量活跃 93——两个数不同源，各自标口径
    // （2026-10-14 文案批：「后端全量活跃」→「全部活跃」，去后端视角）
    expect(pagerText(w)).toContain('共 30 条');
    expect(w.find('.pagination-note').text()).toContain('全部活跃 93 条');
  });

  it('未截断时不出现口径 note（避免同屏复读）', async () => {
    const w = await mountSS(Array.from({ length: 30 }, (_, i) => fakeSession(i + 1)), {
      counts: { total: 30, active: 30, expired: 0, revoked: 0 },
      adminCounts: [{ adminId: 'admin-1', total: 30, active: 30, expired: 0, revoked: 0 }]
    });
    expect(w.find('.pagination-note').exists()).toBe(false);
  });

  it('「下线全部」条数 = 全量活跃 + 未撤销已过期（后端 revoke-all 真实作用域），当前标签页除外', async () => {
    const sessions = Array.from({ length: 12 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions, {
      counts: { total: 505, active: 467, expired: 33, revoked: 5 },
      adminCounts: [{ adminId: 'admin-1', total: 505, active: 467, expired: 33, revoked: 5 }],
      window: { limit: 100, returned: 12 }
    });
    // admin-1 即当前管理员：467 活跃 + 33 过期 - 1 当前标签页 = 499
    const btn = w.findAll('button').find((b) => b.text().includes('下线全部'));
    expect(btn?.text()).toContain('499');
  });

  it('24h 内过期的活跃行给出可读剩余时长（F6-5）', async () => {
    const soon = fakeSession(1);
    soon.expiresAt = new Date(Date.now() + 20 * 3600_000).toISOString();
    const w = await mountSS([soon]);
    const label = w.find('.ss-expiry-soon');
    expect(label.exists()).toBe(true);
    expect(label.text()).toContain('剩 20 小时');
  });

  it('过期时间列 title 含剩余时长（非仅颜色差）', async () => {
    const soon = fakeSession(1);
    soon.expiresAt = new Date(Date.now() + 90 * 60_000).toISOString();
    const w = await mountSS([soon]);
    const cell = w.find('.ss-time--soon');
    expect(cell.attributes('title')).toContain('后过期');
  });

  it('过期/已撤销历史收进折叠组，不计入分页总数', async () => {
    const sessions = [
      fakeSession(1, { revoked: true }),
      fakeSession(2, { expired: true }),
      ...Array.from({ length: 11 }, (_, i) => fakeSession(i + 3))
    ];
    const w = await mountSS(sessions);
    // 13 个会话：2 历史进折叠组，11 活跃；页码器只数活跃行（11，不是 13）
    expect(w.find('.ss-hist').exists()).toBe(true);
    expect(pagerText(w)).toContain('共 11 条');
    // 一页装下 11 活跃 + 2 历史（.ss-tr 同时匹配活跃表行与折叠组内历史表行）
    expect(w.findAll('.ss-tr').length).toBe(13);
  });

  it('第 2 页上，活跃行不在本页但带历史组的卡片给「不在本页」提示而非「无活跃会话」', async () => {
    // admin-1：16 个活跃；admin-2：1 个活跃 + 1 条已撤销历史（历史组必须各页都在）
    const sessions = [
      ...Array.from({ length: 16 }, (_, i) => fakeSession(i + 1)),
      fakeSession(100, { adminId: 'admin-2' }),
      fakeSession(101, { adminId: 'admin-2', revoked: true })
    ];
    const w = await mountSS(sessions);
    // 第 1 页（15 行）：admin-1 占满，admin-2 无行 → 提示指向本页，不谎称「无活跃会话」
    const groups = w.findAll('.ss-group');
    expect(groups.length).toBe(2);
    const auditor = groups[1];
    expect(auditor.find('.ss-group__count').text()).toContain('1 个活跃');
    expect(auditor.find('.ss-tr--empty').text()).toContain('不在本页');
    // 第 2 页：admin-2 的活跃行落位，提示消失
    const next = w.findAll('.mk-pagination__btn').find((b) => b.text() === '下一页')!;
    await next.trigger('click');
    await flushPromises();
    const auditor2 = w.findAll('.ss-group')[1];
    expect(auditor2.find('.ss-tr--empty').exists()).toBe(false);
    expect(auditor2.find('.ss-tr').text()).toContain('#100');
    // 历史折叠组两页都在（翻页不藏历史入口）
    expect(w.find('.ss-hist').exists()).toBe(true);
  });

  /* #8 回归：强制下线单个会话后，卡头全量计数必须重取（不能只改本地行）。
     根因：counts/adminCounts 只在整表加载时赋值，revoke 只改本地 sessions 行 → 计数驻留旧值。 */
  it('强制下线单个会话后卡头计数立即重取（活跃 4 → 3、已撤销 0 → 1）', async () => {
    const base = Array.from({ length: 4 }, (_, i) => fakeSession(i + 1));
    const after = base.map((s) => (s.id === 'sess-2' ? { ...s, revokedAt: new Date().toISOString() } : s));
    h.getSessions
      .mockResolvedValueOnce({
        data: {
          data: {
            sessions: base,
            counts: { total: 4, active: 4, expired: 0, revoked: 0 },
            adminCounts: [{ adminId: 'admin-1', total: 4, active: 4, expired: 0, revoked: 0 }]
          }
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            sessions: after,
            counts: { total: 4, active: 3, expired: 0, revoked: 1 },
            adminCounts: [{ adminId: 'admin-1', total: 4, active: 3, expired: 0, revoked: 1 }]
          }
        }
      });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
    });
    await router.push('/admin/session-security');
    await router.isReady();
    const w = mount(SessionSecurity, { global: { plugins: [router] } });
    await flushPromises();
    await flushPromises();
    expect(pillCount(w, '活跃')).toBe('4');
    // sess-1 是当前标签页（后端 isCurrent 标记），首枚「强制下线」即 sess-2
    const revokeBtn = w.findAll('button').find((b) => b.text().trim() === '强制下线')!;
    await revokeBtn.trigger('click');
    await flushPromises();
    await flushPromises();
    // pill / 组头读数全部来自重取后的 counts（活跃 3、已撤销 1）
    expect(pillCount(w, '活跃')).toBe('3');
    expect(pillCount(w, '已撤销')).toBe('1');
    expect(w.find('.ss-group__count').text()).toContain('3 个活跃');
  });
});
