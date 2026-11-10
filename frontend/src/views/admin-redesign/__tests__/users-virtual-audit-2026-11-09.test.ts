/**
 * 用户账号 / 虚拟学习者 · 2026-11-09 UI/UX 走查整改回归。
 *
 * 四条结论（图 1 / 图 2）：
 * A. Users「当前账号」徽章此前被 .ul-tags 的 margin-left:auto 推到列右缘，与姓名之间空出一段；
 *    现改为姓名行内紧跟（姓名 → 徽章，6px 间隙）。
 * B. Users 最后一行副行被表格底边腰斩：滚动区补 padding-bottom + 底部渐隐遮罩
 *    （与 LearnerCenter .lc-tablewrap 同款，留白 16px > 渐隐 12px）。
 * C. VirtualLearners 只有少量行时卡片仍被 mk-card--fill 撑满视口底（「黑洞」），
 *    分页条被顶出视口：卡片改为随内容增高（封顶可用高度），分页条只要有行就渲染。
 * D. VirtualLearners「异常」列头的漏斗图标（全站唯一、且把排序 caret 挤到左侧）退役：
 *    筛选迁回卡头筛选行的胶囊；caret 回到文字右侧的共享标记。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Users from '../Users.vue';
import VirtualLearners from '../VirtualLearners.vue';
import { liveUsers } from '../live';
import { liveVirtuals } from '../live';
import { filterTrigger, filterOptions, chooseFilter } from './filter-controls';

/* ---------- 共享 mock：两个页面都从 './live' 取数 ---------- */
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

    liveVirtuals: ref([]),
    liveVirtualsTotal: ref(0),
    liveVirtualSessionStats: ref({ created: 0, running: 0, failed: 0, abandoned: 0, completed: 0, total: 0 }),
    liveVirtualStaleCount: ref(0),
    liveVirtualRunStats: ref({
      profileCount: 0,
      totalSessions: 0,
      created: 0,
      running: 0,
      failed: 0,
      abandoned: 0,
      completed: 0,
      completionRate: 0,
      failureRate: 0,
      staleCount: 0,
      maxStaleMins: 0,
      avgDurationMs: 0,
      reclaimThresholdMs: 0
    }),
    liveVirtualStatsLoading: ref(false),
    liveVirtualStatsError: ref(''),
    retryLiveVirtualStats: vi.fn(async () => {}),
    liveDeleteVirtual: vi.fn(async () => {}),
    refreshLiveVirtuals: vi.fn(async () => {}),
    virtualsStaleAfterMutation: vi.fn(() => false),
    markVirtualsMutated: vi.fn(),

    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    shortId: (id: string) => id.slice(0, 8),
    liveAutopilotConcurrency: ref({ used: 0, limit: 10, queued: 0 }),
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

vi.mock('@/api/adminApi', () => {
  const apiObject = (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    });
  return {
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
  };
});

/* ---------- 数据工厂 ---------- */
function makeUser(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `u${i}`,
    name: `用户${i}`,
    email: `user${i}@example.com`,
    isAdmin: i === 1,
    isVirtualLearner: false,
    isTestAccount: false,
    lastLoginAt: '2026-08-13T10:00:00',
    createdAt: '2026-07-01T10:00:00',
    paths: 1,
    sessions: 2,
    xp: 100,
    currentLevel: 'L2',
    ...overrides
  };
}

function makeVirtual(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `vl-${i}`,
    name: `虚拟学习者${i}`,
    goal: '目标',
    /* LiveVirtual 的必备字段（类型守卫）：页面只读下面这些，缺了会造成 TS 报错 */
    level: 'L1',
    story: '',
    currentStage: null,
    raw: {},
    storyCount: 1,
    pathCount: 1,
    sessions: 2,
    runningCount: 0,
    pausedCount: 0,
    failedCount: 0,
    abandonedCount: 0,
    stalledCount: 0,
    activeError: null,
    runningSessionIds: [],
    pausedSessionIds: [],
    createdAt: '2026-08-10T10:00:00',
    ...overrides
  };
}

const readSource = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');
/** 取 <style scoped> 里某个类选择器的规则体（只取第一处） */
function ruleBody(src: string, selector: string): string {
  const style = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return style.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

beforeEach(() => {
  localStorage.clear();
  liveUsers.value = [];
  liveVirtuals.value = [];
});

/* ============================================================ A */
describe('A · 用户账号「当前账号」徽章紧跟姓名', () => {
  it('徽章在姓名行内、紧跟 <strong> 之后（DOM 顺序），不在独立的 .ul-tags 里', async () => {
    // 当前登录管理员 = u1（isSelf 按 admin_user.id 匹配）
    localStorage.setItem('admin_user', JSON.stringify({ id: 'u1' }));
    liveUsers.value = [makeUser(1), makeUser(2)];
    const w = mount(Users);
    await flushPromises();
    await nextTick();

    const selfRow = w.findAll('tbody tr')[0];
    const nameline = selfRow.find('.ul-nameline');
    expect(nameline.exists()).toBe(true);
    // 姓名行内：strong 之后就是「当前账号」徽章
    const strong = nameline.find('strong');
    expect(strong.text()).toBe('用户1');
    const badge = nameline.find('.mk-badge--self');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('当前账号');
    // DOM 顺序：strong 的下一个兄弟就是徽章
    expect(strong.element.nextElementSibling).toBe(badge.element);
    // 旧的右侧悬浮容器已退役
    expect(selfRow.find('.ul-tags').exists()).toBe(false);

    // 副行（等级）仍在，两行结构不变
    expect(selfRow.find('.mk-cell-sub').exists()).toBe(true);
    w.unmount();
  });

  it('姓名行不是 space-between（徽章贴姓名，不推列右缘）', () => {
    const src = readSource('Users.vue');
    const body = ruleBody(src, '.ul-nameline');
    expect(body).not.toBe('');
    expect(body).not.toMatch(/justify-content:\s*space-between/);
    expect(body).toMatch(/gap:\s*6px/);
    // 旧容器 .ul-tags 的 margin-left:auto 已删除
    expect(ruleBody(src, '.ul-tags')).toBe('');
  });
});

/* ============================================================ B */
describe('B · 用户账号表格滚动区底部留白 + 渐隐遮罩', () => {
  it('滚动区挂 ul-tablewrap：padding-bottom 16px + 底部渐隐（12px 落在留白内）', async () => {
    liveUsers.value = [makeUser(1)];
    const w = mount(Users);
    await flushPromises();
    await nextTick();
    const wrap = w.find('.mk-table-scroll');
    expect(wrap.exists()).toBe(true);
    expect(wrap.classes()).toContain('ul-tablewrap');
    w.unmount();

    const body = ruleBody(readSource('Users.vue'), '.ul-tablewrap');
    expect(body).toMatch(/padding-bottom:\s*16px/);
    // 与 TeachingSessions .ts-table-scroll 同款：token 遮罩色 + 12px 渐隐区 + 透明尾
    expect(body).toMatch(/mask-image:\s*linear-gradient\(to bottom, var\(--mk-ink\) 0, var\(--mk-ink\) calc\(100% - 12px\), transparent 100%\)/);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}/i);
    // 渐隐区 12px < 留白 16px：不裁字形
    expect(body).toMatch(/-webkit-mask-image/);
  });
});

/* ============================================================ C */
describe('C · 虚拟学习者卡片随内容增高 + 分页条恒显', () => {
  it('5 行数据：分页条渲染「共 5 位学习者 · 第 1 / 1 页」', async () => {
    liveVirtuals.value = Array.from({ length: 5 }, (_, i) => makeVirtual(i + 1));
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(5);
    const pager = w.find('.mk-pagination');
    expect(pager.exists()).toBe(true);
    expect(pager.text()).toContain('共 5 位学习者');
    expect(pager.text()).toContain('第 1 / 1 页');
    w.unmount();
  });

  /* 2026-11-10 用户：「目标对话他们的列表在数据不够的时候都是列表到底部的」——
     撤销 2026-11-09 审计 C 的「随内容增高」，卡片改回 flex:1 吃满剩余高度。 */
  it('卡片吃满剩余高度（与目标对话同款）：vl-card flex:1 + max-height 封顶', async () => {
    liveVirtuals.value = Array.from({ length: 5 }, (_, i) => makeVirtual(i + 1));
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const wrap = w.find('.vl-cardwrap');
    expect(wrap.exists()).toBe(true);
    const card = wrap.find('.mk-card');
    expect(card.classes()).toContain('vl-card');
    // 分页条在卡内、卡片之下（卡尾可见）
    expect(card.find('.mk-pagination').exists()).toBe(true);
    w.unmount();

    const src = readSource('VirtualLearners.vue');
    expect(ruleBody(src, '.vl-card')).toMatch(/flex:\s*1 1 auto/);
    expect(ruleBody(src, '.vl-card')).toMatch(/max-height:\s*100%/);
    expect(ruleBody(src, '.vl-cardwrap')).toMatch(/flex:\s*1 1 auto/);
  });

  it('0 行时不渲染分页条（空态已说明无数据）', async () => {
    liveVirtuals.value = [];
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    expect(w.find('.mk-pagination').exists()).toBe(false);
    w.unmount();
  });
});

/* ============================================================ D */
describe('D · 「异常」列头去掉漏斗，排序 caret 在文字右侧', () => {
  it('表头无漏斗按钮（.vl-th-filter 已退役），筛选迁到卡头「异常」胶囊', async () => {
    liveVirtuals.value = [makeVirtual(1, { failedCount: 2 })];
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();

    const abnormalTh = w.findAll('thead th').find((th) => th.text().startsWith('异常'))!;
    expect(abnormalTh.exists()).toBe(true);
    // 列头里只有一枚排序按钮，没有第二枚筛选按钮
    expect(abnormalTh.findAll('button')).toHaveLength(1);
    expect(abnormalTh.find('.vl-th-filter').exists()).toBe(false);
    expect(abnormalTh.find('svg').exists()).toBe(false);

    // 卡头筛选行有「异常」胶囊，且计数进 option 文案
    expect(filterTrigger(w as never, '异常').exists()).toBe(true);
    expect(filterOptions(w as never, '异常')).toEqual(['全部', '只看有异常（1）']);
    w.unmount();
  });

  it('「异常」胶囊选「只看有异常」→ 只剩有异常的行', async () => {
    liveVirtuals.value = [
      makeVirtual(1, { failedCount: 2 }),
      makeVirtual(2),
      makeVirtual(3, { stalledCount: 1 })
    ];
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(3);
    await chooseFilter(w as never, '异常', '只看有异常');
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(2);
    w.unmount();
  });

  it('异常列头用共享 .mk-th--sortable / .mk-th__caret 标记，caret 在文字之后', async () => {
    liveVirtuals.value = [makeVirtual(1)];
    const w = mount(VirtualLearners);
    await flushPromises();
    await nextTick();
    const abnormalTh = w.findAll('thead th').find((th) => th.text().startsWith('异常'))!;
    expect(abnormalTh.classes()).toContain('mk-th--sortable');
    const btn = abnormalTh.find('.mk-th__btn');
    const caret = btn.find('.mk-th__caret');
    expect(caret.exists()).toBe(true);
    // caret 是按钮内最后一个子节点（文字 → caret，行内顺序）
    expect(btn.element.lastElementChild).toBe(caret.element);
    w.unmount();

    // 源码里不再有列头漏斗开关类，也没有把 caret 绝对定位到左侧的自定义规则
    const src = readSource('VirtualLearners.vue');
    expect(src).not.toMatch(/vl-th-filter/);
    expect(src).not.toMatch(/mk-th__caret[^{}]*\{[^}]*left:/);
  });
});
