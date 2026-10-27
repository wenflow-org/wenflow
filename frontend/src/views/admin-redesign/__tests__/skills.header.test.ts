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
import { chooseFilter, filterOption, filterValue } from './filter-controls';
import { dataSource, liveSkillStatsMap, intent } from '../store';
import { liveSkillProfiles } from '../live';

const { getReconciliationMock, getEvalRunsMock, getSkillsMock } = vi.hoisted(() => ({
  getReconciliationMock: vi.fn(),
  getEvalRunsMock: vi.fn(),
  getSkillsMock: vi.fn(async (): Promise<unknown> => ({ data: { data: { skills: [] } } })),
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
    getSkills: getSkillsMock,
    // 模型路由页签只剩覆盖矩阵一张表：给两行数据让它渲染出表头
    getSkillModelCoverage: vi.fn(async () => ({
      data: { data: { skills: [
        { skillId: 'skill:a', endpoint: null, model: 'deepseek-v4.1-flash', tier: 'chat', source: 'skill-model-only', paramOverrides: null, fallbackChain: null },
        { skillId: 'skill:c', endpoint: null, model: null, tier: 'chat', source: 'platform-default', paramOverrides: null, fallbackChain: null }
      ] } }
    }))
  }),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
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
  const wrapper = mount(Skills, { global: { plugins: [router], stubs: { teleport: true } } })
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

  it('KPI 卡带：成功率/平均耗时卡（失败节点由卡头「仅看需关注」pill 单源承载）', async () => {
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
    // 平均耗时卡在；「空闲」卡已撤（2026-10-26 评审：4 张固定，不随数据换行）
    expect(kpiOf(w, '平均耗时')!.find('.mk-kpi__num').text()).toBeTruthy()
    expect(kpiOf(w, '空闲')).toBeUndefined()
    // 失败节点不再单列：卡头 pill 承载同源计数
    expect(w.text()).not.toContain('失败节点')
    expect(w.text()).toContain('仅看需关注')
    w.unmount()
  })

  it('「需关注 Skill」KPI 可点：点击即切到「仅看需关注」（pill 不再挂计数）', async () => {
    const w = await mountSkills()
    const kpi = kpiOf(w, '需关注 Skill')!
    expect(kpi.element.tagName).toBe('BUTTON')
    expect(kpi.find('.mk-kpi__num').text()).toBe('1')
    await kpi.trigger('click')
    expect((w.vm as any).onlyAttention).toBe(true)
    expect(filterValue(w as never, '关注')).toBe('attention')
    expect(filterOption(w as never, '关注', '仅看需关注').text()).toBe('仅看需关注')
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

  it('「仅看需关注」pill 点击切换筛选（原状态条失败节点 meta-link 的动作迁卡头 pill）', async () => {
    const w = await mountSkills()
    await chooseFilter(w as never, '关注', '仅看需关注')
    expect((w.vm as any).onlyAttention).toBe(true)
    expect(filterValue(w as never, '关注')).toBe('attention')
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

  it('「完成度」「类别」两列已撤（实测零区分度），对账数据仍供「已上线」KPI', async () => {
    getReconciliationMock.mockResolvedValueOnce({
      data: {
        data: {
          items: [
            { skillId: 'skill:a', completion: { status: 'live', gates: {} } },
            { skillId: 'skill:b', completion: { status: 'draft', gates: {} } },
          ],
        },
      },
    })
    const w = await mountSkills()
    // 主表表头不再有这两列（「批量模型配置」弹窗里另有一张 completion 表，只查主表）
    const mainThs = w.find('.sk-table').findAll('th').map((t) => t.text())
    expect(mainThs).not.toContain('完成度')
    expect(mainThs).not.toContain('类别')
    expect(mainThs).not.toContain('状态')
    // 对账数据没白拉：仍驱动「已上线」KPI（2 行里 1 行 live）
    const live = kpiOf(w, '已上线')!
    expect(live.find('.mk-kpi__num').text()).toBe('1')
    w.unmount()
  })

  it('失败行「查失败」：挂在 Skill 名副行，携 agent+status intent 深链执行日志', async () => {
    const w = await mountSkills()
    // 默认按失败数降序：第一行 = skill:a（30 失败）
    const rowBtns = w.findAll('.sk-table tbody tr')[0].findAll('button').map((b) => b.text())
    expect(rowBtns).toContain('查失败')
    const failBtn = w.findAll('.sk-table tbody tr')[0].findAll('button').find((b) => b.text() === '查失败')!
    expect(failBtn.classes()).toContain('sk-fail-link')
    await failBtn.trigger('click')
    expect(intent.scene).toBe('execution-logs')
    expect(intent.agentFilter).toBe('skill:a')
    expect(intent.statusFilter).toBe('err')
    w.unmount()
    intent.scene = 'overview'
    intent.agentFilter = ''
    intent.statusFilter = ''
  })

  it('Skill 主行 id 是可点的蓝色链接（整行仍可点），操作列已撤', async () => {
    const w = await mountSkills()
    const row = w.findAll('.sk-table tbody tr')[0]
    const link = row.find('.sk-name-link')
    expect(link.exists()).toBe(true)
    expect(link.element.tagName).toBe('BUTTON')
    expect(link.text()).toBe('skill:a')
    // 操作列（100px 整列空白）已撤：表头不再有「操作」
    expect(w.find('.sk-table thead').text()).not.toContain('操作')
    w.unmount()
  })

  it('P95 列默认隐藏（恒「—」无信息量）：首访不含该表头，可在「列」菜单开启', async () => {
    const w = await mountSkills()
    const ths = w.findAll('th').map((t) => t.text())
    expect(ths).not.toContain('P95')
    w.unmount()
  })

  it('运行表补齐版本 / 路由模型 / 最近调用排序；批量模型配置弹窗只有一张表', async () => {
    localStorage.removeItem('wf_skills_sort')
    const w = await mountSkills()
    const runSortable = w.findAll('th.mk-th--sortable').map((t) => t.text())
    expect(runSortable).toEqual(expect.arrayContaining(['Prompt 版本', '路由模型', '最近调用']))
    const versionTh = w.findAll('th.mk-th--sortable').find((t) => t.text().includes('版本'))
    expect(versionTh!.attributes('aria-sort')).toBe('none')
    await versionTh!.find('button').trigger('click')
    expect(versionTh!.attributes('aria-sort')).toBe('descending')

    // 2026-10-24：原「模型路由」页签收进页头弹窗；弹窗内原「只读路由表 + 覆盖矩阵」
    // 两张表已合成一张，只剩覆盖矩阵
    const bulkBtn = w.findAll('.mk-pagehead__actions button').find((b) => b.text() === '批量模型配置')
    await bulkBtn!.trigger('click')
    await flushPromises()
    const dialog = w.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.findAll('table')).toHaveLength(1)
    const routingSortable = dialog.findAll('th.mk-th--sortable').map((t) => t.text())
    expect(routingSortable).toEqual(expect.arrayContaining(['Skill', '路由来源', 'model', '参数覆盖', '备用模型']))
    const headers = dialog.findAll('th').map((t) => t.text())
    expect(headers).toEqual(expect.arrayContaining(['完成度']))
    w.unmount()
  })

  it('「Prompt 版本」列 = 线上生效版本（与详情 hero 同源）：无 ACTIVE Prompt 显示「—」', async () => {
    localStorage.removeItem('wf_skills_sort')
    getSkillsMock.mockResolvedValueOnce({
      data: {
        data: {
          skills: [
            { name: 'skill:a', promptVersion: 4, promptName: 'v4-default-skill.a', description: 'A' },
            { name: 'skill:b', promptVersion: null, description: 'B' },
            { name: 'skill:c', promptVersion: 7, promptName: 'v7-default-skill.c', description: 'C' },
          ],
        },
      },
    })
    const w = await mountSkills()
    const cells = w.findAll('td.sk-c-version .mono')
    expect(cells.map((c) => c.text())).toEqual(['v4', '—', 'v7'])
    expect(cells[0].attributes('title')).toContain('v4-default-skill.a')
    expect(cells[1].attributes('title')).toContain('暂无线上生效 Prompt')
    w.unmount()
  })

  it('表头排序：点击「成功率」在 none → descending → ascending 间切换 aria-sort', async () => {    localStorage.removeItem('wf_skills_sort')
    const w = await mountSkills()
    const th = w.findAll('th.mk-th--sortable').find((t) => t.text().includes('成功率'))
    expect(th).toBeTruthy()
    expect(th!.attributes('aria-sort')).toBe('none')
    await th!.find('button').trigger('click')
    expect(th!.attributes('aria-sort')).toBe('descending')
    await th!.find('button').trigger('click')
    expect(th!.attributes('aria-sort')).toBe('ascending')
  })

  it('Skill 名英文为主（2026-10-25 用户「以英文为主」）：主行 canonical id，中文别名进副行', async () => {
    localStorage.removeItem('wf_skills_sort')
    // 目录给中文 displayName（name），列表主行必须仍是 id——与详情 hero 同一身份口径
    const w = await mountSkills({
      profiles: [{ id: 'goal-conversation', name: '目标对话 Skill', agentId: 'goal-agent', agentName: '目标 Agent', category: 'teaching' }],
      stats: { 'goal-conversation': { calls: 10, errors: 0, avgMs: 100, lastAt: '刚刚' } },
    })
    const row = w.find('.sk-table tbody tr')
    const main = row.find('.sk-name-main')
    expect(main.text()).toBe('goal-conversation')
    expect(main.classes()).toContain('sk-name-main--id')
    // 副行只留身份（中文别名）——功能简介已搬进详情 hero（同日「这个功能简介，可以做到详情页里面」）
    expect(row.find('.sk-sub').text()).toBe('目标对话 Skill')
    expect(row.find('.sk-sub').text()).not.toContain('与学习者多轮对话')
    // 悬停给全：id + 别名（description 也在，来自 meta 端点）
    expect(main.attributes('title')).toContain('goal-conversation')
    expect(main.attributes('title')).toContain('目标对话 Skill')
    // 行可访问名用 id（不是中文别名）
    expect(row.attributes('aria-label')).toContain('goal-conversation')
    w.unmount()
  })

  it('目录没有中文别名时不重复占位：副行只留 description', async () => {
    localStorage.removeItem('wf_skills_sort')
    const w = await mountSkills({
      profiles: [{ id: 'teaching-turn', name: 'teaching-turn', agentId: 'teaching-agent', agentName: '教学 Agent', category: 'teaching' }],
      stats: { 'teaching-turn': { calls: 5, errors: 0, avgMs: 100, lastAt: '刚刚' } },
    })
    const row = w.find('.sk-table tbody tr')
    expect(row.find('.sk-name-main').text()).toBe('teaching-turn')
    expect(row.find('.sk-sub').exists()).toBe(false)
    w.unmount()
  })
})
