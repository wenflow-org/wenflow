/**
 * SkillDetail 技能详情二级页（原型 renderSkillDetail / openPromptModal 的落点，2026-10-01 新建）。
 *
 * 断言 = 原型版式的每一块 + 接线正确性 + 数据诚实性：
 *  - 接线：AdminConsole DETAIL_COMPONENTS 含 skill；Skills.vue 行点击 openSubPage('skill')；
 *    Orchestrator.vue 编排图节点点击 openSubPage('skill')；两者均不再引用 SkillDrawer
 *  - hero：S 头像 / 技能名 / 归属 Agent · 类别副文 / 健康+类别+模型+版本 pills / 真实动作
 *  - 6 页签（运行时 / 协议 / 试跑 / 版本 / 工程 / 字段路由；2026-10 运行时置首：健康+证据先于配置；
 *    页签写/读 ?tab=，深链/刷新可寻址）
 *  - 协议：输入/输出契约 vrow（真实字段路由 fields 拆分）+ 回合状态机/终止条件空态 + System Prompt 代码卡
 *  - Prompt 编辑是弹层（原型 openPromptModal：modal modal--wide），Esc/关闭可收
 *  - 原型有而后端没有数据源的展示块一律空态/省略（回合状态机 / 终止条件 / 执行链路 /
 *    试跑对比 / 依赖与发布 / 运行时限制 / 版本日期作者 / 脱敏列），不硬造
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { nextTick } from 'vue'
// ?raw 读源码：接线断言（openSubPage('skill') / 无 SkillDrawer 引用）对源文本做白盒校验
import SkillsSource from '../Skills.vue?raw'
import OrchestratorSource from '../Orchestrator.vue?raw'
import { DETAIL_COMPONENTS } from '../AdminConsole.vue'
import SkillDetail from '../SkillDetail.vue'
import Skills from '../Skills.vue'
import { subPage, closeSubPage, dataSource, liveSkillStatsMap } from '../store'
import { liveSkillProfiles } from '../live'

const { apiObject, metaMock, promptMock, cfgMock, routingsMock, versionsMock, overviewMock, testSkillMock, probeMock } =
  vi.hoisted(() => ({
    // skills.smoke 同款：custom 里给到的走真 mock，其余方法兜底成 { data: {} } 成功响应
    apiObject: (custom?: Record<string, unknown>): Record<string, unknown> =>
      new Proxy(custom || ({} as Record<string, unknown>), {
        get: (_t, prop) => {
          if (typeof prop !== 'string' || prop === 'then') return undefined;
          if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
          return vi.fn(async () => ({ data: {} }));
        }
      }),
    metaMock: vi.fn(async () => ({ data: { data: {} as Record<string, unknown> } })),
    promptMock: vi.fn(async () => ({ data: { data: {} as Record<string, unknown> } })),
    cfgMock: vi.fn(async () => ({ data: { data: {} as Record<string, unknown> } })),
    routingsMock: vi.fn(async () => ({ data: { data: {} as Record<string, unknown> } })),
    versionsMock: vi.fn(async () => ({ data: { data: [] as Array<Record<string, unknown>> } })),
    overviewMock: vi.fn(async () => ({ data: { data: { items: [] as Array<Record<string, unknown>> } } })),
    testSkillMock: vi.fn(async () => ({ data: { data: {} as Record<string, unknown> } })),
    probeMock: vi.fn(async () => ({ data: { data: {} as Record<string, unknown> } }))
  }))

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject({
    getEffectiveSkillPrompt: promptMock,
    getSkillModelConfig: cfgMock,
    testSkill: testSkillMock,
    modelProbe: probeMock,
    updateSkillModelConfig: apiObject(),
    deleteSkillModelConfig: apiObject(),
    getSkills: vi.fn(async () => ({ data: { data: { skills: [] } } })),
    getReconciliation: vi.fn(async () => ({ data: { data: {} } }))
  }),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminCapabilityProbeApi: apiObject(),
  adminSystemApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject({ getSkillRoutings: routingsMock }),
  adminPromptWorkbenchApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminPromptOpsApi: apiObject({ getAgentOverview: overviewMock }),
  adminHealthCenterApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminSessionsApi: apiObject(),
  adminSkillWorkbenchApi: apiObject({ getMeta: metaMock }),
  adminAgentPromptsApi: apiObject({ getPromptVersions: versionsMock }),
  adminTeachingSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminAgentsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminAchievementsApi: apiObject(),
  adminLearningContentApi: apiObject(),
  adminDevtoolsApi: apiObject(),
  adminApi: apiObject(),
  adminAxios: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}))

vi.mock('@/api/userCustom', () => ({
  getProjectionGrantStatus: vi.fn(async () => ({ data: {} })),
  normalizeProjectionGrant: vi.fn(() => null)
}))

/* ===== 固定数据（契约 = 各接口真实返回形状） ===== */
const PROFILE = { id: 'skill-a', name: '教学回合', category: 'teaching', agentId: 'teaching-agent', agentName: '教学 Agent' }

function primeLive() {
  dataSource.value = 'live'
  liveSkillProfiles.value = [PROFILE]
  liveSkillStatsMap.value = { 'skill-a': { calls: 100, errors: 0, avgMs: 2200, lastAt: '刚刚' } }
}

metaMock.mockResolvedValue({
  data: {
    data: {
      parentAgent: { id: 'teaching-agent', name: '教学 Agent' },
      skill: { id: 'skill-a', name: '教学回合', category: 'teaching' },
      modelConfig: { model: 'gpt-5.2', tier: 'chat', llmRequest: { model: 'gpt-5.2', source: 'active-prompt' } },
      stats: { source: 'agent_call_logs', range: 'all' }
    }
  }
})
promptMock.mockResolvedValue({
  data: { data: { prompt: { id: 'p-1', version: 2, name: 'v2', systemPrompt: 'SYSTEM PROMPT BODY' } } }
})
cfgMock.mockResolvedValue({
  data: {
    data: { enabled: true, tier: 'chat', model: 'gpt-5.2', thinkingMode: 'enabled', reasoningEffort: 'high', requestTimeoutMs: 60000 }
  }
})
routingsMock.mockResolvedValue({
  data: {
    data: {
      skillId: 'skill-a',
      stage: 'teaching',
      agentId: 'teaching-agent',
      routings: [
        { agentId: 'teaching-agent', fieldId: 'learner_state', render: 'visible', handoff: ['state-agent'], internal: false, accumulate: false, notes: '压缩为摘要' },
        { agentId: 'teaching-agent', fieldId: 'mastery_delta', render: 'hidden', handoff: [], internal: true, accumulate: true }
      ],
      fields: [
        { fieldId: 'learner_state', promptRole: 'hard-required', valueType: 'object', description: '学习者当前状态' },
        { fieldId: 'public_reply', promptRole: 'public-reply', valueType: 'string', description: '公开回复' },
        { fieldId: 'mastery_delta', promptRole: 'proposal-output', valueType: 'object', description: '掌握度增量' }
      ],
      promptRoleMeta: [
        { id: 'hard-required', label: '必填入参' },
        { id: 'public-reply', label: '公开回复' },
        { id: 'proposal-output', label: '方案产出' }
      ]
    }
  }
})
versionsMock.mockResolvedValue({
  data: {
    data: [
      { id: 'p2', version: 1, status: 'ARCHIVED', name: 'v1' },
      { id: 'p1', version: 2, status: 'ACTIVE', name: 'v2' }
    ]
  }
})
overviewMock.mockResolvedValue({
  data: { data: { items: [{ agentId: 'skill:skill-a', kind: 'skill', displayName: '教学回合', health: 'good', file: { path: 'prompts/skill.teaching.md' } }] } }
})

function mountDetail() {
  subPage.value = { view: 'skill', id: 'skill-a' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  })
  return mount(SkillDetail, { global: { plugins: [router] } })
}

async function settle() {
  await flushPromises()
  await nextTick()
  await flushPromises()
}

beforeEach(() => {
  primeLive()
})
afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  closeSubPage()
})

describe('技能详情接线（原型 open-skill 跳页，不是抽屉）', () => {
  it('AdminConsole DETAIL_COMPONENTS 含 skill → SkillDetail', () => {
    expect(DETAIL_COMPONENTS.skill).toBeTruthy()
  })

  it('Skills.vue 行点击 openSubPage("skill")，且不再引用 SkillDrawer', async () => {
    // 源文本白盒：SkillDrawer 引用清零、openSubPage('skill') 在位
    expect(SkillsSource).not.toContain('SkillDrawer')
    expect(SkillsSource).toContain("openSubPage('skill'")
    // 行为黑盒：真实点击目录行 → store.subPage 变为 skill 二级页
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
    })
    await router.push('/admin/skills')
    await router.isReady()
    const w = mount(Skills, { global: { plugins: [router] } })
    await settle()

    const row = w.find('.sk-row')
    expect(row.exists()).toBe(true)
    await row.trigger('click')
    expect(subPage.value?.view).toBe('skill')
    expect(subPage.value?.id).toBe('skill-a')
    w.unmount()
  })

  it('Orchestrator.vue 编排图节点点击 openSubPage("skill")，且不再引用 SkillDrawer', () => {
    expect(OrchestratorSource).not.toContain('SkillDrawer')
    expect(OrchestratorSource).toContain("openSubPage('skill'")
    // 节点定位参数 = 真实 skill id（与 Skills 目录 / 抽屉同一id 口径）
    expect(OrchestratorSource).toContain('openSkillFromOverview(sk.id)')
  })
})

describe('SkillDetail 详情页（renderSkillDetail 落点）', () => {
  it('hero：S 头像 + 技能名 + 归属·类别副文 + 健康/类别/模型/版本 pills + 真实动作', async () => {
    const w = mountDetail()
    await settle()

    expect(w.find('.mk-hero__avatar').text()).toBe('S')
    expect(w.find('.mk-hero__title').text()).toBe('教学回合')
    // 类别人话（categoryText）：裸枚举 teaching → 「教学」
    expect(w.find('.mk-hero__sub').text()).toBe('教学 Agent · 教学')

    const pills = w.findAll('.mk-hero__pills .mk-badge').map((b) => b.text())
    expect(pills[0]).toBe('健康') // 窗口内 100 调用 0 失败
    expect(pills[1]).toBe('教学')
    expect(pills.join('|')).toContain('gpt-5.2')
    expect(pills.join('|')).toContain('ACTIVE v2')

    // 动作 = 真实能力（刷新 + 设计页跳转），不搬原型的假评测/发布钮
    const actions = w.findAll('.mk-hero__actions button').map((b) => b.text())
    expect(actions).toEqual(['刷新', '打开设计页 →'])

    w.unmount()
  })

  it('6 页签：运行时 / 协议 / 试跑 / 版本 / 工程 / 字段路由（运行时置首，默认选中）', async () => {
    const w = mountDetail()
    await settle()

    const tabs = w.findAll('.mk-subtab')
    expect(tabs.map((t) => t.text())).toEqual(['运行时', '协议', '试跑', '版本', '工程', '字段路由'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    w.unmount()
  })

  it('?tab= 写/读：深链带合法 tab 直达该页签；点击页签回写 URL（刷新/分享可寻址）', async () => {
    subPage.value = { view: 'skill', id: 'skill-a' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
    })
    await router.push('/admin/people?view=skill&id=skill-a&tab=versions')
    await router.isReady()
    const w = mount(SkillDetail, { global: { plugins: [router] } })
    await settle()

    // 深链读：versions（第 4 个页签）选中
    expect(w.findAll('.mk-subtab')[3].attributes('aria-selected')).toBe('true')
    // 点击写：切「工程」→ URL ?tab=engineering（router.replace 为异步导航，需 flushPromises）
    await w.findAll('.mk-subtab')[4].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('engineering')
    w.unmount()
  })

  it('协议页签：输入/输出契约 vrow（真实字段拆分）+ 回合状态机/终止条件空态 + System Prompt 代码卡', async () => {
    const w = mountDetail()
    await settle()
    // 运行时已置首：协议页签需显式切入（第 2 个）
    await w.findAll('.mk-subtab')[1].trigger('click')
    await nextTick()

    const cards = w.findAll('.skd-pane .mk-card__title').map((t) => t.text())
    expect(cards).toEqual(['输入契约', '输出契约', '回合状态机', '终止条件', 'System Prompt'])

    // 输入 = 非产出角色字段（hard-required）；输出 = proposal-output / public-reply 等产出角色
    const ins = w.findAll('.skd-vrow')
    expect(ins.length).toBe(3)
    expect(ins[0].text()).toContain('learner_state')
    expect(ins[0].text()).toContain('入参')
    expect(ins[0].text()).toContain('必填')
    // 输出契约卡必含产出字段与角色徽标（后端 promptRoleMeta 单源人话）
    const outCard = w.findAll('.skd-pane > .skd-grid > .mk-card')[1]
    expect(outCard.text()).toContain('public_reply')
    expect(outCard.text()).toContain('公开回复')

    // System Prompt：生效内容代码卡 + 截断说明不误报
    expect(w.find('.skd-code').text()).toContain('SYSTEM PROMPT BODY')
    expect(w.text()).not.toContain('已截断')
    // 回合状态机 / 终止条件：core YAML 无 stateMachine/states/termination/limits → 明确空态（不硬造）。
    // 文案 2026-10-04 P3-21（设计评审）人话化：人话领句「该 Skill 未声明…」，schema 细节挪 title
    expect(w.text()).toContain('回合状态机')
    expect(w.text()).toContain('该 Skill 未声明回合状态机')
    expect(w.text()).toContain('终止条件')
    expect(w.text()).toContain('该 Skill 未声明终止条件')

    w.unmount()
  })

  it('Prompt 编辑弹层（原型 openPromptModal：modal--wide）：预填生效内容，关闭/Esc 可收', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[1].trigger('click') // 协议页签（运行时置首后非默认）
    await nextTick()

    await w.findAll('.mk-card__head .mk-btn--sm')[0].trigger('click')
    await nextTick()
    const modal = document.body.querySelector('.mk-modal')
    expect(modal).not.toBeNull()
    expect(modal!.querySelector('.mk-modal__title')!.textContent).toContain('编辑 Prompt · 教学回合')
    const ta = modal!.querySelector('textarea') as HTMLTextAreaElement
    expect(ta.value).toBe('SYSTEM PROMPT BODY')
    // 原型的「保存草稿」无后端草稿接口：主操作 = 真实跳转设计页，不放假保存钮
    expect(modal!.textContent).not.toContain('保存草稿')
    expect(modal!.textContent).toContain('前往设计页编辑')

    // 关闭钮收起；再开 → Esc 收起（弹层在 Esc 栈顶，先于页面关闭）
    ;(modal!.querySelector('.mk-modal__close') as HTMLButtonElement).click()
    await nextTick()
    expect(document.body.querySelector('.mk-modal')).toBeNull()

    await w.findAll('.mk-card__head .mk-btn--sm')[0].trigger('click')
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.body.querySelector('.mk-modal')).toBeNull()
    // 弹层先关，页面保持打开
    expect(subPage.value?.view).toBe('skill')

    w.unmount()
  })

  it('试跑页签：样例输入可编辑，试跑走 testSkill 真实接口并回显输出', async () => {
    testSkillMock.mockResolvedValueOnce({
      data: { data: { success: true, duration: 1234, cached: false, output: { explain: 'ok' } } }
    })
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[2].trigger('click') // 试跑（第 3 个）
    await nextTick()

    expect(w.text()).toContain('样例输入')
    const ta = w.find('.skd-ta')
    expect(ta.exists()).toBe(true)
    await ta.setValue('{\n  "input": "讲讲 p 值"\n}')
    // 注意「试跑」也是页签名：动作钮限定在样例输入卡的 foot 里找
    await w.find('.skd-ta-foot button').trigger('click')
    await settle()

    expect(testSkillMock).toHaveBeenCalledWith('skill-a', { input: '讲讲 p 值' })
    expect(w.find('.skd-code--tall').text()).toContain('explain')
    expect(w.text()).toContain('上次试跑 成功')
    // 执行链路：testSkill 仅回最终输出（无逐步 steps）→ 空态注明
    expect(w.text()).toContain('执行链路')
    expect(w.text()).toContain('本次试跑仅返回最终输出')
    // 原型「试跑对比」评分（ranklist 百分比）后端无此数据，不渲染
    expect(w.text()).not.toContain('试跑对比')
    expect(w.text()).not.toContain('结构完整')

    w.unmount()
  })

  it('版本页签：版本表格（版本/名称/状态），对比回滚投设计页；日期/作者无源不渲染', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[3].trigger('click') // 版本（第 4 个）
    await nextTick()

    const rows = w.findAll('.mk-table tbody tr')
    expect(rows.length).toBe(2)
    // ACTIVE 优先排前
    expect(rows[0].text()).toContain('v2')
    expect(rows[0].text()).toContain('生效')
    expect(rows[1].text()).toContain('v1')
    // 后端列表无日期/作者字段：列不出现，操作投设计页
    expect(w.find('.mk-table thead').text()).not.toContain('日期')
    expect(w.find('.mk-table thead').text()).not.toContain('作者')
    expect(w.text()).toContain('对比 / 回滚')

    w.unmount()
  })

  it('运行时页签（置首默认）：指标格（真实统计）+ 模型配置表单 + 模型测试 + 最近调用空态', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[0].trigger('click')
    await nextTick()

    // 指标卡（共享 MkKpi，审核 #146）：100 调用 / 0 失败（calls>0 显真实失败数，0 调用才显 —）/
    // 100%（rate-utils 1 位小数、整值省 .0）/ 2.2s
    const cards = w.findAll('.mk-kpi')
    expect(cards.length).toBe(4)
    const values = cards.map((v) => v.find('.mk-kpi__num').text())
    expect(values).toEqual(['100', '0', '100%', '2.2s'])
    expect(w.text()).toContain('统计口径')
    // 统计口径对齐真实窗口（liveSkillStatsMap 默认近 7 天）：不再照抄 meta.stats 的「全量」
    expect(w.text()).toContain('近 7 天')

    // 模型配置（SkillDrawer 迁入）：独立配置开着 + 保存/恢复默认在位
    expect(w.text()).toContain('模型配置')
    expect(w.text()).toContain('独立配置')
    expect(w.text()).toContain('保存配置')
    expect(w.text()).toContain('恢复默认')
    // 模型测试（SkillDrawer 迁入）
    expect(w.text()).toContain('模型测试')
    expect(w.text()).toContain('开始探测')
    // 运行时限制：无独立 requestTimeoutMs（cfg 未回超时值时为 null）→ 空态注明
    expect(w.text()).toContain('运行时限制')
    // 最近调用（SkillDrawer 概览迁入）：无日志窗口数据 → 明确空态
    expect(w.text()).toContain('最近调用')
    // 2026-10-08 走查 #3：原空态写「日志窗口内无调用」，与同屏近 7 天统计卡（如 27852 次调用）
    // 互斥。改为点明两者不同源——列表是本页采样，指标走统计接口由服务端聚合。
    expect(w.text()).toContain('本页已加载的日志采样里没有该 Skill 的调用')
    expect(w.text()).toContain('两者不同源')
    expect(w.text()).toContain('以指标卡为准')

    w.unmount()
  })

  it('工程页签：工程信息事实区（真实 meta/overview 字段），仓库/值班/SLO 无源不渲染', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[4].trigger('click') // 工程（第 5 个）
    await nextTick()

    expect(w.text()).toContain('工程信息')
    expect(w.text()).toContain('skill-a')
    expect(w.text()).toContain('教学 Agent')
    expect(w.text()).toContain('prompts/skill.teaching.md')
    // 依赖与发布：core YAML 无 inputs / 发布流后端无阶段状态 → 空态（依赖 chips 与 feed 不硬造）。
    // 文案 2026-10-04 P3-21（设计评审）人话化：人话领句「该 Skill 未声明…」，schema 细节挪 title
    expect(w.text()).toContain('依赖与发布')
    expect(w.text()).toContain('该 Skill 未声明输入依赖')
    expect(w.text()).toContain('发布链：保存并编译 → 发布')
    expect(w.text()).not.toContain('代码仓库')
    expect(w.text()).not.toContain('值班')
    expect(w.text()).not.toContain('SLI / SLO')

    w.unmount()
  })

  it('字段路由页签：字段流转表格（角色人话/流向/渲染/属性）+ 编辑投设计页；脱敏列无源不渲染', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[5].trigger('click') // 字段路由（第 6 个）
    await nextTick()

    const rows = w.findAll('.mk-table tbody tr')
    expect(rows.length).toBe(2)
    expect(rows[0].text()).toContain('learner_state')
    expect(rows[0].text()).toContain('必填入参')
    expect(rows[0].text()).toContain('state-agent')
    expect(rows[1].text()).toContain('内部')
    expect(w.text()).toContain('编辑字段路由')
    // 原型「脱敏」列后端无对应字段：不出现该列
    expect(w.find('.mk-table thead').text()).not.toContain('脱敏')

    w.unmount()
  })

  it('Esc 关详情页（弹层未开时）：subPage 清空回列表', async () => {
    const w = mountDetail()
    await settle()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(subPage.value).toBeNull()
    w.unmount()
  })

  it('未找到：live 档案与 meta 双源都拿不到 → 明确空态 + 返回列表', async () => {
    liveSkillProfiles.value = []
    metaMock.mockRejectedValueOnce(new Error('gone'))
    subPage.value = { view: 'skill', id: 'ghost-skill' }
    const w = mount(SkillDetail)
    await settle()

    expect(w.find('.mk-empty').exists()).toBe(true)
    expect(w.text()).toContain('未找到该 Skill')
    expect(w.text()).toContain('ghost-skill')

    await w.find('.mk-empty__action').trigger('click')
    expect(subPage.value).toBeNull()
    w.unmount()
  })
})
