/**
 * Skills.vue P1 修复批冒烟：
 * 1. 目录表完成度列（复用对账 completion：live 渲染五档徽章，demo/无对账显示 —）
 * 2. 对账面板「仅看异常」切换（未注册/缺 ACTIVE 行过滤；完成度非 live 归「完成度」域，不再并入对账异常）
 * 3. 折叠 pill 口径标注（户口簿全量 vs 目录排除外挂能力）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import Skills from '../Skills.vue';
import SkillReconciliation from '../SkillReconciliation.vue';
import { dataSource, liveSkillStatsMap } from '../store';
import { liveSkillProfiles } from '../live';
import type { SkillCompletion, SkillReconciliationReport } from '@/api/adminApi';

const { getReconciliationMock } = vi.hoisted(() => ({
  getReconciliationMock: vi.fn(),
}));

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
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject({
    getReconciliation: getReconciliationMock,
    getSkills: vi.fn(async () => ({ data: { data: { skills: [] } } }))
  }),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject(),
  adminPromptWorkbenchApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminHealthCenterApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminSessionsApi: apiObject(),
  adminSkillWorkbenchApi: apiObject(),
  adminAgentPromptsApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminAgentsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

function makeCompletion(status: SkillCompletion['status']): SkillCompletion {
  return {
    status,
    gates: {
      draft: { ok: true, detail: '户口簿已登记' },
      handlerReady: { ok: true, detail: 'handler 已注册' },
      coreReady: { ok: true, detail: 'core 文件就绪' },
      fieldsSynced: { ok: true, detail: '字段路由已同步' },
      live: { ok: status === 'live', detail: status === 'live' ? 'ACTIVE prompt 生效' : '缺 ACTIVE prompt' }
    },
    items: [],
    warnings: []
  };
}

function makeRow(skillId: string, overrides: Partial<SkillReconciliationReport['items'][number]> = {}): SkillReconciliationReport['items'][number] {
  return {
    skillId,
    kind: 'mainline',
    displayName: `名称 ${skillId}`,
    stage: 'goal',
    parentAgent: 'goal-agent',
    book: true,
    manifest: true,
    registered: true,
    active: true,
    noPromptFile: false,
    registrationExempt: false,
    diff: null,
    completion: makeCompletion('live'),
    ...overrides
  };
}

function makeReport(): SkillReconciliationReport {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: 4,
      registered: 3,
      active: 2,
      byStatus: { live: 2, draft: 1, 'fields-synced': 1 },
      unregistered: 1,
      activeMissing: 0,
      orphanRegistrations: 0
    },
    items: [
      makeRow('live-a'),
      makeRow('live-b'),
      makeRow('draft-c', { completion: makeCompletion('draft') }),
      makeRow('orphan-d', { registered: false, diff: 'unregistered', completion: makeCompletion('fields-synced') })
    ],
    orphanRegistrations: []
  };
}

async function mountSkills() {
  dataSource.value = 'live';
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  await router.push('/admin/skills');
  await router.isReady();
  const wrapper = mount(Skills, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

/* 对账面板本体在 SkillReconciliation（HealthCenter 内嵌）；仅看异常/口径 pill 属该组件契约 */
async function mountRecon() {
  dataSource.value = 'live';
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  await router.push('/admin/health-center');
  await router.isReady();
  const wrapper = mount(SkillReconciliation, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

describe('Skill 目录 P1 修复批', () => {
  beforeEach(() => {
    getReconciliationMock.mockReset();
    dataSource.value = 'live';
    liveSkillProfiles.value = [];
    liveSkillStatsMap.value = null;
  });

  it('live 模式：目录表渲染完成度五档徽章（复用对账数据）', async () => {
    getReconciliationMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    liveSkillProfiles.value = [
      { id: 'live-a', name: 'Live A', category: 'analysis', agentId: 'goal-agent', agentName: '目标 Agent' },
      { id: 'draft-c', name: 'Draft C', category: 'analysis', agentId: 'goal-agent', agentName: '目标 Agent' },
      { id: 'not-in-rec', name: 'No Rec', category: 'tool', agentId: '', agentName: '' }
    ];
    liveSkillStatsMap.value = {
      'live-a': { calls: 5, errors: 0, avgMs: 100, lastAt: '刚刚' },
      'draft-c': { calls: 0, errors: 0, avgMs: 0, lastAt: '从未' },
      'not-in-rec': { calls: 0, errors: 0, avgMs: 0, lastAt: '从未' }
    };
    const wrapper = await mountSkills();
    expect(getReconciliationMock).toHaveBeenCalled();
    // 目录表完成度徽章：live → 已上线，draft → 草稿；无对账行 → —
    expect(wrapper.find('.sk-table tbody .mk-badge--rec-live').exists()).toBe(true);
    expect(wrapper.find('.sk-table tbody .mk-badge--rec-draft').exists()).toBe(true);
    expect(wrapper.text()).toContain('已上线');
    expect(wrapper.text()).toContain('草稿');
    wrapper.unmount();
  });

  it('对账面板口径 pill：「已上线 X / 总数」并列标注（户口簿全量口径）', async () => {
    getReconciliationMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    const wrapper = await mountRecon();
    // 对账面板（HealthCenter 内嵌的 SkillReconciliation）头部口径 pill
    const pill = wrapper.find('.sk-rec__pills .mk-pill');
    expect(pill.text()).toContain('已上线 2 / 4');
    // 异常计数 pill：未注册 1
    expect(wrapper.text()).toContain('未注册 1');
    wrapper.unmount();
  });

  it('对账面板「仅看异常」：过滤后仅剩未注册/无生效版本行，live 与草稿行隐藏', async () => {
    getReconciliationMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    const wrapper = await mountRecon();
    // 整卡折叠已退役（2026-10-05，details 包壳撤）：面板常开，无需展开步骤
    await flushPromises();
    const pills = wrapper.findAll('.sk-rec-tools .mk-pill');
    expect(pills.some((p) => p.text() === '仅看异常')).toBe(true);
    const rowsBefore = wrapper.findAll('.sk-rec-table tbody tr.sk-row').length;
    expect(rowsBefore).toBeGreaterThan(2);
    // 点击「仅看异常」→ 仅保留 diff 行（未注册/无生效版本）；live 行与「非 live 但无差集」的草稿行都隐藏
    // （2026-10-07 F6-3：完成度非 live 归「完成度」页签/第 4 张 KPI，不再并入对账异常口径）
    await pills.find((p) => p.text() === '仅看异常')!.trigger('click');
    await nextTick();
    await flushPromises();
    const rowsAfter = wrapper.findAll('.sk-rec-table tbody tr.sk-row').length;
    expect(rowsAfter).toBeLessThan(rowsBefore);
    const recRowTexts = wrapper.findAll('.sk-rec-table tbody tr.sk-row').map((r) => r.text());
    expect(recRowTexts.some((t) => t.includes('live-a'))).toBe(false);
    expect(recRowTexts.some((t) => t.includes('draft-c'))).toBe(false); // 非 live 但无差集 → 不属对账异常
    expect(wrapper.findAll('.sk-rec-table tbody tr.sk-row').some((r) => r.text().includes('未注册'))).toBe(true);
    wrapper.unmount();
  });

  it('F6-3：仅剩失效注册残留时，空态如实披露（不写「全部对账一致」）', async () => {
    // 全部 live 且无 diff 行，只有 1 条失效注册残留（对应真实 /skills/reconciliation：36 行 diff 全 null + triage-judge 残留）
    const report = makeReport();
    report.summary = { ...report.summary, total: 2, unregistered: 0, activeMissing: 0, orphanRegistrations: 1 };
    report.items = [makeRow('live-a'), makeRow('live-b')];
    report.orphanRegistrations = [{ name: 'triage-judge' }];
    getReconciliationMock.mockResolvedValue({ data: { success: true, data: report } });
    const wrapper = await mountRecon();
    await flushPromises();
    // 卡头 pill 报「失效注册 1」，残留块可定位
    expect(wrapper.text()).toContain('失效注册 1');
    expect(wrapper.find('.sk-rec-orphans').text()).toContain('triage-judge');
    // 点「仅看异常」→ 0 行（残留无户口簿行），空态必须披露残留而非「全部对账一致」
    await wrapper.findAll('.sk-rec-tools .mk-pill').find((p) => p.text() === '仅看异常')!.trigger('click');
    await nextTick();
    await flushPromises();
    expect(wrapper.findAll('.sk-rec-table tbody tr.sk-row').length).toBe(0);
    const empty = wrapper.find('.mk-empty').text();
    expect(empty).toContain('另有 1 条失效注册残留');
    expect(empty).not.toMatch(/^无异常技能：2 项全部对账一致$/);
    wrapper.unmount();
  });
});

/* 2026-09-29 用户拍板：健康检查/漂移/对账三 tab 退役——三者本是同一份报表的三刀，
   合一后独立成 /admin/health-center（系统组）。2026-10-04 Prompt 评估由独立场景折入，
   Skills 现为 Skill 运行 / 模型路由 / Prompt 评估三页签。 */
async function mountHost(path: string) {
  dataSource.value = 'live';
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/:page?', component: { template: '<div />' } },
      { path: '/admin/health-center', component: { template: '<div />' } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(Skills, { global: { plugins: [router] } });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return { wrapper, router };
}

describe('Skills 页 tab 收敛（健康中心独立成页）', () => {
  beforeEach(() => {
    getReconciliationMock.mockReset();
    dataSource.value = 'live';
    liveSkillProfiles.value = [];
    liveSkillStatsMap.value = null;
  });

  it('三个页签：Skill 运行 / 模型路由 / Prompt 评估，且不再渲染健康中心', async () => {
    const { wrapper } = await mountHost('/admin/skills');
    const tabs = wrapper.findAll('.skills-tabs .tab');
    expect(tabs.map((t) => t.text())).toEqual(['Skill 运行', '模型路由', 'Prompt 评估']);
    expect(wrapper.find('.hc-embedded').exists()).toBe(false);
    // 运行视图在位：KPI 卡带走 run 分支（无档案时 Skill 卡显 0；2026-10-04 状态条已退役）
    expect(wrapper.find('.mk-kpi-grid').exists()).toBe(true);
    wrapper.unmount();
  });

  it('老深链 ?tab=health|drift|recon 改投 /admin/health-center（?refresh 等定位参数带走）', async () => {
    for (const retired of ['health', 'drift', 'recon']) {
      const { wrapper, router } = await mountHost(`/admin/skills?tab=${retired}&refresh=1`);
      expect(router.currentRoute.value.path, `tab=${retired} 应改投健康中心`).toBe('/admin/health-center');
      expect(router.currentRoute.value.query.tab).toBeUndefined();
      expect(router.currentRoute.value.query.refresh).toBe('1');
      wrapper.unmount();
    }
  });

  it('点击「模型路由」切换 tab 并同步 ?tab=model-routing', async () => {
    const { wrapper, router } = await mountHost('/admin/skills');
    await wrapper.findAll('.skills-tabs .tab').find((t) => t.text() === '模型路由')!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe('model-routing');
    // 离开运行视图后：运行统计带随页签消失（模型路由页签自带路由四卡，非运行读数）
    const runRateCard = wrapper.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '成功率');
    expect(runRateCard).toBeUndefined();
    expect(wrapper.text()).not.toContain('仅看需关注');
    wrapper.unmount();
  });
});
