/**
 * SessionSecurity（P3：分页器出视口）回归测试：
 * 活跃会话每批 12 行 + 「加载更多」首屏控件存在（12 行 ≈ 838px，1440×900 视口下分页器首屏可见），
 * 历史会话折叠组不受分页影响。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import SessionSecurity from '../SessionSecurity.vue';

const h = vi.hoisted(() => ({
  getMe: vi.fn(),
  getSessions: vi.fn()
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
  adminSessionsApi: { getAdminSessions: h.getSessions, revokeAdminSession: vi.fn(), revokeAllAdminSessions: vi.fn() },
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
  askConfirm: vi.fn(async () => true)
}));

function fakeSession(i: number, opts: { revoked?: boolean; expired?: boolean } = {}) {
  const now = Date.now();
  return {
    id: `sess-${i}`,
    adminId: 'admin-1',
    jti: `jti-${i}`,
    ip: '::1',
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) #${i}`,
    remember: true,
    issuedAt: new Date(now - 3600_000).toISOString(),
    expiresAt: new Date(opts.expired ? now - 60_000 : now + 86_400_000).toISOString(),
    lastSeenAt: new Date(now - 60_000).toISOString(),
    revokedAt: opts.revoked ? new Date(now - 60_000).toISOString() : null,
    createdAt: new Date(now - 3600_000).toISOString(),
    adminName: 'admin',
    adminEmail: 'admin@wenflow.local'
  };
}

async function mountSS(sessions: unknown[]) {
  h.getSessions.mockResolvedValue({ data: { data: { sessions } } });
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

describe('SessionSecurity 分批渲染（分页器首屏可见）', () => {
  beforeEach(() => {
    h.getMe.mockReset();
    h.getSessions.mockReset();
    h.getMe.mockResolvedValue({ data: { data: { id: 'admin-1' } } });
  });

  it('活跃会话首屏仅渲染每批 12 行', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions);
    const rows = w.findAll('.ss-tr');
    expect(rows.length).toBe(12);
  });

  it('超过 12 行时展示「加载更多」分页控件（首屏可见）', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions);
    const more = w.find('.mk-list-more');
    expect(more.exists()).toBe(true);
    expect(more.text()).toContain('加载更多');
    expect(more.text()).toContain('12 / 30');
  });

  it('加载更多：追加下一批至 24 行', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions);
    await w.find('.mk-list-more button').trigger('click');
    await flushPromises();
    expect(w.findAll('.ss-tr').length).toBe(24);
  });

  it('≤12 行时不展示分页控件（无分页出视口问题）', async () => {
    const sessions = Array.from({ length: 8 }, (_, i) => fakeSession(i + 1));
    const w = await mountSS(sessions);
    expect(w.find('.mk-list-more').exists()).toBe(false);
  });

  it('过期/已撤销历史收进折叠组（不计入活跃分批）', async () => {
    const sessions = [
      fakeSession(1, { revoked: true }),
      fakeSession(2, { expired: true }),
      fakeSession(3),
      fakeSession(4),
      fakeSession(5),
      fakeSession(6),
      fakeSession(7),
      fakeSession(8),
      fakeSession(9),
      fakeSession(10),
      fakeSession(11),
      fakeSession(12),
      fakeSession(13)
    ];
    const w = await mountSS(sessions);
    // 13 个会话：2 历史进折叠组，11 活跃直接展示（无分页控件）；
    // .ss-tr 同时匹配活跃表行与折叠组内历史表行（13 = 11 活跃 + 2 历史）
    expect(w.find('.ss-hist').exists()).toBe(true);
    expect(w.find('.mk-list-more').exists()).toBe(false);
    expect(w.findAll('.ss-tr').length).toBe(13);
  });
});
