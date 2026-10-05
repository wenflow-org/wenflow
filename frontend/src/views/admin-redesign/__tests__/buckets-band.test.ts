/**
 * 教学组页首统计带（buckets 构成带，2026-10-04 用户拍板统一形态）：
 * - 共享原语 MkBuckets：值大字 + 份额条 + 口径脚注，直接落页面无卡壳（判例 = 目标对话四桶）
 * - 教学会话：贴表分布条 MkDistBand（2026-10-04 晚接棒 buckets）——十状态归四组+完结率入副标（窗口口径）；异常快捷筛选迁卡头快捷 chips
 *   （2026-10-04 用户拍板：页头状态条整体退役，异常计数由本带「异常终态」单源承载）
 * - 学习路径：getStats byStatus 全平台口径直出（零值桶如实显示、枚举外归「其它」）
 * - 用户与学习者：真实 / 虚拟 / 测试 三桶互斥构成（管理员作真实桶 foot）
 * - 替代形态回归护栏：stageband 分布卡不再出现在教学会话/学习路径页
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import TeachingSessions from '../TeachingSessions.vue';
import OpsContent from '../OpsContent.vue';
import People from '../People.vue';
import { liveUsers, liveUsersTotal, liveIncludeVirtual } from '../live';

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
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
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

/** 桶标签序列（构成带只此一处计数，顺序即视觉顺序） */
function bucketLabels(w: ReturnType<typeof mount>): string[] {
  return w.findAll('.buckets .bucket .bucket__l').filter((el) => !el.classes().includes('bucket__foot')).map((el) => el.text().trim());
}
function bucketValues(w: ReturnType<typeof mount>): string[] {
  return w.findAll('.buckets .bucket .bucket__v').map((el) => el.text().trim());
}

describe('教学组 buckets 构成带（2026-10-04 统一形态）', () => {
  beforeEach(() => {
    tsList.mockReset();
    pathStats.mockReset();
    liveUsers.value = [];
    liveUsersTotal.value = 0;
  });

  it('教学会话：贴表分布条四组归并+完结率入副标（组内口径在分段悬停披露）；下钻互斥可取消；异常筛选迁卡头快捷 chips', async () => {
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
    // 2026-10-04 晚换装贴表分布条（MkDistBand）：buckets 不再出现；其它段 1 人（枚举外）出现
    expect(w.find('.buckets').exists()).toBe(false);
    expect(w.find('.ts-distband .mk-distband__title').text()).toBe('会话状态分布');
    // 图例恒显全档（含 0 值）：进行中 2（active+initializing）/ 已完成 1 / 异常终态 2 / 已废弃 1 / 其它 1
    const legend = w.findAll('.ts-distband .stageband__legend .sbl');
    expect(legend.map((el) => el.find('.sbl__name').text())).toEqual(['进行中', '已完成', '异常终态', '已废弃', '其它']);
    expect(legend.map((el) => el.find('.sbl__n').text())).toEqual(['2', '1', '2', '1', '1']);
    // 组内合并口径披露 + 完结率随副标（14.29% = 1/7）
    const segTitles = w.findAll('.ts-distband .mk-distband__seg').map((el) => el.attributes('title') || '');
    expect(segTitles.some((t) => t.includes('含初始化 / 暂停 / 收尾中'))).toBe(true);
    expect(segTitles.some((t) => t.includes('失败 / 超时 / 收尾失败合计'))).toBe(true);
    expect(segTitles.some((t) => t.includes('含已被替代'))).toBe(true);
    expect(w.find('.ts-distband .mk-distband__sub').text()).toContain('完结率 14.29%');
    // 下钻：点「已完成」图例 → 只剩丙；再点取消恢复 7 行
    const doneBtn = legend.find((el) => el.find('.sbl__name').text() === '已完成')!;
    await doneBtn.trigger('click');
    await settle();
    expect(w.findAll('tbody tr').map((r) => r.text()).filter((t) => t.includes('丙'))).toHaveLength(1);
    expect(w.findAll('tbody tr').length).toBe(1);
    await doneBtn.trigger('click');
    await settle();
    expect(w.findAll('tbody tr').length).toBe(7);
    // 异常快捷筛选迁卡头快捷 chips（2026-10-04 状态条退役后）：失败+超时 = 2 由本带「异常终态」单源承载，
    // chip 不显计数（同一数字不两处渲染），点击可穿
    expect(w.find('.mk-status').exists(), '本页状态条已退役').toBe(false);
    const abnormalBtn = w.findAll('.mk-card__head .mk-pills[aria-label="快捷筛选"] .mk-pill').find((b) => b.text().startsWith('异常'));
    expect(abnormalBtn?.text()).toBe('异常');
    // 右组另一枚 = 有建议（2026-10-05 计数升 KPI 面板后去计数，学习状态判例）
    expect(w.find('.mk-card__head .mk-pills[aria-label="快捷筛选"] .mk-pill').text()).toBe('有建议');
    w.unmount();
  });

  it('学习路径：贴表分布条（2026-10-04 晚接棒构成带）——byStatus 全平台口径，零值档图例如实显示、枚举外归「其它」', async () => {
    pathStats.mockResolvedValue({
      data: { data: { total: 10, totalMilestones: 3, totalTasks: 5, byStatus: { active: 4, completed: 3, failed: 2, archived: 0, custom_state: 1 } } }
    });
    const { router, ready } = mockRouter('/admin/learning-paths');
    await ready;
    const w = mount(OpsContent, { global: { plugins: [router] } });
    await settle();
    // 构成带退役（教学组统一贴表分布条），buckets 不再出现
    expect(w.find('.buckets').exists()).toBe(false);
    // 图例恒显全部档位（含零值「已下线 0」），段仅非零（custom_state 1 → 其它段出现 = 5 段中 4 段非零）
    const legend = w.findAll('.stageband__legend .sbl');
    expect(legend.map((el) => el.find('.sbl__name').text())).toEqual(['学习中', '已完成', '生成失败', '已下线', '其它']);
    expect(legend.map((el) => el.find('.sbl__n').text())).toEqual(['4', '3', '2', '0', '1']);
    expect(w.findAll('.mk-distband__seg')).toHaveLength(4);
    w.unmount();
  });

  it('用户与学习者：默认「仅真实」单桶 + 披露；含测试后真实 / 虚拟 / 测试三桶互斥构成，管理员作真实桶 foot', async () => {
    const { router, ready } = mockRouter('/admin/people');
    await ready;
    liveIncludeVirtual.value = false;
    const w = mount(People, { global: { plugins: [router] } });
    await settle();
    // 空数据不出空带
    expect(w.find('.buckets').exists()).toBe(false);
    // 播种 live 域（加载后注入，避免 boot 拉取覆盖）
    liveUsers.value = [
      { id: 'u1', name: '管理员', email: 'a@x.com', isAdmin: true, isVirtualLearner: false, isTestAccount: false, xp: 0, currentLevel: 'L1', lastLoginAt: null, createdAt: '2026-10-01T00:00:00Z', paths: 0, sessions: 0 },
      { id: 'u2', name: '真实用户', email: 'b@x.com', isAdmin: false, isVirtualLearner: false, isTestAccount: false, xp: 10, currentLevel: 'L1', lastLoginAt: null, createdAt: '2026-10-01T00:00:00Z', paths: 1, sessions: 1 },
      { id: 'u3', name: '虚拟甲', email: 'v@x.com', isAdmin: false, isVirtualLearner: true, isTestAccount: true, xp: 5, currentLevel: 'L1', lastLoginAt: null, createdAt: '2026-10-01T00:00:00Z', paths: 0, sessions: 0 },
      { id: 'u4', name: '测试乙', email: 't@x.com', isAdmin: false, isVirtualLearner: false, isTestAccount: true, xp: 0, currentLevel: 'L1', lastLoginAt: null, createdAt: '2026-10-01T00:00:00Z', paths: 0, sessions: 0 }
    ];
    liveUsersTotal.value = 4;
    await nextTick();
    // D18：默认「仅真实」口径下虚拟 / 测试结构性为 0，是死档 → 只渲染真实单桶 + 披露未纳入
    expect(bucketLabels(w)).toEqual(['真实用户']);
    expect(bucketValues(w)).toEqual(['2']);
    expect(w.findAll('.bucket__foot').map((f) => f.text()).join(' ')).toContain('虚拟 / 测试账号未纳入');
    w.unmount();

    // 含测试口径 → 三桶互斥构成（管理员数作真实桶 foot；口径悬停给行数与后端总数）
    liveIncludeVirtual.value = true;
    const w2 = mount(People, { global: { plugins: [router] } });
    await settle();
    await nextTick();
    expect(bucketLabels(w2)).toEqual(['真实用户', '虚拟学习者', '测试账号']);
    expect(bucketValues(w2)).toEqual(['2', '1', '1']);
    const feet = w2.findAll('.bucket__foot').map((f) => f.text());
    expect(feet).toContain('其中管理员 1');
    const vt = w2.find('.bucket__v').attributes('title');
    expect(vt).toContain('按已加载 4 行统计');
    expect(vt).toContain('后端共 4');
    w2.unmount();

    liveIncludeVirtual.value = false;
    liveUsers.value = [];
  });
});
