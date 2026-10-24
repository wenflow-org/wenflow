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

  it('两栏结构：左列表平铺一份供应商清单（不按来历分组），默认选中平台通道', async () => {
    const w = await mountPanel()
    // 2026-10-19 用户「就不分区」：原「平台提供 / 自行接入」两组与详情头「平台提供」徽标都撤了
    expect(w.findAll('.mpp-group__title')).toHaveLength(0)
    expect(w.text()).not.toContain('平台提供')
    expect(w.text()).not.toContain('自行接入')
    expect(w.findAll('.mpp-item__name').map((el) => el.text())).toEqual(['平台', 'Acme 网关'])
    // 列表行只给「N 个模型」，不露注册表 id（id 在详情头）
    expect(w.findAll('.mpp-item__meta').map((el) => el.text())).toEqual(['2 个模型', '2 个模型'])
    expect(w.find('.mpp-item--on').text()).toContain('平台')
    // 平台通道详情：状态徽标只出「能不能用」，这一档由下面的连接徽标回答 → 不出徽标
    expect(w.find('.mpp-detail__head').text()).toContain('平台')
    expect(w.find('.mpp-detail__head').findAll('.mk-badge')).toHaveLength(0)
    expect(w.text()).toContain('2 个')
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
    expect(w.find('.mpp-item--on').text()).toContain('平台')
    await w.find('.mpp-list').trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(w.find('.mpp-item--on').text()).toContain('Acme 网关')
    await w.find('.mpp-list').trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(w.find('.mpp-item--on').text()).toContain('平台')
  })

  it('平台详情是二级页签：模型 / 连接 / 基础设施 / 生成参数；自定义供应商没有全局页签', async () => {
    const w = mount(ModelProvidersPanel, {
      props: {},
      global: { stubs: { teleport: true } },
      slots: {
        'platform-infra': '<div class="infra-slot">基础设施内容</div>',
        'platform-generation': '<div class="gen-slot">生成参数内容</div>'
      }
    })
    await flushPromises()
    await nextTick()
    const tabs = w.findAll('.mpp-tabs .mk-subtab').map((t) => t.text().trim())
    expect(tabs).toEqual(['模型2', '连接', '基础设施', '生成参数'])
    expect(w.find('#mpp-panel-models').attributes('style') || '').not.toContain('display: none')
    expect(w.find('#mpp-panel-conn').attributes('style')).toContain('display: none')
    expect(w.find('#mpp-panel-infra').attributes('style')).toContain('display: none')
    expect(w.find('#mpp-panel-generation').attributes('style')).toContain('display: none')

    const infraTab = w.findAll('.mpp-tabs .mk-subtab').find((t) => t.text().includes('基础设施'))!
    await infraTab.trigger('click')
    expect(infraTab.attributes('aria-selected')).toBe('true')
    expect(w.find('#mpp-panel-infra').attributes('style') || '').not.toContain('display: none')
    expect(w.find('#mpp-panel-models').attributes('style')).toContain('display: none')
    expect(w.find('.infra-slot').text()).toContain('基础设施内容')

    const acme = w.findAll('.mpp-item').find((i) => i.text().includes('Acme 网关'))!
    await acme.trigger('click')
    await flushPromises()
    expect(w.findAll('.mpp-tabs')).toHaveLength(0)
    expect(w.find('.mpp-models').attributes('style') || '').not.toContain('display: none')
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
    expect(w.findAll('.mpp-table thead th').map((t) => t.text())).toEqual(['模型', '功能', '单价', '状态', ''])
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

  it('启用开关即时保存：点开关就调写接口并采纳回吐的新视图', async () => {
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
    await flushPromises()
    expect(updateMock).toHaveBeenCalledWith('acme-gateway', { enabled: false })
    // 回吐视图被采纳：左栏该行变成停用态
    expect(w.find('.mpp-item__dot--disabled').exists()).toBe(true)
  })

  it('写失败时把后端人话原因显示出来（不静默、不假装保存成功）', async () => {
    const w = await mountPanel()
    updateMock.mockRejectedValue({ response: { data: { error: '默认对话模型「deepseek-v4-flash」解析不到已启用供应商提供的模型，保存会让全平台默认路由落空。' } } })
    await w.findAll('.mpp-item')[1].find('.mk-switch').trigger('click')
    await flushPromises()
    expect(w.find('.mpp-alert').text()).toContain('解析不到已启用供应商提供的模型')
  })

  it('只读（配置文件不可写）：写入口全部禁用并给出说明', async () => {
    seedView({ readOnly: true })
    const w = await mountPanel()
    expect(w.text()).toContain('注册表文件所在目录当前不可写')
    expect(btn(w, '添加供应商')!.attributes('disabled')).toBeDefined()
    // 模型行的写入口（编辑/删除）一并禁用；「测试」是只读动作，仍可用
    const rowBtn = (text: string) => w.findAll('.mpp-rowacts .mk-link').find((b) => b.text() === text)!
    expect(rowBtn('编辑').attributes('disabled')).toBeDefined()
    expect(rowBtn('删除').attributes('disabled')).toBeDefined()
    expect(rowBtn('测试').attributes('disabled')).toBeUndefined()
  })

  it('获取模型列表 → 逐条添加：一行一个模型，点「添加」带着模型 id 打开编辑弹层', async () => {
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    pullMock.mockResolvedValue({ data: { data: { models: ['acme-chat', 'acme-chat-2', 'acme-pro'] } } })
    await btn(w, '获取模型列表')!.trigger('click')
    await flushPromises()
    const fetch = w.find('.mpp-fetch')
    expect(fetch.text()).toContain('上游模型 3 个')
    const rows = fetch.findAll('.mpp-fetch__row')
    expect(rows).toHaveLength(3)
    // 已登记的只显「已添加」，不再给添加按钮
    const registered = rows.find((r) => r.text().includes('acme-chat') && !r.text().includes('acme-chat-2'))!
    expect(registered.text()).toContain('已添加')
    expect(registered.find('button').exists()).toBe(false)
    // 未登记的逐条添加：id 预填进编辑弹层，基础信息由用户确认后保存
    const target = rows.find((r) => r.text().includes('acme-pro'))!
    await target.find('button').trigger('click')
    await flushPromises()
    // 占位符随已下线模型归一（deepseek-v4-flash → v4.1-flash）
    const idInput = w.find('.med-modal input[placeholder="deepseek-v4.1-flash"]')
    expect(idInput.exists()).toBe(true)
    expect((idInput.element as HTMLInputElement).value).toBe('acme-pro')
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

  it('平台通道的上游清单同样逐条列出（不铺胶囊、不做批量登记）', async () => {
    const w = await mountPanel({ upstream: ['deepseek-v4-flash', 'mystery-1', 'mystery-2'] })
    const rows = w.findAll('.mpp-fetch__row')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('已添加')
    expect(rows[1].text()).toContain('添加')
    expect(w.find('.mpp-chip').exists()).toBe(false)
  })

  it('上游按用途分流：向量/生图/决策不提供「添加」，改去对应配置', async () => {
    const w = await mountPanel({
      upstream: ['deepseek-v4-flash', 'BAAI/bge-m3', 'agnes-image-2.5-flash', 'jev-latest', 'agnes-video-2.5']
    })
    const chatRows = w.findAll('.mpp-fetch__list .mpp-fetch__row')
    expect(chatRows).toHaveLength(1)
    expect(chatRows[0].text()).toContain('deepseek-v4-flash')

    const otherRows = w.findAll('.mpp-fetch__other .mpp-fetch__row')
    expect(otherRows).toHaveLength(4)
    const rowText = (needle: string) => otherRows.find((r) => r.text().includes(needle))!
    expect(rowText('BAAI/bge-m3').text()).toContain('向量')
    expect(rowText('BAAI/bge-m3').find('button').text()).toBe('基础设施配置')
    expect(rowText('agnes-image-2.5-flash').text()).toContain('生图')
    expect(rowText('agnes-image-2.5-flash').find('button').text()).toBe('插件配置')
    expect(rowText('jev-latest').text()).toContain('决策')
    expect(rowText('agnes-video-2.5').text()).toContain('暂未接入')
    expect(rowText('agnes-video-2.5').find('button').exists()).toBe(false)
  })
})
