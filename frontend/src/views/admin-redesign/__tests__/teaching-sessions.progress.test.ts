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
  it('状态条：粗体结论（窗口口径单源化）+ 缺总结 meta + 「只看需关注」快捷钮（点选接既有待关注筛选）', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    const status = wrapper.find('.mk-status');
    // P3（2026-10-04 全站评审）：逐项窗口括注撤除；未触上限时不显示窗口 meta
    expect(status.find('.mk-status__title').text()).toBe('1 个会话需关注');
    expect(status.text()).not.toContain('（最近 1000 条）');
    expect(status.text()).not.toContain('条窗口');
    expect(status.text()).toContain('缺总结 1');
    const quick = status.find('.mk-status__actions button');
    expect(quick.text()).toBe('只看需关注');
    expect(quick.attributes('aria-pressed')).toBe('false');
    await quick.trigger('click');
    expect(quick.attributes('aria-pressed')).toBe('true');
    // 快捷钮 = 既有「待关注」筛选口径（attention !== low）：只剩失败行
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户a');
    wrapper.unmount();
  });

  it('tsDashTone bad 档（补死分支）：失败/收尾失败/超时合计 ≥ 10 → 页头转红 + title 披露阈值', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: Array.from({ length: 10 }, (_, i) => makeItem(`f${i}`, { status: 'failed' })) }
      }
    });
    const wrapper = await mountLive();
    const status = wrapper.find('.mk-status');
    expect(status.classes()).toContain('mk-status--bad');
    expect(status.attributes('title')).toContain('≥ 10');
    expect(status.attributes('title')).toContain('失败 / 收尾失败 / 超时');
    wrapper.unmount();
  });

  it('状态条「有建议」可点穿：服务端 onlyWithAdvisory 过滤 toggle（再点取消）；建议徽章行内预览 + title 全文', async () => {
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
    const link = wrapper.find('.mk-status__meta-link');
    expect(link.text()).toContain('有建议 1');
    expect(link.attributes('aria-pressed')).toBe('false');
    // 建议徽章：行内直出建议标题（首行预览），title 挂完整建议文本
    const adv = wrapper.find('.ts-adv-badge');
    expect(adv.text()).toBe('建议加强练习');
    expect(adv.attributes('title')).toContain('建议加强练习：多做错题');
    // 点击 → 服务端过滤（onlyWithAdvisory: true），再点 → 取消（参数收敛）
    await link.trigger('click');
    await flushPromises();
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ onlyWithAdvisory: true, limit: 1000 }));
    expect(wrapper.find('.mk-status__meta-link').attributes('aria-pressed')).toBe('true');
    await wrapper.find('.mk-status__meta-link').trigger('click');
    await flushPromises();
    const lastArg = listMock.mock.calls[listMock.mock.calls.length - 1][0];
    expect(lastArg.onlyWithAdvisory).toBeUndefined();
    wrapper.unmount();
  });

  it('分布卡「异常」badge 可点穿：失败/收尾失败/超时 状态多选筛选 toggle', async () => {
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
    const abn = wrapper.find('.ts-badge-toggle');
    expect(abn.text()).toBe('异常 2');
    expect(abn.attributes('aria-pressed')).toBe('false');
    await abn.trigger('click');
    await nextTick();
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    expect(wrapper.find('.ts-badge-toggle').attributes('aria-pressed')).toBe('true');
    await wrapper.find('.ts-badge-toggle').trigger('click');
    await nextTick();
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    wrapper.unmount();
  });

  it('分布卡 legend：零值档折叠为「+N 个零值状态」（与段条滤零口径一致），title 披露档名', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    const legend = wrapper.findAll('.sbl');
    // 10 档枚举中仅 失败/进行中 非零 + 1 行零值折叠提示
    expect(legend).toHaveLength(3);
    expect(legend[2].text()).toBe('+8 个零值状态');
    expect(legend[2].attributes('title')).toContain('初始化中');
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

  it('筛选：状态收进卡头 select（2026-10-03 退役右组 11 枚 chips）；左组为既有焦点 chips', async () => {
    listMock.mockResolvedValue({
      data: {
        success: true,
        data: { items: [makeItem('a', { status: 'failed' }), makeItem('b', { status: 'active' })] }
      }
    });
    const wrapper = await mountLive();
    // 状态筛选 = 卡头 select（枚举 = 全部状态 + statusOptions 10 档）
    const sel = wrapper.find('select[aria-label="按状态筛选"]');
    expect(sel.exists()).toBe(true);
    expect(sel.findAll('option').map((o) => o.text())).toEqual([
      '全部状态', '初始化中', '进行中', '已暂停', '超时', '已被替代', '失败', '收尾中', '收尾失败', '已完成', '已废弃'
    ]);
    // 工具条只剩左组焦点 chips（右组 chips 退役 → 无第二组）
    const groups = wrapper.findAll('.ts-toolbar .mk-pills');
    expect(groups).toHaveLength(1);
    expect(groups[0].findAll('.mk-pill').map((c) => c.text().replace(/\d+$/, ''))).toEqual([
      '全部', '进行中', '待关注', '缺总结'
    ]);
    await sel.setValue('failed');
    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain('用户a');
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
