/**
 * TeachingSessions 进度列冒烟（遗留项「教学会话进度列」）：
 * 1. live 模式：后端补字段 progress → 任务 x/y + mk-minibar 迷你条（档位色：完成 ok / 失败 bad）
 * 2. 中断态：失败/超时显示「中断于 任务 x/y」
 * 3. 无进度数据（老数据）→ —
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import TeachingSessions from '../TeachingSessions.vue';
import { dataSource, subPage, closeSubPage } from '../store';
import { clearPageCache } from '../live';

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

beforeEach(() => {
  listMock.mockReset();
  dataSource.value = 'live';
  clearPageCache();
});

afterEach(() => {
  dataSource.value = 'live';
});

describe('TeachingSessions 进度列（遗留项：后端补 progress 字段）', () => {
  it('live：已完成会话 → 进度列只显「已完成」（不渲染任务 x/y 与进度条，语义一致），title 保留历史进度', async () => {
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
    expect(headers).toContain('进度');
    const row = wrapper.find('tbody tr');
    const prog = row.find('.ts-prog--done');
    expect(prog.exists()).toBe(true);
    expect(prog.text()).toBe('已完成');
    expect(row.find('.mk-minibar').exists()).toBe(false);
    expect(row.text()).not.toContain('任务 2/5');
    expect(prog.attributes('title')).toContain('阶段 2/4 · 任务 2/5');
    wrapper.unmount();
  });

  it('live：失败/超时中断态 → 「中断于 任务 x/y」+ 条档 bad', async () => {
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
    expect(rows[0].text()).toContain('中断于 任务 3/4');
    expect(rows[0].find('.mk-minibar__fill').attributes('data-tone')).toBe('bad');
    expect(rows[1].text()).toContain('中断于 任务 1/2');
    wrapper.unmount();
  });

  it('live：P2 中断进度条颜色统一——「已被替代」与失败/超时同为 bad 红条（此前为蓝条）', async () => {
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
    expect(row.text()).toContain('中断于 任务 2/4');
    expect(row.find('.mk-minibar__fill').attributes('data-tone')).toBe('bad');
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
});

describe('TeachingSessions 页层次（newui renderSessions / openTurnDetail 对照）', () => {
  it('状态条退役（2026-10-04）：计数各自唯一——待关注 / 缺总结住焦点 chips，点选即筛选', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    // 页头状态条整体退役：需关注 / 缺总结与 chips 同源同数、异常与构成带「异常终态」同源同数
    expect(wrapper.find('.mk-status').exists(), '本页状态条已退役').toBe(false);
    const chip = (label: string) =>
      wrapper.findAll('.mk-card__head .mk-pills[aria-label="焦点筛选"] .mk-pill').find((c) => c.text().replace(/\d+$/, '') === label)!;
    // 「全部」不显数 = 卡头 meta 的已加载行数（同 People 页判例：同一数字不两处渲染）
    expect(chip('全部').find('.mk-pill__count').exists()).toBe(false);
    expect(chip('待关注').text()).toBe('待关注1');
    expect(chip('缺总结').text()).toBe('缺总结1');
    // 点选 = 既有「待关注」筛选口径（attention !== low）：只剩失败行
    await chip('待关注').trigger('click');
    expect(chip('待关注').attributes('aria-pressed')).toBe('true');
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户a');
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

  it('卡头「有建议」开关可点穿：服务端 onlyWithAdvisory 过滤 toggle（再点取消）；建议徽章行内预览 + title 全文', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            makeItem('a', {
              advisory: { shouldSuggest: true, priority: 'high', ui: { title: '建议加强练习', body: '多做错题' } }
            }),
            makeItem('b', { status: 'active' })
          ]
        }
      }
    });
    const wrapper = await mountLive();
    const link = wrapper.find('.mk-card__head .mk-pills[aria-label="快捷筛选"] .mk-pill');
    expect(link.text()).toBe('有建议1');
    expect(link.attributes('aria-pressed')).toBe('false');
    // 建议徽章：行内直出建议标题（首行预览），title 挂完整建议文本
    const adv = wrapper.find('.ts-adv-badge');
    expect(adv.text()).toBe('建议加强练习');
    expect(adv.attributes('title')).toContain('建议加强练习：多做错题');
    // 点击 → 服务端过滤（onlyWithAdvisory: true），再点 → 取消（参数收敛）
    await link.trigger('click');
    await flushPromises();
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ onlyWithAdvisory: true, limit: 1000 }));
    expect(wrapper.find('.mk-card__head .mk-pills[aria-label="快捷筛选"] .mk-pill').attributes('aria-pressed')).toBe('true');
    await wrapper.find('.mk-card__head .mk-pills[aria-label="快捷筛选"] .mk-pill').trigger('click');
    await flushPromises();
    const lastArg = listMock.mock.calls[listMock.mock.calls.length - 1][0];
    expect(lastArg.onlyWithAdvisory).toBeUndefined();
    wrapper.unmount();
  });

  it('卡头「异常」开关可点穿：失败/收尾失败/超时 状态多选筛选 toggle；计数由构成带单源承载', async () => {
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
    // chip 不显计数（同窗口同集合由构成带「异常终态」桶单源承载，数字不两处渲染）
    expect(abn.text()).toBe('异常');
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

  it('分布卡退役（2026-10-04 教学组统一 buckets 构成带）：stageband 不再出现，构成带按收束语义归组', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    expect(wrapper.find('.stageband').exists()).toBe(false);
    expect(wrapper.find('.buckets').exists()).toBe(true);
    const labels = wrapper
      .findAll('.buckets .bucket .bucket__l')
      .filter((el) => !el.classes().includes('bucket__foot'))
      .map((el) => el.text().trim());
    // failed + active：进行中 1 / 已完成 0 / 异常终态 1 / 已废弃 0 / 完成率（零值桶如实显示）
    expect(labels).toEqual(['进行中', '已完成', '异常终态', '已废弃', '完成率']);
    wrapper.unmount();
  });

  it('P3 顺手：90 秒显示「1 分钟」（向下取整）；挂机红阈值进 title；未知任务类型回退「—」+ title 原文', async () => {
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
    expect(rows[0].text()).toContain('1 分钟');
    expect(rows[0].text()).not.toContain('2 分钟');
    expect(rows[0].text()).toContain('—');
    expect(rows[0].find('td .mk-cell-sub').attributes('title')).toBe('任务类型原文：weird_type');
    expect(rows[1].find('.ts-ia').attributes('title')).toContain('≥ 25 分钟按挂机标红');
    wrapper.unmount();
  });

  it('筛选：一行到底——chips 全在卡头，状态下拉与时间下拉收进「高级筛选」弹层', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    // 表前只有一行：快筛条 .ts-toolbar 退役（chips 并回卡头，2026-10-04）
    expect(wrapper.find('.ts-toolbar').exists(), '快筛条已并回卡头一行').toBe(false);
    // 状态 / 时间 = 高级筛选弹层里的 select（枚举 = 全部状态 + statusOptions 10 档）
    await wrapper.find('.mk-adv .mk-btn').trigger('click');
    const sel = wrapper.find('.mk-adv__pop select[aria-label="按状态筛选"]');
    expect(sel.exists()).toBe(true);
    expect(sel.findAll('option').map((o) => o.text())).toEqual([
      '全部状态', '初始化中', '进行中', '已暂停', '超时', '已被替代', '失败', '收尾中', '收尾失败', '已完成', '已废弃'
    ]);
    expect(wrapper.find('.mk-adv__pop select[aria-label="按开始时间筛选"]').exists()).toBe(true);
    // 卡头两组 chips：焦点（单选，全部不显数）+ 快捷（两个独立开关）
    const groups = wrapper.findAll('.mk-card__head .mk-pills');
    expect(groups.map((g) => g.attributes('aria-label'))).toEqual(['焦点筛选', '快捷筛选']);
    expect(wrapper.findAll('.mk-card__head .mk-pills[aria-label="焦点筛选"] .mk-pill').map((c) => c.text().replace(/\d+$/, ''))).toEqual([
      '全部', '进行中', '待关注', '缺总结'
    ]);
    expect(wrapper.findAll('.mk-card__head .mk-pills[aria-label="快捷筛选"] .mk-pill').map((c) => c.text().replace(/\d+$/, ''))).toEqual([
      '有建议', '异常'
    ]);
    await sel.setValue('failed');
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户a');
    // 弹层里生效的筛选数标在触发钮上（收起来也不丢状态）
    expect(wrapper.find('.mk-adv .mk-btn .mk-pill__count').text()).toBe('1');
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
