/**
 * SkillDetail 技能详情二级页（原型 renderSkillDetail / openPromptModal 的落点，2026-10-01 新建）。
 *
 * 断言 = 原型版式的每一块 + 接线正确性 + 数据诚实性：
 *  - 接线：AdminConsole DETAIL_COMPONENTS 含 skill；Skills.vue 行点击直达设计页
 *    （2026-10-14 方案 B：原「设计」小钮撤除、行不再开 skill 二级页）；Orchestrator.vue
 *    编排图节点点击 openSubPage('skill')；两者均不再引用 SkillDrawer
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

const { apiObject, metaMock, promptMock, cfgMock, routingsMock, versionsMock, overviewMock, coreMock, testSkillMock, probeMock } =
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
    coreMock: vi.fn(async () => ({ data: {} as Record<string, unknown> })),
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
  adminPromptWorkbenchApi: apiObject({ getCore: coreMock }),
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
      skill: { id: 'skill-a', name: '教学回合', category: 'teaching', description: '按教学回合推进课堂，产出讲解与追问' },
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
      ],
      // 平铺后 RoutingTab 内嵌 SkillFieldRouting 也读本接口（需 core.fields/core.sync）
      core: { exists: true, fields: [], sync: null }
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

  it('Skills.vue 行点击直达 Skill 详情二级页（2026-10-14 方案 B；2026-10-15 设计页平铺后落 skill）', async () => {
    // 源文本白盒：SkillDrawer 引用清零；行点击改走 openDesign（原「设计」小钮撤除）。
    // 2026-10-15 设计页退役平铺进详情页后，行点击落 ?view=skill&id=（与编排图节点下钻同一落点）。
    expect(SkillsSource).not.toContain('SkillDrawer')
    expect(SkillsSource).not.toContain('>设计</button>')
    expect(SkillsSource).toContain('@click="openDesign(')
    expect(SkillsSource).toContain("openSubPage('skill'")
    // 行为黑盒：真实点击目录行 → 打开 Skill 详情二级页（store.subPage 契约；
    // URL 落地由 AdminConsole 的 subPage→URL watch 负责，另有 admin-console.smoke 覆盖）
    closeSubPage()
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
    await settle()
    expect(subPage.value).toMatchObject({ view: 'skill', id: 'skill-a' })
    closeSubPage()
    w.unmount()
  })

  it('Orchestrator.vue 编排图节点点击 openSubPage("skill")，且不再引用 SkillDrawer', () => {
    expect(OrchestratorSource).not.toContain('SkillDrawer')
    expect(OrchestratorSource).toContain("openSubPage('skill'")
    // 节点定位参数 = 真实 skill id（与 Skills 目录 / 抽屉同一id 口径）
    expect(OrchestratorSource).toContain('openSkillFromOverview(sk.id)')
    // 节点同时显示中文显示名与 Skill id（2026-10-13 用户：现在用的还是中文，希望加上 skill 名称）
    expect(OrchestratorSource).toContain('class="orch-odg-nodename"')
    expect(OrchestratorSource).toContain('class="orch-odg-slug mono">{{ sk.id }}')
  })

  it('编排图页首 KPI 带与告警条已撤（2026-10-12 用户走查）：读数进卡头 meta，页级告警迁健康中心', () => {
    // 三张纯读数卡 + 两枚告警卡都不再渲染：本页无 KPI、无页级告警条（告警迁健康中心
    // 检查项 orchestration-steps / w4-corehash）
    expect(OrchestratorSource).not.toContain('label="阶段"')
    expect(OrchestratorSource).not.toContain('label="阶段交接"')
    expect(OrchestratorSource).not.toContain('<MkKpi')
    expect(OrchestratorSource).not.toContain('import MkKpi')
    expect(OrchestratorSource).not.toContain('mk-alert')
    expect(OrchestratorSource).not.toContain('unresolvedCount')
    // 行级证据（交接明细表的徽章）2026-10-13 随该表整体删除：与「字段旅程」页签同源重复
    // 且两处字段数打架（7 vs 25）；治理信号现只在健康中心，本页不再持有任何治理读数
    expect(OrchestratorSource).not.toContain('orch-handoff__badge-btn')
    expect(OrchestratorSource).not.toContain('goUnresolved')
    expect(OrchestratorSource).not.toContain('goHashDrift')
    expect(OrchestratorSource).not.toContain('stageHandoffs')
    // 阶段数/Skill 总数收进总览卡头右组 meta（F8-4 三源口径 title 随行）
    expect(OrchestratorSource).toContain('}} 阶段 · {{ totalSkills }} 个 Skill')
    expect(OrchestratorSource).toContain(':title="skillKpiTitle"')
  })

  it('总览画布：居中 + 可拖动 + 滚轮连续缩放（2026-10-13 用户）', () => {
    // 居中：滚动区做单 flex 项容器 + 画布 margin:auto（溢出时 auto 边距归 0，
    // 不会像 justify-content:center 那样把起始边裁到滚动区外够不着）
    expect(OrchestratorSource).toContain('display: flex; align-items: flex-start;')
    expect(OrchestratorSource).toContain('flex: none; margin: auto;')
    // 缩放：zoom 参与布局（放大后出真实滚动范围），宽度由 JS 给 px——
    // zoom 的百分比语义会把 width:100% 钉死在容器宽，缩小时看不出变化
    expect(OrchestratorSource).toContain('zoom: String(odgZoom.value)')
    expect(OrchestratorSource).toContain('width: odgBaseW.value ?')
    // 滚轮直缩（不带修饰键）+ 连续无档位：比例走指数曲线，只夹上下限
    expect(OrchestratorSource).toContain('@wheel.prevent="onOdgWheelZoom"')
    expect(OrchestratorSource).not.toContain('ODG_ZOOM_STEP')
    expect(OrchestratorSource).not.toContain('stepOdgZoom')
    expect(OrchestratorSource).toContain('ODG_ZOOM_WHEEL_K')
    expect(OrchestratorSource).toContain('ODG_ZOOM_MIN = 0.25')
    expect(OrchestratorSource).toContain('ODG_ZOOM_MAX = 3')
    // 只留读数（点它回 100%），不再有 − / ＋ 固定档按钮
    expect(OrchestratorSource).toContain('orch-odg-zoom__val')
    expect(OrchestratorSource).not.toContain('orch-odg-zoom"')
    // 拖动平移仍是原实现（缩放后才有可平移的滚动范围）
    expect(OrchestratorSource).toContain('@pointerdown="onOdgPointerDown"')
  })

  it('编排图导航两级页签（2026-10-26：字段旅程补回阶段内页签）', () => {
    // 一级 = 总览 + 阶段；原来的「阶段选择」胶囊行退役（同一屏两套导航）
    expect(OrchestratorSource).toContain('class="tabs orch-top-tabs"')
    expect(OrchestratorSource).toContain('@click="goOverview"')
    expect(OrchestratorSource).toContain('@click="selectStageTab(s.id)"')
    expect(OrchestratorSource).not.toContain('class="orch-stage-pills"')
    expect(OrchestratorSource).not.toContain('stageScoped')
    // 阶段内三枚子视图并列：进了路由/治理仍能点回字段旅程（此前只能再点一次阶段页签）
    expect(OrchestratorSource).toContain("const SUB_PANES: Array<{ id: OrchSubPane; label: string }> = [")
    expect(OrchestratorSource).toContain("{ id: 'journey', label: '字段旅程' }")
    expect(OrchestratorSource).toContain("{ id: 'routing', label: '字段路由' }")
    expect(OrchestratorSource).toContain("{ id: 'governance', label: '治理' }")
    // 回程逻辑已删：再点当前阶段页签不再有特殊分支
    expect(OrchestratorSource).not.toContain('pane.value !== \'overview\' && active.value === id')
    // 二级页签与阶段内容同壳（一级页签 aria-controls 指向它）
    expect(OrchestratorSource).toContain('id="orch-stage-view"')
    expect(OrchestratorSource).toContain('class="tabs orch-subtabs"')
    expect(OrchestratorSource).toContain("pane.value = 'journey'")
    expect(OrchestratorSource).toContain('function selectStageTab(id: string)')
    // SkillFieldRouting 传来的 ?tab=field-routings 必须落在字段路由（此前静默落回总览）
    expect(OrchestratorSource).toContain("qTab === 'field-routings'")
  })

  it('编排图阶段页签用中文（2026-10-26 评审：与画布列头同名，不再英中对照）', () => {
    expect(OrchestratorSource).toContain('{{ stageTabLabel(s) }}')
    expect(OrchestratorSource).toContain('const STAGE_TAB_LABEL: Record<string, string> = {')
    expect(OrchestratorSource).toContain("teaching: '教学'")
    expect(OrchestratorSource).toContain("profile: '学习者'")
    expect(OrchestratorSource).toContain("simulation: '仿真'")
    // 未登记的阶段回退中文显示名：不裸出 id、也不留空
    expect(OrchestratorSource).toContain('STAGE_TAB_LABEL[s.id] || s.name.replace(/阶段$/, \'\')')
  })

  it('编排图悬停信息双层结构（2026-10-14 用户：业务名 + 技术查验）', () => {
    // 阶段页签：首行阶段名，其后 Agent / Skill 数 / 操作提示
    expect(OrchestratorSource).toContain('function stageTabTitle(s: Stage): string')
    expect(OrchestratorSource).toContain('Agent: ${s.agentId}')
    expect(OrchestratorSource).toContain('Skill: ${s.skills.length} 个')
    // 总览 Skill 节点：中文名 / Skill id / Agent / 产出数 / 点击提示
    expect(OrchestratorSource).toContain(':title="skillNodeTitle(sk, s)"')
    expect(OrchestratorSource).toContain('Skill: ${sk.id}')
    expect(OrchestratorSource).toContain('产出字段: ${sk.produces.length} 个')
    // 入/出统计自带解释（promptRole 人话仍取后端单源，不写第二份；「口径」改「统计含」）
    expect(OrchestratorSource).toContain('function contractTitle(kind: \'in\' | \'out\', n: number): string')
    expect(OrchestratorSource).toContain("roleMetaById.value['hard-required']")
    expect(OrchestratorSource).toContain('统计含：${roles}')
  })
})

describe('SkillDetail 详情页（renderSkillDetail 落点）', () => {
  it('hero：S 头像 + 英文 canonical id + 中文别名/归属·类别副文 + 健康/类别/版本 pills + 真实动作', async () => {
    const w = mountDetail()
    await settle()

    expect(w.find('.mk-hero__avatar').text()).toBe('S')
    // 2026-10-14 用户拍板「英文优先，中文只是别名」：标题 = canonical id，中文名降为副文首位
    // （代码注册表与声明源实测 17/34 不同名，拿中文当身份会认错技能）
    expect(w.find('.mk-hero__title').text()).toBe('skill-a')
    // 类别人话（categoryText）：裸枚举 teaching → 「教学」
    expect(w.find('.mk-hero__sub').text()).toBe('教学回合 · 教学 Agent · 教学')
    // 功能简介（2026-10-25 用户「这个功能简介，可以做到详情页里面」）：从列表副行搬进 hero，
    // 独立一行、不被截断；sub 只留身份标签
    expect(w.find('.mk-hero__desc').text()).toBe('按教学回合推进课堂，产出讲解与追问')
    expect(w.find('.mk-hero__sub').text()).not.toContain('按教学回合推进课堂')

    const pills = w.findAll('.mk-hero__pills .mk-badge').map((b) => b.text())
    expect(pills[0]).toBe('健康') // 窗口内 100 调用 0 失败
    expect(pills[1]).toBe('教学')
    // 2026-10-24 用户「还是重复部分」：生效模型只在运行时里出现一次，hero 不再重复
    expect(pills.join('|')).not.toContain('gpt-5.2')
    expect(pills.join('|')).toContain('线上生效 v2')

    // 动作 = 真实能力（2026-10-23 用户「已经有刷新，为什么还有独立刷新」：hero 最后一颗
    // 刷新钮也撤除，各域跟随顶栏 liveRefreshSeq 广播；hero 动作区不再留按钮）
    const actions = w.findAll('.mk-hero__actions button').map((b) => b.text())
    expect(actions).toEqual([])

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

    // 平铺后 .skd-pane 内有多个 .skd-bloc（运行时默认块 + 协议块，各 v-show）；
    // 协议块是模板里的第一个（index 0）。只读概览断言全部限定在协议块内。
    const bloc = w.findAll('.skd-bloc')[0]
    const cards = bloc.findAll('.mk-card__title').map((t) => t.text())
    expect(cards).toEqual(['输入契约', '输出契约', '回合状态机', '终止条件', 'System Prompt'])

    // 输入 = 非产出角色字段（hard-required）；输出 = proposal-output / public-reply 等产出角色
    const ins = bloc.findAll('.skd-vrow')
    expect(ins.length).toBe(3)
    expect(ins[0].text()).toContain('learner_state')
    expect(ins[0].text()).toContain('入参')
    expect(ins[0].text()).toContain('必填')
    // 输出契约卡必含产出字段与角色徽标（后端 promptRoleMeta 单源人话）
    const outCard = bloc.findAll('.skd-grid > .mk-card')[1]
    expect(outCard.text()).toContain('public_reply')
    expect(outCard.text()).toContain('公开回复')

    // System Prompt：生效内容代码卡 + 截断说明不误报
    expect(bloc.find('.skd-code').text()).toContain('SYSTEM PROMPT BODY')
    expect(bloc.text()).not.toContain('已截断')
    // 回合状态机 / 终止条件：core YAML 无 stateMachine/states/termination/limits → 明确空态（不硬造）。
    // 文案 2026-10-04 P3-21（设计评审）人话化：人话领句「该 Skill 未声明…」，schema 细节挪 title
    expect(bloc.text()).toContain('回合状态机')
    expect(bloc.text()).toContain('该 Skill 未声明回合状态机')
    expect(bloc.text()).toContain('终止条件')
    expect(bloc.text()).toContain('该 Skill 未声明终止条件')

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
    // 原型的「保存草稿」无后端草稿接口：主操作 = 切到核心文件编辑（本页协议页签），不放假保存钮
    expect(modal!.textContent).not.toContain('保存草稿')
    expect(modal!.textContent).toContain('前往核心文件编辑')

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

  it('试跑页签：TrialTab 输入可编辑，试跑走 testSkill 真实接口并回显输出', async () => {
    testSkillMock.mockResolvedValueOnce({
      data: { data: { success: true, duration: 1234, cached: false, output: { explain: 'ok' } } }
    })
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[2].trigger('click') // 试跑（第 3 个）
    await nextTick()

    expect(w.text()).toContain('试跑')
    const ta = w.find('.sdp-json')
    expect(ta.exists()).toBe(true)
    await ta.setValue(JSON.stringify({ input: '讲讲 p 值' }))
    // 唯一运行入口在 TrialTab 卡头（宿主旧的「样例输入 + 试跑」副本已撤）
    const runBtn = w.findAll('button').find((b) => b.text().includes('运行预览'))!
    await runBtn.trigger('click')
    await settle()

    expect(testSkillMock).toHaveBeenCalledWith('skill-a', { input: '讲讲 p 值' })
    expect(w.find('.sdp-output').text()).toContain('explain')
    expect(w.text()).toContain('执行链路')
    expect(w.text()).toContain('本次试跑仅返回最终输出')
    expect(w.text()).not.toContain('试跑对比')
    expect(w.text()).not.toContain('结构完整')
    w.unmount()
  })

  it('#15 试跑输入按 core 输入契约生成默认载荷（唯一入口在 TrialTab）', async () => {
    // stage-designer 的真实契约：milestone / cognitiveCore 必填，其余可选
    coreMock.mockResolvedValue({
      data: {
        core: {
          inputs: [
            { name: 'milestone', type: 'object' },
            { name: 'previousMilestone', type: 'object?' },
            { name: 'cognitiveCore', type: 'object' }
          ]
        }
      }
    })
    testSkillMock.mockResolvedValueOnce({
      data: { data: { success: true, duration: 10, cached: false, output: { ok: true } } }
    })

    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[2].trigger('click') // 试跑
    await nextTick()

    const ta = w.find('.sdp-json')
    expect(JSON.parse((ta.element as HTMLTextAreaElement).value)).toEqual({ milestone: {}, cognitiveCore: {} })

    const runBtn = w.findAll('button').find((b) => b.text().includes('运行预览'))!
    await runBtn.trigger('click')
    await settle()
    expect(testSkillMock).toHaveBeenCalledWith('skill-a', { milestone: {}, cognitiveCore: {} })
    w.unmount()
    coreMock.mockResolvedValue({ data: {} })
  })

  it('版本页签：版本表格（版本/名称/状态）+ 下方版本管理区块；日期/作者无源不渲染', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[3].trigger('click') // 版本（第 4 个）
    await nextTick()

    const rows = w.find('.mk-table').findAll('tbody tr')
    expect(rows.length).toBe(2)
    // ACTIVE 优先排前
    expect(rows[0].text()).toContain('v2')
    expect(rows[0].text()).toContain('生效')
    expect(rows[1].text()).toContain('v1')
    // 后端列表无日期/作者字段：列不出现
    expect(w.find('.mk-table thead').text()).not.toContain('日期')
    expect(w.find('.mk-table thead').text()).not.toContain('作者')
    // 2026-10-15 设计页平铺：版本管理区块（VersionsTab）就地渲染在只读版本表下方
    expect(w.find('.sdp-versions').exists()).toBe(true)

    w.unmount()
  })

  it('运行时页签（置首默认）：指标格（真实统计）+ 模型与路由表单 + 模型测试 + 最近调用空态', async () => {
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
    // 2026-10-25 用户「文案去掉」：指标下方的「统计来源：Skill 执行日志」说明行已撤；
    // 来源字段只在「工程」页签的工程信息里保留（排查口径时才看）
    expect(w.find('.skd-metric-band + .mk-card__note').exists()).toBe(false)
    // 统计口径对齐真实窗口（liveSkillStatsMap 默认近 7 天）：不再照抄 meta.stats 的「全量」
    expect(w.text()).toContain('近 7 天')

    // 模型与路由（2026-10-19 重排：宿主与设计区块原本各渲染一份同配置的可编辑副本，
    // 现由 RuntimeTab 单点承载，卡名从「模型配置」改为「模型与路由」）
    expect(w.text()).toContain('模型与路由')
    // 2026-10-24 用户「什么叫独立配置」：开关改称「覆盖平台默认」，说出独立于谁
    expect(w.text()).toContain('覆盖平台默认')
    // 保存钮只在表单变脏后出现在卡头（footer 的同名副本已撤）
    expect(w.findAll('.sdp-card__save').length).toBe(0)
    expect(w.text()).toContain('恢复默认')
    // 2026-10-24 用户「生效值没意义，拿掉」：只读摘要删掉，换成一行取值顺序（谁压谁）
    expect(w.text()).not.toContain('只读 · 当前实际生效')
    expect(w.find('.sdp-order').text()).toContain('取值顺序')
    // 模型测试（右侧验证列）
    expect(w.text()).toContain('模型测试')
    expect(w.text()).toContain('开始探测')
    // 同题不再出现两遍：页面里「模型与路由」「模型测试」各只一处
    expect(w.findAll('.mk-card__title').filter((t) => t.text().includes('模型与路由')).length).toBe(1)
    expect(w.findAll('.mk-card__title').filter((t) => t.text().includes('模型测试')).length).toBe(0) // 模型测试是段标题不是卡
    expect(w.text()).not.toContain('运行时限制')
    // 最近调用（SkillDrawer 概览迁入）：无日志窗口数据 → 明确空态
    expect(w.text()).toContain('最近调用')
    // 2026-10-08 走查 #3：原空态写「日志窗口内无调用」，与同屏近 7 天统计卡（如 27852 次调用）
    // 互斥。改为点明两者不同源——列表是本页采样，指标走统计接口由服务端聚合。
    expect(w.text()).toContain('近 7 天暂无该 Skill 的调用记录')
    expect(w.text()).toContain('统计范围与列表不同')
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

  it('字段路由页签：字段流转表格（角色人话/流向/渲染/属性）+ 下方字段路由设计区块；脱敏列无源不渲染', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[5].trigger('click') // 字段路由（第 6 个）
    await nextTick()

    // 平铺后本页有两处字段表（只读概览 + 设计区块的路由表）：断言只读概览那张（首个表）
    const rows = w.find('.mk-table').findAll('tbody tr')
    expect(rows.length).toBe(2)
    expect(rows[0].text()).toContain('learner_state')
    expect(rows[0].text()).toContain('必填入参')
    expect(rows[0].text()).toContain('state-agent')
    expect(rows[1].text()).toContain('内部')
    // 原型「脱敏」列后端无对应字段：不出现该列
    expect(w.find('.mk-table thead').text()).not.toContain('脱敏')
    // 2026-10-15 设计页平铺：字段路由设计区块（RoutingTab，根 .sdp-routing）就地渲染
    expect(w.find('.sdp-routing').exists()).toBe(true)

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
