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
    const cancelPill = w.findAll('.mk-pill').find((x) => x.text().startsWith('已取消'))!;
    const failPill = w.findAll('.mk-pill').find((x) => x.text().startsWith('失败'))!;
    expect(cancelPill.find('.mk-pill__count').exists()).toBe(false);
    expect(failPill.find('.mk-pill__count').exists()).toBe(false);
    // 点「已取消」→ 只剩 cancelled + abandoned（失败不再混进来）
    await cancelPill.trigger('click');
    await nextTick();
    let rows = w.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(w.text()).toContain('用户1');
    expect(w.text()).toContain('用户2');
    expect(w.text()).not.toContain('用户3');
    // 点「失败」→ 只有 failed 行
    await cancelPill.trigger('click');
    await nextTick();
    await failPill.trigger('click');
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
    expect(w.findAll('.mk-pill').find((p) => p.text().startsWith('进行中'))!.find('.mk-pill__count').exists()).toBe(false);
    // 重试后 stats 恢复 → 错误条消失、完结率与计数回来
    statsMock.mockResolvedValue({
      data: { success: true, data: { total: 5, active: 5, completed: 0, completionRate: '0' } }
    });
    await retry!.trigger('click');
    await flushPromises();
    await flushPromises();
    expect(w.find('.mk-status--bad').exists()).toBe(false);
    expect(rateCard().find('.mk-kpi__num').text()).toBe('0%');
    expect(w.findAll('.mk-pill').find((p) => p.text().startsWith('进行中'))!.find('.mk-pill__count').text()).toBe('5');
  });

  it('2026-10-26 KPI 带压到三张（总数 / 完结率 / 停滞），近 7 天新增挂总数卡数值行注记', async () => {
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
    expect(tiles.map((t) => t.find('.mk-kpi__label').text().trim())).toEqual(['目标对话数', '完结率', '停滞目标对话']);
    expect(tiles.map((t) => t.find('.mk-kpi__num').text())).toEqual(['40近 7 天 +8', '0%', '5']);
    // 增长读数（参与用户）不再单开卡
    expect(w.findAll('.mk-kpi__label').map((n) => n.text().trim())).not.toContain('参与用户');
    // 状态数字只活在卡头 pills（2026-10-17 分布带退役后）；「全部」不显数（总数单源=分页器）
    const pill = (label: string) => w.findAll('.mk-pill').find((p) => p.text().startsWith(label))!;
    expect(pill('进行中').find('.mk-pill__count').text()).toBe('40');
    expect(pill('已完成').find('.mk-pill__count').text()).toBe('0');
    expect(pill('已取消').find('.mk-pill__count').exists()).toBe(false);
    expect(pill('全部').find('.mk-pill__count').exists()).toBe(false);
    expect(w.find('.gc-distband').exists()).toBe(false);
  });

  it('行点击进座舱（与 TeachingSessions 语义对齐）：openSubPage session-real；操作列按钮改名「详情」，不再叫「控制台」', async () => {
    const w = await mountGoals();
    await w.find('tbody tr').trigger('click');
    expect(vi.mocked(openSubPage)).toHaveBeenCalledWith('session-real', 'conv-1');
    expect(w.findAll('button').some((b) => b.text() === '详情')).toBe(true);
    expect(w.findAll('button').some((b) => b.text() === '控制台')).toBe(false);
  });

  /* 2026-10-22 用户「目标对话的查看路径，和详细，重复了」：两个按钮都开 session-real 座舱，
     只是一个落 Path 页签、一个落默认页签。路径列改纯状态，下钻只留「详情」。 */
  it('路径列只回答有没有生成：不再有与「详情」重复的「查看路径」按钮', async () => {
    const w = await mountGoals();
    expect(w.findAll('button').some((b) => b.text() === '查看路径')).toBe(false);
    const rows = w.findAll('tbody tr');
    expect(rows[1].text()).toContain('已生成');
    expect(rows[0].text()).toContain('—');
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

  it('「路径」列「已生成」可点 → 座舱「路径」页签', async () => {
    const w = await mountGoals();
    const pathBtn = w.findAll('tbody button.mk-user-link').find((b) => b.text() === '已生成')!;
    expect(pathBtn).toBeTruthy();
    await pathBtn.trigger('click');
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
    let item = rowOf('用户1').findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text().includes('路径'))!;
    expect(item.text()).toBe('生成路径');
    expect(item.attributes('disabled')).toBeDefined();
    await rowOf('用户1').find('.mk-menu__btn').trigger('click');
    await rowOf('用户2').find('.mk-menu__btn').trigger('click');
    await nextTick();
    item = rowOf('用户2').findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text().includes('路径'))!;
    expect(item.text()).toBe('重建路径');
    expect(item.attributes('disabled')).toBeUndefined();
    await rowOf('用户2').find('.mk-menu__btn').trigger('click');
    await rowOf('用户3').find('.mk-menu__btn').trigger('click');
    await nextTick();
    item = rowOf('用户3').findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text().includes('路径'))!;
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
