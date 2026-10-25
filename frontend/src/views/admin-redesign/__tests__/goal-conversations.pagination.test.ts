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
    // 计数 = 5 − 1 − 1 = 3；口径披露进 pill 的 title（不再是「用户取消或中断」文案）
    const cancelPill = w.findAll('.mk-pill').find((x) => x.text().startsWith('已取消'))!;
    expect(cancelPill.find('.mk-pill__count').text()).toBe('3');
    expect(cancelPill.attributes('title')).toContain('含用户取消、失败中断');
    expect(w.text()).not.toContain('用户取消或中断');
    // 点「已取消」→ 与计数同口径（补集聚合），点进去对得上
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
    // 口径披露随「进行中」pill 的 title（原分布带段悬停文案迁移）
    const activePill = w.findAll('.mk-pill').find((el) => el.text().startsWith('进行中'))!;
    expect(activePill.attributes('title')).toContain('其中 1 条超过 7 天未更新');
    expect(activePill.attributes('title')).toContain('澄清中或待确认');
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

  it('2026-10-05 KPI 面板：四卡（会话总数/完结率/参与用户/近 7 天新增）；状态计数只在卡头 pills', async () => {
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
    expect(tiles.map((t) => t.find('.mk-kpi__label').text().trim())).toEqual(['目标对话数', '完结率', '参与用户', '近 7 天新增', '停滞目标对话']);
    expect(tiles.map((t) => t.find('.mk-kpi__num').text())).toEqual(['40', '0%', '12', '8', '5']);
    // 状态数字只活在卡头 pills（2026-10-17 分布带退役后）；「全部」不显数（总数单源=分页器）
    const pill = (label: string) => w.findAll('.mk-pill').find((p) => p.text().startsWith(label))!;
    expect(pill('进行中').find('.mk-pill__count').text()).toBe('40');
    expect(pill('已完成').find('.mk-pill__count').text()).toBe('0');
    expect(pill('已取消').find('.mk-pill__count').text()).toBe('0');
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

  /* 2026-10-21 用户「右上角已经是真实了啊」+「其他地方也有这种文案」：页头副题不再复述视角，
     视角只由 .ds-toggle 表达（2026-10-04 的「副题随开关改口径」判例据此退役） */
  it('页头副题不复述口径；口径开关已退役（2026-10-21「没有测试，测试只是备注」）', async () => {
    const w = await mountGoals();
    const subText = () => w.find('.mk-pagehead__sub').text();
    expect(subText()).toContain('与学习者澄清真实目标');
    expect(subText()).not.toContain('仅真实用户');
    expect(subText()).not.toContain('测试账号');
    expect(w.find('.ds-toggle').exists()).toBe(false);
  });
});
