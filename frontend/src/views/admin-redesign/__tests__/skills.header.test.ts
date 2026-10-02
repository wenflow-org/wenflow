/**
 * Skills 页头（单行状态条）+ 可读性批（2026-10）：
 * - 成功率精度/阈值/兜底走 rate-utils 单点（99.9% 不再显示 100%；<90 红 / <97 琥珀）
 * - liveCount 三态（live … / live ? / 红字 0 个 live）
 * - 「状态」列更名「完成度」；失败行「查失败」intent 直达；P95 默认隐藏
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import Skills from '../Skills.vue';
import { dataSource, liveSkillStatsMap, intent } from '../store';
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

async function mountSkills(live?: { profiles?: unknown[]; stats?: Record<string, unknown> }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  });
  dataSource.value = 'live'
  if (live) {
    liveSkillProfiles.value = (live.profiles ?? []) as any;
    liveSkillStatsMap.value = (live.stats ?? {}) as any;
  } else {
    injectLiveData()
  }
  const wrapper = mount(Skills, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('Skills 新页头（单行状态条）', () => {
  beforeEach(() => {
    liveSkillProfiles.value = []
    liveSkillStatsMap.value = {}
    localStorage.removeItem('wf_skills_hidden_cols')
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
    // 成功率 76.7%（100+50 调用，30+5 失败 → 115/150，1 位小数精度）
    expect(meta.some((t) => t.includes('成功率'))).toBe(true)
    const rateMeta0 = w.findAll('.mk-status__meta').find((m) => m.text().includes('成功率'))!
    expect(rateMeta0.text()).toContain('76.7%（115/150）')
    expect(linkTexts.some((t) => t.includes('失败节点'))).toBe(true)
    expect(meta.some((t) => t.includes('空闲'))).toBe(true)
    expect(meta.some((t) => t.includes('平均耗时'))).toBe(true)
    // 总调用已并入成功率括号（如 76.7%（115/150）），不再独立展示
    expect(meta.some((t) => t.includes('成功率') && t.includes('（'))).toBe(true)
    // 成功率 title 披露全站统一阈值（着色必须带条件阈值）
    const rateMeta = w.findAll('.mk-status__meta').find((m) => m.text().includes('成功率'))!
    expect(rateMeta.attributes('title')).toContain('<90% 红')
    expect(rateMeta.attributes('title')).toContain('<97% 琥珀')
  })

  it('成功率精度：99.9% 显示 99.9%（toFixed(0) 曾把它抹成 100%）', async () => {
    const w = await mountSkills({
      profiles: [{ id: 'skill:a', name: 'A', agentId: 'agent-1', agentName: '阶段一', category: 'teaching' }],
      stats: { 'skill:a': { calls: 1000, errors: 1, avgMs: 100 } },
    })
    const rateMeta = w.findAll('.mk-status__meta').find((m) => m.text().includes('成功率'))!
    expect(rateMeta.text()).toContain('99.9%')
    expect(rateMeta.text()).not.toContain('100%')
    w.unmount()
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

  it('成功率 tone 着色：77% < 90 归红档（全站阈值收敛 <90 红 / <97 琥珀，旧 <70/<90 私有口径退役）', async () => {
    const w = await mountSkills()
    const rateMeta = w.findAll('.mk-status__meta').find((m) => m.text().includes('成功率'))!
    expect(rateMeta.classes()).toContain('mk-status__meta--bad')
    expect(w.findAll('.mk-status__meta--warn').length).toBe(0)
  })

  it('liveCount 三态：对账就绪且为 0 → 红字「0 个 live」（全 draft 是真异常，不再静默隐藏）', async () => {
    const w = await mountSkills()
    const live = w.findAll('.mk-status__meta').find((m) => m.text().includes('个 live'))!
    expect(live.text()).toBe('0 个 live')
    expect(live.classes()).toContain('mk-status__meta--bad')
    w.unmount()
  })

  it('liveCount 三态：对账加载中 → 「live …」', async () => {
    getReconciliationMock.mockReturnValue(new Promise(() => {}))
    const w = await mountSkills()
    const live = w.findAll('.mk-status__meta').find((m) => m.text().includes('live'))!
    expect(live.text()).toBe('live …')
    expect(live.classes()).not.toContain('mk-status__meta--bad')
    w.unmount()
  })

  it('liveCount 三态：对账加载失败 → 灰「live ?」（读不到 ≠ 0）', async () => {
    getReconciliationMock.mockRejectedValue(new Error('recon boom'))
    const w = await mountSkills()
    const live = w.findAll('.mk-status__meta').find((m) => m.text().endsWith('live ?'))!
    expect(live.text()).toBe('live ?')
    expect(live.classes()).not.toContain('mk-status__meta--bad')
    expect(live.attributes('title')).toContain('recon boom')
    w.unmount()
  })

  it('「状态」列更名「完成度」：与行首健康点去双语义', async () => {
    const w = await mountSkills()
    const ths = w.findAll('th').map((t) => t.text())
    expect(ths).toContain('完成度')
    expect(ths).not.toContain('状态')
    w.unmount()
  })

  it('失败行操作列「查失败」小钮：携 agent+status intent 深链执行日志', async () => {
    const w = await mountSkills()
    // 默认按失败数降序：第一行 = skill:a（30 失败）
    const rowBtns = w.findAll('.sk-table tbody tr')[0].findAll('button').map((b) => b.text())
    expect(rowBtns).toContain('查失败')
    const failBtn = w.findAll('.sk-table tbody tr')[0].findAll('button').find((b) => b.text() === '查失败')!
    await failBtn.trigger('click')
    expect(intent.scene).toBe('execution-logs')
    expect(intent.agentFilter).toBe('skill:a')
    expect(intent.statusFilter).toBe('err')
    w.unmount()
    intent.scene = 'overview'
    intent.agentFilter = ''
    intent.statusFilter = ''
  })

  it('P95 列默认隐藏（恒「—」无信息量）：首访不含该表头，可在「列」菜单开启', async () => {
    const w = await mountSkills()
    const ths = w.findAll('th').map((t) => t.text())
    expect(ths).not.toContain('P95')
    w.unmount()
  })

  it('表头排序：点击「成功率」在 none → descending → ascending 间切换 aria-sort', async () => {
    localStorage.removeItem('wf_skills_sort')
    const w = await mountSkills()
    const th = w.findAll('th.mk-th--sortable').find((t) => t.text().includes('成功率'))
    expect(th).toBeTruthy()
    expect(th!.attributes('aria-sort')).toBe('none')
    await th!.find('button').trigger('click')
    expect(th!.attributes('aria-sort')).toBe('descending')
    await th!.find('button').trigger('click')
    expect(th!.attributes('aria-sort')).toBe('ascending')
  })
})
