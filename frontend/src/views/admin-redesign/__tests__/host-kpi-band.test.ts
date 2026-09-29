/**
 * 页头 KPI 区统一形态（2026-09-28）
 *
 * 契约：三个教学页的页头都是「状态条 → .mk-kpi-grid（MkKpi 卡）→ [视图 pills] → 内容卡」，
 * 且 KPI 卡不兼做视图切换、不重说卡头筛选 pills 的计数。
 * 这些数字只存在于模板里，改动极易静默丢失（卡片数量/文案没有类型约束），故按视图逐档锁住标签。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import People from '../People.vue';
import GoalConversations from '../GoalConversations.vue';
import MemoryReview from '../MemoryReview.vue';

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

async function clickPill(w: ReturnType<typeof mount>, label: string) {
  const btn = w.findAll('.mk-pill').find((b) => b.text().includes(label));
  expect(btn, `未找到视图切换 pill：${label}`).toBeTruthy();
  await btn!.trigger('click');
  await settle();
}

describe('页头 KPI 区（教学三页统一形态）', () => {
  beforeEach(() => {
    overview.mockResolvedValue({ data: { data: {} } });
    detail.mockResolvedValue({ data: { data: {} } });
  });

  it('People：账号域 KPI（用户总数 / 测试·虚拟 / 有学习路径），切学习状态换成画像三维', async () => {
    const { router, ready } = mockRouter('/admin/people');
    await ready;
    const w = mount(People, { global: { plugins: [router] } });
    await settle();
    expect(kpiLabels(w)).toEqual(['用户总数', '测试 / 虚拟', '有学习路径']);

    await clickPill(w, '学习状态');
    expect(kpiLabels(w)).toEqual(['学习画像', '趋势下降', '疲劳中高', '有风险']);
    w.unmount();
  });

  it('目标对话独立页：KPI 三卡（总数 / 完成率 / 已取消），宿主 pills 已随拆页退役', async () => {
    const { router, ready } = mockRouter('/admin/goal-conversations');
    await ready;
    const w = mount(GoalConversations, { global: { plugins: [router] } });
    await settle();
    expect(kpiLabels(w)).toEqual(['目标对话', '完成率', '已取消']);
    // 2026-09-29 拆回独立页：学习会话合并宿主的视图切换 pills 不应再出现
    expect(w.find('.gc-tabs').exists()).toBe(false);
    w.unmount();
  });

  it('MemoryReview：页级绝对值只住 KPI 卡，作用域开关在页头，旧概览带与折叠说明卡都不在', async () => {
    const { router, ready } = mockRouter('/admin/memory-review');
    await ready;
    const w = mount(MemoryReview, { global: { plugins: [router] } });
    await settle();
    expect(kpiLabels(w)).toEqual(['用户', '记忆痕迹', '当前到期', '需人工看', '待归并建议']);
    // 页头为 pagehead 形态（newui/admin），作用域开关（整页口径）在页头动作区
    expect(w.find('.mk-pagehead').exists()).toBe(true);
    expect(w.find('.mk-pagehead .mk-status__scope').exists()).toBe(true);
    // 旧形态回归护栏：概览带 / 口径与术语折叠卡 / 状态条散文计数
    expect(w.find('.mr-summary').exists()).toBe(false);
    expect(w.find('.mk-section__summary').exists()).toBe(false);
    expect(w.find('.mk-status__meta').exists()).toBe(false);
    w.unmount();
  });
});
