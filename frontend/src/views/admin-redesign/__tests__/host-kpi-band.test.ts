/**
 * 页头 KPI 区形态契约（2026-09-28 立，2026-10-01/02 收紧）
 *
 * 契约：**页面统计带服从原型该页自己的形态，同屏只许一带、数字不重复**——
 * - People / 教学会话：原型无 KPI 板块，页头 KPI 带退役（计数住状态条 meta 或 pills）
 * - 目标对话：唯一统计带 = 原型 renderGoals 的 buckets 四桶（kpi 栅格 + 构成卡双带已撤）
 * - 记忆与复习：保留 .mk-kpi-grid（页级绝对值只住 KPI 卡）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import People from '../People.vue';
import GoalConversations from '../GoalConversations.vue';
import MemoryReview from '../MemoryReview.vue';
import TeachingSessions from '../TeachingSessions.vue';

const overview = vi.hoisted(() => vi.fn());
const detail = vi.hoisted(() => vi.fn());
const recompute = vi.hoisted(() => vi.fn());
const applyMerge = vi.hoisted(() => vi.fn());
const rollback = vi.hoisted(() => vi.fn());

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
  adminUsersApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminNotificationsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminLearningContentApi: apiObject(),
  adminSystemApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} })),
  adminMemoryReviewApi: { overview, detail, recompute, apply: applyMerge, rollback }
}));
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn() }));
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

/** KPI 卡标签（顺序即视觉顺序） */
function kpiLabels(w: ReturnType<typeof mount>): string[] {
  return w.findAll('.mk-kpi-grid .mk-kpi__label').map((el) => el.text().trim());
}

describe('页头 KPI 区（教学三页统一形态）', () => {
  beforeEach(() => {
    overview.mockResolvedValue({ data: { data: {} } });
    detail.mockResolvedValue({ data: { data: {} } });
  });

  it('People：页头 KPI 带已退役（2026-10-01 用户拍板：原型无此板块），页头=单视图「用户与学习者」', async () => {
    const { router, ready } = mockRouter('/admin/people');
    await ready;
    const w = mount(People, { global: { plugins: [router] } });
    await settle();
    // 反向断言：不再渲染任何 KPI 卡
    expect(kpiLabels(w)).toEqual([]);
    expect(w.find('.mk-kpi-grid').exists()).toBe(false);
    // 页头 = 原型 pageTitle 形态：页名 + 副题（2026-10-04 学习状态拆页后副题固定为账号管理口径）
    expect(w.find('.mk-pagehead').exists()).toBe(true);
    expect(w.find('.mk-pagehead').text()).toContain('管理用户账号、角色与登录状态');
    expect(w.find('.mk-pagehead').text()).not.toContain('学习状态分布');
    w.unmount();
  });

  it('目标对话独立页：统计带 = 原型 buckets 四桶单带（kpi 栅格已撤），pills 不带计数', async () => {
    const { router, ready } = mockRouter('/admin/goal-conversations');
    await ready;
    const w = mount(GoalConversations, { global: { plugins: [router] } });
    await settle();
    // 反向断言：KPI 栅格不再渲染（2026-10-02 用户拍板撤双带：kpi 栅格 + 构成卡复读同批数字）
    expect(kpiLabels(w)).toEqual([]);
    expect(w.find('.mk-kpi-grid').exists()).toBe(false);
    expect(w.find('.mk-card .buckets').exists()).toBe(false);
    // buckets 是页面级统计带（原型直接落页面，无卡壳）；mock 空数据（stats 未回填且无失败）下整组隐藏
    // （stats 拉取失败的三态「统计获取失败 · 重试」在 goal-conversations.pagination.test.ts 覆盖）
    expect(w.find('.buckets').exists()).toBe(false);
    // 2026-09-29 拆回独立页：学习会话合并宿主的视图切换 pills 不应再出现
    expect(w.find('.gc-tabs').exists()).toBe(false);
    w.unmount();
  });

  it('教学会话独立页：页头 KPI 带已退役（2026-10-02），统计带 = 构成带唯一一处（2026-10-04 状态条退役）', async () => {
    const { router, ready } = mockRouter('/admin/teaching-sessions');
    await ready;
    const w = mount(TeachingSessions, { global: { plugins: [router] } });
    await settle();
    expect(kpiLabels(w)).toEqual([]);
    expect(w.find('.mk-kpi-grid').exists()).toBe(false);
    // 2026-10-04 用户拍板：页头状态条整体退役——需关注 / 缺总结与焦点 chips 同源同数、
    // 异常与构成带「异常终态」同源同数（同一数字不两处渲染）；总数与窗口截断口径并进卡头 meta
    expect(w.find('.mk-status').exists(), '本页状态条已退役').toBe(false);
    const meta = w.find('.mk-card__meta');
    expect(meta.text()).toContain('0 / 0 条');
    // 本用例 0 行未触上限：不出现截断口径（触限时 meta 追加「共 N，仅显示最近 1000 条」）
    expect(meta.text()).not.toContain('条窗口');
    // P1#4 兜底诚实化：后端未回 total（mock 空响应）时，meta title 不得声称全量
    expect(meta.attributes('title')).toContain('非全量');
    expect(meta.attributes('title')).not.toContain('全量口径');
    // 计数各自唯一：待关注 / 缺总结住焦点 chips（「全部」不显数 = meta 的已加载行数），
    // 有建议住右组；0 行时异常 chip 不出现
    expect(w.findAll('.mk-card__head .mk-pills[aria-label="焦点筛选"] .mk-pill').map((c) => c.text().replace(/\d+$/, ''))).toEqual([
      '全部', '进行中', '待关注', '缺总结'
    ]);
    expect(w.findAll('.mk-card__head .mk-pills[aria-label="快捷筛选"] .mk-pill').map((c) => c.text())).toEqual(['有建议0']);
    w.unmount();
  });

  it('MemoryReview：页级绝对值只住 KPI 卡，作用域开关在页头，旧概览带与折叠说明卡都不在', async () => {
    const { router, ready } = mockRouter('/admin/memory-review');
    await ready;
    const w = mount(MemoryReview, { global: { plugins: [router] } });
    await settle();
    expect(kpiLabels(w)).toEqual(['用户', '记忆痕迹', '当前到期', '需人工看', '待归并建议']);
    // 页头为 pagehead 形态（newui/admin），数据范围开关（整组统一 DataScopeToggle，2026-10-04）在页头动作区
    expect(w.find('.mk-pagehead').exists()).toBe(true);
    expect(w.find('.mk-pagehead .ds-toggle').exists()).toBe(true);
    // 旧形态回归护栏：概览带 / 口径与术语折叠卡 / 状态条散文计数
    expect(w.find('.mr-summary').exists()).toBe(false);
    expect(w.find('.mk-section__summary').exists()).toBe(false);
    expect(w.find('.mk-status__meta').exists()).toBe(false);
    w.unmount();
  });
});
