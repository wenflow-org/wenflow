/**
 * 供应商与模型编辑面板（ModelProvidersPanel，BYOK 2026-10-18）：
 * 两栏结构、即时保存（开关/密钥/增删改）、后端人话原因可见、只读降级、上游清单登记、
 * 运行面读数（冷却/告警）与上游未登记折叠。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ModelProvidersPanel from '../ModelProvidersPanel.vue'
import { confirmState, settleConfirm } from '../useConfirm'

const {
  getMock, updateMock, removeMock, removeKeyMock, addModelMock, removeModelMock, updateModelMock, testMock, pullMock, getModelRegistryMock
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  updateMock: vi.fn(),
  removeMock: vi.fn(),
  removeKeyMock: vi.fn(),
  addModelMock: vi.fn(),
  removeModelMock: vi.fn(),
  updateModelMock: vi.fn(),
  testMock: vi.fn(),
  pullMock: vi.fn(),
  getModelRegistryMock: vi.fn()
}))

vi.mock('@/api/adminApi', () => ({
  adminModelProvidersApi: {
    get: getMock,
    update: updateMock,
    remove: removeMock,
    removeKey: removeKeyMock,
    addModel: addModelMock,
    updateModel: updateModelMock,
    removeModel: removeModelMock,
    test: testMock,
    pullModels: pullMock
  },
  adminApiConfigApi: { getModelRegistry: getModelRegistryMock }
}))

interface ProviderSpec {
  id: string
  name: string
  enabled?: boolean
  baseUrl?: string | null
  apiKeyEnv?: string | null
  keyHint?: string | null
  status?: 'ready' | 'unconfigured' | 'inherit' | 'disabled'
  models?: Array<{ id: string; tier?: 'chat' | 'reasoning'; fallbacks?: string[] }>
  profileId?: never
}

function providerView(p: ProviderSpec): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    description: null,
    enabled: p.enabled !== false,
    recommended: p.id === 'platform',
    endpointSource: p.baseUrl ? 'own' : 'inherit',
    baseUrl: p.baseUrl ?? null,
    apiKeyEnv: p.apiKeyEnv ?? null,
    keySource: p.keyHint ? 'db' : 'none',
    keyHint: p.keyHint ?? null,
    status: p.status ?? (p.baseUrl ? (p.keyHint ? 'ready' : 'unconfigured') : 'inherit'),
    models: (p.models ?? []).map((m) => ({
      id: m.id,
      label: m.id,
      tier: m.tier ?? 'chat',
      supportsThinking: false,
      supportsReasoningEffort: false,
      maxOutputTokens: null,
      defaultMaxTokens: null,
      reasoningReserveTokens: null,
      maxParallelRequests: null,
      fallbacks: m.fallbacks ?? [],
      pricing: null,
      description: null
    }))
  }
}

let view: { registry: Record<string, unknown>; providers: Array<Record<string, unknown>> }

function seedView(extra?: Partial<{ readOnly: boolean; providers: Array<Record<string, unknown>> }>): void {
  view = {
    registry: {
      path: 'backend/config/llm-providers.json',
      source: 'file',
      mtimeMs: 1,
      lastError: null,
      readOnly: extra?.readOnly ?? false
    },
    providers: extra?.providers ?? [
      providerView({ id: 'platform', name: '平台', models: [{ id: 'deepseek-v4-flash' }, { id: 'agnes-3.0-flash' }] }),
      providerView({ id: 'acme-gateway', name: 'Acme 网关', baseUrl: 'https://gw.acme.com/v1', apiKeyEnv: 'PROVIDER_ACME_GATEWAY_API_KEY', keyHint: '····9xQv', models: [{ id: 'acme-chat', fallbacks: ['acme-chat-2'] }, { id: 'acme-chat-2' }] })
    ]
  }
  getMock.mockResolvedValue({ data: { data: view } })
}

/** 模型行（排除「对话 / 推理」功能分组行） */
function modelRows(wrapper: Awaited<ReturnType<typeof mountPanel>>) {
  return wrapper.findAll('.mpp-table tbody tr').filter((r) => !r.classes('mpp-group'))
}

async function mountPanel(props: Record<string, unknown> = {}) {
  const wrapper = mount(ModelProvidersPanel, { props, global: { stubs: { teleport: true } } })
  await flushPromises()
  await nextTick()
  return wrapper
}

/** 选中左栏某个供应商（详情跟着换） */
async function pick(wrapper: Awaited<ReturnType<typeof mountPanel>>, name: string) {
  const item = wrapper.findAll('.mpp-item').find((i) => i.text().includes(name))!
  await item.trigger('click')
  await flushPromises()
}

function btn(wrapper: Awaited<ReturnType<typeof mountPanel>>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))
}

/** 面板用 v-show 切页签；未挂载到 document 时 isVisible() 读不到内联 display，直接看 style */
function shown(wrapper: Awaited<ReturnType<typeof mountPanel>>, selector: string): boolean {
  return !(wrapper.find(selector).attributes('style') || '').includes('display: none')
}

describe('ModelProvidersPanel', () => {
  beforeEach(() => {
    getMock.mockReset()
    updateMock.mockReset()
    removeMock.mockReset()
    removeKeyMock.mockReset()
    addModelMock.mockReset()
    removeModelMock.mockReset()
    updateModelMock.mockReset()
    testMock.mockReset()
    pullMock.mockReset()
    getModelRegistryMock.mockReset()
    getModelRegistryMock.mockResolvedValue({ data: { data: { models: [], cooldowns: [], warnings: [], runtime: { maxModelCandidates: 2 } } } })
    seedView()
  })

  it('两栏结构：左列表平铺一份供应商清单（不按来历分组），默认选中当前通道', async () => {
    const w = await mountPanel()
    // 2026-10-19 用户「就不分区」：原「平台提供 / 自行接入」两组与详情头「平台提供」徽标都撤了
    expect(w.findAll('.mpp-group__title')).toHaveLength(0)
    expect(w.text()).not.toContain('平台提供')
    expect(w.text()).not.toContain('自行接入')
    expect(w.findAll('.mpp-item__name').map((el) => el.text())).toEqual(['当前通道', 'Acme 网关'])
    // 列表行只给「N 个模型」，不露注册表 id（id 在详情头）
    expect(w.findAll('.mpp-item__meta').map((el) => el.text())).toEqual(['2 个模型', '2 个模型'])
    expect(w.find('.mpp-item--on').text()).toContain('当前通道')
    // 平台通道详情：状态徽标只出「能不能用」，这一档由下面的连接徽标回答 → 不出徽标
    expect(w.find('.mpp-detail__head').text()).toContain('当前通道')
    expect(w.find('.mpp-detail__head').findAll('.mk-badge')).toHaveLength(0)
    expect(w.text()).toContain('2 个')
  })

  it('模型为空时给下一步：当前通道直接去配置连接，不铺一张空表', async () => {
    seedView({ providers: [providerView({ id: 'platform', name: '平台', models: [] })] })
    const w = await mountPanel()
    const setup = w.find('.mpp-setup')
    expect(setup.exists()).toBe(true)
    expect(setup.text()).toContain('还没有登记模型')
    expect(setup.text()).toContain('先配置服务地址与 API Key')
    expect(w.find('.mpp-table').exists()).toBe(false)
    await btn(w, '去配置连接')!.trigger('click')
    await flushPromises()
    expect(shown(w, '#mpp-platform-panel-conn')).toBe(true)
  })

  it('供应商列表按 tab 语义走 roving tabindex：只有选中项占 Tab 位，方向键/Home/End 移动选中', async () => {
    const w = await mountPanel()
    const tabs = () => w.findAll('.mpp-item')
    expect(tabs().map((t) => t.attributes('tabindex'))).toEqual(['0', '-1'])

    await w.find('.mpp-list').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(w.find('.mpp-item--on').text()).toContain('Acme 网关')
    expect(tabs().map((t) => t.attributes('tabindex'))).toEqual(['-1', '0'])

    // 末尾再按下越界回到第一项（循环），Home 直接回第一项
    await w.find('.mpp-list').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(w.find('.mpp-item--on').text()).toContain('当前通道')
    await w.find('.mpp-list').trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(w.find('.mpp-item--on').text()).toContain('Acme 网关')
    await w.find('.mpp-list').trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(w.find('.mpp-item--on').text()).toContain('当前通道')
  })

  it('平台详情分「模型 / 连接 / 基础设施 / 生成参数」四页签：连接与生成参数由宿主经插槽内联注入，平台不再有「设置」钮', async () => {
    const w = await mountPanel()
    // 2026-10-26：平台详情有二级页签，默认落在「模型」
    const tabs = w.findAll('.mpp-subtabs .mk-subtab').map((t) => t.text())
    expect(tabs).toEqual(['模型2', '连接', '基础设施', '生成参数'])
    expect(w.find('.mpp-subtabs .mk-subtab[aria-selected="true"]').text()).toBe('模型2')
    expect(shown(w, '#mpp-platform-panel-models')).toBe(true)
    expect(shown(w, '#mpp-platform-panel-conn')).toBe(false)
    expect(shown(w, '#mpp-platform-panel-generation')).toBe(false)

    // 连接表单就在正下方：平台详情不再摆一颗点了几乎不动的「设置」
    expect(w.findAll('.mpp-detail__acts .mk-btn').some((b) => b.text() === '设置')).toBe(false)
    expect(w.emitted('focus-platform-connection')).toBeUndefined()

    // 切到「连接」页签：连接表单可见、模型表隐藏；再切「基础设施」
    await w.findAll('.mpp-subtabs .mk-subtab').find((t) => t.text() === '连接')!.trigger('click')
    expect(shown(w, '#mpp-platform-panel-conn')).toBe(true)
    expect(shown(w, '#mpp-platform-panel-models')).toBe(false)
    await w.findAll('.mpp-subtabs .mk-subtab').find((t) => t.text() === '基础设施')!.trigger('click')
    expect(shown(w, '#mpp-platform-panel-infra')).toBe(true)
    expect(shown(w, '#mpp-platform-panel-conn')).toBe(false)
    await w.findAll('.mpp-subtabs .mk-subtab').find((t) => t.text() === '生成参数')!.trigger('click')
    expect(shown(w, '#mpp-platform-panel-generation')).toBe(true)
    expect(shown(w, '#mpp-platform-panel-infra')).toBe(false)

    // 切到自定义供应商：没有二级页签（基础设施只属于平台），切回平台时归位到「模型」
    const acmeTab = w.findAll('.mpp-item').find((i) => i.text().includes('Acme 网关'))!
    await acmeTab.trigger('click')
    await flushPromises()
    expect(w.findAll('.mpp-subtabs')).toHaveLength(0)
    await w.findAll('.mpp-item').find((i) => i.text().includes('当前通道'))!.trigger('click')
    await flushPromises()
    expect(w.find('.mpp-subtabs .mk-subtab[aria-selected="true"]').text()).toBe('模型2')

    // 自定义供应商：设置仍打开注册表编辑弹层
    const acme = w.findAll('.mpp-item').find((i) => i.text().includes('Acme 网关'))!
    await acme.trigger('click')
    await flushPromises()
    await w.findAll('.mpp-detail__acts .mk-btn').find((b) => b.text() === '设置')!.trigger('click')
    await flushPromises()
    expect(w.find('[aria-label="供应商设置"]').exists()).toBe(true)
    expect(w.emitted('focus-platform-connection')).toBeUndefined()
  })

  it('自带端点的供应商：详情显示服务地址、密钥三件套（掩码 + 显示切换 + 留空沿用）与模型清单', async () => {
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    expect(w.find('.mpp-endpoint__value').text()).toBe('https://gw.acme.com/v1')
    const keyInput = w.find('.mpp-endpoint__key input')
    expect(keyInput.attributes('type')).toBe('password')
    expect(keyInput.attributes('placeholder')).toBe('已配置 ····9xQv，留空 = 沿用')
    await btn(w, '显示')!.trigger('click')
    expect(w.find('.mpp-endpoint__key input').attributes('type')).toBe('text')
    // 模型表：模型 / 功能 / 单价 / 状态 / 操作（用途分组行 + 能力标签见下一条用例）
    expect(w.findAll('.mpp-table thead th').map((t) => t.text())).toEqual(['模型', '功能', '状态', ''])
    const rows = modelRows(w)
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('acme-chat')
    expect(rows[1].text()).toContain('acme-chat-2')
  })

  it('按功能区分：按用途分组（对话 / 推理），能力（思考 / 推理强度 / 读图）单独成列', async () => {
    const platform = providerView({ id: 'platform', name: '平台', models: [
      { id: 'chat-plain' },
      { id: 'chat-read' },
      { id: 'think-fast', tier: 'reasoning' }
    ] })
    platform.models = (platform.models as Array<Record<string, unknown>>).map((m) => {
      if (m.id === 'chat-read') return { ...m, vision: true }
      if (m.id === 'think-fast') return { ...m, supportsThinking: true, supportsReasoningEffort: true }
      return m
    })
    seedView({ providers: [platform] })
    const w = await mountPanel()
    const groups = w.findAll('.mpp-group')
    // 两个用途各一段，组头写清功能与条数（空组不渲染）
    expect(groups.map((g) => g.find('.mpp-group__name').text())).toEqual(['对话', '推理'])
    expect(groups.map((g) => g.find('.mpp-group__count').text())).toEqual(['2 个', '1 个'])
    expect(groups[0].text()).toContain('常规教学、工具调用与高频 Skill')

    const rows = modelRows(w)
    const fn = (i: number) => rows[i].find('.mpp-fn').text()
    expect(fn(0)).toBe('基础对话')
    expect(fn(1)).toBe('读图')
    expect(fn(2)).toBe('思考推理强度')
    // 能力标签有可读文本，不只靠颜色
    expect(rows[1].findAll('.mpp-fn__chip').map((c) => c.text())).toEqual(['读图'])
  })

  it('停用开关先确认再写盘，成功后给回执（误触不会让上游直接退出路由）', async () => {
    const w = await mountPanel()
    updateMock.mockResolvedValue({
      data: {
        data: {
          registry: view.registry,
          providers: view.providers.map((p) => (p.id === 'acme-gateway' ? { ...p, enabled: false, status: 'disabled' } : p))
        }
      }
    })
    const acmeSwitch = w.findAll('.mpp-item')[1].find('.mk-switch')
    // 2026-10-23 UI 审查：开关只有 aria-checked、没有可访问名，读屏只念「开关」
    expect(acmeSwitch.attributes('aria-label')).toBe('启用供应商 Acme 网关')
    await acmeSwitch.trigger('click')
    await nextTick()
    // 停用要二次确认；取消则一次都不写
    expect(confirmState.open).toBe(true)
    settleConfirm(false)
    await flushPromises()
    expect(updateMock).not.toHaveBeenCalled()

    await acmeSwitch.trigger('click')
    await nextTick()
    settleConfirm(true)
    await flushPromises()
    expect(updateMock).toHaveBeenCalledWith('acme-gateway', { enabled: false })
    // 停用条目默认收起：清单只剩当前通道，底部给出「显示已停用」入口
    expect(w.findAll('.mpp-item__name').map((el) => el.text())).toEqual(['当前通道'])
    expect(w.text()).toContain('显示已停用（1）')
    await w.find('.mpp-show-disabled').trigger('click')
    await flushPromises()
    expect(w.find('.mpp-item__dot--disabled').exists()).toBe(true)
  })

  it('写失败时把后端人话原因显示出来（不静默、不假装保存成功）', async () => {
    const w = await mountPanel()
    updateMock.mockRejectedValue({ response: { data: { error: '默认对话模型「deepseek-v4-flash」解析不到已启用供应商提供的模型，保存会让全平台默认路由落空。' } } })
    await w.findAll('.mpp-item')[1].find('.mk-switch').trigger('click')
    await nextTick()
    settleConfirm(true)
    await flushPromises()
    expect(w.find('.mpp-alert').text()).toContain('解析不到已启用供应商提供的模型')
  })

  it('只读（配置文件不可写）：写入口全部禁用并给出说明', async () => {
    seedView({ readOnly: true })
    const w = await mountPanel()
    expect(w.text()).toContain('注册表文件所在目录当前不可写')
    // 2026-10-28 新人视角：不再从清单里「新建供应商」，只编辑当前通道
    expect(w.text()).not.toContain('添加供应商')
    // 模型行的写入口（编辑 / 删除）一并禁用；「测试」是只读动作，仍可用
    const rowBtn = (text: string) => w.findAll('.mpp-rowacts .mk-link').find((b) => b.text() === text)!
    expect(rowBtn('编辑').attributes('disabled')).toBeDefined()
    expect(rowBtn('测试').attributes('disabled')).toBeUndefined()
    // 删除是低频且不可撤销的动作，收进 ⋯ 菜单（与公告/账号/虚拟学习者同一套行内层级）
    expect(w.findAll('.mpp-rowacts .mk-link').some((b) => b.text() === '删除')).toBe(false)
    await w.find('.mpp-rowacts .mk-menu__btn').trigger('click')
    await flushPromises()
    const removeItem = w.findAll('.mpp-rowacts .mk-menu__item').find((b) => b.text() === '删除')!
    expect(removeItem.exists()).toBe(true)
    expect(removeItem.attributes('disabled')).toBeDefined()
  })

  it('获取模型列表 → 浮窗勾选：不再铺内联清单，勾选后带模型 id 打开编辑弹层', async () => {
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    pullMock.mockResolvedValue({ data: { data: { models: ['acme-chat', 'acme-chat-2', 'acme-pro'] } } })
    await btn(w, '获取模型列表')!.trigger('click')
    await flushPromises()
    expect(w.find('.mpp-fetch').exists()).toBe(false)
    const dialog = w.find('.pmd')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('已拉取 3 个')
    const rows = dialog.findAll('.pmd-row')
    expect(rows).toHaveLength(3)
    // 已登记的只读「已添加」，勾选框禁用
    const registered = rows.find((r) => r.text().includes('acme-chat') && !r.text().includes('acme-chat-2'))!
    expect(registered.text()).toContain('已添加')
    expect(registered.find('input').attributes('disabled')).toBeDefined()
    // 未登记的勾选后点「配置」，模型 id 预填进编辑弹层
    const target = rows.find((r) => r.text().includes('acme-pro'))!
    await target.find('input').setValue(true)
    await flushPromises()
    const liveDialog = w.find('.pmd')
    const confirm = liveDialog.findAll('button').find((b) => b.text().includes('配置选中的 1 个'))!
    await confirm.trigger('click')
    await flushPromises()
    expect(w.find('.pmd').exists()).toBe(false)
    const idInput = w.find('.med-modal .med-two input')
    expect(idInput.exists()).toBe(true)
    expect((idInput.element as HTMLInputElement).value).toBe('acme-pro')
  })

  it('勾选多个后逐个配置：保存一个自动进下一个，标题带进度', async () => {
    const w = await mountPanel({ upstream: ['mimo-v2.5-flash', 'step-3.5-flash'] })
    ;(w.vm as unknown as { openPull: () => void }).openPull()
    await nextTick()
    const boxes = w.findAll('.pmd-sec .pmd-row input')
    await boxes[0].setValue(true)
    await nextTick()
    await w.findAll('.pmd-sec .pmd-row input')[1].setValue(true)
    await nextTick()
    await w.findAll('.pmd .mk-modal__foot .mk-btn--primary')[0].trigger('click')
    await nextTick()
    const title = () => w.find('.med-modal .mk-modal__title').text()
    const idValue = () => (w.find('.med-modal .med-two input').element as HTMLInputElement).value
    expect(title()).toBe('添加模型 · 1/2')
    expect(idValue()).toBe('mimo-v2.5-flash')
    addModelMock.mockResolvedValue({ data: { data: {}, warnings: [] } })
    await w.find('.med-modal .mk-modal__foot .mk-btn--primary').trigger('click')
    await flushPromises()
    await nextTick()
    expect(title()).toBe('添加模型 · 2/2')
    expect(idValue()).toBe('step-3.5-flash')
    expect(addModelMock).toHaveBeenCalledTimes(1)
  })

  it('删除供应商要二次确认；确认后调删除接口', async () => {
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    removeMock.mockResolvedValue({ data: { success: true, data: view, warnings: [] } })
    const del = btn(w, '删除')!
    await del.trigger('click')
    await nextTick()
    expect(confirmState.open).toBe(true)
    expect(confirmState.message).toContain('2 个模型')
    settleConfirm(true)
    await flushPromises()
    expect(removeMock).toHaveBeenCalledWith('acme-gateway')
  })

  it('单模型测试走真实调用，结果回显在该模型行内', async () => {
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    testMock.mockResolvedValue({ data: { data: { model: 'acme-chat', durationMs: 1234, content: '可以' } } })
    await btn(w, '测试')!.trigger('click')
    await flushPromises()
    expect(testMock).toHaveBeenCalledWith('acme-gateway', { modelId: 'acme-chat' })
    const result = w.find('.mpp-rowtest')
    expect(result.text()).toContain('调用通过')
    expect(result.text()).toContain('1234ms')
    expect(result.attributes('title')).toContain('可以')
  })

  it('运行面读数：冷却中的模型标「冷却中」，空态是「健康」', async () => {
    getModelRegistryMock.mockResolvedValue({
      data: { data: { models: [], cooldowns: [{ providerId: 'acme-gateway', model: 'acme-chat', remainingMs: 30000 }], warnings: [], runtime: { maxModelCandidates: 2 } } }
    })
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    const rows = modelRows(w)
    expect(rows[0].text()).toContain('冷却中')
    expect(rows[1].text()).toContain('健康')
  })

  it('配置告警不只给图标：别名未引用的模型在状态列写明「未被引用」，细节留在 title', async () => {
    getModelRegistryMock.mockResolvedValue({
      data: {
        data: {
          models: [],
          cooldowns: [],
          warnings: ['模型「acme-chat」未被任何别名引用（只能通过具体 id 使用）。'],
          runtime: { maxModelCandidates: 2 }
        }
      }
    })
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    const badge = modelRows(w)[0].find('.mpp-label')
    expect(badge.text()).toContain('未被引用')
    expect(badge.attributes('title')).toContain('未被任何别名引用')
  })

  it('平台通道的拉取结果进浮窗勾选（不在详情里铺清单）', async () => {
    const w = await mountPanel({ upstream: ['deepseek-v4-flash', 'mystery-1', 'mystery-2'] })
    expect(w.find('.mpp-fetch').exists()).toBe(false)
    expect(w.find('.pmd').exists()).toBe(false)
    ;(w.vm as unknown as { openPull: () => void }).openPull()
    await nextTick()
    const rows = w.findAll('.pmd-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('已添加')
    expect(rows[1].text()).not.toContain('已添加')
    expect(rows[1].find('input').attributes('disabled')).toBeUndefined()
    expect(w.find('.mpp-chip').exists()).toBe(false)
  })

  it('上游按用途分流：浮窗里向量/生图/决策不提供勾选，改去对应配置', async () => {
    const w = await mountPanel({
      upstream: ['deepseek-v4-flash', 'BAAI/bge-m3', 'agnes-image-2.5-flash', 'jev-latest', 'agnes-video-2.5']
    })
    ;(w.vm as unknown as { openPull: () => void }).openPull()
    await nextTick()
    const chatRows = w.findAll('.pmd-sec:not(.pmd-sec--other) .pmd-row')
    expect(chatRows).toHaveLength(1)
    expect(chatRows[0].text()).toContain('deepseek-v4-flash')

    const otherRows = w.findAll('.pmd-row--other')
    expect(otherRows).toHaveLength(4)
    const rowText = (needle: string) => otherRows.find((r) => r.text().includes(needle))!
    expect(rowText('BAAI/bge-m3').text()).toContain('向量')
    expect(rowText('BAAI/bge-m3').find('button').text()).toBe('基础设施配置')
    expect(rowText('agnes-image-2.5-flash').text()).toContain('生图')
    expect(rowText('agnes-image-2.5-flash').find('button').text()).toBe('插件配置')
    expect(rowText('jev-latest').text()).toContain('决策')
    expect(rowText('agnes-video-2.5').text()).toContain('暂未接入')
    expect(rowText('agnes-video-2.5').find('button').exists()).toBe(false)

    // 基础设施配置 → 同页滚到基础设施卡（2026-10-25 不再开弹窗）
    await rowText('BAAI/bge-m3').find('button').trigger('click')
    expect(w.emitted('open-platform-settings')).toBeUndefined()
  })
})
