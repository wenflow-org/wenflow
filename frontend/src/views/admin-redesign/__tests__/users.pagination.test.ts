/**
 * Users 客户端分页（P2：37 行单页直排 → mk-pagination 统一分页器）测试：
 * 总数/页码展示 / 首屏 15 行 / 翻页整页切片 / 每页条数变更 / 筛选回第 1 页
 * （mock './live' 与 './store'，liveUsers 提供 37 行客户端全量数据）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Users from '../Users.vue';
import { liveUsers } from '../live';

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

function makeUser(i: number) {
  return {
    id: `u${i}`,
    name: `用户${i}`,
    email: `user${i}@example.com`,
    isAdmin: i === 1,
    lastLoginAt: '2026-08-13T10:00:00',
    createdAt: '2026-07-01T10:00:00',
    paths: 1,
    sessions: 2,
    xp: 100,
    currentLevel: 'L2'
  };
}

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveUsers: ref([]),
    liveUsersTotal: ref(0),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    registrationEnabled: ref<boolean | null>(null),
    liveCreateUser: vi.fn(async () => {}),
    liveDeleteUser: vi.fn(async () => {}),
    liveSetUserRole: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    isLive: ref(true),
    intent: { agentFilter: '', statusFilter: '', quickAction: '' },
    openSubPage: vi.fn()
  };
});

vi.mock('@/api/adminApi', () => ({
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
  adminAnnouncementsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  getDeletedUsers: vi.fn(async () => ({ data: { data: { users: [] } } })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

function findBtn(wrapper: ReturnType<typeof mount>, text: string) {
  const b = wrapper.findAll('button').find((x) => x.text() === text);
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

async function mountUsers() {
  const w = mount(Users);
  await flushPromises();
  return w;
}

describe('Users 客户端分页（mk-pagination）', () => {
  beforeEach(() => {
    liveUsers.value = Array.from({ length: 37 }, (_, i) => makeUser(i + 1));
  });

  it('37 行 → 总数展示「共 37 条」+ 第 1 / 3 页 + 首屏 15 行', async () => {
    const w = await mountUsers();
    await nextTick();
    expect(w.text()).toContain('共 37 条');
    expect(w.text()).toContain('第 1 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(15);
    expect(w.text()).toContain('用户1');
    expect(w.text()).not.toContain('用户16');
  });

  it('翻页：第 2 页整页切片（第 16-30 行，无第 1 页残留）', async () => {
    const w = await mountUsers();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 2 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(15);
    const rows = w.findAll('tbody tr');
    expect(rows[0].text()).toContain('用户16');
    // 第 1 页行（用户1-15）不残留：邮箱唯一可精确判定
    expect(w.text()).not.toContain('user1@example.com');
    expect(w.text()).not.toContain('user15@example.com');
    expect(w.text()).not.toContain('用户31');
  });

  it('末页：第 3 页只含剩余 7 行（37 = 15×2 + 7）', async () => {
    const w = await mountUsers();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 3 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(7);
    expect(w.text()).toContain('用户31');
  });

  it('每页条数 50 → 单页展示全部 37 行', async () => {
    const w = await mountUsers();
    await w.find('.mk-pagination__size').setValue('50');
    await nextTick();
    expect(w.text()).toContain('第 1 / 1 页');
    expect(w.findAll('tbody tr')).toHaveLength(37);
  });

  it('关键词筛选：结果缩到 1 页且页码回 1', async () => {
    const w = await mountUsers();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 2 / 3 页');
    await w.find<HTMLInputElement>('.mk-filter__input').setValue('用户36');
    await nextTick();
    expect(w.text()).toContain('第 1 / 1 页');
    expect(w.findAll('tbody tr')).toHaveLength(1);
    expect(w.text()).toContain('用户36');
  });
});
