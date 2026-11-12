/**
 * SkillDetail 技能详情二级页（原型 renderSkillDetail / openPromptModal 的落点，2026-10-01 新建）。
 *
 * 断言 = 原型版式的每一块 + 接线正确性 + 数据诚实性：
 *  - 接线：AdminConsole DETAIL_COMPONENTS 含 skill；Skills.vue 行点击直达设计页
 *    （2026-10-14 方案 B：原「设计」小钮撤除、行不再开 skill 二级页）；Orchestrator.vue
 *    编排图节点点击 openSubPage('skill')；两者均不再引用 SkillDrawer
 *  - hero：S 头像 / 技能名 / 归属 Agent · 类别副文 / 健康+类别+模型+版本 pills / 真实动作
 *  - 4 页签（运行概览 / 指令与字段 / 在线试跑 / 版本与信息；2026-11-08 由 6 档合并：
 *    协议+字段路由 → 指令与字段，版本+工程 → 版本与信息）；运行概览置首：健康+证据先于配置；
 *    页签写/读 ?tab=，旧键（versions/engineering/routing/fields）别名归一，深链/刷新可寻址
 *  - 指令与字段：输入契约 vrow + 流程空态 + 全文 System Prompt（英文「输出契约」墙已删，
 *    逐字段中英对照改由同页签下方的字段流向表承载）
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
import { subPage, closeSubPage, dataSource, liveSkillStatsMap, intent } from '../store'
import { confirmState, settleConfirm } from '../useConfirm'
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
        { fieldId: 'mastery_delta', promptRole: 'proposal-output', valueType: 'object', description: '掌握度增量' },
        // 隐式推断类内部出参：编排里由本阶段模型产出，绝不属于「输入契约」（2026-10-31 四轮评审 P0-2 回归锁定）
        { fieldId: 'analysis.confusion', promptRole: 'hidden-inference', valueType: 'object', description: '隐式推断出参' }
      ],
      promptRoleMeta: [
        { id: 'hard-required', label: '必填入参' },
        { id: 'public-reply', label: '公开回复' },
        { id: 'proposal-output', label: '方案产出' },
        { id: 'hidden-inference', label: '隐式推断' }
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
/* core YAML（协议页签：输入契约 = inputs 声明 + 输出字段/规则表单的同一份数据） */
const CORE_MOCK = {
  data: {
    core: {
      inputs: [
        { name: 'learner', type: 'object', ref: 'sandbox:agent.learner', desc: '学习者状态' },
        { name: 'messages', type: 'array', ref: 'user:latestMessage' }
      ],
      rules: ['先诊断再讲解', '不替学生写作业'],
      fields: []
    }
  }
}
coreMock.mockResolvedValue(CORE_MOCK)

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

    // 2026-11-09 目录改为固定列宽表：行选择器从 .sk-item 换成表格行
    const row = w.find('.sk-catalog tbody tr')
    expect(row.exists()).toBe(true)
    await row.trigger('click')
    await settle()
    expect(subPage.value).toMatchObject({ view: 'skill', id: 'skill-a' })
    closeSubPage()
    w.unmount()
  })

  /* 2026-11-11 第二轮（键盘动线）：目录行本身可 Tab（tabindex=0）+ Enter/Space 打开详情；
     行内「详情」按钮是同一落点的第二入口，@click.stop 保证只跳一次（不叠加行点击）。 */
  it('目录行键盘动线：Enter / Space 打开详情；行内「详情」按钮单跳', async () => {
    closeSubPage()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
    })
    await router.push('/admin/skills')
    await router.isReady()
    const w = mount(Skills, { global: { plugins: [router] } })
    await settle()

    const row = w.find('.sk-catalog tbody tr')
    expect(row.attributes('tabindex')).toBe('0')
    await row.trigger('keydown', { key: 'Enter' })
    await settle()
    expect(subPage.value).toMatchObject({ view: 'skill', id: 'skill-a' })

    closeSubPage()
    const detail = row.findAll('button').find((b) => b.text() === '详情')
    expect(detail, '行内应有「详情」按钮').toBeTruthy()
    await detail!.trigger('click')
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
    // 2026-10-31 四轮评审：Skill 数带「编排」限定词，与 Skill 目录的 29 个区分口径
    expect(OrchestratorSource).toContain('}} 阶段 · {{ totalSkills }} 个编排 Skill')
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

  /* 2026-11-10 用户「阶段换成英文名，和 agent 一样」：页签与画布列头都用阶段 id，
     中文全名只留在悬停 title 里（与 goal-agent 同一语言，读起来是一对）。 */
  it('编排图阶段名用英文 id，中文全名退到悬停', () => {
    expect(OrchestratorSource).toContain('{{ stageTabLabel(s) }}')
    expect(OrchestratorSource).toContain('const stageTabLabel = (s: Stage) => s.id')
    // 列头：可见文本 = s.id，title 仍给中文全名
    expect(OrchestratorSource).toContain('class="orch-odg-colname" :title="s.name">{{ s.id }}')
    // 悬停仍是业务名（中文）在先
    expect(OrchestratorSource).toContain('function stageTabTitle(s: Stage): string')
    expect(OrchestratorSource).toContain('return [s.name,')
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
    // 2026-11-10 用户「入出、必填产出 都去掉」：总览不再挂字段读数
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

  /** 2026-11-08 用户「6 个重叠晦涩的页签合并为 4 个」：协议+字段路由 → 指令与字段；版本+工程 → 版本与信息。 */
  it('4 页签：运行概览 / 指令与字段 / 在线试跑 / 版本与信息（运行概览置首，默认选中）', async () => {
    const w = mountDetail()
    await settle()

    const tabs = w.findAll('.mk-subtab')
    expect(tabs.map((t) => t.text())).toEqual(['运行概览', '指令与字段', '在线试跑', '版本与信息'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    w.unmount()
  })

  it('?tab= 写/读：深链带合法 tab 直达该页签；旧键（versions/engineering）别名归一到新页签', async () => {
    subPage.value = { view: 'skill', id: 'skill-a' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
    })
    // 旧深链 ?tab=versions 仍可寻址：归一落到「版本与信息」（最后一个页签）
    await router.push('/admin/people?view=skill&id=skill-a&tab=versions')
    await router.isReady()
    const w = mount(SkillDetail, { global: { plugins: [router] } })
    await settle()
    expect(w.findAll('.mk-subtab')[3].attributes('aria-selected')).toBe('true')

    // 点击写：切「在线试跑」→ URL 回写（router.replace 为异步导航，需 flushPromises）
    await w.findAll('.mk-subtab')[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('trial')
    w.unmount()
  })

  /* 回归（2026-11-08 自伤）：合并页签后多了键 `info`，但认领集合漏了它。
     从旧深链（?tab=runtime 等本页认领的旧键）进入后点「版本与信息」→ 写回 ?tab=info →
     重读时不认领 → 落回默认页「运行概览」，页签自己弹回。 */
  it('从旧深链进入后点「版本与信息」：停在该页签，不被读回默认页', async () => {
    subPage.value = { view: 'skill', id: 'skill-a' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
    })
    await router.push('/admin/people?view=skill&id=skill-a&tab=runtime')
    await router.isReady()
    const w = mount(SkillDetail, { global: { plugins: [router] } })
    await settle()
    expect(w.findAll('.mk-subtab')[0].attributes('aria-selected')).toBe('true')

    await w.findAll('.mk-subtab')[3].trigger('click')
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('info')
    // 关键断言：URL 写回后不能被读回默认页
    expect(w.findAll('.mk-subtab')[3].attributes('aria-selected')).toBe('true')
    w.unmount()
  })

  it('指令与字段页签：查看态 = 输入契约 · 流程 · 全文生效 Prompt（英文输出契约墙已删）', async () => {
    const w = mountDetail()
    await settle()
    // 运行概览已置首：指令与字段需显式切入（第 2 个）
    await w.findAll('.mk-subtab')[1].trigger('click')
    await nextTick()

    // 平铺后 .skd-pane 内有多个 .skd-bloc（各 v-show）；协议块是模板里的第一个（index 0）。
    const bloc = w.findAll('.skd-bloc')[0]
    /* 2026-11-08 用户「图 4 右边塞了一堵 20 行纯英文变量墙，根本没法读」：
       「输出契约」卡整张删除——逐字段中英对照改由同页签下方的字段流向表承载。 */
    const cards = bloc.findAll('.mk-card__title').map((t) => t.text())
    expect(cards).toEqual(['输入契约', '流程', 'System Prompt'])

    // 输入契约 = core YAML 的 inputs 声明（ref 前缀标来源：sandbox: → 编排注入 / user: → 用户 / 平台）
    const inCard = bloc.findAll('.mk-card')[0]
    const inRows = inCard.findAll('.sdp-crow')
    expect(inRows.length).toBe(2)
    expect(inRows[0].text()).toContain('learner')
    expect(inRows[0].text()).toContain('编排注入')
    expect(inRows[1].text()).toContain('用户 / 平台')

    // 流程：core 与运行时清单都没声明阶段/终止 → 一行空态
    const flowCard = bloc.findAll('.mk-card')[1]
    expect(flowCard.find('.mk-card__title').text()).toBe('流程')
    expect(flowCard.find('.sdp-flowrow').exists()).toBe(false)
    expect(flowCard.text()).toContain('core YAML 与运行时清单都没有声明阶段或终止条件。')

    // System Prompt：全文代码卡（2026-11-08 改容器内滚动），不再有「已截断」的半句话
    expect(bloc.find('.sdp-pw__pre').text()).toContain('SYSTEM PROMPT BODY')
    expect(bloc.text()).not.toContain('已截断')
    // 查看态不含编辑态的东西（保存并编译 / 发布 / 源码视图）
    expect(bloc.text()).not.toContain('保存并编译')
    expect(bloc.text()).not.toContain('编译预览')

    // 切到编辑态：核心文件表单与发布动作才出现
    const editBtn = bloc.findAll('.mk-seg__item').find((b) => b.text() === '编辑')!
    await editBtn.trigger('click')
    await nextTick()
    expect(bloc.text()).toContain('核心文件')
    expect(bloc.text()).toContain('保存并编译')

    w.unmount()
  })

  /* P0（2026-11-11）：生效 Prompt 拉取失败此前只剩一句「暂无生效 Prompt。」——
     把「请求失败」读成「确实没有生效版本」。失败必须给原因 + 重试。 */
  it('生效 Prompt 拉取失败：显示可读原因 + 重试，不落成「暂无生效 Prompt」空态', async () => {
    promptMock.mockRejectedValueOnce(new Error('upstream 502'))
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[1].trigger('click')
    await nextTick()

    const alert = w.findAll('.mk-alert').find((a) => a.text().includes('生效 Prompt 加载失败'))
    expect(alert, '应有生效 Prompt 错误条').toBeTruthy()
    expect(alert!.text()).toContain('upstream 502')
    expect(w.find('.sdp-pw__pre').exists()).toBe(false)

    promptMock.mockResolvedValueOnce({
      data: { data: { prompt: { id: 'p-9', version: 9, name: 'v9', systemPrompt: 'RETRY OK' } } }
    })
    await alert!.find('button').trigger('click')
    await settle()
    expect(w.find('.sdp-pw__pre').text()).toContain('RETRY OK')
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
    // 2026-11-02 评审：底排此前只有「复制内容 / 取消 / 前往核心文件编辑」，读起来像没有保存动作。
    // 草稿本来就落在本机浏览器（关闭时 persistPromptDraft → sessionStorage，下次打开自动恢复），
    // 这颗钮只是把已有的持久化显式化，不是假保存（后端仍无草稿接口）。
    expect(modal!.textContent).toContain('保存草稿')
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
    const runBtn = w.findAll('button').find((b) => b.text().includes('开始试跑'))!
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

    const runBtn = w.findAll('button').find((b) => b.text().includes('开始试跑'))!
    await runBtn.trigger('click')
    await settle()
    expect(testSkillMock).toHaveBeenCalledWith('skill-a', { milestone: {}, cognitiveCore: {} })
    w.unmount()
    coreMock.mockResolvedValue(CORE_MOCK)
  })

  it('版本页签：只保留 VersionsTab 单一入口，不再重复渲染 Prompt 版本表', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[3].trigger('click') // 版本（第 4 个）
    await nextTick()

    // 2026-11-06 整合：三段（变体 / 核心文件 / Prompt）同处一张卡，卡头分段切换
    const versionsBloc = w.findAll('.skd-bloc').find((b) => b.find('.mk-seg').exists())
    expect(versionsBloc, '版本页签应已渲染').toBeTruthy()
    expect(versionsBloc!.findAll('.mk-seg__item').map((b) => b.text())).toEqual(['变体', '核心文件', 'Prompt'])
    // 只有一个版本入口：卡内不出现第二个「Prompt 版本」标题
    expect(versionsBloc!.findAll('.mk-card__title').length).toBe(0)

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
    /* 2026-11-10 用户「模型与路由也重新设计一下」：卡头「覆盖平台默认」开关与
       那行黄字说明撤除——卡面陈述当前模型与参数，改值走「配置」。
       「平台默认」这类机制词不再出现在这一屏（承接列表页同一口径）。 */
    expect(w.text()).not.toContain('覆盖平台默认')
    expect(w.text()).not.toContain('平台默认')
    expect(w.find('.sdp-head__act').exists()).toBe(true)
    // 2026-10-28：保存与「恢复默认」都收进配置弹层；卡面只有摘要 + 配置入口
    expect(w.findAll('.sdp-card__save').length).toBe(0)
    expect(w.find('.sdp-live').exists()).toBe(true)
    expect(w.findAll('button').some((b) => b.text() === '配置')).toBe(true)
    // 2026-10-24 用户「生效值没意义，拿掉」：只读摘要删掉，换成「谁压谁」的说明
    expect(w.text()).not.toContain('只读 · 当前实际生效')
    // 2026-11-06 两行摘要：模型 id 的悬停仍是「谁压谁」那套说明
    expect(w.find('.sdp-model').attributes('title') ?? '').toContain('本 Skill 指定')
    // 2026-11-04：模型测试块已从本页撑出去——连通性测试在「模型与接入」页每个模型上都有
    expect(w.text()).not.toContain('开始探测')
    expect(w.find('#sdp-panel-test').exists()).toBe(false)
    // 同题不再出现两遍：页面里「模型与路由」只一处
    expect(w.findAll('.mk-card__title').filter((t) => t.text().includes('模型与路由')).length).toBe(1)
    expect(w.text()).not.toContain('运行时限制')
    // 最近调用（SkillDrawer 概览迁入）：无日志窗口数据 → 明确空态
    expect(w.text()).toContain('最近调用')
    // 2026-10-08 走查 #3：原空态写「日志窗口内无调用」，与同屏近 7 天统计卡（如 27852 次调用）
    // 2026-10-31 O04：列表改服务端自拉（与指标卡同窗口），采样仅作失败兜底。
    expect(w.text()).toContain('近 7 天暂无该 Skill 的调用记录')
    expect(w.text()).toContain('与指标卡同窗口')
    // 服务端自拉后空态与指标卡同口径（O04），不再写「统计范围与列表不同」

    w.unmount()
  })

  it('版本与信息：工程信息事实区（真实 meta/overview 字段），仓库/值班/SLO 无源不渲染', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[3].trigger('click') // 版本与信息（原「版本」+「工程」）
    await nextTick()

    /* 2026-11-06 整合：宿主的「工程信息」kv 卡与页签内的「基础信息」是同一批事实的两套呈现，
       已合成一套（.mk-facts--rows），只剩页签内这份。 */
    expect(w.text()).toContain('基础信息')
    expect(w.text()).not.toContain('工程信息')
    expect(w.text()).toContain('skill-a')
    expect(w.text()).toContain('教学 Agent')
    // 底层机器标识（Prompt 文件路径 / 哈希 / 生效记录 ID）折进默认收起的开发者抽屉
    expect(w.text()).toContain('开发者底层工程元数据')
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

  it('指令与字段：字段流向表默认流向视图；「契约编辑」切设计区块——两套大表不再同屏堆叠', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[1].trigger('click') // 指令与字段（原「协议」+「字段路由」）
    await nextTick()

    // 2026-10-31 外部评审拍板：页签内加「流向视图 / 契约编辑」切换器，默认流向。
    // 2026-11-06：分段控件改用共享 .mk-seg（原 .skd-rswitch 是本页第三套分段方言）
    const vSwitch = w.findAll('.mk-seg').find((s) => s.text().includes('流向视图'))
    expect(vSwitch, '字段路由页签应有流向/契约分段').toBeTruthy()
    expect(vSwitch!.findAll('.mk-seg__item').map((b) => b.text())).toEqual(['流向视图', '契约编辑'])
    expect(w.text()).toContain('契约编辑')

    // 默认流向视图：只读概览表（角色人话/流向/渲染/属性）
    const rows = w.find('.mk-table').findAll('tbody tr')
    expect(rows.length).toBe(2)
    expect(rows[0].text()).toContain('learner_state')
    expect(rows[0].text()).toContain('必填入参')
    expect(rows[0].text()).toContain('state-agent')
    expect(rows[1].text()).toContain('内部')
    // 原型「脱敏」列后端无对应字段：不出现该列
    expect(w.find('.mk-table thead').text()).not.toContain('脱敏')
    // 设计区块默认不挂载（切到契约编辑才拉数据）
    expect(w.find('.sdp-routing').exists()).toBe(false)

    await vSwitch!.findAll('.mk-seg__item')[1].trigger('click')
    await nextTick()
    expect(w.find('.sdp-routing').exists()).toBe(true)

    w.unmount()
  })

  /* 2026-11-11 走查（lesson-knowledge-enricher）：6 个产出字段的「流向」全是 —、
     「渲染」全是隐藏、「内部/累积」全空——三列逐行复读同一个空值，说明列被挤窄。
     与「脱敏列无数据就不出列」同一判例：整列没有信息量就省略。 */
  it('字段流向表：全表同值时省略空列（流向 / 渲染 / 属性），渲染全隐藏只在卡头说一次', async () => {
    routingsMock.mockResolvedValueOnce({
      data: {
        data: {
          skillId: 'skill-a',
          stage: 'teaching',
          agentId: 'teaching-agent',
          routings: [
            { agentId: 'teaching-agent', fieldId: 'conceptLedger', render: 'hidden', handoff: [], internal: false, accumulate: false, notes: '概念账本' },
            { agentId: 'teaching-agent', fieldId: 'knowledgeStateSummary', render: 'hidden', handoff: [], internal: false, accumulate: false, notes: '知识状态摘要' }
          ],
          fields: [
            { fieldId: 'conceptLedger', promptRole: 'proposal-output', valueType: 'object', description: '概念账本' },
            { fieldId: 'knowledgeStateSummary', promptRole: 'proposal-output', valueType: 'string', description: '知识状态摘要' }
          ],
          promptRoleMeta: [{ id: 'proposal-output', label: '派生展示' }],
          core: { exists: true, fields: [], sync: null }
        }
      }
    })
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[1].trigger('click')
    await nextTick()

    const table = w.find('.mk-table')
    const heads = table.findAll('thead th').map((t) => t.text())
    expect(heads).toEqual(['字段', '角色', '说明'])
    // 卡头一句替代 2 行「隐藏」徽章；文案明确「列已省略」，避免读者以为列丢了
    expect(w.text()).toContain('渲染全部隐藏（列已省略）')
    const hiddenHint = w.findAll('.mk-card__meta').find((m) => m.text().includes('渲染全部隐藏'))
    expect(hiddenHint!.attributes('title')).toContain('省略「渲染」列')
    expect(table.text()).not.toContain('隐藏')
    w.unmount()
  })

  it('字段流向表：有真实流向 / 属性时列仍在（不误伤有信息的表）', async () => {
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[1].trigger('click')
    await nextTick()

    const heads = w.find('.mk-table').findAll('thead th').map((t) => t.text())
    expect(heads).toContain('流向')
    expect(heads).toContain('渲染')
    expect(heads).toContain('内部 / 累积')
    w.unmount()
  })

  it('试跑失败：错误原因可读 + 重试入口；重试按同一载荷再跑一次', async () => {
    testSkillMock.mockRejectedValueOnce(new Error('upstream boom'))
    testSkillMock.mockResolvedValueOnce({
      data: { data: { success: true, duration: 12, cached: false, output: { ok: true } } }
    })
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[2].trigger('click')
    await nextTick()

    const runBtn = w.findAll('button').find((b) => b.text().includes('开始试跑'))!
    await runBtn.trigger('click')
    await settle()
    const alert = w.find('.mk-alert')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('试跑失败')
    const retry = alert.findAll('button').find((b) => b.text() === '重试')
    expect(retry, '失败态应有重试入口').toBeTruthy()

    await retry!.trigger('click')
    await settle()
    expect(testSkillMock).toHaveBeenCalledTimes(2)
    expect(w.find('.sdp-output').text()).toContain('ok')
    w.unmount()
  })

  /* 2026-11-11 第二轮（可用性）：排查「这个 Skill 最近为什么失败」最常用的一跳。
     最近调用列表只到单条 Trace，卡头补「查执行日志」→ 按该 Skill 过滤的全部调用；
     复用 ExecLogs 的 URL 契约（?agent=，AdminConsole 由 intent 落 URL），不改后端。 */
  it('最近调用卡头 → 执行日志：带该 Skill 的 agent 过滤（全部状态，近 7 天）', async () => {
    intent.scene = ''
    intent.agentFilter = ''
    intent.statusFilter = ''
    const w = mountDetail()
    await settle()

    const btn = w.findAll('button').find((b) => b.text() === '查执行日志')
    expect(btn, '运行时页签应有「查执行日志」入口').toBeTruthy()
    await btn!.trigger('click')

    expect(intent.scene).toBe('execution-logs')
    expect(intent.agentFilter).toBe('skill-a')
    // 这个入口看全部调用；失败筛选入口仍是 hero 健康徽标（investigateAgent 默认 status=err）
    expect(intent.statusFilter).toBe('')
    expect(intent.timeRange).toBe('week')
    w.unmount()
    intent.scene = ''
    intent.agentFilter = ''
  })

  it('hero 失败徽标 → 执行日志失败筛选：任何页签都一跳（不再先切运行概览）', async () => {
    liveSkillStatsMap.value = { 'skill-a': { calls: 100, errors: 5, avgMs: 2200, lastAt: '刚刚' } }
    intent.scene = ''
    intent.agentFilter = ''
    intent.statusFilter = ''
    const w = mountDetail()
    await settle()
    // 切到非运行页签，确认徽标仍直接进日志
    await w.findAll('.mk-subtab')[1].trigger('click')
    await nextTick()

    const badge = w.find('.skd-badge-btn')
    expect(badge.exists(), '有失败时健康徽标应可点').toBe(true)
    await badge.trigger('click')
    expect(intent.scene).toBe('execution-logs')
    expect(intent.agentFilter).toBe('skill-a')
    expect(intent.statusFilter).toBe('err')
    w.unmount()
    intent.scene = ''
    intent.agentFilter = ''
    intent.statusFilter = ''
  })

  /* 2026-11-11 第二轮：Prompt 弹层的正文改动此前不在 anyDirty 里——
     编辑后点面包屑返回 / 关浏览器不会拦（弹层「已关闭」时草稿会落 sessionStorage，
     但「没关就离开」这条路是静默丢弃）。现在纳入离开守卫，且关闭弹层后不再重复拦。 */
  it('Prompt 弹层有未保存改动：离开被确认框拦下；关闭弹层落草稿后不再拦', async () => {
    confirmState.open = false
    confirmState.busy = false
    confirmState.busyMode = false
    confirmState.resolve = null
    const w = mountDetail()
    await settle()
    await w.findAll('.mk-subtab')[1].trigger('click')
    await nextTick()
    await w.findAll('.mk-card__head .mk-btn--sm')[0].trigger('click')
    await nextTick()

    const ta = document.querySelector('.mk-modal textarea') as HTMLTextAreaElement
    expect(ta).toBeTruthy()
    ta.value = 'CHANGED PROMPT BODY'
    ta.dispatchEvent(new Event('input'))
    await nextTick()

    // 关浏览器同样要拦（beforeunload 与 anyDirty 同源）
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    closeSubPage()
    await settle()
    expect(confirmState.open, '未保存的 Prompt 应触发离开确认').toBe(true)
    settleConfirm(false)
    await settle()
    expect(subPage.value?.view).toBe('skill')

    // 显式关闭弹层 → 草稿落 sessionStorage，dirty 清零；再离开不再拦
    ;(document.querySelector('.mk-modal__close') as HTMLButtonElement).click()
    await nextTick()
    confirmState.open = false
    closeSubPage()
    await settle()
    expect(confirmState.open).toBe(false)
    w.unmount()
    sessionStorage.removeItem('skd-prompt-draft:skill-a')
    intent.scene = ''
    intent.agentFilter = ''
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
