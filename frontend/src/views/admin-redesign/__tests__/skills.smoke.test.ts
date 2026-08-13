/**
 * Skills.vue P1 修复批冒烟：
 * 1. 目录表完成度列（复用对账 completion：live 渲染五档徽章，demo/无对账显示 —）
 * 2. 对账面板「仅看异常」切换（未注册/缺 ACTIVE/非 live 行过滤，与目录表「仅看需关注」对称）
 * 3. 折叠 pill 口径标注（户口簿全量 vs 目录排除外挂能力）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import Skills from '../Skills.vue';
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

async function mountSkills(live: boolean) {
  dataSource.value = live ? 'live' : 'demo';
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

describe('Skill 目录 P1 修复批', () => {
  beforeEach(() => {
    getReconciliationMock.mockReset();
    dataSource.value = 'demo';
    liveSkillProfiles.value = [];
    liveSkillStatsMap.value = null;
  });

  it('demo 模式：目录表含完成度列，行显示 —（无对账数据）', async () => {
    const wrapper = await mountSkills(false);
    expect(getReconciliationMock).not.toHaveBeenCalled();
    const headers = wrapper.findAll('th').map((th) => th.text());
    expect(headers).toContain('完成度');
    // demo 无对账快照：完成度列显示 —
    expect(wrapper.text()).toContain('目标对话');
    const firstRow = wrapper.findAll('tbody tr')[0];
    expect(firstRow.text()).toContain('—');
    wrapper.unmount();
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
    const wrapper = await mountSkills(true);
    expect(getReconciliationMock).toHaveBeenCalled();
    // 目录表完成度徽章：live → 已上线，draft → 草稿；无对账行 → —
    expect(wrapper.find('.sk-table tbody .mk-badge--rec-live').exists()).toBe(true);
    expect(wrapper.find('.sk-table tbody .mk-badge--rec-draft').exists()).toBe(true);
    expect(wrapper.text()).toContain('已上线');
    expect(wrapper.text()).toContain('草稿');
    wrapper.unmount();
  });

  it('折叠 pill 口径：户口簿全量 vs 目录（排除外挂能力）并列标注', async () => {
    getReconciliationMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    liveSkillProfiles.value = [
      { id: 'live-a', name: 'Live A', category: 'analysis', agentId: 'goal-agent', agentName: '目标 Agent' }
    ];
    liveSkillStatsMap.value = { 'live-a': { calls: 1, errors: 0, avgMs: 50, lastAt: '刚刚' } };
    const wrapper = await mountSkills(true);
    const pill = wrapper.find('.sk-rec__pills .mk-pill');
    expect(pill.text()).toContain('完成度 live 2 / 4');
    expect(pill.text()).toContain('目录 1');
    expect(pill.attributes('title')).toContain('户口簿');
    wrapper.unmount();
  });

  it('对账面板「仅看异常」：过滤后仅剩异常行（未注册/非 live），live 行隐藏', async () => {
    getReconciliationMock.mockResolvedValue({ data: { success: true, data: makeReport() } });
    liveSkillProfiles.value = [
      { id: 'live-a', name: 'Live A', category: 'analysis', agentId: 'goal-agent', agentName: '目标 Agent' }
    ];
    liveSkillStatsMap.value = { 'live-a': { calls: 1, errors: 0, avgMs: 50, lastAt: '刚刚' } };
    const wrapper = await mountSkills(true);
    // 展开对账面板
    await wrapper.find('.sk-rec__summary').trigger('click');
    await nextTick();
    await flushPromises();
    const pills = wrapper.findAll('.sk-rec-tools .mk-pill');
    expect(pills.some((p) => p.text() === '仅看异常')).toBe(true);
    const rowsBefore = wrapper.findAll('.sk-rec-table tbody tr.sk-row').length;
    expect(rowsBefore).toBeGreaterThan(2);
    // 点击「仅看异常」→ live 行隐藏，异常行（未注册/草稿）保留
    await pills.find((p) => p.text() === '仅看异常')!.trigger('click');
    await nextTick();
    await flushPromises();
    const rowsAfter = wrapper.findAll('.sk-rec-table tbody tr.sk-row').length;
    expect(rowsAfter).toBeLessThan(rowsBefore);
    const recRowTexts = wrapper.findAll('.sk-rec-table tbody tr.sk-row').map((r) => r.text());
    expect(recRowTexts.some((t) => t.includes('live-a'))).toBe(false);
    expect(wrapper.findAll('.sk-rec-table tbody tr.sk-row').some((r) => r.text().includes('未注册'))).toBe(true);
    wrapper.unmount();
  });
});
