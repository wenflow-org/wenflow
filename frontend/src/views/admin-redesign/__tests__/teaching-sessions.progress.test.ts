/**
 * TeachingSessions 进度列冒烟（遗留项「教学会话进度列」）：
 * 1. live 模式：后端补字段 progress → 任务 x/y + mk-minibar 迷你条（档位色：完成 ok / 失败 bad）
 * 2. 中断态：失败/超时显示「中断于 x/y」
 * 3. 无进度数据（老数据）→ —
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import TeachingSessions from '../TeachingSessions.vue';
import { dataSource, subPage, closeSubPage } from '../store';
import { clearPageCache } from '../live';
import { chooseFilter, filterOptions, filterTrigger, filterValue } from './filter-controls';

const mockRouter = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

function apiObject(custom?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(custom || ({} as Record<string, unknown>), {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
      return vi.fn(async () => ({ data: {} }));
    }
  });
}

vi.mock('@/api/adminApi', () => ({
  adminTeachingSessionsApi: apiObject({ list: listMock })
}));

function makeItem(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    userId: 'u-' + id,
    userName: '用户' + id,
    email: id + '@example.com',
    topic: '主题 ' + id,
    subject: '学科',
    taskType: 'practice',
    status: 'active',
    duration: 600,
    messageCount: 4,
    knowledgePointCount: 2,
    startTime: '2026-08-12T02:00:00.000Z',
    wrapup: null,
    advisory: null,
    progress: null,
    ...overrides
  };
}

async function mountLive() {
  dataSource.value = 'live';
  const wrapper = mount(TeachingSessions, { global: { plugins: [mockRouter()] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe('TeachingSessions 低参与标注（拍板 #1：completed 且用户消息 <2 条，显示口径）', () => {
  it('completed + messageCount<2 → 状态列出「低参与」badge；≥2 条不出', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('low', { status: 'completed', messageCount: 0 }),
            makeItem('real', { status: 'completed', messageCount: 6 }),
            makeItem('act', { status: 'active', messageCount: 0 }),
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0].find('.ts-status').text()).toContain('低参与');
    expect(rows[1].find('.ts-status').text()).not.toContain('低参与');
    expect(rows[2].find('.ts-status').text()).not.toContain('低参与');
    wrapper.unmount();
  });
});

describe('TeachingSessions 手动结束标注（2026-10-18：endReason 落库后区分「任务完成」与「用户结束」）', () => {
  it('completed + manual-end → 「手动结束」徽章；task-completed 与缺失不猜', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('manual', {
              status: 'completed',
              endReason: 'manual-end',
              messageCount: 6,
              progress: { taskIndex: 1, totalTasks: 4, milestoneIndex: 1, totalMilestones: 3 }
            }),
            makeItem('done', { status: 'completed', endReason: 'task-completed', progress: { taskIndex: 4, totalTasks: 4, milestoneIndex: 3, totalMilestones: 3 } }),
            makeItem('old', { status: 'completed', progress: { taskIndex: 2, totalTasks: 5, milestoneIndex: 2, totalMilestones: 4 } })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0].find('.ts-status').text()).toContain('已完成');
    expect(rows[0].find('.ts-status').text()).toContain('手动结束');
    expect(rows[0].text()).toContain('停在 1/4');
    // 徽章 title 不把 manual-end 一律说成用户动作：后台收束悬挂会话也写同一个原因
    // （2026-10-26 文案收口：解释型悬停说明已删，徽章只留状态词）
    const badge = rows[0].findAll('.ts-status .mk-badge--sm').find((b) => b.text() === '手动结束');
    expect(badge!.attributes('title')).toBeUndefined();
    expect(rows[1].find('.ts-status').text()).not.toContain('手动结束');
    expect(rows[1].text()).toContain('停在 4/4');
    expect(rows[2].find('.ts-status').text()).not.toContain('手动结束');
    wrapper.unmount();
  });

  it('状态列徽章：主状态徽章带 ts-status__main（68px 定宽），标注徽章不受定宽牵连', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [makeItem('m', { status: 'completed', endReason: 'manual-end', messageCount: 1 })]
        }
      }
    });
    const wrapper = await mountLive();
    const main = wrapper.find('.ts-status .ts-status__main');
    expect(main.exists()).toBe(true);
    // 低参与 + 手动结束两枚标注徽章都按内容宽（模板里不再落到 .ts-status .mk-badge 那条定宽规则）
    const sm = wrapper.findAll('.ts-status .mk-badge--sm');
    expect(sm).toHaveLength(2);
    sm.forEach((b) => expect(b.classes()).not.toContain('ts-status__main'));
    wrapper.unmount();
  });
});

beforeEach(() => {
  listMock.mockReset();
  dataSource.value = 'live';
  clearPageCache();
});

afterEach(() => {
  dataSource.value = 'live';
});

describe('TeachingSessions 进度列（遗留项：后端补 progress 字段）', () => {
  it('live：已完成会话 → 状态/进度列显「停在 x/y」（不渲染进度条），title 保留历史进度', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              status: 'completed',
              progress: { taskIndex: 2, totalTasks: 5, milestoneIndex: 2, totalMilestones: 4 }
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const headers = wrapper.findAll('th').map((th) => th.text());
    expect(headers).toContain('状态 / 进度');
    const row = wrapper.find('tbody tr');
    const prog = row.find('.ts-prog');
    expect(prog.exists()).toBe(true);
    // 2026-10-23：生命周期由徽章表达，位置只说「停在 x/y」，不复述结果
    expect(prog.text()).toBe('停在 2/5');
    expect(row.find('.mk-minibar').exists()).toBe(false);
    expect(row.text()).not.toContain('任务 2/5');
    expect(prog.attributes('title')).toContain('阶段 2/4 · 第 2 个任务（共 5 个）');
    wrapper.unmount();
  });

  it('live：失败/超时中断态 → 状态徽章 + 「停在 x/y」', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              status: 'failed',
              progress: { taskIndex: 3, totalTasks: 4, milestoneIndex: 3, totalMilestones: 4 }
            }),
            makeItem('b', {
              status: 'timeout',
              progress: { taskIndex: 1, totalTasks: 2, milestoneIndex: 1, totalMilestones: 5 }
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0].text()).toContain('失败');
    expect(rows[0].text()).toContain('停在 3/4');
    expect(rows[1].text()).toContain('超时');
    expect(rows[1].text()).toContain('停在 1/2');
    // 合并后不再有进度条：结果着色只由状态徽章承担
    expect(rows[0].find('.mk-minibar').exists()).toBe(false);
    wrapper.unmount();
  });

  it('live：「已被替代」与失败/超时同为异常终态（徽章 tone 由共享字典给出）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              status: 'superseded',
              progress: { taskIndex: 2, totalTasks: 4, milestoneIndex: 2, totalMilestones: 4 }
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const row = wrapper.find('tbody tr');
    expect(row.text()).toContain('已被替代');
    expect(row.text()).toContain('停在 2/4');
    expect(row.find('.ts-status__main').classes()).toContain('mk-badge--warn');
    wrapper.unmount();
  });

  it('live：老数据无 progress → 进度列显示 —', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { progress: null })] }
      }
    });
    const wrapper = await mountLive();
    const row = wrapper.find('tbody tr');
    expect(row.text()).toContain('—');
    expect(row.find('.ts-prog').exists()).toBe(false);
    wrapper.unmount();
  });

  it('live：终态但 totalTasks=0 → 出灰色「—」，不套绿色终态样式（绿色破折号会被读成「第 0 格也算完成」）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [makeItem('zero', { status: 'completed', progress: { taskIndex: 0, totalTasks: 0, milestoneIndex: 0, totalMilestones: 0 } })]
        }
      }
    });
    const wrapper = await mountLive();
    const row = wrapper.find('tbody tr');
    expect(row.find('.ts-prog--done').exists()).toBe(false);
    // 合并列内仍是「—」守卫（不再有独立的进度格）
    expect(row.find('.ts-status .mk-na').text()).toBe('—');
    wrapper.unmount();
  });

  it('live：taskIndex=0（结束时还没定位到任务）→ title 说「未进入具体任务」，不说「第 1 个」（与可见的 0/4 自相矛盾）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [makeItem('n', { status: 'completed', progress: { taskIndex: 0, totalTasks: 4, milestoneIndex: 1, totalMilestones: 3 } })]
        }
      }
    });
    const wrapper = await mountLive();
    const prog = wrapper.find('tbody tr').find('.ts-prog');
    expect(prog.text()).toBe('停在 0/4');
    const title = prog.attributes('title') || '';
    expect(title).toContain('未进入具体任务（共 4 个）');
    expect(title).not.toContain('第 1 个任务');
    wrapper.unmount();
  });
});

describe('TeachingSessions 页层次（newui renderSessions / openTurnDetail 对照）', () => {
  it('KPI 四卡：需关注 / 缺总结 / 有建议 / 完结率；卡头只留一组标志 chip（显命中数）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    // 三运维关注量 + 完结率住 MkKpi 卡带（值 = attentionCount / missingWrapupCount / advisoryCount / 1-已完成占比）
    // 2026-10-26：「异常终态」卡退役（与「需关注」在同一行数据上同源同数），异常数由「异常」chip 承载
    const tiles = wrapper.findAll('.mk-kpi-grid .mk-kpi');
    expect(tiles.map((t) => t.find('.mk-kpi__label').text().trim())).toEqual(['需关注', '缺总结', '有建议', '完结率']);
    expect(tiles.map((t) => t.find('.mk-kpi__num').text())).toEqual(['1', '1', '0', '0%']);
    /* 2026-10-27 筛选重建：焦点 chips 撤除——「进行中」在状态下拉、「缺总结」在总结下拉、
       「需关注」是派生视图（点 KPI 卡）。同一维度不再有胶囊和下拉两个入口。
       卡头唯一 chip 组 = 标志筛选（多选开关），激活态仍在；有建议的数字只在 KPI 卡
       （2026-10-27 计数收敛），异常没有独立 KPI 仍带计数。 */
    expect(wrapper.find('.mk-card__head .mk-pills[aria-label="焦点筛选"]').exists()).toBe(false);
    const flags = wrapper.findAll('.mk-card__head .mk-pills[aria-label="标志筛选"] .mk-pill');
    expect(flags.map((c) => c.text())).toEqual(['有建议', '异常1']);
    wrapper.unmount();
  });

  it('「需关注」KPI 可点：点卡 = 打开视图（以可移除胶囊出现），再点关闭', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    const tile = wrapper.findAll('.mk-kpi-grid .mk-kpi').find((t) => t.find('.mk-kpi__label').text().trim() === '需关注')!;
    expect(tile.element.tagName).toBe('BUTTON');
    await tile.trigger('click');
    await nextTick();
    /* 视图不是维度：Polaris 判例——派生视图以「已应用 + 可移除」chip 表达，激活才占位。
       筛选行里因此看得见「现在看的是需关注」，不必再养一组单选胶囊。 */
    const viewChip = wrapper.find('.mk-card__head .ts-view-chip');
    expect(viewChip.exists()).toBe(true);
    expect(viewChip.text()).toContain('需关注');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    // 就地清除（Carbon：已应用的筛选必须能不打开容器就清掉）
    await viewChip.trigger('click');
    await nextTick();
    expect(wrapper.find('.mk-card__head .ts-view-chip').exists()).toBe(false);
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    wrapper.unmount();
  });

  it('同一维度只有一处入口：进行中 = 状态下拉，缺总结 = 总结下拉（点 KPI 卡落到它）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    expect(wrapper.find('.mk-status').exists(), '本页状态条已退役').toBe(false);
    // 卡头不再有「全部 / 进行中 / 需关注 / 缺总结」这组单选胶囊
    expect(wrapper.find('.mk-card__head .mk-pills[aria-label="焦点筛选"]').exists()).toBe(false);
    // 「进行中」归状态下拉
    expect(filterOptions(wrapper as never, '状态')).toContain('进行中');
    // 「缺总结」归总结下拉：点 KPI 卡 → 下拉落到 missing，整枚胶囊激活，列表只剩缺总结行
    const missingTile = wrapper.findAll('.mk-kpi-grid .mk-kpi').find((t) => t.find('.mk-kpi__label').text().trim() === '缺总结')!;
    await missingTile.trigger('click');
    await nextTick();
    expect(filterValue(wrapper as never, '总结')).toBe('missing');
    expect(wrapper.find('.mk-filter button.mk-pill--active').text()).toContain('缺总结');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    wrapper.unmount();
  });

  it('异常堆积告警（原 tsDashTone bad 档）：失败/收尾失败/超时合计 ≥ 10 → 「异常」chip 转红 + title 披露阈值', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: Array.from({ length: 10 }, (_, i) => makeItem(`f${i}`, { status: 'failed' })) }
      }
    });
    const wrapper = await mountLive();
    const abn = wrapper.find('.ts-abn-chip');
    expect(abn.exists()).toBe(true);
    expect(abn.classes()).toContain('ts-abn-chip--heap');
    expect(abn.attributes('title')).toContain('≥ 10');
    expect(abn.attributes('title')).toContain('失败 / 收尾失败 / 超时');
    wrapper.unmount();
  });

  it('卡头「有建议」开关可点穿：服务端 onlyWithAdvisory 过滤 toggle（再点取消）；建议徽章读运营口径', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              advisory: {
                shouldSuggest: true,
                priority: 'high',
                recommendation: 'reinforce',
                scope: 'downstream_path',
                reasonCodes: ['prerequisite_gaps'],
                rationale: '继续按原路径推进的成本偏高，建议先经过人工确认。',
                // 学员端文案（admin 页不得原样上屏）
                ui: { title: '建议先确认路径调整', body: '该调整只会调整后续阶段的课程安排，不会覆盖你已完成的内容。' }
              }
            }),
            makeItem('b', { status: 'active' })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const link = wrapper.find('.mk-card__head .mk-pills[aria-label="标志筛选"] .mk-pill');
    expect(link.text()).toBe('有建议');
    expect(link.attributes('aria-pressed')).toBe('false');
    // 徽章 = 运营视角状态（待确认），不是学员端「建议先确认路径调整」原句
    const adv = wrapper.find('.ts-adv-badge');
    expect(adv.text()).toBe('待确认调整');
    expect(adv.classes()).toContain('mk-badge--bad');
    const title = adv.attributes('title') || '';
    expect(title).toContain('高优先级');
    expect(title).toContain('影响后续路径');
    expect(title).toContain('触发原因：前置缺口');
    expect(title).toContain('建议动作：先补强再推进');
    expect(title).toContain('处置：未处置');
    expect(title).not.toContain('不会覆盖你已完成的内容');
    // 点击 → 服务端过滤（onlyWithAdvisory: true），再点 → 取消（参数收敛）
    await link.trigger('click');
    await flushPromises();
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ onlyWithAdvisory: true, limit: 1000 }));
    expect(wrapper.find('.mk-card__head .mk-pills[aria-label="标志筛选"] .mk-pill').attributes('aria-pressed')).toBe('true');
    await wrapper.find('.mk-card__head .mk-pills[aria-label="标志筛选"] .mk-pill').trigger('click');
    await flushPromises();
    const lastArg = listMock.mock.calls[listMock.mock.calls.length - 1][0];
    expect(lastArg.onlyWithAdvisory).toBeUndefined();
    wrapper.unmount();
  });

  it('建议已被学习者「保持原计划」→ 徽章退为中性与已决态，title 记处置动作', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              advisory: {
                shouldSuggest: true,
                priority: 'high',
                recommendation: 'reinforce',
                scope: 'downstream_path',
                reasonCodes: ['prerequisite_gaps'],
                rationale: '继续按原路径推进的成本偏高。',
                learnerResponse: { action: 'keep', at: '2026-10-21T10:00:00.000Z' },
                ui: { title: '建议先确认路径调整', body: '不会覆盖你已完成的内容。' }
              }
            })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const adv = wrapper.find('.ts-adv-badge');
    expect(adv.text()).toBe('已保持计划');
    expect(adv.classes()).toContain('mk-badge--muted');
    expect(adv.classes()).not.toContain('mk-badge--bad');
    expect(adv.attributes('title')).toContain('处置：学员选择保持原计划');
    wrapper.unmount();
  });

  it('卡头「异常」开关可点穿：失败/收尾失败/超时 状态多选筛选 toggle；计数由分布条红段单源承载', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', { status: 'failed' }),
            makeItem('b', { status: 'active' }),
            makeItem('c', { status: 'timeout' })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const abn = wrapper.find('.ts-abn-chip');
    // 2026-10-11 统一判例：chip 显命中数（失败 / 收尾失败 / 超时合计）
    expect(abn.text()).toBe('异常2');
    expect(abn.attributes('aria-pressed')).toBe('false');
    await abn.trigger('click');
    await nextTick();
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    expect(wrapper.find('.ts-abn-chip').attributes('aria-pressed')).toBe('true');
    await wrapper.find('.ts-abn-chip').trigger('click');
    await nextTick();
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    wrapper.unmount();
  });

  it('分布带已退役（2026-10-17）：buckets/stageband/mk-distband 均不出现，完结率由 KPI 承载', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    // 旧「stageband 分布卡」与后续 MkDistBand 贴表分布条均已下线
    expect(wrapper.find('.buckets').exists()).toBe(false);
    expect(wrapper.find('.mk-distband').exists()).toBe(false);
    expect(wrapper.find('.stageband').exists()).toBe(false);
    // 2 条里 0 条 completed → 完结率 0%
    const rate = wrapper.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '完结率')!;
    expect(rate.find('.mk-kpi__num').text()).toBe('0%');
    wrapper.unmount();
  });

  it('时长按分钟解释（后端 duration 单位是分钟）：90 → 1 小时 30 分、1600 → 26 小时 40 分；长时阈值进 title；未知任务类型回退「—」+ title 原文', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', { duration: 90, taskType: 'weird_type' }),
            makeItem('b', { duration: 1600 })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0].text()).toContain('1 小时 30 分');
    expect(rows[1].text()).toContain('26 小时 40 分');
    expect(rows[0].text()).toContain('—');
    expect(rows[0].find('td .mk-cell-sub').attributes('title')).toBe('任务类型原文：weird_type');
    expect(rows[1].find('.ts-ia').attributes('title')).toContain('≥ 25 分钟按长时标注');
    wrapper.unmount();
  });

  it('筛选：一行到底——一维一枚胶囊下拉，标志用单组 chips，无隐藏弹层', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    // 表前只有一行：快筛条 .ts-toolbar 退役（chips 并回卡头，2026-10-04）
    expect(wrapper.find('.ts-toolbar').exists(), '快筛条已并回卡头一行').toBe(false);
    // 2026-10-27：卡头维度下拉统一为 MkPillSelect（描边胶囊触发器 + 自绘 listbox），
    // 原生 select 已退役——option 文案与选择结果不变，查询走 filter-controls。
    expect(filterTrigger(wrapper as never, '状态').exists()).toBe(true);
    expect(filterOptions(wrapper as never, '状态')).toEqual([
      '全部状态', '初始化中', '进行中', '已暂停', '超时', '已被替代', '失败', '收尾中', '收尾失败', '已完成', '已废弃'
    ]);
    // 总结三档筛选（总览「评估失败 / 降级总结」的落地入口）也在主栏
    expect(filterOptions(wrapper as never, '总结')).toEqual(['全部总结', '降级总结', '评估失败', '缺总结']);
    /* 2026-10-27：课型 / 开始时间从「筛选」弹层提到主栏——Carbon 的筛选模式明确
       「多个类别不得收进菜单/下拉」；卡头不再有弹层触发器，维度一维一枚胶囊下拉。 */
    expect(wrapper.find('.mk-adv').exists()).toBe(false);
    expect(filterOptions(wrapper as never, '课型')).toEqual(['全部课型', '正课', '复习课', '延伸课']);
    expect(filterOptions(wrapper as never, '开始时间')).toEqual(['全部时间', '近 7 天', '近 30 天']);
    // 卡头只有一组 chips（标志开关）：单选/多选不再并排同形（M3「同一页别混 chip 行为」）
    const groups = wrapper.findAll('.mk-card__head .mk-pills');
    expect(groups.map((g) => g.attributes('aria-label'))).toEqual(['标志筛选']);
    expect(wrapper.findAll('.mk-card__head .mk-pills[aria-label="标志筛选"] .mk-pill').map((c) => c.text().replace(/\d+$/, ''))).toEqual([
      '有建议', '异常'
    ]);
    await chooseFilter(wrapper as never, '状态', '失败');
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户a');
    /* 2026-10-27 用户「清除筛选也不想要」：工具条不再挂文字链，每个维度自己复位
       （下拉选回「全部…」），不再有第三个重复入口 */
    expect(wrapper.findAll('.mk-filter .mk-link').some((b) => b.text() === '清除筛选')).toBe(false);
    await chooseFilter(wrapper as never, '开始时间', '近 7 天');
    expect(filterValue(wrapper as never, '开始时间')).toBe('7d');
    await chooseFilter(wrapper as never, '状态', '全部状态');
    await chooseFilter(wrapper as never, '开始时间', '全部时间');
    expect(filterValue(wrapper as never, '状态')).toBe('');
    expect(filterValue(wrapper as never, '开始时间')).toBe('');
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    wrapper.unmount();
  });

  it('行点击 → 座舱二级页（对齐原型 open-session 进详情页习惯，不再开抽屉）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed', duration: 600, messageCount: 4 })] }
      }
    });
    closeSubPage();
    const wrapper = await mountLive();
    await wrapper.find('tbody tr').trigger('click');
    await nextTick();
    // 原型习惯：会话行点击直达二级详情页（session-real 只读座舱），不再渲染抽屉
    expect(subPage.value?.view).toBe('session-real');
    expect(subPage.value?.id).toBe('a');
    expect(document.body.querySelector('.mk-drawer')).toBeNull();
    closeSubPage();
    wrapper.unmount();
  });
});
