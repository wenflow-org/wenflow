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
import { chooseFilter, filterOption } from './filter-controls';
import { openSubPage } from '../store';
import { liveRefreshSeq } from '../live';

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
    // 状态筛选入口 = 卡头 pills（2026-10-17 由退役的分布带迁回）
    await chooseFilter(w as never, '状态', '已取消');
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

  it('「已取消」与「失败」拆成两档：取消/回收进已取消，失败独立成档（2026-10-26）', async () => {
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
    // 后端只给合并桶（total−active−completed=3），拆分后两档不显计数，避免窗口口径冒充全量
    expect(filterOption(w as never, '状态', '已取消').text()).toBe('已取消');
    expect(filterOption(w as never, '状态', '失败').text()).toBe('失败');
    // 选「已取消」→ 只剩 cancelled + abandoned（失败不再混进来）
    await chooseFilter(w as never, '状态', '已取消');
    await nextTick();
    let rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(w.text()).toContain('用户1');
    expect(w.text()).toContain('用户2');
    expect(w.text()).not.toContain('用户3');
    // 选「失败」→ 只有 failed 行
    await chooseFilter(w as never, '状态', '失败');
    await nextTick();
    rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(w.text()).toContain('用户3');
    expect(w.text()).not.toContain('用户1');
  });

  it('状态列语义色：失败红、取消灰（spec：bad=需立即行动 / muted=不适用）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv(1, { status: 'failed' }),
            makeConv(2, { status: 'cancelled' })
          ]
        }
      }
    });
    const w = await mountGoals();
    const badges = w.findAll('tbody .mk-badge');
    const failBadge = badges.find((b) => b.text() === '失败')!;
    const cancelBadge = badges.find((b) => b.text() === '已取消')!;
    expect(failBadge.classes()).toContain('mk-badge--bad');
    expect(cancelBadge.classes()).toContain('mk-badge--muted');
  });

  it('「状态」表头按状态档固定序排（进行中 → 已完成 → 已取消 → 失败 → 已放弃），不按阶段序号', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv(1, { status: 'failed', stage: 'initial' }),
            makeConv(2, { status: 'active', stage: 'proposal' }),
            makeConv(3, { status: 'completed', stage: 'completed' }),
            makeConv(4, { status: 'abandoned', stage: 'initial' }),
            makeConv(5, { status: 'cancelled', stage: 'understanding' })
          ]
        }
      }
    });
    const w = await mountGoals();
    const statusTh = w.findAll('thead th').find((th) => th.text().startsWith('状态'))!;
    await statusTh.trigger('click');
    await nextTick();
    const order = w.findAll('tbody tr').map((tr) => tr.findAll('td')[2].find('.mk-badge').text());
    // 首击降序（desc）→ 固定档序倒排；关键是同档聚在一起，而不是按阶段穿插
    expect(order).toEqual(['已放弃', '失败', '已取消', '已完成', '进行中']);
  });

  it('P1#6 停滞信号：窗口内 active 且 updatedAt 超 7 天 → 停滞 KPI 计数', async () => {
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
    const stale = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '停滞目标对话')!;
    expect(stale.find('.mk-kpi__num').text()).toBe('1');
  });

  /* 2026-10-26 动线收口：停滞读数有对应行，就必须能落到那几行。此前它是本页唯一
     点了没反应的 KPI（同组学习状态页的需关注/观察都可点即筛）。 */
  it('停滞 KPI 可点即筛：点卡只剩停滞行，再点取消；卡头出现「停滞」已应用胶囊', async () => {
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
    const card = () => w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '停滞目标对话')!;
    expect(card().classes()).toContain('mk-kpi--clickable');
    // 常驻 chip 已退役：卡头只在筛选生效时出现「已应用」胶囊
    expect(w.find('.mk-card__head .mk-pills').exists()).toBe(false);
    expect(w.find('.mk-card__head .gc-view-chip').exists()).toBe(false);

    await card().trigger('click');
    await nextTick();
    expect(card().classes()).toContain('gc-kpi--on');
    expect(w.findAll('tbody tr')).toHaveLength(1);
    expect(w.find('.mk-card__head .gc-view-chip').text()).toContain('停滞');

    await card().trigger('click');
    await nextTick();
    expect(card().classes()).not.toContain('gc-kpi--on');
    expect(w.findAll('tbody tr')).toHaveLength(2);
    expect(w.find('.mk-card__head .gc-view-chip').exists()).toBe(false);
  });

  it('停滞为 0 时 KPI 不可点、筛选区无「已应用」胶囊（不承诺一个空动作）', async () => {
    const fresh = new Date(Date.now() - 86400000).toISOString();
    listMock.mockResolvedValue({
      data: { success: true, data: { conversations: [makeConv(1, { status: 'active', updatedAt: fresh })] } }
    });
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 1, active: 1, completed: 0, completionRate: '0' } }
    });
    const w = await mountGoals();
    const card = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '停滞目标对话')!;
    expect(card.classes()).not.toContain('mk-kpi--clickable');
    expect(w.find('.mk-card__head .gc-view-chip').exists()).toBe(false);
  });

  /* 2026-10-27 综合重做：未生成路径从常驻 chip 升为 KPI 卡（读数 + 一键筛选），
     KPI 是唯一读数出处，卡头只在筛选生效时给可移除胶囊。 */
  it('未生成路径 KPI 可点即筛：点卡只剩未生成行，胶囊就地清除', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv(1, { status: 'active' }), // 无 learningPathId
            makeConv(2, { status: 'active' }), // 有 learningPathId
            makeConv(3, { status: 'active', learningPathId: null })
          ]
        }
      }
    });
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 3, active: 3, completed: 0, completionRate: '0' } }
    });
    const w = await mountGoals();
    const card = () => w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '未生成路径')!;
    expect(card().find('.mk-kpi__num').text()).toBe('2');
    await card().trigger('click');
    await nextTick();
    expect(card().classes()).toContain('gc-kpi--on');
    expect(w.findAll('tbody tr')).toHaveLength(2);
    const token = w.find('.mk-card__head .gc-view-chip');
    expect(token.text()).toContain('未生成路径');
    await token.trigger('click');
    await nextTick();
    expect(w.findAll('tbody tr')).toHaveLength(3);
    expect(w.find('.mk-card__head .gc-view-chip').exists()).toBe(false);
  });

  it('P1#6 stats 拉取失败 → 错误条「统计暂不可用 · 重试」，完结率 KPI 不拿 0 冒充读数', async () => {
    statsMock.mockRejectedValue(new Error('stats boom'));
    const w = await mountGoals();
    const strip = w.find('.mk-status--bad');
    expect(strip.exists()).toBe(true);
    expect(strip.text()).toContain('统计暂不可用');
    expect(strip.text()).not.toContain('KPI');
    const retry = strip.findAll('button').find((b) => b.text() === '重试');
    expect(retry).toBeTruthy();
    // 取数失败：完结率显「—」而不是 0%；状态 pills 也不渲染计数徽章（不把未知读成 0）
    const rateCard = () => w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '完结率')!;
    expect(rateCard().find('.mk-kpi__num').text()).toBe('—');
    expect(filterOption(w as never, '状态', '进行中').text()).toBe('进行中');
    // 重试后 stats 恢复 → 错误条消失、完结率与计数回来
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 5, active: 5, completed: 0, completionRate: '0' } }
    });
    await retry!.trigger('click');
    await flushPromises();
    await flushPromises();
    expect(w.find('.mk-status--bad').exists()).toBe(false);
    expect(rateCard().find('.mk-kpi__num').text()).toBe('0%');
    expect(filterOption(w as never, '状态', '进行中').text()).toBe('进行中（5）');
  });

  it('KPI 带四张（总数 / 完结率 / 停滞 / 未生成路径），近 7 天新增挂总数卡数值行注记', async () => {
    // 日期动态生成（组件按「今天−6」UTC 日历日过滤窗口，硬编码日期会跨日失效）；
    // d(9) 在窗口外，必须被过滤掉——证明近 7 天新增口径没被「按完成日归集的老对话」污染
    const d = (offsetDays: number) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
    statsMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          total: 40, active: 40, completed: 0, completionRate: '0',
          distinctUsers: 12,
          dailyStats: [
            { date: d(2), total: 3, active: 3, completed: 0, cancelled: 0 },
            { date: d(5), total: 5, active: 5, completed: 0, cancelled: 0 },
            { date: d(9), total: 7, active: 0, completed: 7, cancelled: 0 }
          ]
        }
      }
    });
    const w = await mountGoals();
    const tiles = w.findAll('.mk-kpi-grid .mk-kpi');
    expect(tiles.map((t) => t.find('.mk-kpi__label').text().trim())).toEqual(['目标对话数', '完结率', '停滞目标对话', '未生成路径']);
    // 本组 beforeEach 的行窗口 = 5 行；奇数行无 learningPathId → 未生成路径 = 3
    expect(tiles.map((t) => t.find('.mk-kpi__num').text())).toEqual(['40近 7 天 +8', '0%', '5', '3']);
    // 增长读数（参与用户）不再单开卡
    expect(w.findAll('.mk-kpi__label').map((n) => n.text().trim())).not.toContain('参与用户');
    // 状态数字只活在卡头 pills（2026-10-17 分布带退役后）；「全部」不显数（总数单源=分页器）
    const opt = (label: string) => filterOption(w as never, '状态', label).text();
    expect(opt('进行中')).toBe('进行中（40）');
    expect(opt('已完成')).toBe('已完成（0）');
    expect(opt('已取消')).toBe('已取消');
    expect(opt('全部')).toBe('全部状态');
    expect(w.find('.gc-distband').exists()).toBe(false);
  });

  it('行点击进座舱；操作列不再重复「详情」按钮，只保留 ⋯ 溢出菜单', async () => {
    const w = await mountGoals();
    await w.find('tbody tr').trigger('click');
    expect(vi.mocked(openSubPage)).toHaveBeenCalledWith('session-real', 'conv-1');
    expect(w.findAll('tbody .mk-actions .mk-link')).toHaveLength(0);
    expect(w.findAll('button').some((b) => b.text() === '控制台')).toBe(false);
  });

  /* 2026-10-27 用户「这两个按钮也重复吧，本身点这个条目就可以跳进去了」：
     行点击即详情；路径页签入口收进 ⋯ 菜单。 */
  it('不再有独立「路径」列或「路径」按钮：路径入口收进 ⋯ 菜单', async () => {
    const w = await mountGoals();
    expect(w.findAll('thead th').map((t) => t.text())).not.toContain('路径');
    expect(w.text()).not.toContain('已生成');
    const rows = w.findAll('tbody tr');
    // makeConv：偶数行有 learningPathId → ⋯ 菜单出现「查看路径」；奇数行没有
    await rows[1].find('.mk-menu__btn').trigger('click');
    await nextTick();
    expect(rows[1].findAll('.mk-menu__item').map((b) => b.text())).toContain('查看路径');
    await rows[0].find('.mk-menu__btn').trigger('click');
    await nextTick();
    expect(rows[0].findAll('.mk-menu__item').map((b) => b.text())).not.toContain('查看路径');
  });

  /* 2026-10-26：页头副题（复述页名 + 两个列名）已删，口径只由页名与数据自明；
     口径开关已于 2026-10-21 退役（「没有测试，测试只是备注」） */
  it('页头只剩标题：不再有复述型副题，也没有口径开关', async () => {
    const w = await mountGoals();
    expect(w.find('.mk-pagehead__sub').exists()).toBe(false);
    expect(w.find('.ds-toggle').exists()).toBe(false);
  });

  /** 2026-10-24 用户「空数据的时候，页面很奇怪，没有统一设计」：
   *  本来就没数据时原走页面级一行裸文字（不在卡里、无说明），现与「筛选无匹配」同骨架同位置。
   *  2026-10-26：空态只留一句事实 + 一个出口（不再有教学第二句），分页器常驻。 */
  it('0 行：仍渲染列表卡（卡头 + 卡内 min 空态 + 常驻分页器），空态给「查看学习者」出口', async () => {
    listMock.mockResolvedValue({ data: { success: true, data: { conversations: [] } } });
    statsMock.mockResolvedValue({ data: { success: true, data: { total: 0, active: 0, completed: 0, completionRate: '0' } } });
    const w = await mountGoals();
    // 卡在：卡头筛选带随卡渲染，空态在卡内且带 min（占满卡内剩余高度）
    expect(w.find('.mk-card--fill').exists()).toBe(true);
    expect(w.find('.mk-card--fill .mk-card__head').exists()).toBe(true);
    const empty = w.find('.mk-empty');
    expect(empty.classes()).toContain('mk-empty--min');
    expect(empty.text()).toContain('暂无目标对话');
    expect(empty.text()).not.toContain('学习者在学习端提出目标后');
    const action = empty.findAll('button').find((b) => b.text() === '查看学习者');
    expect(action).toBeTruthy();
    // 分页器常驻：0 行时仍给「共 0 条 · 第 1 / 1 页」，否则整页像数据没了
    expect(w.find('.mk-pagination').exists()).toBe(true);
    expect(w.find('.mk-pagination').text()).toContain('共 0 条');
    w.unmount();
  });

  it('筛选无匹配：只留「当前筛选无匹配」+ 清除筛选（不再有「放宽筛选条件试试」）', async () => {
    const w = await mountGoals();
    const input = w.find('input[placeholder*="搜索用户"]');
    await input.setValue('绝不匹配的关键词');
    await flushPromises();
    const empty = w.find('.mk-empty');
    expect(empty.text()).toContain('当前筛选无匹配');
    expect(empty.text()).not.toContain('放宽筛选条件');
    expect(empty.findAll('button').some((b) => b.text() === '清除筛选')).toBe(true);
    w.unmount();
  });

  it('⋯ 菜单「查看路径」→ 座舱「路径」页签', async () => {
    const w = await mountGoals();
    const row = w.findAll('tbody tr')[1];
    await row.find('.mk-menu__btn').trigger('click');
    await nextTick();
    const item = row.findAll('.mk-menu__item').find((b) => b.text() === '查看路径')!;
    expect(item).toBeTruthy();
    await item.trigger('click');
    expect(vi.mocked(openSubPage)).toHaveBeenCalledWith('session-real', 'conv-2', { stage: 'path' });
  });

  it('「重建路径」只对已完成行开放：未完成行的菜单项禁用，文案按有无路径切换', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          conversations: [
            makeConv(1, { status: 'active', learningPathId: null }),
            makeConv(2, { status: 'completed', learningPathId: 'path-2' }),
            makeConv(3, { status: 'completed', learningPathId: null })
          ]
        }
      }
    });
    const w = await mountGoals();
    const rowOf = (name: string) => w.findAll('tbody tr').find((tr) => tr.text().includes(name))!;
    await rowOf('用户1').find('.mk-menu__btn').trigger('click');
    await nextTick();
    let item = rowOf('用户1').findAll('.mk-menu__pop .mk-menu__item').find((b) => ['生成路径', '重建路径'].includes(b.text()))!;
    expect(item.text()).toBe('生成路径');
    expect(item.attributes('disabled')).toBeDefined();
    await rowOf('用户1').find('.mk-menu__btn').trigger('click');
    await rowOf('用户2').find('.mk-menu__btn').trigger('click');
    await nextTick();
    item = rowOf('用户2').findAll('.mk-menu__pop .mk-menu__item').find((b) => ['生成路径', '重建路径'].includes(b.text()))!;
    expect(item.text()).toBe('重建路径');
    expect(item.attributes('disabled')).toBeUndefined();
    await rowOf('用户2').find('.mk-menu__btn').trigger('click');
    await rowOf('用户3').find('.mk-menu__btn').trigger('click');
    await nextTick();
    item = rowOf('用户3').findAll('.mk-menu__pop .mk-menu__item').find((b) => ['生成路径', '重建路径'].includes(b.text()))!;
    expect(item.text()).toBe('生成路径');
    expect(item.attributes('disabled')).toBeUndefined();
  });

  it('顶栏刷新（liveRefreshSeq 广播）强制重拉列表', async () => {
    const w = await mountGoals();
    const before = listMock.mock.calls.length;
    liveRefreshSeq.value += 1;
    await flushPromises();
    await flushPromises();
    expect(listMock.mock.calls.length).toBeGreaterThan(before);
    w.unmount();
  });
});
