/**
 * Skills 页首统计（2026-10-04 状态条退役换 KPI 卡带）+ 可读性批（2026-10）：
 * - 成功率精度/阈值/兜底走 rate-utils 单点（99.9% 不再显示 100%；<90 红 / <97 琥珀）
 * - liveCount 三态（… / ? / 红 0）
 * - 「状态」列更名「完成度」；失败行「查失败」intent 直达；P95 默认隐藏
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import Skills from '../Skills.vue';
import { dataSource, liveSkillStatsMap, intent } from '../store';
import { liveSkillProfiles } from '../live';

const { getReconciliationMock, getEvalRunsMock } = vi.hoisted(() => ({
  getReconciliationMock: vi.fn(),
  getEvalRunsMock: vi.fn(),
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
  adminPromptOpsApi: apiObject({
    getEvalRuns: getEvalRunsMock,
    getEvalCases: vi.fn(async () => ({ data: { data: [] } })),
  }),
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

describe('Skills 页首统计（2026-10-04 状态条退役换 KPI 卡带）', () => {
  /** 按标签取 KPI 卡（run 页签的统计带） */
  function kpiOf(w: ReturnType<typeof mount>, label: string) {
    return w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === label);
  }

  beforeEach(() => {
    liveSkillProfiles.value = []
    liveSkillStatsMap.value = {}
    localStorage.removeItem('wf_skills_hidden_cols')
    getReconciliationMock.mockReset()
    getReconciliationMock.mockResolvedValue({ data: { data: { items: [], completion: {} } } })
  })

  it('不再渲染 MkOverview 块；状态条已退役换 KPI 卡带', async () => {
    const w = await mountSkills()
    expect(w.find('.mk-overview').exists()).toBe(false)
    expect(w.find('.mk-status').exists()).toBe(false)
    expect(w.find('.mk-kpi-grid').exists()).toBe(true)
  })

  it('KPI 卡带：成功率/空闲/平均耗时卡（失败节点由卡头「仅看需关注」pill 单源承载）', async () => {
    const w = await mountSkills()
    // 成功率 76.7%（100+50 调用，30+5 失败 → 115/150，1 位小数精度）
    // 2026-10-19 用户走查「KPI hint 在报读数」：副行只留口径短语，分子分母进 title 长释
    // 2026-10-22：卡面与悬停都不再复述公式/分母，只留窗口与着色阈值
    const rate = kpiOf(w, '成功率')!
    expect(rate.find('.mk-kpi__num').text()).toBe('76.7%')
    expect(rate.find('.mk-kpi__hint').exists()).toBe(false)
    expect(rate.attributes('title')).not.toContain('成功 115')
    expect(rate.attributes('title')).toContain('低于 90% 标红')
    expect(rate.attributes('title')).toContain('低于 97% 标黄')
    // 空闲（skill:c 0 调用）/ 平均耗时卡在
    expect(kpiOf(w, '空闲')!.find('.mk-kpi__num').text()).toBe('1')
    expect(kpiOf(w, '平均耗时')!.find('.mk-kpi__num').text()).toBeTruthy()
    // 失败节点不再单列：卡头 pill 承载同源计数
    expect(w.text()).not.toContain('失败节点')
    expect(w.text()).toContain('仅看需关注')
    w.unmount()
  })

  it('成功率精度：99.9% 显示 99.9%（toFixed(0) 曾把它抹成 100%）', async () => {
    const w = await mountSkills({
      profiles: [{ id: 'skill:a', name: 'A', agentId: 'agent-1', agentName: '阶段一', category: 'teaching' }],
      stats: { 'skill:a': { calls: 1000, errors: 1, avgMs: 100 } },
    })
    expect(kpiOf(w, '成功率')!.find('.mk-kpi__num').text()).toBe('99.9%')
    expect(w.text()).not.toContain('100%')
    w.unmount()
  })

  it('KPI 卡带：Prompt 评估页签的读数带在宿主槽位（面板经 kpiView 供出，2026-10-15 迁位）', async () => {
    getEvalRunsMock.mockResolvedValue({ data: { data: Array.from({ length: 3 }, (_, i) => ({ id: `run-${i}`, agentId: 'skill:goal-conversation', promptVersion: 1, promptSource: 'active', mode: 'eval-set', caseCount: 2, totalRuns: 2, summary: { passRate: 100, passedCount: 2, totalRuns: 2, repeatCount: 1 }, durationMs: 900, createdAt: new Date().toISOString() })) } })
    const w = await mountSkills()
    await (w.vm as any).switchTab('prompt-eval')
    // 面板是 defineAsyncComponent：异步分片解析 + 挂载 + ref 回填，用 waitFor 等这一刻。
    // 2026-10-18：默认 1s 在 100 文件并行跑时不够（异步分片解析排队 >1s，整跑偶发失败、
    // 单跑必过），显式给 10s——这是等分片解析，不是掩盖产品竞态（testTimeout 20s）。
    await vi.waitFor(() => {
      expect(kpiOf(w, '评估历史')!.find('.mk-kpi__num').text()).toBe('3')
    }, { timeout: 10000 })
    // 带在「页头之下、页签栏之上」的宿主槽位，随页签 v-if 渲染
    const labels = w.findAll('.mk-kpi-grid .mk-kpi__label').map((el) => el.text().trim())
    expect(labels).toEqual(['最近评测通过率', '评估用例', '启用用例', '评估历史'])
    w.unmount()
  })

  it('「仅看需关注」pill 点击切换筛选（原状态条失败节点 meta-link 的动作迁卡头 pill）', async () => {
    const w = await mountSkills()
    const pill = w.findAll('.mk-pill').find((p) => p.text().includes('仅看需关注'))!
    expect(pill).toBeTruthy()
    await pill.trigger('click')
    expect((w.vm as any).onlyAttention).toBe(true)
    // 激活态类
    expect(pill.classes()).toContain('mk-pill--active')
  })

  it('成功率 tone 着色：77% < 90 归红档（全站阈值收敛 <90 红 / <97 琥珀，旧 <70/<90 私有口径退役）', async () => {
    const w = await mountSkills()
    const rate = kpiOf(w, '成功率')!
    expect(rate.classes()).toContain('mk-kpi--bad')
    expect(w.findAll('.mk-kpi--warn').length).toBe(0)
    w.unmount()
  })

  it('liveCount 三态：对账就绪且为 0 → 红 0（全 draft 是真异常，不再静默隐藏）', async () => {
    const w = await mountSkills()
    const live = kpiOf(w, '已上线')!
    expect(live.find('.mk-kpi__num').text()).toBe('0')
    expect(live.classes()).toContain('mk-kpi--bad')
    w.unmount()
  })

  it('liveCount 三态：对账加载中 → 「…」', async () => {
    getReconciliationMock.mockReturnValue(new Promise(() => {}))
    const w = await mountSkills()
    const live = kpiOf(w, '已上线')!
    expect(live.find('.mk-kpi__num').text()).toBe('…')
    expect(live.classes()).not.toContain('mk-kpi--bad')
    w.unmount()
  })

  it('liveCount 三态：对账加载失败 → 「?」（读不到 ≠ 0）', async () => {
    getReconciliationMock.mockRejectedValue(new Error('recon boom'))
    const w = await mountSkills()
    const live = kpiOf(w, '已上线')!
    expect(live.find('.mk-kpi__num').text()).toBe('?')
    expect(live.classes()).not.toContain('mk-kpi--bad')
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

  it('运行表补齐版本 / 路由模型 / 最近调用排序；模型路由表五列全部可排', async () => {
    localStorage.removeItem('wf_skills_sort')
    localStorage.removeItem('wf_skills_routing_sort')
    const w = await mountSkills()
    const runSortable = w.findAll('th.mk-th--sortable').map((t) => t.text())
    expect(runSortable).toEqual(expect.arrayContaining(['版本', '路由模型', '最近调用']))
    const versionTh = w.findAll('th.mk-th--sortable').find((t) => t.text().includes('版本'))
    expect(versionTh!.attributes('aria-sort')).toBe('none')
    await versionTh!.find('button').trigger('click')
    expect(versionTh!.attributes('aria-sort')).toBe('descending')

    const routingTab = w.findAll('.tabs .tab').find((t) => t.text() === '模型路由')
    await routingTab!.trigger('click')
    await flushPromises()
    const routingSortable = w.findAll('th.mk-th--sortable').map((t) => t.text())
    expect(routingSortable).toEqual(expect.arrayContaining(['Skill', '归属 Agent', '路由模型', '备用模型', '完成度']))
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
