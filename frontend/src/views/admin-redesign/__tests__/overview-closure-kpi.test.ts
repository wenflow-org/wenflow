/**
 * 总览「完课量」KPI（#105 读侧接入，2026-10-19）。
 *
 * 锁定 KPI 家法：hint 一行可见口径（真实 / 虚拟 / 未标记分解），长释（含「不回填」纪律与
 * 通道构成）进 title；历史无 track 的 legacy 行如实计「未标记」，不并入真实/虚拟。
 * 数据源 = /admin/overview/closure（learner_evidence 已投影收束事件）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Overview from '../Overview.vue';
import { liveOverviewFull } from '../live';
import { intent } from '../store';

const { apiObject, closureSummaryMock } = vi.hoisted(() => ({
  apiObject: () =>
    new Proxy({} as Record<string, unknown>, {
      get: (target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        // 显式挂载的方法优先（如 getClosureSummary 的定制 mock），其余方法返回空壳成功响应
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        return vi.fn(async () => ({ data: {} }));
      }
    }),
  closureSummaryMock: vi.fn(async () => ({ data: { data: {} } }))
}));

vi.mock('@/api/adminApi', () => {
  const dash = apiObject();
  dash.getClosureSummary = closureSummaryMock;
  return {
    adminDashboardApi: dash,
    adminHealthCenterApi: apiObject(),
    adminMemoryReviewApi: apiObject(),
    adminTeachingSessionsApi: apiObject(),
    adminSkillsApi: apiObject(),
    adminUsersApi: apiObject(),
    adminLearnerModelsApi: apiObject(),
    adminMemoryTracesApi: apiObject(),
    adminVirtualLearnersApi: apiObject(),
    adminApiConfigApi: apiObject(),
    adminAgentsApi: apiObject(),
    adminPromptOpsApi: apiObject(),
    adminAgentTopologyApi: apiObject(),
    adminPlatformSettingsApi: apiObject(),
    adminAnnouncementsApi: apiObject(),
    adminGoalConversationsApi: apiObject(),
    adminRuntimeDefinitionsApi: apiObject(),
  };
});

async function mountOverview() {
  liveOverviewFull.value = null;
  const wrapper = mount(Overview);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

function closureCard(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.mk-kpi').find((x) => x.text().includes('完课量'));
}

beforeEach(() => {
  closureSummaryMock.mockReset();
  closureSummaryMock.mockImplementation(async () => ({
    data: {
      data: {
        // #186 口径对齐后的真实响应形状：主值 total 与 byTrack 同源同口径（非虚拟），
        // 行内注「真实 + 未标记」之和恒等于 total（90+17=107）；虚拟 20 单列、标注「不计入」。
        total: 107,
        byTrack: { human: 90, 'virtual-learner': 0, unknown: 0, legacy: 17 },
        bySource: { 'human-ui': 90, unknown: 17 },
        virtualCount: 20,
        pathCompletions: 1
      }
    }
  }));
  intent.scene = '';
});

describe('总览完课量 KPI（#105）', () => {
  it('分解挂在数值行内（valueNote）：真实 / 未标记之和 = 主值；虚拟单列标注「不计入」', async () => {
    const wrapper = await mountOverview();

    const card = closureCard(wrapper);
    expect(card).toBeTruthy();
    expect(card!.text()).toContain('107');
    const note = card!.find('.mk-kpi__num-note');
    expect(note.exists()).toBe(true);
    // 与主值同口径的两项相加 = 107（数值行内自证，不再「主值 107 却标真实 0」）
    expect(note.text()).toContain('真实 90');
    expect(note.text()).toContain('未标记 17');
    // 虚拟单列，且明确标注不计入主值
    expect(note.text()).toContain('虚拟 20');
    expect(note.text()).toContain('不计入');
    // 五卡里只有这一卡曾带副行，副行撤掉后整排高度一致
    expect(card!.find('.mk-kpi__hint').exists()).toBe(false);
  });

  it('title 说明主值走非虚拟口径、虚拟单列不计入', async () => {
    const wrapper = await mountOverview();

    const title = closureCard(wrapper)!.attributes('title') || '';
    expect(title).toContain('非虚拟口径');
    expect(title).toContain('不计入');
    expect(title).not.toContain('不回填');
    expect(title).not.toContain('通道构成');
  });

  it('点击进教学会话页（逐条轨道/通道在那里）', async () => {
    const wrapper = await mountOverview();

    await closureCard(wrapper)!.trigger('click');
    expect(intent.scene).toBe('teaching-sessions');
  });
  it('读数失败不伪造 0：值给「—」、说明如实呈报（走悬停），并在卡内给重试', async () => {
    closureSummaryMock.mockImplementation(async () => {
      throw new Error('boom');
    });
    const wrapper = await mountOverview();

    const card = closureCard(wrapper);
    expect(card!.text()).toContain('—');
    /* 2026-11-01：卡内不再渲染解释文字，失败说明退到卡根 title */
    expect(card!.find('.mk-kpi__hint').exists()).toBe(false);
    expect(card!.attributes('title')).toContain('读数加载失败');
    expect(card!.text()).not.toContain('未标记');
    // 2026-10-26：失败态卡不可点（读数不可信），卡内自带重试，不再只能靠整页重试
    expect(card!.classes()).not.toContain('mk-kpi--clickable');
    const retry = card!.findAll('button').find((b) => b.text() === '重试');
    expect(retry).toBeTruthy();
    expect(closureSummaryMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('加载中不把「读数加载中…」写成卡面文案', async () => {
    closureSummaryMock.mockImplementation(() => new Promise(() => {}) as never);
    const wrapper = mount(Overview);
    await nextTick();

    const card = closureCard(wrapper);
    expect(card).toBeTruthy();
    expect(card!.text()).not.toContain('读数加载中');
    wrapper.unmount();
  });
});
