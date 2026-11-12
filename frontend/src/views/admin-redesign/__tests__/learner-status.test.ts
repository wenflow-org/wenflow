/**
 * 学习状态页审计回归（2026-11-09）：
 *  - 表格底部不再腰斩（渐隐遮罩 + 留白，CSS 层面保证）
 *  - 卡头多余 ⋯ 已移除，全页只留行内一个溢出入口（重算 / 全部重算）
 *  - 每行统一两行结构：姓名 + 副行（邮箱，无邮箱退回截断 user id）
 *  - 当前进度主标题规则：活跃任务显任务名；无活跃任务但有兜底路径（已下线等）显路径状态，
 *    有历史完成时副注「历史进度 N%（完成/总数）」；无路径显「未开始」
 *  - 默认每页 15 行
 *  - 数据覆盖率 KPI 带副注「X/Y 位有快照」
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { LiveLearner } from '../live';
import { shortId } from '../live';
import LearnerCenter from '../LearnerCenter.vue';
import { liveLearners } from '../live';
import { subPage } from '../store';

const { apiObject } = vi.hoisted(() => {
  const apiObject = (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    });
  return { apiObject };
});

vi.mock('@/api/adminApi', () => ({
  adminUsersApi: apiObject(),
  adminTeachingSessionsApi: { list: vi.fn(async () => ({ data: { data: { items: [] } } })) },
  adminGoalConversationsApi: apiObject(),
  adminNotificationsApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminMemoryReviewApi: apiObject(),
  adminMemoryTracesApi: apiObject(),
  getUserIncludingDeleted: vi.fn(async () => ({ data: { data: { deletedAt: null, user: {} } } })),
  getDeletedUsers: vi.fn(async () => ({ data: { data: { users: [] } } })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

function lr(p: Partial<LiveLearner> = {}): LiveLearner {
  return {
    userId: 'u', name: 'n', email: '', pathTitle: null, currentTask: null, currentMilestone: null,
    trend: 'flat', fatigue: '低', confidence: 0.8, generatedAt: '2026-10-01T08:00:00Z',
    struggling: [], fragile: [], ...p
  } as LiveLearner;
}

beforeEach(() => { subPage.value = null; liveLearners.value = []; });
afterEach(() => { liveLearners.value = []; subPage.value = null; });

describe('当前进度主标题规则（审计 QW4）', () => {
  type Vm = {
    progressMainTitle: (r: Record<string, unknown>) => string;
    progressNote: (r: Record<string, unknown>) => string;
  };

  it('活跃任务显任务名；兜底路径按状态且区分 0 完成与有历史进度；无路径显未开始', async () => {
    liveLearners.value = [
      lr({ userId: 'a', name: '活跃', currentTask: '任务A', pathTitle: '路径A' })
    ];
    const w = mount(LearnerCenter);
    await settle();
    const vm = w.vm as unknown as Vm;
    // active 任务优先，副注为空
    expect(vm.progressMainTitle({ task: '任务A', path: '路径A', fallbackPath: null })).toBe('任务A');
    expect(vm.progressNote({ task: '任务A', fallbackPath: null })).toBe('');
    // 已下线且有历史完成：主标题为路径状态，副注给历史进度与分子分母
    const archived = { status: 'archived', completedTasks: 6, totalTasks: 15 };
    expect(vm.progressMainTitle({ task: '', path: '已下线路径', fallbackPath: archived })).toBe('已下线');
    expect(vm.progressNote({ task: '', path: '已下线路径', fallbackPath: archived })).toBe('历史进度 40%（6/15）');
    // 已下线但 0 完成：主标题带「· 未开始」组合，副注为空（不把 0/15 说成学了）
    const archivedZero = { status: 'archived', completedTasks: 0, totalTasks: 15 };
    expect(vm.progressMainTitle({ task: '', path: '刚下线', fallbackPath: archivedZero })).toBe('已下线 · 未开始');
    expect(vm.progressNote({ task: '', path: '刚下线', fallbackPath: archivedZero })).toBe('');
    // 无路径、无兜底 → 未开始
    expect(vm.progressMainTitle({ task: '', path: '', fallbackPath: null })).toBe('未开始');
    w.unmount();
  });

  it('已下线有历史进度的学员不再显未开始；0 完成与无路径文案可区分（渲染层）', async () => {
    liveLearners.value = [
      lr({
        userId: 'b', name: '中断账号', currentTask: null, pathTitle: 'Python 入门',
        fallbackPath: { status: 'archived', completedTasks: 6, totalTasks: 15 }
      }),
      lr({
        userId: 'z', name: '刚下线账号', currentTask: null, pathTitle: '刚下线的路径',
        fallbackPath: { status: 'archived', completedTasks: 0, totalTasks: 15 }
      }),
      lr({ userId: 'c', name: '新账号', currentTask: null, pathTitle: null, fallbackPath: null })
    ];
    const w = mount(LearnerCenter);
    await settle();
    const rowOf = (name: string) => w.findAll('tbody tr').find((r) => r.text().includes(name))!;

    const interrupted = rowOf('中断账号');
    const mainTitle = interrupted.find('.progress-title').text();
    expect(mainTitle).toBe('已下线');
    expect(mainTitle).not.toBe('未开始');
    // 历史进度落在副注（同列副行），路径名保留
    const subTexts = interrupted.findAll('.lc-task .mk-cell-sub').map((s) => s.text());
    expect(subTexts).toContain('Python 入门');
    expect(subTexts).toContain('历史进度 40%（6/15）');

    // 0 完成：主标题「已下线 · 未开始」，与无路径的「未开始」区分
    const zero = rowOf('刚下线账号');
    expect(zero.find('.progress-title').text()).toBe('已下线 · 未开始');
    const fresh = rowOf('新账号');
    expect(fresh.find('.progress-title').text()).toBe('未开始');
    expect(fresh.find('.progress-title').text()).not.toBe(zero.find('.progress-title').text());
    w.unmount();
  });
});

describe('每行副行统一两行结构（审计 #3）', () => {
  it('有邮箱显邮箱、无邮箱退回截断 user id', async () => {
    liveLearners.value = [
      lr({ userId: 'u1', name: '张三', email: 'zh@x.com', currentTask: '任务A', pathTitle: '路径A' }),
      lr({ userId: 'user_b9c9a08abcdefghijklmn8dd77f', name: 'uxcheck', email: '', currentTask: '任务B', pathTitle: '路径B' })
    ];
    const w = mount(LearnerCenter);
    await settle();
    const emailRow = w.findAll('tbody tr').find((r) => r.text().includes('张三'))!;
    expect(emailRow.find('.lc-celluser .mk-cell-sub').text()).toContain('zh@x.com');
    const noEmailRow = w.findAll('tbody tr').find((r) => r.text().includes('uxcheck'))!;
    expect(noEmailRow.find('.lc-celluser .mk-cell-sub').text()).toBe(shortId('user_b9c9a08abcdefghijklmn8dd77f'));
    // 两行结构对齐：uxcheck 也有副行，不再是单行错位
    expect(noEmailRow.find('.lc-celluser .mk-cell-subline').exists()).toBe(true);
    w.unmount();
  });
});

describe('卡头多余溢出入口已移除（审计 #2）', () => {
  it('卡头无独立 ⋯，全页只留行内一个溢出入口，且含全部重算', async () => {
    liveLearners.value = [
      lr({ userId: 'a', name: '甲', currentTask: '任务A', pathTitle: '路径A' }),
      lr({ userId: 'b', name: '乙', currentTask: '任务B', pathTitle: '路径B' })
    ];
    const w = mount(LearnerCenter);
    await settle();
    // 卡头右组不再有 ⋯ 菜单
    expect(w.find('.mk-card__head .mk-menu').exists()).toBe(false);
    expect(w.find('.mk-card__head .mk-menu__btn').exists()).toBe(false);
    // 行内 ⋯ 仍在，且打开后同时含「重算」与「全部重算（当前筛选）」
    const rowMenuBtn = w.find('tbody tr .mk-actions .mk-menu__btn');
    expect(rowMenuBtn.exists()).toBe(true);
    await rowMenuBtn.trigger('click');
    await nextTick();
    const pop = w.find('.mk-menu__pop');
    expect(pop.exists()).toBe(true);
    expect(pop.text()).toContain('重算');
    expect(pop.text()).toContain('全部重算（当前筛选）');
    w.unmount();
  });
});

describe('默认每页 15 行（审计 #6）', () => {
  it('载入 20 位学员时首页恰显 15 行', async () => {
    liveLearners.value = Array.from({ length: 20 }, (_, i) =>
      lr({ userId: `u${i}`, name: `学员${i}`, currentTask: `任务${i}`, pathTitle: `路径${i}`, email: `s${i}@x.com` })
    );
    const w = mount(LearnerCenter);
    await settle();
    expect(w.findAll('tbody tr')).toHaveLength(15);
    w.unmount();
  });
});

describe('数据覆盖率 KPI 副注（审计 #3）', () => {  it('卡面带 X/Y 位有快照 副注', async () => {
    liveLearners.value = [
      lr({ userId: 'a', name: '甲', currentTask: '任务A', pathTitle: '路径A', confidence: 0.7 }),
      lr({ userId: 'b', name: '乙', currentTask: '任务B', pathTitle: '路径B', confidence: 0.3 }),
      lr({ userId: 'c', name: '丙', currentTask: '', pathTitle: null, confidence: undefined })
    ];
    const w = mount(LearnerCenter);
    await settle();
    const cov = w.findAll('.lc-kpi .mk-kpi').find((c) => c.find('.mk-kpi__label').text().trim() === '数据覆盖率')!;
    const note = cov.find('.mk-kpi__num-note');
    expect(note.exists(), '数据覆盖率应有副注').toBe(true);
    // 2026-11-11 困惑测试 #32：分子是「有学习任务且测得置信度」，不是「有快照」——
    // 已加载学习者人人有快照，原措辞会让读者问「未开始用户算不算分母」。
    // 2026-11-11 全站打磨：1280 宽六卡一排时完整句会被卡右侧裁掉，副注只留 X/Y 位；
    // 完整口径仍在卡根 title（悬停 / 读屏可达）。
    expect(note.text()).toBe('2/3 位');
    expect(cov.attributes('title')).toContain('有学习任务且测得置信度的用户 2 / 已加载 3 位');
    w.unmount();
  });
});
