/**
 * 教学会话 · 2026-11-09 外部评审整改回归（管理端列表一致性批次）。
 *
 * 覆盖五条走查结论：
 * 1. 用户格统一双行结构：姓名 + 邮箱；无邮箱退化为截断后的用户 ID（重名 / 特殊账号可区分）；
 * 2. 操作列存在且主操作「详情」与行点击进同一个只读座舱；
 * 3. 分页器默认每页 15 条（不随改动漂移）；
 * 4. 课堂列有封顶宽度规则（百分比 + min/max），不再在 1920 下无限吞掉余量；
 * 5. 完结率 KPI 带副注「已完成 X/Y」（与数字同源同批数据）；
 *    + 底部截断修复：滚动区带底部留白与渐隐遮罩；
 *    + 状态下拉空档文案「全部」（触发器读作「状态 全部」）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import TeachingSessions from '../TeachingSessions.vue';
import { dataSource, subPage, closeSubPage } from '../store';
import { clearPageCache } from '../live';
import { filterValue } from './filter-controls';

const mockRouter = () =>
  createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] });

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminTeachingSessionsApi: {
    list: listMock,
    // 页面可能调用其它端点：统一回空壳
    getStats: vi.fn(async () => ({ data: { data: {} } }))
  }
}));

function makeItem(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    userId: 'user_abcdefghijklmnopqrstuvwxyz' + id,
    userName: '用户' + id,
    email: id + '@example.com',
    topic: '主题 ' + id,
    subject: '学科',
    taskType: 'practice',
    status: 'completed',
    duration: 600,
    messageCount: 4,
    knowledgePointCount: 2,
    startTime: '2026-08-12T02:00:00.000Z',
    wrapup: { status: 'complete', summary: { topicSummary: '总结' } },
    advisory: null,
    progress: null,
    ...overrides
  };
}

async function mountLive(items: Array<Record<string, unknown>>) {
  listMock.mockResolvedValue({ data: { data: { items, total: items.length } } });
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
  closeSubPage();
});

describe('用户格双行（2026-11-09 跨页一致性）', () => {
  it('有邮箱 → 副行渲染邮箱', async () => {
    const wrapper = await mountLive([makeItem('a', { email: 'sim29@sim.local' })]);
    const user = wrapper.find('tbody tr .ts-user');
    expect(user.find('.mk-cell-sub').text()).toBe('sim29@sim.local');
    expect(user.find('.mk-cell-sub').attributes('title')).toBe('sim29@sim.local');
    wrapper.unmount();
  });

  it('重名用户靠邮箱区分（两个「林见微」副行各不相同）', async () => {
    const wrapper = await mountLive([
      makeItem('a', { userName: '林见微', email: 'sim29@sim.local' }),
      makeItem('b', { userName: '林见微', email: 'sim30@sim.local' })
    ]);
    const subs = wrapper.findAll('tbody tr .ts-user .mk-cell-sub').map((s) => s.text());
    expect(subs).toEqual(['sim29@sim.local', 'sim30@sim.local']);
    wrapper.unmount();
  });

  it('缺邮箱 → 副行退化为截断后的用户 ID（不空白、不泄裸 cuid）', async () => {
    const wrapper = await mountLive([makeItem('a', { email: '', userId: 'uxcheck_1234567890abcdefghij' })]);
    const sub = wrapper.find('tbody tr .ts-user .mk-cell-sub');
    expect(sub.exists()).toBe(true);
    expect(sub.text()).toBe('uxcheck_1234…efghij');
    expect(sub.attributes('title')).toBe('uxcheck_1234567890abcdefghij');
    wrapper.unmount();
  });
});

describe('操作列（对齐学习路径：详情主操作）', () => {
  it('表头有「操作」列，且走全局 .mk-c-act 宽度类', async () => {
    const wrapper = await mountLive([makeItem('a')]);
    const act = wrapper.find('thead th.mk-c-act');
    expect(act.exists()).toBe(true);
    expect(act.text()).toBe('操作');
    expect(act.classes()).toContain('mk-th--right');
    expect(wrapper.find('tbody td .mk-actions .mk-link').text()).toBe('详情');
    wrapper.unmount();
  });

  it('点「详情」→ 与行点击同一个只读座舱（session-real + 该行 id）', async () => {
    closeSubPage();
    const wrapper = await mountLive([makeItem('sess-42')]);
    await wrapper.find('tbody td .mk-actions .mk-link').trigger('click');
    await nextTick();
    expect(subPage.value?.view).toBe('session-real');
    expect(subPage.value?.id).toBe('sess-42');
    wrapper.unmount();
  });

  it('缺总结行的「详情」与行点击落点一致（座舱 summary 页签）', async () => {
    closeSubPage();
    const wrapper = await mountLive([makeItem('s-miss', { status: 'completed', wrapup: null })]);
    await wrapper.find('tbody td .mk-actions .mk-link').trigger('click');
    await nextTick();
    expect(subPage.value?.view).toBe('session-real');
    expect(subPage.value?.id).toBe('s-miss');
    expect(subPage.value?.stage).toBe('wrapup');
    wrapper.unmount();
  });

  /* 2026-11-09 用户走查（图 3）「右侧操作列只有 详情，建议和图 1、图 2 一样保持 详情 ...」 */
  it('操作列是「详情 + ⋯」：菜单里查看学习者 / 查看课后总结，且不放工程排查入口', async () => {
    closeSubPage();
    const wrapper = await mountLive([makeItem('s-7')]);
    const menuBtn = wrapper.find('tbody .mk-menu__btn');
    expect(menuBtn.exists()).toBe(true);
    expect(menuBtn.attributes('aria-label')).toBe('更多操作');
    await menuBtn.trigger('click');
    await nextTick();
    const items = wrapper.findAll('tbody .mk-menu__pop .mk-menu__item').map((b) => b.text());
    expect(items).toEqual(['查看学习者', '查看课后总结']);
    // 2026-10-19 用户拍板：工程排查面（执行日志 / Trace）不进运营列表
    expect(items.join('')).not.toContain('执行日志');
    expect(items.join('')).not.toContain('Trace');

    // 「查看课后总结」直接落座舱总结页签（不按缺总结再分叉）
    await wrapper.findAll('tbody .mk-menu__pop .mk-menu__item')[1].trigger('click');
    await nextTick();
    expect(subPage.value?.view).toBe('session-real');
    expect(subPage.value?.id).toBe('s-7');
    expect(subPage.value?.stage).toBe('wrapup');
    wrapper.unmount();
  });

  it('「查看学习者」落学习者详情，带该行 userId', async () => {
    closeSubPage();
    const wrapper = await mountLive([makeItem('s-8')]);
    await wrapper.find('tbody .mk-menu__btn').trigger('click');
    await nextTick();
    await wrapper.findAll('tbody .mk-menu__pop .mk-menu__item')[0].trigger('click');
    await nextTick();
    expect(subPage.value?.view).toBe('learner');
    expect(subPage.value?.id).toBe('user_abcdefghijklmnopqrstuvwxyz' + 's-8');
    wrapper.unmount();
  });
});

describe('分页 / 尺寸预算', () => {
  it('默认每页 15 条：20 行数据第 1 页只渲染 15 行', async () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem(`r${i}`));
    const wrapper = await mountLive(items);
    expect(wrapper.findAll('tbody tr')).toHaveLength(15);
    const pager = wrapper.find('.mk-pagination');
    expect(pager.exists()).toBe(true);
    expect(pager.text()).toContain('共 20');
    wrapper.unmount();
  });

  it('课堂列有封顶宽度规则（百分比 + min/max），不在 1920 下无限吞余量', () => {
    const src = readFileSync(resolve(__dirname, '..', 'TeachingSessions.vue'), 'utf8');
    const block = src.match(/\.ts-c-topic\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('%');
    expect(block).toMatch(/max-width:\s*\d+px/);
    expect(block).toMatch(/min-width:\s*\d+px/);
  });
});

describe('KPI 副注与底部截断', () => {
  it('完结率副注写「已完成 X/Y」，与负载数据同源', async () => {
    const wrapper = await mountLive([
      makeItem('a', { status: 'completed' }),
      makeItem('b', { status: 'completed' }),
      makeItem('c', { status: 'failed' }),
      makeItem('d', { status: 'active' })
    ]);
    const rate = wrapper.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '完结率')!;
    expect(rate.find('.mk-kpi__num').text()).toBe('50%已完成 2/4');
    expect(rate.find('.mk-kpi__num-note').text()).toBe('已完成 2/4');
    wrapper.unmount();
  });

  it('滚动区带底部留白 + 渐隐遮罩（最后一行不被分页栏腰斩）', () => {
    const src = readFileSync(resolve(__dirname, '..', 'TeachingSessions.vue'), 'utf8');
    const style = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '';
    const block = style.match(/\.ts-table-scroll\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toMatch(/padding-bottom:\s*1[0-9]px/);
    expect(block).toMatch(/mask-image/);
    expect(block).toContain('linear-gradient');
    // 表格容器确实挂了该类
    expect(src).toMatch(/class="mk-table-scroll ts-table-scroll"/);
  });
});

describe('状态下拉空档文案', () => {
  it('「全部」而非「全部状态」：触发器读作「状态 全部」，当前值为空', async () => {
    const wrapper = await mountLive([makeItem('a')]);
    expect(filterValue(wrapper as never, '状态')).toBe('');
    const label = wrapper
      .findAll('.mk-pillselect-wrap')
      .find((w) => w.find('.mk-pillselect__k').text() === '状态')!;
    expect(label.text()).toContain('全部');
    expect(label.text()).not.toContain('全部状态');
    wrapper.unmount();
  });
});

/**
 * 2026-11-09 用户走查（图 3）：顶部「异常 2 / 有建议 14」在表格列里找不到落点——
 * 「课后总结」列就地透出这两枚信号徽章，KPI 读数因此能逐行对上。
 */
describe('课后总结列的信号徽章（对齐顶部 KPI）', () => {
  it('异常行出「异常」徽章；有建议行出「有建议」；两者并存时两枚都在', async () => {
    const advisory = {
      shouldSuggest: true,
      priority: 'high',
      recommendation: 'reinforce',
      scope: 'downstream_path',
      reasonCodes: ['prerequisite_gaps'],
      rationale: '继续按原路径推进的成本偏高。'
    };
    const wrapper = await mountLive([
      makeItem('ok-1'),
      makeItem('abn-1', { status: 'timeout', wrapup: null }),
      makeItem('adv-1', { advisory }),
      makeItem('both-1', { status: 'failed', wrapup: null, advisory }),
    ]);
    const badges = (id: string) => {
      const row = wrapper.findAll('tbody tr').find((r) => r.text().includes('主题 ' + id))!;
      return row.findAll('.ts-out .mk-badge').map((b) => b.text());
    };
    expect(badges('ok-1')).toEqual(['有总结']);
    expect(badges('abn-1')).toContain('异常');
    expect(badges('adv-1')).toContain('有建议');
    expect(badges('both-1')).toEqual(['缺总结', '异常', '有建议']);
    // 异常徽章与顶部「异常」卡同判据：失败 / 收尾失败 / 超时
    expect(badges('abn-1')).not.toContain('有建议');
    wrapper.unmount();
  });

  it('学员已选择保持原计划 → 出灰色「已保持计划」，不与待确认建议同色', async () => {
    const wrapper = await mountLive([
      makeItem('keep-1', {
        advisory: {
          shouldSuggest: true,
          priority: 'high',
          recommendation: 'reinforce',
          scope: 'downstream_path',
          reasonCodes: ['prerequisite_gaps'],
          learnerResponse: { action: 'keep', at: '2026-10-21T10:00:00.000Z' }
        }
      }),
    ]);
    const badge = wrapper.find('tbody tr .ts-out .mk-badge:not(.mk-badge--ok)');
    expect(badge.text()).toBe('已保持计划');
    expect(badge.classes()).toContain('mk-badge--muted');
    wrapper.unmount();
  });
});

describe('加载 / 空态 / 时间口径（2026-11-11 全站打磨）', () => {
  it('加载失败 → 错误条带可读原因 + 重试，不伪装成空态', async () => {
    listMock.mockRejectedValue(new Error('网络不可达'));
    dataSource.value = 'live';
    const wrapper = mount(TeachingSessions, { global: { plugins: [mockRouter()] } });
    await flushPromises();
    await nextTick();
    await flushPromises();
    const alert = wrapper.find('.mk-alert--row');
    expect(alert.text()).toContain('教学会话加载失败：网络不可达');
    expect(alert.find('.mk-alert__btn').text()).toBe('重试');
    expect(wrapper.find('.mk-empty').exists()).toBe(false);
    wrapper.unmount();
  });

  it('0 条且未筛选 → 空态说明来源并给「查看学习者」出口', async () => {
    const wrapper = await mountLive([]);
    const empty = wrapper.find('.mk-empty');
    expect(empty.text()).toContain('暂无教学会话');
    expect(empty.text()).toContain('教学会话由学习者在端内发起');
    expect(empty.findAll('button').some((b) => b.text() === '查看学习者')).toBe(true);
    wrapper.unmount();
  });

  it('开始时间悬停用 YYYY-MM-DD HH:mm，不再输出 2026/11/11 口径', async () => {
    const wrapper = await mountLive([makeItem('a', { startTime: '2026-08-12T02:00:00.000Z' })]);
    const startCell = wrapper.findAll('tbody tr')[0].findAll('td')[5];
    const title = startCell.find('.mk-cell-sub').attributes('title') || '';
    expect(title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(title).not.toContain('/');
    wrapper.unmount();
  });
});
