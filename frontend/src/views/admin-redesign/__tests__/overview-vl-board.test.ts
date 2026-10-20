/**
 * 总览 row3 第三卡「虚拟学习者看板」（2026-10-19 用户「这块区域 4K 下看着也很空，
 * 可以做三个看板，我倾向于做一个虚拟学习者的在这里」）。
 *
 * 锁三件事：
 *  1) 三栏落地：row3 里第三张卡是虚拟学习者，且读的是本页 boot 已有的 live 同源 ref；
 *  2) 三态纪律：加载中「…」、失败「—」+ 重试，绝不把「没拉到」渲染成真实 0；
 *  3) 列表域失败必须并入失败态（live.ts 只在列表 GET 成功后拉运行统计，
 *     列表挂了统计保持初值 0 而 liveVirtualStatsError 仍为空 → 假绿）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Overview from '../Overview.vue';
import {
  liveOverviewFull,
  liveVirtualRunStats,
  liveVirtualSessionStats,
  liveAutopilotConcurrency,
  liveVirtualStatsLoaded,
  liveVirtualStatsLoading,
  liveVirtualStatsError,
  liveFailures
} from '../live';
import { intent } from '../store';

const { apiObject } = vi.hoisted(() => ({
  apiObject: () =>
    new Proxy({} as Record<string, unknown>, {
      get: (target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

vi.mock('@/api/adminApi', () => {
  const dash = apiObject();
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
    adminRuntimeDefinitionsApi: apiObject()
  };
});

function resetLive() {
  liveOverviewFull.value = null;
  liveVirtualStatsLoaded.value = false;
  liveVirtualStatsLoading.value = false;
  liveVirtualStatsError.value = '';
  liveFailures.value = {};
  liveVirtualRunStats.value = {
    profileCount: 0,
    totalSessions: 0,
    created: 0,
    running: 0,
    failed: 0,
    abandoned: 0,
    completed: 0,
    completionRate: 0,
    failureRate: 0,
    systemFailureRate: 0,
    humanTerminatedRate: 0,
    staleCount: 0,
    maxStaleMins: 0,
    avgDurationMs: 0,
    reclaimThresholdMs: 0,
    todayCalls: 0
  };
  liveVirtualSessionStats.value = { created: 0, running: 0, failed: 0, abandoned: 0, completed: 0, total: 0 };
  liveAutopilotConcurrency.value = { used: 0, limit: 10, queued: 0 };
  intent.scene = '';
}

function readyStats() {
  liveVirtualStatsLoaded.value = true;
  liveVirtualRunStats.value = {
    ...liveVirtualRunStats.value,
    profileCount: 42,
    totalSessions: 128,
    running: 3,
    failed: 5,
    abandoned: 6,
    completed: 117,
    completionRate: 91.4,
    systemFailureRate: 3.9,
    humanTerminatedRate: 4.7,
    staleCount: 2,
    todayCalls: 77
  };
  liveVirtualSessionStats.value = { created: 1, running: 3, failed: 5, abandoned: 6, completed: 117, total: 128 };
  liveAutopilotConcurrency.value = { used: 2, limit: 10, queued: 1 };
}

async function mountOverview() {
  const wrapper = mount(Overview);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

function vlCard(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('.ov-card--vl');
}

beforeEach(() => {
  resetLive();
});

describe('总览 row3 第三卡：虚拟学习者看板', () => {
  it('row3 三栏：第三张卡是虚拟学习者，口径写明「仅虚拟学习者与测试账号」', async () => {
    const wrapper = await mountOverview();

    const row3 = wrapper.find('.row3');
    expect(row3.findAll('.mk-card').length).toBe(3);
    const card = vlCard(wrapper);
    expect(card.exists()).toBe(true);
    expect(card.find('.mk-card__title').text()).toBe('虚拟学习者');
    expect(card.find('.mk-card__meta').text()).toContain('仅虚拟学习者与测试账号');
  });

  it('读的是本页已加载的 live 同源数据（六格读数全部是真读数）', async () => {
    readyStats();
    const wrapper = await mountOverview();

    const text = vlCard(wrapper).text();
    for (const label of ['学习者', '在跑会话', '自动驾驶并发', '无响应会话', '完成率', '系统失败率']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('42'); // 学习者
    expect(text).toContain('3'); // 在跑会话
    expect(text).toContain('2/10'); // 并发 used/limit
    expect(text).toContain('91%'); // 完成率取整
    expect(text).toContain('今日调用 77 次'); // 卡底当日读数
    expect(text).toContain('排队 1'); // 排队非零才出现
  });

  it('加载中不给数字：六格显「…」，不把未加载渲染成 0', async () => {
    const wrapper = await mountOverview();

    const card = vlCard(wrapper);
    expect(card.text()).not.toContain('0%');
    expect(card.findAll('.mk-stat__value').map((v) => v.text())).toEqual(['…', '…', '…', '…', '…', '…']);
  });

  it('统计域失败：显「不可用 + 重试」，值给「—」而非 0', async () => {
    liveVirtualStatsLoaded.value = true; // 曾成功过又失败：不得回落到 0
    liveVirtualStatsError.value = 'boom';
    const wrapper = await mountOverview();

    const card = vlCard(wrapper);
    expect(card.text()).toContain('不可用');
    expect(card.find('.ov-vl__state--bad').text()).toContain('重试');
    expect(card.findAll('.mk-stat__value').map((v) => v.text())).toEqual(['—', '—', '—', '—', '—', '—']);
  });

  it('列表域失败也判失败态（否则统计初值 0 会被读成完成率 0% 的假绿）', async () => {
    liveVirtualStatsLoaded.value = true;
    liveVirtualStatsError.value = '';
    liveFailures.value = { virtuals: 'list down' };
    const wrapper = await mountOverview();

    const card = vlCard(wrapper);
    expect(card.find('.ov-vl__state--bad').exists()).toBe(true);
    expect(card.findAll('.mk-stat__value').map((v) => v.text())).toEqual(['—', '—', '—', '—', '—', '—']);
  });

  it('一条会话都没有时比率给「—」：无分母不伪造 0%（rate-utils 判例）', async () => {
    liveVirtualStatsLoaded.value = true;
    liveVirtualRunStats.value = { ...liveVirtualRunStats.value, profileCount: 21, totalSessions: 0 };
    const wrapper = await mountOverview();

    const values = vlCard(wrapper).findAll('.mk-stat__value').map((v) => v.text());
    expect(values[0]).toBe('21'); // 学习者仍是真 0 之外的读数
    expect(values[4]).toBe('—'); // 完成率
    expect(values[5]).toBe('—'); // 系统失败率
    expect(values).not.toContain('0%');
  });

  it('判据与重试接线：白盒锁住 liveFailures.virtuals 并入 + 统计域与列表域一起重拉', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'Overview.vue'), 'utf8');

    expect(src).toContain("liveVirtualStatsError.value || liveFailures.value.virtuals");
    const retry = src.slice(src.indexOf('function retryVlBoard'));
    expect(retry).toContain('retryLiveVirtualStats()');
    expect(retry).toContain('loadLiveData()');
  });
});
