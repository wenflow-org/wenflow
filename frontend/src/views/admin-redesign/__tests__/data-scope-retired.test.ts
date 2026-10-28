/**
 * 口径开关退役回归（2026-10-21 用户拍板「没有测试，测试只是备注」）：
 * - 教学组六页不再渲染「真实 / 测试」视角开关（DataScopeToggle 已删除）；
 * - 列表请求不再携带 includeTest / testOnly / qaOnly（后端默认 = 全部非虚拟账号）；
 * - 账号页把测试/审计账号当普通账号列出，行内一枚「测试」备注即可，虚拟账号不在此列。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import TeachingSessions from '../TeachingSessions.vue';
import GoalConversations from '../GoalConversations.vue';
import Users from '../Users.vue';
import { dataSource } from '../store';
import { liveUsers, clearPageCache } from '../live';

const mockRouter = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });

const { tsListMock, gcListMock, gcStatsMock } = vi.hoisted(() => ({
  tsListMock: vi.fn(),
  gcListMock: vi.fn(),
  gcStatsMock: vi.fn()
}));

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    dataSource: ref('demo'),
    isLive: ref(true),
    openSession: vi.fn(),
    openSubPage: vi.fn(),
    intent: {
      agentFilter: '',
      statusFilter: '',
      traceId: '',
      errorCategory: '',
      timeRange: '',
      scene: '',
      quickAction: ''
    }
  };
});

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
    refreshLiveUsers: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
    isPageCacheFresh: () => false,
    markPageFetched: vi.fn(),
    clearPageCache: vi.fn(),
    // 顶栏刷新广播（TeachingSessions / GoalConversations 均 watch 它）
    liveRefreshSeq: ref(0)
  };
});

vi.mock('@/api/adminApi', () => ({
  adminTeachingSessionsApi: { list: tsListMock },
  adminGoalConversationsApi: {
    list: gcListMock,
    getStats: gcStatsMock,
    getDetail: vi.fn(async () => ({ data: {} })),
    regeneratePath: vi.fn(async () => ({ data: {} })),
    remove: vi.fn(async () => ({ data: {} }))
  },
  adminUsersApi: {
    getUsers: vi.fn(async () => ({ data: {} })),
    getUser: vi.fn(async () => ({ data: {} })),
    createUser: vi.fn(async () => ({ data: {} })),
    deleteUser: vi.fn(async () => ({ data: {} })),
    updateUser: vi.fn(async () => ({ data: {} })),
    updateUserRole: vi.fn(async () => ({ data: {} })),
    batchDeleteUsers: vi.fn(async () => ({ data: {} })),
    getProjectionGrant: vi.fn(async () => ({ data: {} })),
    createProjectionTokenFromGrant: vi.fn(async () => ({ data: {} }))
  },
  getDeletedUsers: vi.fn(async () => ({ data: { data: { users: [] } } })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

function tsRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    userId: 'u1',
    userName: '学习者',
    email: 'u1@example.com',
    topic: '主题',
    subject: '学科',
    taskType: 'practice',
    status: 'active',
    duration: 600,
    messageCount: 4,
    knowledgePointCount: 2,
    startTime: '2026-08-12T02:00:00.000Z',
    wrapup: null,
    advisory: null,
    progress: null,
    isVirtualLearner: false,
    isTestAccount: false,
    ...over
  };
}

function gcRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conv-1',
    userId: 'user-1',
    users: { name: '用户一', email: 'u1@example.com' },
    status: 'active',
    stage: 'understanding',
    description: '目标摘要',
    collectedData: '{}',
    learningPathId: null,
    createdAt: '2026-08-01T10:00:00',
    updatedAt: '2026-08-10T10:00:00',
    completedAt: null,
    isVirtualLearner: false,
    isTestAccount: false,
    ...over
  };
}

beforeEach(() => {
  tsListMock.mockReset();
  gcListMock.mockReset();
  gcStatsMock.mockReset();
  gcStatsMock.mockResolvedValue({ data: { success: true, data: { total: 1, active: 1, completed: 0, completionRate: '0' } } });
  dataSource.value = 'live';
  clearPageCache();
});

describe('教学组：口径开关已退役', () => {
  it('教学会话：请求不带任何视角参数，页头无 真实/测试 开关', async () => {
    tsListMock.mockResolvedValue({ data: { success: true, data: { items: [tsRow()] } } });
    const w = mount(TeachingSessions, { global: { plugins: [mockRouter()] } });
    await flushPromises();
    await nextTick();
    await flushPromises();
    expect(tsListMock).toHaveBeenCalledWith({ limit: 1000 });
    expect(w.find('.ds-toggle').exists()).toBe(false);
    w.unmount();
  });

  it('目标对话：请求与统计都不带视角参数，页头无开关', async () => {
    gcListMock.mockResolvedValue({ data: { success: true, data: { conversations: [gcRow()] } } });
    const w = mount(GoalConversations, { global: { plugins: [mockRouter()] } });
    await flushPromises();
    await flushPromises();
    expect(gcListMock).toHaveBeenCalledWith({ limit: 1000 });
    expect(gcStatsMock).toHaveBeenCalledWith();
    expect(w.find('.ds-toggle').exists()).toBe(false);
    w.unmount();
  });

  it('账号页：测试账号照常列出，行内一枚「测试」备注；不挂虚拟徽章', async () => {
    liveUsers.value = [
      {
        id: 'u1', name: '普通用户', email: 'real@example.com', isAdmin: false,
        isVirtualLearner: false, isTestAccount: false, xp: 100, currentLevel: 'L2',
        lastLoginAt: '2026-08-13T10:00:00', createdAt: '2026-07-01T10:00:00', paths: 1, sessions: 2
      },
      {
        id: 'u2', name: '走查账号甲', email: 'vcheck_abc@wenflow.local', isAdmin: false,
        isVirtualLearner: false, isTestAccount: true, xp: 0, currentLevel: 'L1',
        lastLoginAt: null, createdAt: '2026-07-01T10:00:00', paths: 0, sessions: 0
      }
    ] as unknown as typeof liveUsers.value;
    const w = mount(Users);
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain('走查账号甲');
    expect(w.text()).toContain('测试');
    expect(w.find('.mk-badge--virtual').exists()).toBe(false);
    // 状态条不再分「真实 / 测试账号」两枚读数
    expect(w.text()).not.toContain('测试账号 ');
    w.unmount();
  });
});
