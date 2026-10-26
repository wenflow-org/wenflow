/**
 * Skill 运行时页签的模型选择（2026-10-20 走查）。
 *
 * 借鉴成熟平台（OpenRouter / LiteLLM / Dify）后的三条硬约束，钉在这里：
 * - 主模型从目录里选，不再手填 ID；「继承」是一条显式选项，不是空输入框；
 * - 选中目录模型时层级随模型切换（chat 模型配 reasoning 档会路由错档）；
 * - 备用链只列同供应商、同层级（后端 validateFallbackChain 同规则），并排除主模型与已选项。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RuntimeTab from '../skill-design/runtime-tab.vue'

const CATALOG = [
  {
    id: 'deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
    tier: 'chat',
    providerId: 'platform',
    providerName: '平台',
    supportsThinking: true,
    supportsReasoningEffort: true,
    pricing: { inputPer1M: 0.3, outputPer1M: 1.2 }
  },
  {
    id: 'agnes-3.0-flash',
    label: 'Agnes 3.0 Flash',
    tier: 'chat',
    providerId: 'platform',
    providerName: '平台',
    pricing: { inputPer1M: 0.03, outputPer1M: 0.15 }
  },
  {
    id: 'acme-vision',
    label: 'Acme Vision',
    tier: 'reasoning',
    providerId: 'acme',
    providerName: 'Acme 网关',
    vision: true
  }
]

const getSkillModelConfig = vi.fn(async () => ({
  data: {
    data: {
      tier: 'chat',
      model: 'deepseek-v4.1-flash',
      thinkingMode: 'default',
      reasoningEffort: 'default',
      requestTimeoutMs: null,
      enabled: true,
      maxLogicalRetries: null,
      paramOverrides: null,
      fallbackChain: null,
      generationParams: null
    }
  }
}))

vi.mock('@/api/adminApi', () => ({
  adminSkillsApi: {
    getSkillModelConfig: (...args: unknown[]) => getSkillModelConfig(...(args as [])),
    updateSkillModelConfig: vi.fn(async () => ({ data: { data: {} } })),
    deleteSkillModelConfig: vi.fn(async () => ({ data: { data: {} } })),
    modelProbe: vi.fn(async () => ({ data: { data: {} } })),
    probeSkillChannel: vi.fn(async () => ({ data: { data: { ok: true, count: 1, models: [] } } }))
  },
  adminPlatformSettingsApi: {
    getReliabilitySettings: vi.fn(async () => ({ data: { data: { settings: { maxLogicalRetries: 1 } } } }))
  },
  adminApiConfigApi: {
    getModelCatalog: vi.fn(async () => ({ data: { data: { models: CATALOG } } }))
  }
}))

vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))

async function mountTab() {
  const w = mount(RuntimeTab, {
    props: { skillId: 'skill-a', refreshTick: 0 },
    global: { stubs: { teleport: true } }
  })
  await flushPromises()
  await flushPromises()
  return w
}

async function openPicker(w: Awaited<ReturnType<typeof mountTab>>, selector: string) {
  await w.find(selector).trigger('click')
  await w.vm.$nextTick()
}

function optionIds(w: Awaited<ReturnType<typeof mountTab>>): string[] {
  return w.findAll('.mk-mp__opt').map((o) => o.find('.mk-mp__id').text())
}

describe('Skill 运行时 · 模型与备用链选择', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('主模型显示当前目录条目；「用平台默认模型」是显式选项', async () => {
    const w = await mountTab()
    const control = w.find('.sdp-form__grid .mk-mp')
    expect(control.text()).toContain('deepseek-v4.1-flash')

    await openPicker(w, '.sdp-form__grid .mk-mp .mk-mp__control')
    expect(optionIds(w)[0]).toBe('用平台默认模型')
    w.unmount()
  })

  it('选到 reasoning 模型时层级自动带出（不再单独选模型层级）', async () => {
    const w = await mountTab()
    expect(w.text()).not.toContain('模型层级')

    await openPicker(w, '.sdp-form__grid .mk-mp .mk-mp__control')
    const acme = w.findAll('.mk-mp__opt').find((o) => o.find('.mk-mp__id').text() === 'acme-vision')
    expect(acme, '目录里的 reasoning 模型应出现在候选里').toBeTruthy()
    await acme!.trigger('click')
    await flushPromises()

    expect(w.find('.sdp-model-meta').text()).toContain('reasoning')
    // 层级随模型切到 reasoning 后，备用链只剩同层级候选（acme 自己是主模型被排除）
    await openPicker(w, '.sdp-fallback .mk-mp__control')
    expect(optionIds(w)).toEqual([])
    w.unmount()
  })

  it('四段同页铺开、不分 tab：模型 / 生成参数 / 请求与容错 / 模型测试同时可见', async () => {
    const w = await mountTab()
    // 2026-10-25 用户「作为一个页面，不分 tab」：左分节导航退役，四段按顺序纵向铺开
    expect(w.find('.sdp-nav').exists()).toBe(false)
    const panels = w.findAll('.sdp-sections > .sdp-panel')
    expect(panels.map((p) => p.find('h4').text())).toEqual(['模型', '生成参数', '请求与容错', '模型测试'])
    // 全部常驻：没有任何一段被 v-show 藏起来
    for (const p of panels) {
      expect(p.attributes('style') || '').not.toContain('display: none')
    }
    // 段头右侧仍报该段当前值（原导航副文的信息不丢）
    expect(w.find('#sdp-panel-params .sdp-panel__state').text()).toContain('T=')
    expect(w.find('#sdp-panel-request .sdp-panel__state').text()).toContain('重试')
    w.unmount()
  })

  it('备用链只列同供应商、同层级，并排除主模型', async () => {
    const w = await mountTab()
    await openPicker(w, '.sdp-fallback .mk-mp__control')
    const ids = optionIds(w)
    expect(ids).toEqual(['agnes-3.0-flash'])
    expect(ids).not.toContain('deepseek-v4.1-flash')
    expect(ids).not.toContain('acme-vision')
    w.unmount()
  })

  it('选中备用后进入有序链；再次打开不再列出已选项', async () => {
    const w = await mountTab()
    await openPicker(w, '.sdp-fallback .mk-mp__control')
    await w.findAll('.mk-mp__opt')[0].trigger('click')
    await flushPromises()

    expect(w.find('.sdp-fallback__chain').text()).toContain('agnes-3.0-flash')
    // 链上序号（备用顺序即降级顺序）
    expect(w.find('.sdp-fallback__chain .sdp-chip b').text()).toBe('1')

    await openPicker(w, '.sdp-fallback .mk-mp__control')
    expect(optionIds(w)).toEqual([])
    w.unmount()
  })
})
