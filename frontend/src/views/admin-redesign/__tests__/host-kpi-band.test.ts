/**
 * 页头 KPI 区形态契约（2026-09-28 立，2026-10-01/02 收紧，2026-10-05 放宽教学会话）
 *
 * 契约：**页面统计带服从原型该页自己的形态，数字不重复**——
 * - People：原型无 KPI 板块，页头 KPI 带退役（计数住 pills / meta）
 * - 教学会话：2026-10-05 用户拍板「像学习路径页面 kpi 面板，统一面板设计」——
 *   补 MkKpi 卡带（需关注 / 缺总结 / 有建议，v-if 有行才渲染），同源 chips 去计数；
 *   状态比例归分布卡（两维度不重叠）
 * - 目标对话：状态分布 = 分布卡（旧 buckets 四桶 / kpi 栅格双带已撤）
 * - 记忆与复习 / 学习路径：保留 .mk-kpi-grid（页级绝对值只住 KPI 卡）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import People from '../People.vue';
import GoalConversations from '../GoalConversations.vue';

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

  it('People：页头 KPI 带已退役（2026-10-01 用户拍板：原型无此板块），页头=单视图「用户账号」', async () => {
    const { router, ready } = mockRouter('/admin/people');
    await ready;
    const w = mount(People, { global: { plugins: [router] } });
    await settle();
    // 反向断言：不再渲染任何 KPI 卡
    expect(kpiLabels(w)).toEqual([]);
    expect(w.find('.mk-kpi-grid').exists()).toBe(false);
    // 页头 = 页名 + 主操作（副题已删：复述页名属注释型文案）
    expect(w.find('.mk-pagehead').exists()).toBe(true);
    expect(w.find('.mk-pagehead').text()).toContain('用户账号');
    expect(w.find('.mk-pagehead').text()).not.toContain('学习状态分布');
    w.unmount();
  });

  it('目标对话独立页：KPI 面板 = 总数/完结率/停滞（2026-10-26 增长读数并入总数卡），状态计数归卡头 pills', async () => {
    const { router, ready } = mockRouter('/admin/goal-conversations');
    await ready;
    const w = mount(GoalConversations, { global: { plugins: [router] } });
    await settle();
    // 2026-10-17：分布带退役，完结率从带副文升独立 KPI 卡（两位小数 → 四舍五入）；状态计数迁回卡头 pills
    // 2026-10-26：「参与用户」「近 7 天新增」两张增长读数卡删除，近 7 天新增改挂总数卡数值行注记
    expect(kpiLabels(w)).toEqual(['目标对话数', '完结率', '停滞目标对话']);
    expect(w.find('.mk-kpi-grid').exists()).toBe(true);
    // 构成卡旧形态不复辟：状态计数只活在卡头 pills（10-02 撤双带判例不回退）
    expect(w.find('.mk-card .buckets').exists()).toBe(false);
    expect(w.find('.buckets').exists()).toBe(false);
    expect(w.find('.gc-distband').exists()).toBe(false);
    // 2026-09-29 拆回独立页：学习会话合并宿主的视图切换 pills 不应再出现
    expect(w.find('.gc-tabs').exists()).toBe(false);
    w.unmount();
  });

  it('教学会话独立页：KPI 面板 = 需关注/缺总结/有建议（2026-10-05 统一面板设计，v-if 有行才渲染），状态比例归分布卡', async () => {
    const { router, ready } = mockRouter('/admin/teaching-sessions');
    await ready;
    const w = mount(TeachingSessions, { global: { plugins: [router] } });
    await settle();
    // 本用例 mock 空响应（0 行）：KPI 面板 v-if rows.length 不渲染；有行时的值见 progress 测试
    expect(kpiLabels(w)).toEqual([]);
    // 2026-10-04 用户拍板：页头状态条整体退役——需关注 / 缺总结与焦点 chips 同源同数、
    // 异常与分布条「异常终态」段同源同数（同一数字不两处渲染）；总数与窗口截断口径并进卡头 meta
    expect(w.find('.mk-status').exists(), '本页状态条已退役').toBe(false);
    // 口径开关已退役（2026-10-21「没有测试，测试只是备注」）：页头不再有视角控件
    expect(w.find('.ds-toggle').exists()).toBe(false);
    // 本用例 0 行未触上限：连截断 meta 都不渲染（触限时才有「共 N 条 · 当前显示最近 1000 条」，
    // 那是分页器没有的事实；未触限时窗口=全量，无需再报一遍）
    expect(w.find('.mk-card--fill .mk-card__meta').exists()).toBe(false);
    /* 2026-10-27 筛选重建：焦点 chips（全部/进行中/需关注/缺总结）撤除——
       进行中归状态下拉、缺总结归总结下拉、需关注是派生视图（点 KPI 卡，激活才出可移除胶囊）；
       卡头唯一 chip 组 = 标志筛选。0 行时异常 chip 不出现。 */
    expect(w.find('.mk-card__head .mk-pills[aria-label="焦点筛选"]').exists()).toBe(false);
    // 2026-10-27 计数收敛：有建议的数字只在 KPI 卡（同源同判据），chip 只表达已应用
    expect(w.findAll('.mk-card__head .mk-pills[aria-label="标志筛选"] .mk-pill').map((c) => c.text())).toEqual(['有建议']);
    w.unmount();
  });

  // 「MemoryReview：页级 KPI 卡」用例随独立页退役（2026-10-12 并入学习者详情页签；
  // 页签内面板无页级 KPI 栅格，面板契约见 memory-review.redesign/outlet/apply 三件套）
});

/**
 * 页级读数原语的归属（2026-10-27 用户「执行日志的 kpi 设计和其他的都不一样」）。
 *
 * 两种读数形态长得像、语义不同：
 * - `MkKpi` + `.mk-kpi-grid` = **列表页页级 KPI 卡带**（白面、26px 数字、可点即筛）；
 * - `MkStatStrip layout="grid"` = **详情页 hero 下的一行读数条**（分格竖线、18px），
 *   或卡内的一排小读数。
 *
 * 执行日志曾把后者当页级 KPI 用，于是同一层级的目标对话（成卡）与执行日志（成条）
 * 页头读数两副面孔。这条守卫把 statstrip 的宿主钉在详情页与卡内槽位。
 */
describe('页级读数形态归属', () => {
  const DIR = resolve(__dirname, '..');
  /* 允许的宿主：VirtualProfile = 虚拟学习者详情 hero 下；Overview / MemoryReview = 卡内读数槽 */
  const STATSTRIP_HOSTS = new Set(['VirtualProfile.vue', 'Overview.vue', 'MemoryReview.vue']);
  const files = readdirSync(DIR).filter((f) => f.endsWith('.vue'));

  it('MkStatStrip 只住详情页 hero 与卡内读数槽，列表页页级 KPI 一律 MkKpi 卡带', () => {
    const offenders = files.filter((f) => {
      if (STATSTRIP_HOSTS.has(f)) return false;
      return readFileSync(resolve(DIR, f), 'utf8').includes("from '@/components/mk/MkStatStrip.vue'");
    });
    expect(offenders).toEqual([]);
  });

  it('执行日志页头读数是三张 MkKpi（成功率 / P50 / P99），且不随行数隐藏', () => {
    const src = readFileSync(resolve(DIR, 'ExecLogs.vue'), 'utf8');
    expect(src).toContain('<section class="mk-kpi-grid" aria-label="执行读数">');
    expect(src.split('<MkKpi ').length - 1).toBe(3);
    // 原先的 v-if="logs.length" 包围整条读数带：窗口筛空时页头读数与页签之间会整体上跳
    expect(src).not.toMatch(/<section class="mk-kpi-grid"[^>]*v-if/);
  });
});
