/**
 * 接入通道面板（ModelProvidersPanel，BYOK 2026-10-18；2026-10-27 收敛为单通道）：
 * 平台通道详情（页签 / 模型表 / 增删改）、后端人话原因可见、只读降级、上游清单登记、
 * 运行面读数（冷却/告警）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ModelProvidersPanel from '../ModelProvidersPanel.vue'

const {
  getMock, addModelMock, addModelsMock, updateModelMock, testMock, getModelRegistryMock
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  addModelMock: vi.fn(),
  addModelsMock: vi.fn(),
  updateModelMock: vi.fn(),
  testMock: vi.fn(),
  getModelRegistryMock: vi.fn()
}))

vi.mock('@/api/adminApi', () => ({
  adminModelProvidersApi: {
    get: getMock,
    addModel: addModelMock,
    addModels: addModelsMock,
    updateModel: updateModelMock,
    test: testMock
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

/** 对话模型行（列表行，不是列头表格） */
function modelRows(wrapper: Awaited<ReturnType<typeof mountPanel>>) {
  return wrapper.findAll('.mpp-model-row')
}

async function mountPanel(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  const wrapper = mount(ModelProvidersPanel, { props, slots, global: { stubs: { teleport: true } } })
  await flushPromises()
  await nextTick()
  return wrapper
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
    addModelMock.mockReset()
    addModelsMock.mockReset()
    updateModelMock.mockReset()
    testMock.mockReset()
    getModelRegistryMock.mockReset()
    getModelRegistryMock.mockResolvedValue({ data: { data: { models: [], cooldowns: [], warnings: [], runtime: { maxModelCandidates: 2 } } } })
    seedView()
  })

  it('单通道详情：左栏通道清单已撤，页面直接呈现平台通道', async () => {
    const w = await mountPanel()
    // 2026-10-27 用户「这个区域不要了」：不再有左栏清单，也没有通道切换/停用入口
    expect(w.find('.mpp-list').exists()).toBe(false)
    expect(w.find('.mpp-item').exists()).toBe(false)
    // 自建通道仍在注册表里，但这一页不再提供它的入口
    expect(w.text()).not.toContain('Acme 网关')
    expect(w.text()).not.toContain('显示已停用')
    // 卡头是能力卡身份：对话与推理模型 + LLM，连接状态由宿主注入
    expect(w.find('.mk-card__head').text()).toContain('对话与推理模型')
    expect(w.find('.mk-card__head').find('.mpp-type').text()).toBe('LLM')
    expect(w.find('.mk-card__head').text()).not.toContain('一条通道 =')
    // 状态徽标只出「能不能用」，这一档由下面的连接徽标回答 → 不出徽标
    expect(w.find('.mk-card__head').findAll('.mk-badge')).toHaveLength(0)
    // 挂载模型区：区名 + 条数，列表不再有列头表格
    expect(w.find('.mpp-models__head').text()).toContain('挂载模型')
    expect(w.find('.mpp-models__count').text()).toBe('2 个')
    expect(w.findAll('.mpp-model-row')).toHaveLength(2)
  })

  it('模型为空时给下一步：平台通道直接去配置连接，不铺一张空表', async () => {
    seedView({ providers: [providerView({ id: 'platform', name: '平台', models: [] })] })
    const w = await mountPanel()
    const setup = w.find('.mpp-setup')
    expect(setup.exists()).toBe(true)
    expect(setup.text()).toContain('还没有登记模型')
    expect(setup.text()).toContain('先配置服务地址与 API Key')
    // 2026-10-28 对话模型为空时不铺空列表；向量 / 重排已拆成宿主的独立能力卡
    expect(w.find('.mpp-models__list').exists()).toBe(false)
    expect(w.findAll('.mpp-model-row')).toHaveLength(0)
    await btn(w, '去配置连接')!.trigger('click')
    await flushPromises()
    expect(w.find('#mpp-platform-panel-conn').exists()).toBe(true)
  })

  it('本卡只负责对话与推理：连接与挂载模型常驻，向量 / 重排已拆到宿主', async () => {
    const w = await mountPanel()
    // 2026-10-27 用户「把 tab 解散了」：没有二级页签，内容全在 DOM 里且都可见
    expect(w.findAll('.mpp-subtabs').length).toBe(0)
    expect(w.find('[role="tab"]').exists()).toBe(false)
    expect(shown(w, '#mpp-platform-panel-conn')).toBe(true)
    expect(shown(w, '#mpp-platform-panel-models')).toBe(true)
    expect(w.find('#mpp-platform-panel-generation').exists()).toBe(false)
    // 2026-10-28 三卡重构：向量 / 重排不再嵌在对话卡里
    expect(w.find('#mpp-platform-panel-infra').exists()).toBe(false)
    // 连接表单就在正下方：平台详情不再摆一颗点了几乎不动的「设置」
    expect(w.findAll('.mpp .mk-card__head .mk-btn').some((b) => b.text() === '设置')).toBe(false)
    expect(w.emitted('focus-platform-connection')).toBeUndefined()
  })

  it('对话模型区平铺：不再按用途切小组，能力标签跟在模型 ID 后面', async () => {
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
    // 区标题只留「区名 + 条数」，添加入口在本区标题行
    expect(w.find('.mpp-models__head').text()).toContain('挂载模型')
    expect(w.find('.mpp-models__count').text()).toBe('3 个')
    expect(w.findAll('.mpp-group')).toHaveLength(0)

    const rows = modelRows(w)
    expect(rows).toHaveLength(3)
    const caps = (i: number) => rows[i].findAll('.mpp-fn__chip').map((c) => c.text())
    expect(caps(0)).toEqual([])
    expect(caps(1)).toEqual(['读图'])
    expect(caps(2)).toEqual(['思考', '推理强度'])
    // 能力标签有可读文本，不只靠颜色
    expect(rows[1].findAll('.mpp-fn__chip').map((c) => c.text())).toEqual(['读图'])
  })

  it('只读（配置文件不可写）：写入口全部禁用并给出说明', async () => {
    seedView({ readOnly: true })
    const w = await mountPanel()
    expect(w.text()).toContain('注册表文件所在目录当前不可写')
    // 2026-10-28 新人视角：不再从清单里「新建供应商」，只编辑平台通道
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

  it('选择器确认后批量引入：能力标签随模型名推断，不再逐个弹配置框', async () => {
    addModelsMock.mockResolvedValue({ data: { data: {} } })
    const w = await mountPanel({ upstream: ['mimo-v2.5-flash', 'step-3.5-flash'] })
    ;(w.vm as unknown as { openPull: () => void }).openPull()
    await nextTick()
    const boxes = w.findAll('.pmd-list .pmd-row input')
    await boxes[0].setValue(true)
    await nextTick()
    await w.findAll('.pmd-list .pmd-row input')[1].setValue(true)
    await nextTick()
    await w.findAll('.pmd .mk-modal__foot .mk-btn--primary')[0].trigger('click')
    await flushPromises()

    expect(addModelsMock).toHaveBeenCalledTimes(1)
    const [providerId, models] = addModelsMock.mock.calls[0]
    expect(providerId).toBe('platform')
    expect(models).toEqual([
      { id: 'mimo-v2.5-flash', supportsThinking: false, supportsReasoningEffort: false, vision: false },
      { id: 'step-3.5-flash', supportsThinking: false, supportsReasoningEffort: false, vision: false }
    ])
    // 引入后不再自动弹模型编辑弹层
    expect(w.find('.med-modal').exists()).toBe(false)
    // 选择器确认后关闭
    expect(w.find('.pmd').exists()).toBe(false)
  })

  it('单模型测试走真实调用，结果回显在该模型行内', async () => {
    const w = await mountPanel()
    testMock.mockResolvedValue({ data: { data: { model: 'deepseek-v4-flash', durationMs: 1234, content: '可以' } } })
    await btn(w, '测试')!.trigger('click')
    await flushPromises()
    expect(testMock).toHaveBeenCalledWith('platform', { modelId: 'deepseek-v4-flash' })
    const result = w.find('.mpp-rowtest')
    expect(result.text()).toContain('调用通过')
    expect(result.text()).toContain('1234ms')
    expect(result.attributes('title')).toContain('可以')
  })

  it('运行面读数：冷却中的模型标「冷却中」，空态是「健康」', async () => {
    getModelRegistryMock.mockResolvedValue({
      data: { data: { models: [], cooldowns: [{ providerId: 'platform', model: 'deepseek-v4-flash', remainingMs: 30000 }], warnings: [], runtime: { maxModelCandidates: 2 } } }
    })
    const w = await mountPanel()
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
          warnings: ['模型「deepseek-v4-flash」未被任何别名引用（只能通过具体 id 使用）。'],
          runtime: { maxModelCandidates: 2 }
        }
      }
    })
    const w = await mountPanel()
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

  it('上游清单按用途给出建议：向量 / 重排模型置灰并指向对应能力卡', async () => {
    const upstream = ['deepseek-v4-flash', 'BAAI/bge-m3', 'agnes-image-2.5-flash', 'jev-latest', 'agnes-video-2.5']
    const w = await mountPanel({ upstream })
    ;(w.vm as unknown as { openPull: () => void }).openPull()
    await nextTick()
    const rows = w.findAll('.pmd-row')
    expect(rows).toHaveLength(upstream.length)
    expect(rows.every((r) => r.find('input[type="checkbox"]').exists())).toBe(true)
    const embedding = rows.find((r) => r.text().includes('BAAI/bge-m3'))!
    expect(embedding.text()).toContain('建议归入向量模型')
    expect(embedding.find('input').attributes('disabled')).toBeDefined()
    const chat = rows.find((r) => r.text().includes('agnes-image-2.5-flash'))!
    expect(chat.find('input').attributes('disabled')).toBeUndefined()
    expect(w.text()).not.toContain('基础设施配置')
    expect(w.text()).not.toContain('插件配置')
    expect(w.text()).not.toContain('暂未接入')
  })
})
