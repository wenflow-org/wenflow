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
      providerView({ id: 'platform', name: '平台提供', models: [{ id: 'deepseek-v4-flash' }, { id: 'agnes-3.0-flash' }] }),
      providerView({ id: 'acme-gateway', name: 'Acme 网关', baseUrl: 'https://gw.acme.com/v1', apiKeyEnv: 'PROVIDER_ACME_GATEWAY_API_KEY', keyHint: '····9xQv', models: [{ id: 'acme-chat', fallbacks: ['acme-chat-2'] }, { id: 'acme-chat-2' }] })
    ]
  }
  getMock.mockResolvedValue({ data: { data: view } })
}

async function mountPanel(props: Record<string, unknown> = {}) {
  const wrapper = mount(ModelProvidersPanel, { props })
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

  it('两栏结构：左列表按「平台提供 / 自行接入」分组，默认选中平台提供', async () => {
    const w = await mountPanel()
    expect(w.findAll('.mpp-group__title').map((el) => el.text())).toEqual(['平台提供', '自行接入'])
    expect(w.findAll('.mpp-item__name').map((el) => el.text())).toEqual(['平台提供', 'Acme 网关'])
    expect(w.find('.mpp-item--on').text()).toContain('平台提供')
    // 平台提供详情：状态徽标 + 模型清单（2 个），服务地址与密钥归连接设置（宿主插槽）
    expect(w.find('.mpp-detail__head').text()).toContain('平台提供')
    expect(w.text()).toContain('2 个')
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
    // 模型行：备用链按运行时上限截断展示
    const rows = w.findAll('.mpp-table tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('acme-chat')
    expect(rows[0].text()).toContain('acme-chat-2')
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

  it('获取模型列表 → 勾选登记：只登记勾中的，按对话档建立', async () => {
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    pullMock.mockResolvedValue({ data: { data: { models: ['acme-chat', 'acme-chat-2', 'acme-pro'], registered: ['acme-chat', 'acme-chat-2'] } } })
    addModelMock.mockResolvedValue({ data: { success: true, data: view, warnings: [] } })
    await btn(w, '获取模型列表')!.trigger('click')
    await flushPromises()
    expect(w.find('.mpp-pulled').text()).toContain('上游返回 3 个模型，其中 1 个还没登记')
    // 已登记的两个不可再勾（勾了也是重复 id）
    const chips = w.findAll('.mpp-chip')
    expect(chips[0].find('input').attributes('disabled')).toBeDefined()
    const target = chips.find((c) => c.text().includes('acme-pro'))!.find('input')
    await target.setValue(true)
    await btn(w, '登记选中的 1 个')!.trigger('click')
    await flushPromises()
    expect(addModelMock).toHaveBeenCalledWith('acme-gateway', { id: 'acme-pro', label: 'acme-pro', tier: 'chat' })
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

  it('单模型测试走真实调用并把原文回显到面板', async () => {
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    testMock.mockResolvedValue({ data: { data: { model: 'acme-chat', durationMs: 1234, content: '可以' } } })
    await btn(w, '测试')!.trigger('click')
    await flushPromises()
    expect(testMock).toHaveBeenCalledWith('acme-gateway', { modelId: 'acme-chat' })
    expect(w.find('.mpp-test').text()).toContain('调用通过')
    expect(w.find('.mpp-test').text()).toContain('1234ms')
    expect(w.find('.mpp-test').text()).toContain('「可以」')
  })

  it('运行面读数：冷却中的模型标「冷却中」，空态是「健康」', async () => {
    getModelRegistryMock.mockResolvedValue({
      data: { data: { models: [], cooldowns: [{ providerId: 'acme-gateway', model: 'acme-chat', remainingMs: 30000 }], warnings: [], runtime: { maxModelCandidates: 2 } } }
    })
    const w = await mountPanel()
    await pick(w, 'Acme 网关')
    const rows = w.findAll('.mpp-table tbody tr')
    expect(rows[0].text()).toContain('冷却中')
    expect(rows[1].text()).toContain('健康')
  })

  it('上游有、登记表没有的模型收进折叠（默认收起）', async () => {
    const w = await mountPanel({ upstream: ['deepseek-v4-flash', 'mystery-1', 'mystery-2'] })
    const fold = w.find('.mpp-upstream')
    expect(fold.exists()).toBe(true)
    expect(fold.find('summary').text()).toContain('上游还有 2 个未登记')
    expect(fold.attributes('open')).toBeUndefined()
  })
})
