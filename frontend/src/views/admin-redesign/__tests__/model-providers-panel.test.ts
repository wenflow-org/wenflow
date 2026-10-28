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
  getMock, addModelMock, updateModelMock, testMock, getModelRegistryMock
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  addModelMock: vi.fn(),
  updateModelMock: vi.fn(),
  testMock: vi.fn(),
  getModelRegistryMock: vi.fn()
}))

vi.mock('@/api/adminApi', () => ({
  adminModelProvidersApi: {
    get: getMock,
    addModel: addModelMock,
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
    // 详情头只留「平台通道 + 平台内置」，不再解释通道由什么组成
    expect(w.find('.mpp-detail__head').text()).toContain('平台通道')
    expect(w.find('.mpp-detail__head').find('.mpp-type').text()).toBe('平台内置')
    expect(w.find('.mpp-detail__head').text()).not.toContain('一条通道 =')
    // 状态徽标只出「能不能用」，这一档由下面的连接徽标回答 → 不出徽标
    expect(w.find('.mpp-detail__head').findAll('.mk-badge')).toHaveLength(0)
    // 模型表列：本地模型 / 上游模型名 / 功能 / 状态 / 操作
    expect(w.findAll('.mpp-table thead th').map((t) => t.text())).toEqual(['本地模型', '上游模型名', '功能', '状态', ''])
    expect(w.text()).toContain('2 个')
  })

  it('模型为空时给下一步：平台通道直接去配置连接，不铺一张空表', async () => {
    seedView({ providers: [providerView({ id: 'platform', name: '平台', models: [] })] })
    const w = await mountPanel()
    const setup = w.find('.mpp-setup')
    expect(setup.exists()).toBe(true)
    expect(setup.text()).toContain('还没有登记模型')
    expect(setup.text()).toContain('先配置服务地址与 API Key')
    expect(w.find('.mpp-table').exists()).toBe(false)
    await btn(w, '去配置连接')!.trigger('click')
    await flushPromises()
    expect(w.find('#mpp-platform-panel-conn').exists()).toBe(true)
  })

  it('页签已解散：连接 / 模型 / 基础设施 / 平台默认四段平铺，全部常驻可见', async () => {
    const w = await mountPanel()
    // 2026-10-27 用户「把 tab 解散了」：没有二级页签，四段全在 DOM 里且都可见
    expect(w.findAll('.mpp-subtabs').length).toBe(0)
    expect(w.find('[role="tab"]').exists()).toBe(false)
    expect(shown(w, '#mpp-platform-panel-conn')).toBe(true)
    expect(shown(w, '#mpp-platform-panel-models')).toBe(true)
    expect(shown(w, '#mpp-platform-panel-infra')).toBe(true)
    expect(shown(w, '#mpp-platform-panel-generation')).toBe(true)
    // 连接表单就在正下方：平台详情不再摆一颗点了几乎不动的「设置」
    expect(w.findAll('.mpp-detail__acts .mk-btn').some((b) => b.text() === '设置')).toBe(false)
    expect(w.emitted('focus-platform-connection')).toBeUndefined()
  })

  it('上游模型名：与本地名相同时只标「同本地名」，有独立映射才显示上游名', async () => {
    const platform = providerView({ id: 'platform', name: '平台', models: [{ id: 'local-a' }, { id: 'local-b' }] })
    platform.models = (platform.models as Array<Record<string, unknown>>).map((m, i) => (
      i === 0 ? { ...m, upstreamModelId: 'upstream-b' } : m
    ))
    seedView({ providers: [platform] })
    const w = await mountPanel()
    const cells = w.findAll('.mpp-upstream')
    expect(cells).toHaveLength(2)
    // 有映射：显示上游名
    expect(cells[0].text()).toBe('upstream-b')
    // 无映射：不复读本地名字符串，只标「同本地名」（窄列不再断行）
    expect(cells[1].text()).toBe('同本地名')
    expect(cells[1].find('.mono').exists()).toBe(false)
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
