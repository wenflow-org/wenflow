/**
 * 教学组页首统计带（buckets 构成带，2026-10-04 用户拍板统一形态）：
 * - 共享原语 MkBuckets：值大字 + 份额条 + 口径脚注，直接落页面无卡壳（判例 = 目标对话四桶）
 * - 教学会话：贴表分布条 MkDistBand（2026-10-04 晚接棒 buckets）——十状态归四组+完结率入副标（窗口口径）；异常快捷筛选迁卡头快捷 chips
 *   （2026-10-04 用户拍板：页头状态条整体退役，异常计数由本带「异常终态」单源承载）
 * - 学习路径：getStats byStatus 全平台口径直出（零值桶如实显示、枚举外归「其它」）
 * - 用户与学习者：KPI 面板常驻（2026-10-05 统一面板设计）；构成带仅「含测试」档三桶互斥构成
 * - 替代形态回归护栏：stageband 分布卡不再出现在教学会话/学习路径页
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import TeachingSessions from '../TeachingSessions.vue';
import OpsContent from '../OpsContent.vue';
import People from '../People.vue';
import { liveUsers, liveUsersTotal } from '../live';
import { filterOptions } from './filter-controls';

const { tsList, pathStats, lcApi, tsApi, apiObject } = vi.hoisted(() => {
  const apiObject = (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    });
  /** 带覆盖的 API 代理：显式覆盖的方法用注入的 mock，其余任意方法回 { data: {} } */
  const proxied = (overrides: Record<string, unknown>): Record<string, unknown> =>
    new Proxy({ ...overrides } as Record<string, unknown>, {
      get: (t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (prop in t) return t[prop];
        return vi.fn(async () => ({ data: {} }));
      }
    });
  const tsList = vi.fn();
  const pathStats = vi.fn();
  return { tsList, pathStats, tsApi: proxied({ list: tsList }), lcApi: proxied({ getStats: pathStats }), apiObject };
});

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminTeachingSessionsApi: tsApi,
  adminUsersApi: apiObject(),
  adminNotificationsApi: apiObject(),
  adminTokenCostApi: apiObject(),
  adminLearningContentApi: lcApi,
  adminMemoryReviewApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminDevtoolsApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true), doneConfirm: vi.fn(), failConfirm: vi.fn() }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function mockRouter(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  });
  const ready = router.push(initialPath).then(() => router.isReady());
  return { router, ready };
}

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

describe('教学组 buckets 构成带（2026-10-04 统一形态）', () => {
  beforeEach(() => {
    tsList.mockReset();
    pathStats.mockReset();
    liveUsers.value = [];
    liveUsersTotal.value = 0;
  });

  it('教学会话：分布带退役（2026-10-17）→ 完结率升 KPI、状态筛选交给维度下拉与 KPI 卡', async () => {
    tsList.mockResolvedValue({
      data: { data: { total: 7, items: [
        { id: 's1', status: 'active', userName: '甲', topic: 'T1' },
        { id: 's2', status: 'initializing', userName: '乙', topic: 'T2' },
        { id: 's3', status: 'completed', userName: '丙', topic: 'T3', wrapup: { status: 'complete' } },
        { id: 's4', status: 'failed', userName: '丁', topic: 'T4' },
        { id: 's5', status: 'timeout', userName: '戊', topic: 'T5' },
        { id: 's6', status: 'discarded', userName: '己', topic: 'T6' },
        { id: 's7', status: 'weird_state', userName: '庚', topic: 'T7' }
      ] } }
    });
    const { router, ready } = mockRouter('/admin/teaching-sessions');
    await ready;
    const w = mount(TeachingSessions, { global: { plugins: [router] } });
    await settle();
    // 构成带与分布带先后退役，buckets / mk-distband 都不再出现
    expect(w.find('.buckets').exists()).toBe(false);
    expect(w.find('.ts-distband').exists()).toBe(false);
    expect(w.find('.mk-distband').exists()).toBe(false);
    // 完结率从带副文升 KPI：1/7 → 14%（四舍五入，不再有 14.29% 的假精度）
    // 2026-10-27：异常升为 KPI 卡（读数 + 入口），卡头常驻 chip 组退役
    const kpis = w.findAll('.mk-kpi');
    expect(kpis.map((t) => t.find('.mk-kpi__label').text().trim())).toEqual(['需关注', '异常', '缺总结', '有建议', '完结率']);
    const rate = kpis.find((c) => c.find('.mk-kpi__label').text() === '完结率')!;
    expect(rate.find('.mk-kpi__num').text()).toBe('14%');
    // 异常 = 失败 + 超时 = 2，点 KPI 卡即筛
    expect(w.find('.mk-status').exists(), '本页状态条已退役').toBe(false);
    const abnormalCard = kpis.find((c) => c.find('.mk-kpi__label').text().trim() === '异常')!;
    expect(abnormalCard.find('.mk-kpi__num').text()).toBe('2');
    await abnormalCard.trigger('click');
    await settle();
    expect(w.findAll('tbody tr').length).toBe(2);
    expect(w.find('.mk-card__head .mk-pills').exists()).toBe(false);
    w.unmount();
  });

  it('学习路径：状态筛选在卡头 pills（2026-10-17 分布带退役）——byStatus 全平台口径，零值档如实显示、枚举外归「其它」', async () => {
    pathStats.mockResolvedValue({
      data: { data: { total: 10, totalMilestones: 3, totalTasks: 5, byStatus: { active: 4, completed: 3, failed: 2, archived: 0, custom_state: 1 } } }
    });
    const { router, ready } = mockRouter('/admin/learning-paths');
    await ready;
    const w = mount(OpsContent, { global: { plugins: [router] } });
    await settle();
    // 构成带与分布带先后退役，buckets / mk-distband 都不再出现
    expect(w.find('.buckets').exists()).toBe(false);
    expect(w.find('.mk-distband').exists()).toBe(false);
    // pills 恒显全部档位（含零值「已下线 0」），枚举外 custom_state 归「其它」；「全部」不显数
    const opts = filterOptions(w as never, '状态');
    expect(opts).toEqual(['全部状态', '学习中（4）', '已完成（3）', '生成失败（2）', '已下线（0）', '其它（1）']);
    w.unmount();
  });

  it('用户账号：无构成带，计数住筛选 pill（全部 / 管理员 / 普通用户 / 活跃 / 新增 / 从未登录）', async () => {
    const { router, ready } = mockRouter('/admin/people');
    await ready;
    const w = mount(People, { global: { plugins: [router] } });
    await settle();
    // 空数据不出构成带
    expect(w.find('.buckets').exists()).toBe(false);
    /* 2026-10-21 拍板「没有测试，测试只是备注」：列表 = 全部非虚拟账号，
       测试账号照常计入计数；虚拟学习者由后端排除，不进本页。 */
    liveUsers.value = [
      { id: 'u1', name: '管理员', email: 'a@x.com', isAdmin: true, isVirtualLearner: false, isTestAccount: false, xp: 0, currentLevel: 'L1', lastLoginAt: null, createdAt: '2026-10-01T00:00:00Z', paths: 0, sessions: 0 },
      { id: 'u2', name: '真实用户', email: 'b@x.com', isAdmin: false, isVirtualLearner: false, isTestAccount: false, xp: 10, currentLevel: 'L1', lastLoginAt: new Date().toISOString(), createdAt: '2026-10-01T00:00:00Z', paths: 1, sessions: 1 },
      { id: 'u4', name: '测试乙', email: 'vcheck_abc@wenflow.local', isAdmin: false, isVirtualLearner: false, isTestAccount: true, xp: 0, currentLevel: 'L1', lastLoginAt: null, createdAt: '2026-10-01T00:00:00Z', paths: 0, sessions: 0 }
    ];
    liveUsersTotal.value = 3;
    await nextTick();
    // KPI 带已退役：计数住在筛选 pill 上（除「全部」外一律显命中数）
    expect(w.find('.mk-kpi-grid').exists()).toBe(false);
    const opts = filterOptions(w as never, '视图');
    expect(opts).toEqual([
      '全部用户', '管理员（1）', '普通用户（2）', '近 7 天活跃（1）', '近 7 日新增（0）', '从未登录（2）', '已删除'
    ]);
    // 页头不再有口径开关
    expect(w.find('.ds-toggle').exists()).toBe(false);
    w.unmount();
    liveUsers.value = [];
  });
});
