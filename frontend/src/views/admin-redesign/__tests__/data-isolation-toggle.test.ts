/**
 * 数据隔离（A3）前端切换测试：TeachingSessions / GoalConversations / Users 三页
 * - 默认「仅真实」：列表请求带 includeTest=false（不含虚拟/测试行）
 * - 切换「含虚拟·测试」：按 includeTest=true 重拉，虚拟/测试行显式灰标（虚拟 / 测试 徽章）
 * - Users：切换触发 liveSetUsersIncludeTest，虚拟行带「虚拟」灰标
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import TeachingSessions from '../TeachingSessions.vue';
import GoalConversations from '../GoalConversations.vue';
import Users from '../Users.vue';
import { dataSource } from '../store';
import { liveUsers, liveSetUsersIncludeTest } from '../live';

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
    liveSetUsersIncludeTest: vi.fn(async () => {}),
    loadLiveData: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
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

function findBtn(wrapper: ReturnType<typeof mount>, text: string) {
  const b = wrapper.findAll('button').find((x) => x.text() === text);
  if (!b) throw new Error(`button not found: ${text}`);
  return b;
}

function tsItem(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    userId: 'u-' + id,
    userName: '用户' + id,
    email: id + '@example.com',
    topic: '主题 ' + id,
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

function gcItem(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conv-' + id,
    userId: 'user-' + id,
    users: { name: '用户' + id, email: id + '@example.com' },
    status: 'active',
    stage: 'understanding',
    description: '目标摘要 ' + id,
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
  gcStatsMock.mockResolvedValue({
    data: { success: true, data: { total: 1, active: 1, completed: 0, completionRate: '0' } }
  });
  dataSource.value = 'demo';
});

afterEach(() => {
  dataSource.value = 'demo';
  liveUsers.value = [];
});

describe('TeachingSessions 数据隔离切换（A3）', () => {
  it('默认「仅真实」：请求带 includeTest=false，列表不渲染虚拟/测试灰标', async () => {
    tsListMock.mockResolvedValue({
      data: { success: true, data: { items: [tsItem('a')] } }
    });
    dataSource.value = 'live';
    const wrapper = mount(TeachingSessions);
    await flushPromises();
    await nextTick();
    await flushPromises();
    expect(tsListMock).toHaveBeenCalledWith({ limit: 100, includeTest: false });
    expect(wrapper.text()).toContain('仅真实');
    expect(wrapper.find('.mk-badge--virtual').exists()).toBe(false);
    wrapper.unmount();
  });

  it('切换「含虚拟·测试」→ 按 includeTest=true 重拉，虚拟/测试行显式灰标', async () => {
    tsListMock.mockResolvedValue({ data: { success: true, data: { items: [tsItem('a')] } } });
    dataSource.value = 'live';
    const wrapper = mount(TeachingSessions);
    await flushPromises();
    await nextTick();
    await flushPromises();
    tsListMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            tsItem('v', { userName: '虚拟小王', email: 'virtual_1@test.local', isVirtualLearner: true, isTestAccount: true }),
            tsItem('t', { userName: '截图', email: 'shotsnap001@example.com', isTestAccount: true })
          ]
        }
      }
    });
    await findBtn(wrapper, '含虚拟·测试').trigger('click');
    await flushPromises();
    await nextTick();
    expect(tsListMock).toHaveBeenLastCalledWith({ limit: 100, includeTest: true });
    expect(wrapper.text()).toContain('含虚拟/测试');
    const tags = wrapper.findAll('.mk-badge--sm');
    expect(tags).toHaveLength(2);
    expect(tags[0].text()).toBe('虚拟');
    expect(tags[1].text()).toBe('测试');
    wrapper.unmount();
  });
});

describe('GoalConversations 数据隔离切换（A3）', () => {
  it('默认「仅真实」：列表请求带 includeTest=false；切换后带 true 且虚拟行灰标', async () => {
    gcListMock.mockResolvedValue({
      data: { success: true, data: { conversations: [gcItem('1')] } }
    });
    const wrapper = mount(GoalConversations);
    await flushPromises();
    await flushPromises();
    expect(gcListMock).toHaveBeenCalledWith({ limit: 100, includeTest: false });
    expect(wrapper.text()).toContain('仅真实');
    expect(wrapper.find('.mk-badge--virtual').exists()).toBe(false);

    gcListMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            gcItem('1'),
            gcItem('v', {
              users: { name: '虚拟小张', email: 'virtual_2@test.local' },
              isVirtualLearner: true,
              isTestAccount: true
            })
          ]
        }
      }
    });
    await findBtn(wrapper, '含虚拟·测试').trigger('click');
    await flushPromises();
    await nextTick();
    expect(gcListMock).toHaveBeenLastCalledWith({ limit: 100, includeTest: true });
    expect(wrapper.text()).toContain('含虚拟/测试');
    const tag = wrapper.find('.mk-badge--virtual');
    expect(tag.exists()).toBe(true);
    expect(tag.text()).toBe('虚拟');
    wrapper.unmount();
  });
});

describe('Users 数据隔离切换（A3）', () => {
  it('默认「仅真实」：无虚拟灰标；切换后触发 liveSetUsersIncludeTest(true) 且虚拟行带「虚拟」灰标', async () => {
    // 默认口径：后端已排除虚拟/测试账号（仅真实行）
    liveUsers.value = [
      {
        id: 'u1',
        name: '真实用户',
        email: 'real@example.com',
        isAdmin: false,
        isVirtualLearner: false,
        isTestAccount: false,
        xp: 100,
        currentLevel: 'L2',
        lastLoginAt: '2026-08-13T10:00:00',
        createdAt: '2026-07-01T10:00:00',
        paths: 1,
        sessions: 2
      }
    ];
    const wrapper = mount(Users);
    await flushPromises();
    expect(wrapper.find('.mk-badge--virtual').exists()).toBe(false);
    expect(wrapper.text()).toContain('真实 1');

    await findBtn(wrapper, '含虚拟·测试').trigger('click');
    await nextTick();
    expect(liveSetUsersIncludeTest).toHaveBeenCalledWith(true);
    // 切换后全量口径：后端返回虚拟/测试行 → 虚拟行带「虚拟」灰标
    liveUsers.value = [
      ...liveUsers.value,
      {
        id: 'virtual_1',
        name: '虚拟小王',
        email: 'virtual_1@test.local',
        isAdmin: false,
        isVirtualLearner: true,
        isTestAccount: true,
        xp: 0,
        currentLevel: 'L1',
        lastLoginAt: null,
        createdAt: '2026-07-01T10:00:00',
        paths: 1,
        sessions: 2
      }
    ];
    await nextTick();
    expect(wrapper.text()).toContain('测试/虚拟 1');
    const virtualTag = wrapper.find('.mk-badge--virtual');
    expect(virtualTag.exists()).toBe(true);
    expect(virtualTag.text()).toBe('虚拟');
    wrapper.unmount();
  });
});
