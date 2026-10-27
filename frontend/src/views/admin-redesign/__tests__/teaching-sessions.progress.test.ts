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
  it('completed + messageCount<2 → 状态格 title 含「低参与」；≥2 条不出', async () => {
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
    const title = (i: number) => rows[i].find('.ts-status').attributes('title') || '';
    expect(title(0)).toContain('低参与');
    expect(title(1)).not.toContain('低参与');
    expect(title(2)).not.toContain('低参与');
    // 行内只留状态徽章，不再铺备注文本
    expect(rows[0].find('.ts-status').text()).toBe('已完成');
    wrapper.unmount();
  });
});

describe('TeachingSessions 手动结束标注（2026-10-18：endReason 落库后区分「任务完成」与「用户结束」）', () => {
  it('completed + manual-end → 状态格 title 含「手动结束」；task-completed 与缺失不猜', async () => {
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
    const title = (i: number) => rows[i].find('.ts-status').attributes('title') || '';
    expect(rows[0].find('.ts-status').text()).toBe('已完成');
    expect(title(0)).toContain('手动结束');
    expect(title(0)).toContain('第 1 个任务（共 4 个）');
    expect(title(1)).not.toContain('手动结束');
    expect(title(1)).toContain('第 4 个任务（共 4 个）');
    expect(title(2)).not.toContain('手动结束');
    wrapper.unmount();
  });

  it('状态格：行内只有一枚主状态徽章，结束方式与进度都在 title', async () => {
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
    // 2026-10-27 用户「还是太多数据了」：格内只留状态徽章，副行文本下线
    expect(wrapper.findAll('.ts-status .mk-badge')).toHaveLength(1);
    const title = wrapper.find('.ts-status').attributes('title') || '';
    expect(title).toContain('手动结束 · 低参与');
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
  it('live：已完成会话 → 状态格 title 给「阶段 + 任务位置」，行内只留徽章、不渲染进度条', async () => {
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
    expect(headers).toContain('状态');
    expect(headers).not.toContain('状态 / 进度');
    const row = wrapper.find('tbody tr');
    const cell = row.find('.ts-status');
    // 2026-10-27 用户「还是太多数据了」：进度不再上屏，只进 title
    expect(cell.text()).toBe('已完成');
    expect(cell.attributes('title')).toBe('阶段 2/4 · 第 2 个任务（共 5 个）');
    expect(row.find('.mk-minibar').exists()).toBe(false);
    expect(row.text()).not.toContain('2/5');
    wrapper.unmount();
  });

  it('live：失败/超时中断态 → 状态徽章，进度在 title', async () => {
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
    expect(rows[0].find('.ts-status').attributes('title')).toContain('第 3 个任务（共 4 个）');
    expect(rows[1].text()).toContain('超时');
    expect(rows[1].find('.ts-status').attributes('title')).toContain('第 1 个任务（共 2 个）');
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
    expect(row.find('.ts-status').attributes('title')).toContain('第 2 个任务（共 4 个）');
    expect(row.find('.ts-status__main').classes()).toContain('mk-badge--warn');
    wrapper.unmount();
  });

  it('live：老数据无 progress → 状态格 title 为空，不留占位符', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { progress: null })] }
      }
    });
    const wrapper = await mountLive();
    const cell = wrapper.find('tbody tr .ts-status');
    expect(cell.text()).toBe('进行中');
    expect(cell.attributes('title') || '').toBe('');
    wrapper.unmount();
  });

  it('live：终态但 totalTasks=0 → 不把 0/0 或 — 冒充进度', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [makeItem('zero', { status: 'completed', progress: { taskIndex: 0, totalTasks: 0, milestoneIndex: 0, totalMilestones: 0 } })]
        }
      }
    });
    const wrapper = await mountLive();
    const cell = wrapper.find('tbody tr .ts-status');
    expect(cell.text()).toBe('已完成');
    expect(cell.attributes('title') || '').not.toContain('/0');
    wrapper.unmount();
  });

  it('live：taskIndex=0（结束时还没定位到任务）→ title 说「未进入具体任务」，不说「第 1 个」', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [makeItem('n', { status: 'completed', progress: { taskIndex: 0, totalTasks: 4, milestoneIndex: 1, totalMilestones: 3 } })]
        }
      }
    });
    const wrapper = await mountLive();
    const title = wrapper.find('tbody tr .ts-status').attributes('title') || '';
    expect(title).toContain('未进入具体任务（共 4 个）');
    expect(title).not.toContain('第 1 个任务');
    wrapper.unmount();
  });
});

describe('TeachingSessions 页层次（newui renderSessions / openTurnDetail 对照）', () => {
  it('KPI 五卡：需关注 / 异常 / 缺总结 / 有建议 / 完结率；卡头不再常驻任何 chip', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    // 四运维关注量 + 完结率住 MkKpi 卡带（值 = attentionCount / abnormal / missing / advisory / 已完成占比）
    const tiles = wrapper.findAll('.mk-kpi-grid .mk-kpi');
    expect(tiles.map((t) => t.find('.mk-kpi__label').text().trim())).toEqual(['需关注', '异常', '缺总结', '有建议', '完结率']);
    expect(tiles.map((t) => t.find('.mk-kpi__num').text())).toEqual(['1', '1', '1', '0', '0%']);
    /* 2026-10-27 用户「去掉这个 pill，综合设计 KPI 面板和筛选」：KPI 是读数唯一出处，
       也是快捷筛选入口；卡头不再有常驻 chip 组——筛选生效时只出现「已应用」胶囊。 */
    expect(wrapper.find('.mk-card__head .mk-pills').exists()).toBe(false);
    expect(wrapper.find('.mk-card__head .ts-view-chip').exists()).toBe(false);
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

  it('异常堆积告警：失败/收尾失败/超时合计 ≥ 10 → 「异常」KPI 转红 + hint 披露阈值', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: Array.from({ length: 10 }, (_, i) => makeItem(`f${i}`, { status: 'failed' })) }
      }
    });
    const wrapper = await mountLive();
    const abn = wrapper.findAll('.mk-kpi-grid .mk-kpi').find((t) => t.find('.mk-kpi__label').text().trim() === '异常')!;
    expect(abn.classes()).toContain('mk-kpi--bad');
    expect(abn.find('.mk-kpi__hint').text()).toBe('异常堆积');
    expect(abn.attributes('title')).toContain('≥ 10');
    expect(abn.attributes('title')).toContain('失败 / 收尾失败 / 超时');
    wrapper.unmount();
  });

  it('「有建议」KPI 可点穿：服务端 onlyWithAdvisory 过滤 toggle；卡头出现可移除胶囊', async () => {
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
    // 2026-10-27 用户「还是太多数据了」：建议处置不再占行内位置，只进总结格 title
    expect(wrapper.find('.ts-adv-note').exists()).toBe(false);
    const out = wrapper.find('tbody tr .ts-out');
    // 进行中会话没有总结：行内只显示空值占位，建议细节在 title
    expect(out.text()).toBe('—');
    const title = out.attributes('title') || '';
    expect(title).toContain('未生成');
    expect(title).toContain('高优先级');
    expect(title).toContain('影响后续路径');
    expect(title).toContain('触发原因：前置缺口');
    expect(title).toContain('建议动作：先补强再推进');
    expect(title).toContain('处置：未处置');
    expect(title).not.toContain('不会覆盖你已完成的内容');
    // 点击 KPI 卡 → 服务端过滤（onlyWithAdvisory: true），卡头出现「有建议」已应用胶囊
    const tile = wrapper.findAll('.mk-kpi-grid .mk-kpi').find((t) => t.find('.mk-kpi__label').text().trim() === '有建议')!;
    expect(tile.attributes('aria-pressed')).toBe('false');
    await tile.trigger('click');
    await flushPromises();
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ onlyWithAdvisory: true, limit: 1000 }));
    expect(tile.attributes('aria-pressed')).toBe('true');
    const viewChip = wrapper.find('.mk-card__head .ts-view-chip');
    expect(viewChip.text()).toContain('有建议');
    // 胶囊就地清除 → 取消服务端过滤
    await viewChip.trigger('click');
    await flushPromises();
    const lastArg = listMock.mock.calls[listMock.mock.calls.length - 1][0];
    expect(lastArg.onlyWithAdvisory).toBeUndefined();
    expect(wrapper.find('.mk-card__head .ts-view-chip').exists()).toBe(false);
    wrapper.unmount();
  });

  it('建议已被学习者「保持原计划」→ 行内不铺建议标记，title 记处置动作', async () => {
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
    const out = wrapper.find('tbody tr .ts-out');
    expect(out.text()).toBe('—');
    expect(out.attributes('title')).toContain('处置：学员选择保持原计划');
    wrapper.unmount();
  });

  it('课后总结：有总结 / 缺总结都用徽章（绿实心 / 琥珀虚线），未生成按空值', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('done', { status: 'completed', wrapup: { status: 'complete', summary: { topicSummary: '总结' } } }),
            makeItem('miss', { status: 'completed', wrapup: null }),
            makeItem('active', { status: 'active', wrapup: null })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const rows = wrapper.findAll('tbody tr');
    const ok = rows[0].find('.ts-out .mk-badge');
    expect(ok.text()).toBe('有总结');
    expect(ok.classes()).toContain('mk-badge--ok');
    const missing = rows[1].find('.ts-out .mk-badge');
    expect(missing.text()).toBe('缺总结');
    expect(missing.classes()).toContain('mk-badge--warn');
    expect(rows[2].find('.ts-out .mk-na').text()).toBe('—');
    // 旧的灰色文字档位下线，两档统一走徽章
    expect(wrapper.find('.ts-out__text').exists()).toBe(false);
    wrapper.unmount();
  });

  it('「异常」KPI 可点即筛：落到状态下拉的「异常」档，再点取消；与下拉同一状态', async () => {
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
    const abn = wrapper.findAll('.mk-kpi-grid .mk-kpi').find((t) => t.find('.mk-kpi__label').text().trim() === '异常')!;
    expect(abn.find('.mk-kpi__num').text()).toBe('2');
    expect(abn.attributes('aria-pressed')).toBe('false');
    await abn.trigger('click');
    await nextTick();
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    /* KPI 卡与「状态」下拉共用 statusFilter：点卡后下拉的当前值也必须是 abnormal，
       不再维护第二套 abnormalOnly 开关（同一维度只有一处状态）。 */
    expect(filterValue(wrapper as never, '状态')).toBe('abnormal');
    expect(abn.attributes('aria-pressed')).toBe('true');
    await abn.trigger('click');
    await nextTick();
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    expect(filterValue(wrapper as never, '状态')).toBe('');
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

  it('时长按分钟解释（后端 duration 单位是分钟）：90 → 1 小时 30 分、1600 → 26 小时 40 分；title 只给读数，不再标长时；未知任务类型回退「—」+ title 原文', async () => {
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
    expect(rows[1].find('.ts-ia').attributes('title')).toContain('时长 26 小时 40 分');
    expect(rows[1].find('.ts-ia').attributes('title')).not.toContain('长时标注');
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
      '全部状态', '异常（失败 · 超时）', '初始化中', '进行中', '已暂停', '超时', '已被替代', '失败', '收尾中', '收尾失败', '已完成', '已废弃'
    ]);
    // 总结三档筛选（总览「评估失败 / 降级总结」的落地入口）也在主栏
    expect(filterOptions(wrapper as never, '总结')).toEqual(['全部总结', '降级总结', '评估失败', '缺总结']);
    /* 2026-10-27：课型 / 开始时间从「筛选」弹层提到主栏——Carbon 的筛选模式明确
       「多个类别不得收进菜单/下拉」；卡头不再有弹层触发器，维度一维一枚胶囊下拉。 */
    expect(wrapper.find('.mk-adv').exists()).toBe(false);
    expect(filterOptions(wrapper as never, '课型')).toEqual(['全部课型', '正课', '复习课', '延伸课']);
    expect(filterOptions(wrapper as never, '开始时间')).toEqual(['全部时间', '近 7 天', '近 30 天']);
    // 卡头不再有常驻 chip 组：KPI 是读数与入口，筛选区只留维度下拉 + 已应用视图胶囊
    expect(wrapper.find('.mk-card__head .mk-pills').exists()).toBe(false);
    expect(wrapper.find('.mk-card__head .ts-view-chip').exists()).toBe(false);
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
