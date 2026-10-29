/**
 * 总览 KPI 数值落定门（A1-2，2026-10-29 夜审）：
 * live 总览快照跨页常驻（boot 旧值、后端冷启动 0），首帧直接渲染会先出 0/旧值、
 * 1-2s 后被本轮刷新跳成真实值。钉住：本次挂载内首次成功刷新完成前，数值 KPI 显「—」。
 * （走真实 live.ts + mock adminApi，与 overview-kpi-targets.test.ts 同一套马具。）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Overview from '../Overview.vue';
import { liveOverviewFull } from '../live';

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

vi.mock('@/api/adminApi', () => ({
  adminDashboardApi: apiObject(),
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
}));

/** 让真实 fetchLiveOverview 用 mock 接口先造一份合法快照（后续用例以此作「旧值」） */
async function seedBaseSnapshot() {
  liveOverviewFull.value = null;
  const probe = mount(Overview);
  await flushPromises();
  await nextTick();
  await flushPromises();
  const base = liveOverviewFull.value;
  probe.unmount();
  return base;
}

describe('总览 KPI 数值落定门（A1-2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('挂载内首轮刷新未完成：数值 KPI 显「—」，旧快照值不上卡', async () => {
    const base = await seedBaseSnapshot();
    expect(base).toBeTruthy();
    // 模拟跨页重入：live 里还留着上一次的快照
    liveOverviewFull.value = base;
    const w = mount(Overview);
    // 同步断言（轮询在途）：卡已渲染（吃旧快照的结构），但数值位全是「—」
    const nums = w.findAll('.mk-kpi .mk-kpi__num').map((x) => x.text());
    expect(nums.length).toBeGreaterThanOrEqual(4);
    expect(nums.every((t) => t.includes('—'))).toBe(true);
    // 首轮刷新落地 → 数值上卡（mock 口径下今日调用为 0，但「0」也必须是刷新后的真值）
    await flushPromises();
    await nextTick();
    const after = w.findAll('.mk-kpi .mk-kpi__num').map((x) => x.text());
    expect(after.some((t) => !t.includes('—'))).toBe(true);
    w.unmount();
  });
});
