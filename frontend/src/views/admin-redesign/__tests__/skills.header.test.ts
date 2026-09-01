/**
 * 临时验证：Skills 新页头（单行状态条）在有数据时渲染正确
 * 验证点：MkOverview 已移除、状态条含成功率/失败节点/空闲/平均耗时、
 *         失败节点可点击切换 onlyAttention
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import Skills from '../Skills.vue';
import { dataSource, liveSkillStatsMap } from '../store';
import { liveSkillProfiles } from '../live';

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

// 注入 live 数据：3 个 Skill（2 失败 1 空闲），模拟用户截图场景
function injectLiveData() {
  liveSkillProfiles.value = [
    { id: 'skill:a', name: 'A', agentId: 'agent-1', agentName: '阶段一', category: 'teaching' },
    { id: 'skill:b', name: 'B', agentId: 'agent-1', agentName: '阶段一', category: 'teaching' },
    { id: 'skill:c', name: 'C', agentId: 'agent-2', agentName: '阶段二', category: 'tool' },
  ] as any;
  liveSkillStatsMap.value = {
    'skill:a': { calls: 100, errors: 30, avgMs: 5000 },
    'skill:b': { calls: 50, errors: 5, avgMs: 3000 },
    'skill:c': { calls: 0, errors: 0, avgMs: 0 },
  } as any;
}

async function mountSkills() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  });
  dataSource.value = 'live'
  injectLiveData()
  const wrapper = mount(Skills, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('Skills 新页头（单行状态条）', () => {
  beforeEach(() => {
    liveSkillProfiles.value = []
    liveSkillStatsMap.value = {}
    getReconciliationMock.mockReset()
    getReconciliationMock.mockResolvedValue({ data: { data: { items: [], completion: {} } } })
  })

  it('不再渲染 MkOverview 块（已统一为单行状态条）', async () => {
    const w = await mountSkills()
    expect(w.find('.mk-overview').exists()).toBe(false)
    expect(w.find('.mk-status').exists()).toBe(true)
  })

  it('状态条显示成功率/失败节点/空闲/平均耗时 meta', async () => {
    const w = await mountSkills()
    const meta = w.findAll('.mk-status__meta').map((m) => m.text())
    const linkTexts = w.findAll('.mk-status__meta-link').map((m) => m.text())
    // 成功率 77%（100+50 调用，30+5 失败 → 115/150 = 77%）
    expect(meta.some((t) => t.includes('成功率'))).toBe(true)
    expect(linkTexts.some((t) => t.includes('失败节点'))).toBe(true)
    expect(meta.some((t) => t.includes('空闲'))).toBe(true)
    expect(meta.some((t) => t.includes('平均耗时'))).toBe(true)
    expect(meta.some((t) => t.includes('总调用'))).toBe(true)
  })

  it('失败节点计数可点击切换「仅看需关注」', async () => {
    const w = await mountSkills()
    const link = w.find('.mk-status__meta-link')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('失败节点')
    await link.trigger('click')
    expect((w.vm as any).onlyAttention).toBe(true)
    // 激活态类
    expect(link.classes()).toContain('mk-status__meta-link--on')
  })

  it('成功率 tone 着色：失败多时显示 warn（77% < 90）', async () => {
    const w = await mountSkills()
    const warnMeta = w.findAll('.mk-status__meta--warn')
    expect(warnMeta.length).toBeGreaterThan(0)
  })

  it('网格视图无内滚（双滚动条已消除）', async () => {
    const w = await mountSkills()
    // 切网格
    const gridPill = w.findAll('.mk-pill').find((p) => p.text() === '网格')
    await gridPill!.trigger('click')
    await flushPromises()
    const grid = w.find('.sk-grid--inset')
    expect(grid.exists()).toBe(true)
    const style = (grid.element as HTMLElement).style
    expect(style.maxHeight).toBe('')
  })
})
