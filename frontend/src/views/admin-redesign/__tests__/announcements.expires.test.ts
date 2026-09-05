/**
 * Announcements 过期语义（P2：维护公告过期仍展示）测试：
 * 已过 expiresAt 的 published 公告 → 状态徽章「已过期」灰显、不占「生效中」计数；
 * 未过期 / 无过期时间的 published → 「生效中」
 * （后端 /active 已按 expiresAt 过滤，此处覆盖管理端列表展示语义）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Announcements from '../Announcements.vue';
import { liveAnnouncements, type LiveAnnouncement } from '../live';

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveAnnouncements: ref<Record<string, unknown>[]>([]),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    liveCreateAnnouncement: vi.fn(async () => {}),
    liveUpdateAnnouncement: vi.fn(async () => {}),
    livePublishAnnouncement: vi.fn(async () => {}),
    liveArchiveAnnouncement: vi.fn(async () => {}),
    liveDeleteAnnouncement: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    dataSource: ref('live'),
    isLive: ref(true),
    intent: { quickAction: '' }
  };
});

vi.mock('@/api/adminApi', () => ({
  adminAnnouncementsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminAuditApi: apiObject(),
  adminAgentsApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject()
}));

function makeAnnouncement(id: string, overrides: Partial<LiveAnnouncement> = {}): LiveAnnouncement {
  return {
    id,
    title: `公告 ${id}`,
    body: '正文',
    severity: 'info',
    status: 'published',
    publishedAt: '2026-07-25T02:00:00Z',
    expiresAt: null,
    createdBy: null,
    createdAt: '2026-07-20T02:00:00Z',
    ...overrides
  };
}

async function mountAnnouncements() {
  const w = mount(Announcements);
  await flushPromises();
  return w;
}

describe('Announcements 过期语义（expiresAt）', () => {
  beforeEach(() => {
    liveAnnouncements.value = [];
  });

  it('已过期的 published 公告 → 「已过期」灰徽章，不占生效中计数', async () => {
    liveAnnouncements.value = [
      makeAnnouncement('a1', { expiresAt: '2026-07-30T00:00:00Z' }),
      makeAnnouncement('a2', { expiresAt: null })
    ];
    const w = await mountAnnouncements();
    await nextTick();
    const statusTexts = w.findAll('td').map((td) => td.text());
    expect(statusTexts).toContain('已过期');
    expect(statusTexts).toContain('生效中');
    // 状态条：标题固定「公告中心」，生效中只计未过期 1 条
    expect(w.text()).toContain('共 2 条');
    expect(w.text()).toContain('公告中心');
    expect(w.text()).toContain('生效中 1');
    // 过期行徽章为灰（mk-badge--muted），非绿（生效中）
    const badges = w.findAll('tbody tr td:nth-child(3) .mk-badge').map((b) => b.text());
    expect(badges).toContain('已过期');
  });

  it('全部过期 → 标题仍为「公告中心」（状态走 dot 灰点），无生效中计数', async () => {
    liveAnnouncements.value = [
      makeAnnouncement('a1', { expiresAt: '2026-07-30T00:00:00Z' }),
      makeAnnouncement('a2', { expiresAt: '2026-08-01T00:00:00Z' })
    ];
    const w = await mountAnnouncements();
    await nextTick();
    expect(w.text()).toContain('公告中心');
    expect(w.text()).toContain('生效中 0');
    expect(w.find('.mk-status.mk-status--muted').exists()).toBe(true);
  });

  it('不过期（expiresAt 空）的 published → 永久生效中', async () => {
    liveAnnouncements.value = [makeAnnouncement('a1', { expiresAt: null })];
    const w = await mountAnnouncements();
    await nextTick();
    expect(w.text()).toContain('生效中');
    expect(w.text()).toContain('公告中心');
    expect(w.text()).toContain('生效中 1');
    expect(w.text()).not.toContain('已过期');
  });
});
