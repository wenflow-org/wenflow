/**
 * GoalConversations 客户端分页（P2：76 行单页直排 → mk-pagination 统一分页器）测试：
 * 总数/页码展示 / 首屏 15 行 / 翻页整页切片 / 筛选回第 1 页
 * （mock '@/api/adminApi'，list 返回 40 行客户端全量数据）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import GoalConversations from '../GoalConversations.vue';

const mockRouter = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });

const { listMock, statsMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  statsMock: vi.fn()
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

vi.mock('../store', async () => {
  const { ref, reactive } = await import('vue');
  return {
    isLive: ref(true),
    dataSource: ref('live'),
    intent: reactive({ scene: 'goal-conversations', statusFilter: '', agentFilter: '', traceId: '', quickAction: '' }),
    openSession: vi.fn(),
    openSubPage: vi.fn()
  };
});

vi.mock('@/api/adminApi', () => ({
  adminGoalConversationsApi: { list: listMock, getStats: statsMock, getDetail: vi.fn(async () => ({ data: {} })), regeneratePath: vi.fn(async () => ({ data: {} })), remove: vi.fn(async () => ({ data: {} })) },
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
  adminRuntimeDefinitionsApi: apiObject()
}));

function makeConv(i: number) {
  return {
    id: `conv-${i}`,
    userId: `user-${i}`,
    users: { name: `用户${i}`, email: `user${i}@example.com` },
    status: 'active',
    stage: 'understanding',
    description: `目标摘要 ${i}`,
    collectedData: '{}',
    learningPathId: i % 2 === 0 ? `path-${i}` : null,
    createdAt: '2026-08-01T10:00:00',
    updatedAt: '2026-08-10T10:00:00',
    completedAt: null
  };
}

function findBtn(wrapper: ReturnType<typeof mount>, text: string) {
  const b = wrapper.findAll('button').find((x) => x.text() === text);
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

async function mountGoals() {
  const w = mount(GoalConversations, { global: { plugins: [mockRouter()] } });
  await flushPromises();
  await flushPromises();
  return w;
}

describe('GoalConversations 客户端分页（mk-pagination）', () => {
  beforeEach(() => {
    listMock.mockReset();
    statsMock.mockReset();
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: Array.from({ length: 40 }, (_, i) => makeConv(i + 1))
        }
      }
    });
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 40, active: 40, completed: 0, completionRate: '0' } }
    });
  });

  it('40 行 → 总数「共 40 条」+ 第 1 / 3 页 + 首屏 15 行', async () => {
    const w = await mountGoals();
    await nextTick();
    expect(w.text()).toContain('共 40 条');
    expect(w.text()).toContain('第 1 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(15);
    expect(w.text()).toContain('用户1');
    expect(w.text()).not.toContain('用户16');
  });

  it('翻页：第 2 页整页切片（第 16-30 行）', async () => {
    const w = await mountGoals();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 2 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(15);
    expect(w.text()).toContain('用户16');
    // 第 1 页行（用户1-15）不残留：邮箱唯一可精确判定
    expect(w.text()).not.toContain('user1@example.com');
    expect(w.text()).not.toContain('user15@example.com');
  });

  it('末页：第 3 页只含剩余 10 行（40 = 15×2 + 10）', async () => {
    const w = await mountGoals();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 3 / 3 页');
    expect(w.findAll('tbody tr')).toHaveLength(10);
    expect(w.text()).toContain('用户31');
  });

  it('状态筛选：结果缩到 1 页且页码回 1（76 行场景的筛选语义）', async () => {
    // 40 行中 5 行已取消：筛选「已取消」→ 5 行单页，页码从第 2 页回 1
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            ...Array.from({ length: 35 }, (_, i) => makeConv(i + 1)),
            ...Array.from({ length: 5 }, (_, i) => ({
              ...makeConv(36 + i),
              status: 'cancelled',
              stage: 'cancelled'
            }))
          ]
        }
      }
    });
    const w = await mountGoals();
    await findBtn(w, '下一页').trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 2 / 3 页');
    await w.findAll('.mk-pill').find((x) => x.text() === '已取消')!.trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 1 / 1 页');
    expect(w.findAll('tbody tr')).toHaveLength(5);
  });
});
