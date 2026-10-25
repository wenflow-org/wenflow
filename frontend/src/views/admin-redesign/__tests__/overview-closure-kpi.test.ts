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
  return wrapper.findAll('button.mk-kpi').find((x) => x.text().includes('完课量'));
}

beforeEach(() => {
  closureSummaryMock.mockReset();
  closureSummaryMock.mockImplementation(async () => ({
    data: {
      data: {
        total: 127,
        byTrack: { human: 0, 'virtual-learner': 20, unknown: 0, legacy: 107 },
        bySource: { unknown: 107, 'vl-assisted': 20 },
        pathCompletions: 1
      }
    }
  }));
  intent.scene = '';
});

describe('总览完课量 KPI（#105）', () => {
  it('分解挂在数值行内（valueNote）：真实 / 虚拟 / 未标记；不再单开副行抬高整排（2026-10-21）', async () => {
    const wrapper = await mountOverview();

    const card = closureCard(wrapper);
    expect(card).toBeTruthy();
    expect(card!.text()).toContain('127');
    const note = card!.find('.mk-kpi__num-note');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain('真实 0');
    expect(note.text()).toContain('虚拟 20');
    expect(note.text()).toContain('未标记 107');
    // 五卡里只有这一卡曾带副行，副行撤掉后整排高度一致
    expect(card!.find('.mk-kpi__hint').exists()).toBe(false);
  });

  it('title 只保留与真实口径不同源的限定', async () => {
    const wrapper = await mountOverview();

    const title = closureCard(wrapper)!.attributes('title') || '';
    expect(title).toContain('与上方真实口径 KPI 不同源');
    expect(title).not.toContain('不回填');
    expect(title).not.toContain('通道构成');
  });

  it('点击进教学会话页（逐条轨道/通道在那里）', async () => {
    const wrapper = await mountOverview();

    await closureCard(wrapper)!.trigger('click');
    expect(intent.scene).toBe('teaching-sessions');
  });

  it('读数失败不伪造 0：值给「—」、hint 如实呈报', async () => {
    closureSummaryMock.mockImplementation(async () => {
      throw new Error('boom');
    });
    const wrapper = await mountOverview();

    const card = closureCard(wrapper);
    expect(card!.text()).toContain('—');
    expect(card!.text()).toContain('读数加载失败');
    expect(card!.text()).not.toContain('未标记');
  });
});
