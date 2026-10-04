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
import { openSubPage } from '../store';

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

function makeConv(i: number, overrides: Record<string, unknown> = {}) {
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
    completedAt: null,
    ...overrides
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
    await w.findAll('.mk-pill').find((x) => x.text().startsWith('已取消'))!.trigger('click');
    await nextTick();
    expect(w.text()).toContain('第 1 / 1 页');
    expect(w.findAll('tbody tr')).toHaveLength(5);
  });
});

describe('GoalConversations 状态桶口径 / 停滞信号 / 行点击语义（P1#5、P1#6、2026-10-02 对齐）', () => {
  beforeEach(() => {
    listMock.mockReset();
    statsMock.mockReset();
    listMock.mockResolvedValue({
      data: { success: true, data: { conversations: Array.from({ length: 5 }, (_, i) => makeConv(i + 1)) } }
    });
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 5, active: 5, completed: 0, completionRate: '0' } }
    });
  });

  it('P1#5「已取消」桶 = 取消/中断/回收合计；pill 同口径——非 active 且非 completed 全收（cancelled/failed/abandoned）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv(1, { status: 'cancelled' }),
            makeConv(2, { status: 'abandoned' }),
            makeConv(3, { status: 'failed' }),
            makeConv(4, { status: 'completed' }),
            makeConv(5, { status: 'active' })
          ]
        }
      }
    });
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 5, active: 1, completed: 1, completionRate: '20' } }
    });
    const w = await mountGoals();
    // 桶值 = 5 − 1 − 1 = 3；foot 披露「取消 / 中断 / 回收合计」口径（不再是「用户取消或中断」）
    expect(w.text()).toContain('取消 / 中断 / 回收合计');
    expect(w.text()).not.toContain('用户取消或中断');
    const cancelPill = w.findAll('.mk-pill').find((x) => x.text() === '已取消')!;
    expect(cancelPill.attributes('title')).toContain('同口径');
    await cancelPill.trigger('click');
    await nextTick();
    const rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(w.text()).toContain('用户1'); // cancelled
    expect(w.text()).toContain('用户2'); // abandoned
    expect(w.text()).toContain('用户3'); // failed
    expect(w.text()).not.toContain('用户4'); // completed 不入桶
    expect(w.text()).not.toContain('用户5'); // active 不入桶
  });

  it('P1#6 停滞信号：窗口内 active 且 updatedAt 超 7 天 → 「进行中」桶 foot 出现「其中 N 条超 7 天未更新」+ 口径 title', async () => {
    const fresh = new Date(Date.now() - 86400000).toISOString();
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv(1, { status: 'active', updatedAt: '2020-01-01T00:00:00Z' }),
            makeConv(2, { status: 'active', updatedAt: fresh })
          ]
        }
      }
    });
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 2, active: 2, completed: 0, completionRate: '0' } }
    });
    const w = await mountGoals();
    expect(w.text()).toContain('其中 1 条超 7 天未更新');
    const stalledFoot = w.findAll('.bucket__foot').find((el) => el.text().includes('超 7 天未更新'))!;
    expect(stalledFoot).toBeTruthy();
    expect(stalledFoot.attributes('title')).toContain('按最近 1000 条');
    expect(stalledFoot.attributes('title')).toContain('非全量');
  });

  it('P1#6 stats 拉取失败 → 桶位显示「统计获取失败 · 重试」，不再整组静默消失', async () => {
    statsMock.mockRejectedValue(new Error('stats boom'));
    const w = await mountGoals();
    const buckets = w.find('.buckets');
    expect(buckets.exists()).toBe(true);
    expect(buckets.text()).toContain('统计获取失败');
    const retry = buckets.findAll('button').find((b) => b.text() === '重试');
    expect(retry).toBeTruthy();
    // 重试后 stats 恢复 → 错误桶消失、正常桶组回来
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 5, active: 5, completed: 0, completionRate: '0' } }
    });
    await retry!.trigger('click');
    await flushPromises();
    await flushPromises();
    expect(w.find('.buckets').text()).not.toContain('统计获取失败');
    expect(w.find('.buckets').text()).toContain('进行中');
  });

  it('行点击进座舱（与 TeachingSessions 语义对齐）：openSubPage session-real；操作列按钮改名「详情」，不再叫「控制台」', async () => {
    const w = await mountGoals();
    await w.find('tbody tr').trigger('click');
    expect(vi.mocked(openSubPage)).toHaveBeenCalledWith('session-real', 'conv-1');
    expect(w.findAll('button').some((b) => b.text() === '详情')).toBe(true);
    expect(w.findAll('button').some((b) => b.text() === '控制台')).toBe(false);
  });

  it('页头副题随 includeTest 切换如实：默认「仅真实用户口径」，切「含测试」后改为含虚拟与测试账号（2026-10-04 批次五族语统一，原「含模拟」）', async () => {
    const w = await mountGoals();
    expect(w.text()).toContain('仅真实用户口径');
    // .ds-toggle 是 DataScopeToggle 的稳定测试钩子（见组件注释）
    const toggle = w.find('.ds-toggle');
    expect(toggle.exists()).toBe(true);
    await toggle.findAll('button')[1].trigger('click'); // 含测试
    await nextTick();
    expect(w.text()).toContain('含虚拟学习者与测试账号');
    expect(w.text()).not.toContain('仅真实用户口径');
  });
});
