/**
 * TeachingSessions 筛选 ↔ URL + 行内动作 tooltip（2026-10-13 运营走查 O2c / O4）。
 *
 * O2c 实测缺陷：点快筛「异常18」→ 进详情 → 返回（应用内「← 会话列表」或浏览器后退）或刷新，
 * 都回到「全部」167 条 —— 逐条排查每看一条要重筛一次，也无法把「这批异常」的链接发给同事。
 * 现在应用视图（需关注/有建议）/ 状态下拉（含异常组合档）/ 课型 / 开始时间全部住进 URL。
 * O4：行内「链路 / 详情」两个词此前无任何说明，点前只能猜。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import TeachingSessions from '../TeachingSessions.vue';
import { clearPageCache, liveRefreshSeq } from '../live';
import { subPage, closeSubPage } from '../store';
import { filterValue } from './filter-controls';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminTeachingSessionsApi: {
    list: listMock,
    // 其余端点按需返回空壳（页面可能调用统计/重试等）
    getStats: vi.fn(async () => ({ data: { data: {} } }))
  }
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

async function mountTs(url: string) {
  clearPageCache('teaching-sessions');
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page?', component: { template: '<div />' } }] });
  await router.push(url);
  await router.isReady();
  const wrapper = mount(TeachingSessions, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({
    data: {
      data: {
        items: [
          makeItem('s-active'),
          makeItem('s-done', { status: 'completed' }),
          makeItem('s-failed', { status: 'failed' }),
          makeItem('s-discarded', { status: 'discarded' })
        ],
        pagination: { total: 4, page: 1, limit: 100 }
      }
    }
  });
});

describe('TeachingSessions · 筛选 ↔ URL（O2c）', () => {
  it('深链 ?pill=missing 落位：应用视图胶囊显示「缺总结」且可移除（返回 / 刷新还原）', async () => {
    const { wrapper } = await mountTs('/admin/teaching-sessions?pill=missing');
    const chip = wrapper.find('button.ts-view-chip');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain('缺总结');
    expect(chip.classes()).toContain('mk-pill--active');
    wrapper.unmount();
  });

  it('点「需关注」KPI → URL 带 pill=attention；点应用视图胶囊取消 → 删键', async () => {
    const { wrapper, router } = await mountTs('/admin/teaching-sessions');
    // 2026-10-26：需关注不再有常驻 chip——它是派生视图，入口是「需关注」KPI 卡
    const attention = wrapper.findAll('button.mk-kpi').find((c) => c.text().includes('需关注'))!;
    await attention.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.pill).toBe('attention');
    const chip = wrapper.find('button.ts-view-chip');
    expect(chip.text()).toContain('需关注');
    await chip.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.pill).toBeUndefined();
    wrapper.unmount();
  });

  it('「异常」进 URL（adv=abnormal）：刷新 / 分享后仍是异常视图', async () => {
    const { wrapper, router } = await mountTs('/admin/teaching-sessions');
    const abn = wrapper.findAll('.mk-kpi').find((c) => c.text().includes('异常'))!;
    await abn.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.adv).toBe('abnormal');
    // 旧独立键（abn）不再写出：异常已并入状态维度，URL 只留一个表达
    expect(router.currentRoute.value.query.abn).toBeUndefined();
    wrapper.unmount();
  });

  it('深链 ?abn=1 落位（旧链接兼容）：状态下拉 = 异常，KPI 卡是按下态', async () => {
    const { wrapper } = await mountTs('/admin/teaching-sessions?abn=1');
    expect(filterValue(wrapper as never, '状态')).toBe('abnormal');
    const abn = wrapper.findAll('.mk-kpi').find((c) => c.text().includes('异常'))!;
    expect(abn.attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });

  it('搜索词进 URL（q）', async () => {
    const { wrapper, router } = await mountTs('/admin/teaching-sessions');
    const input = wrapper.find('input[placeholder*="搜索主题"]');
    expect(input.exists()).toBe(true);
    await input.setValue('地理');
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe('地理');
    wrapper.unmount();
  });
});

describe('TeachingSessions · 行内动作（2026-10-19 下线链路 / 2026-10-26 撤重复详情钮）', () => {
  it('行内不再有「详情」钮（行点击已是同一动作），也没有「链路」入口', async () => {
    const { wrapper } = await mountTs('/admin/teaching-sessions');
    const btns = wrapper.findAll('button').filter((b) => ['链路', '详情'].includes(b.text()));
    expect(btns).toHaveLength(0);
    wrapper.unmount();
  });

  it('缺总结行点击 → 座舱总结页签（stage=wrapup）；其余行落默认页签', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          items: [
            makeItem('s-missing', { status: 'completed', wrapup: null }),
            makeItem('s-done', { status: 'completed', wrapup: { status: 'complete', summary: { topicSummary: '总结' } } })
          ],
          total: 2
        }
      }
    });
    const { wrapper } = await mountTs('/admin/teaching-sessions');
    const rows = wrapper.findAll('tbody tr');
    await rows[0].trigger('click');
    await flushPromises();
    expect(subPage.value).toMatchObject({ view: 'session-real', id: 's-missing', stage: 'wrapup' });
    closeSubPage();
    await rows[1].trigger('click');
    await flushPromises();
    expect(subPage.value).toMatchObject({ view: 'session-real', id: 's-done' });
    expect(subPage.value?.stage).toBeUndefined();
    closeSubPage();
    wrapper.unmount();
  });

  it('?wrap=eval-failed 落位：只留评估失败行，并写回 URL', async () => {
    listMock.mockResolvedValue({
      data: {
        data: {
          items: [
            makeItem('s-evalfail', {
              status: 'completed',
              wrapup: { status: 'complete', summary: { topicSummary: '总结' }, sources: { summary: 'model', evaluation: 'failed' } }
            }),
            makeItem('s-ok', {
              status: 'completed',
              wrapup: { status: 'complete', summary: { topicSummary: '总结' }, sources: { summary: 'model', evaluation: 'model' } }
            })
          ],
          total: 2
        }
      }
    });
    const { wrapper, router } = await mountTs('/admin/teaching-sessions?wrap=eval-failed');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.text()).toContain('用户s-evalfail');
    expect(router.currentRoute.value.query.wrap).toBe('eval-failed');
    wrapper.unmount();
  });

  it('顶栏刷新（liveRefreshSeq 广播）触发一次强制重拉', async () => {
    const { wrapper } = await mountTs('/admin/teaching-sessions');
    const before = listMock.mock.calls.length;
    liveRefreshSeq.value += 1;
    await flushPromises();
    expect(listMock.mock.calls.length).toBeGreaterThan(before);
    wrapper.unmount();
  });
});
