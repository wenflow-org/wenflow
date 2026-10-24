/**
 * 成就子页签可寻址（2026-10-24）：宿主占 ?tab=，子视图用 ?sub=defs|records。
 * 覆盖：深链直达解锁记录（含首屏取数）、点击写 URL、defs 删键保持地址干净。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import OpsAchievements from '../OpsAchievements.vue';

const h = vi.hoisted(() => ({
  getRecords: vi.fn(),
  getDefinitions: vi.fn()
}));

const { apiObject } = vi.hoisted(() => ({
  apiObject: (custom?: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(custom || ({} as Record<string, unknown>), {
      get: (_target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
        return vi.fn(async () => ({ data: { data: {} } }));
      }
    })
}));

vi.mock('@/api/adminApi', () => ({
  adminAchievementsApi: apiObject({ getRecords: h.getRecords, getDefinitions: h.getDefinitions }),
  adminUsersApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminAuditApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminNotificationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminPromptOpsApi: apiObject()
}));

vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => false), doneConfirm: vi.fn(), failConfirm: vi.fn() }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const EmptyRoute = { template: '<div />' };

async function mountAt(query: Record<string, string>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/ops-hub', component: EmptyRoute }]
  });
  await router.push({ path: '/admin/ops-hub', query });
  await router.isReady();
  const w = mount(OpsAchievements, {
    props: { embedded: true },
    global: { plugins: [router] }
  });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return { w, router };
}

function tabEl(w: Awaited<ReturnType<typeof mountAt>>['w'], text: string) {
  const el = w.findAll('button[role="tab"]').find((b) => b.text() === text);
  if (!el) throw new Error(`tab not found: ${text}`);
  return el;
}

describe('OpsAchievements 子页签 URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getDefinitions.mockResolvedValue({
      data: { data: [{ id: 'a1', name: '首次完成', type: 'milestone', description: '', requirement: { type: 'sessions', value: 1 }, xpReward: 10, unlockCount: 3 }] }
    });
    h.getRecords.mockResolvedValue({
      data: { data: { records: [], pagination: { total: 0, page: 1, limit: 20 } } }
    });
  });

  it('?sub=records 直达解锁记录并首屏取数', async () => {
    const { w } = await mountAt({ tab: 'achievements', sub: 'records' });
    expect(tabEl(w, '解锁记录').attributes('aria-selected')).toBe('true');
    expect(tabEl(w, '成就定义').attributes('aria-selected')).toBe('false');
    expect(h.getRecords).toHaveBeenCalledTimes(1);
    expect(h.getDefinitions).toHaveBeenCalledTimes(1);
  });

  it('不带 sub 落成就定义，且不请求记录', async () => {
    const { w } = await mountAt({ tab: 'achievements' });
    expect(tabEl(w, '成就定义').attributes('aria-selected')).toBe('true');
    expect(h.getRecords).not.toHaveBeenCalled();
  });

  it('点击页签写 URL；回到定义时删掉 sub 键', async () => {
    const { w, router } = await mountAt({ tab: 'achievements' });
    await tabEl(w, '解锁记录').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.sub).toBe('records');
    await tabEl(w, '成就定义').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.sub).toBeUndefined();
    expect(router.currentRoute.value.query.tab).toBe('achievements');
  });
});
