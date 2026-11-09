/**
 * Skill 运行时页签的模型选择（2026-10-20 走查）。
 *
 * 借鉴成熟平台（OpenRouter / LiteLLM / Dify）后的硬约束，钉在这里：
 * - 主模型从目录里选，不再手填 ID；「继承」是一条显式选项，不是空输入框。
 * 2026-11-04 用户「为什么还在区分默认推理和对话」后，删掉了「选中模型即同步档位」那一条：
 * 档位随模型本身走、路由侧也不读 skill 的 tier，界面上不再出现档位胶囊。
 * 2026-11-04 用户「去掉降级这个功能，不要」：备用链选择器与相关用例随降级整条下线。
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
    reasoningEfforts: ['low', 'high', 'max'],
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

/** 2026-10-28：模型 / 参数 / 容错收进「配置」弹层，先打开再断言。 */
async function openConfig(w: Awaited<ReturnType<typeof mountTab>>) {
  const btn = w.findAll('button').find((b) => b.text() === '配置')
  expect(btn, '卡头应有配置入口').toBeTruthy()
  await btn!.trigger('click')
  await flushPromises()
  await w.vm.$nextTick()
}

async function openPicker(w: Awaited<ReturnType<typeof mountTab>>, selector: string) {
  await w.find(selector).trigger('click')
  await w.vm.$nextTick()
}

function optionIds(w: Awaited<ReturnType<typeof mountTab>>): string[] {
  return w.findAll('.mk-mp__opt').map((o) => o.find('.mk-mp__id').text())
}

describe('Skill 运行时 · 模型选择', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('主模型回显当前模型；选择器只列真实模型，不出「用平台默认模型」', async () => {
    const w = await mountTab()
    // 2026-11-06 两行摘要：卡面第一行（「模型」）就是当前在跑的模型 id
    expect(w.find('.sdp-model').text()).toContain('deepseek-v4.1-flash')
    await openConfig(w)
    const control = w.find('.sdp-form__grid .mk-mp')
    expect(control.text()).toContain('deepseek-v4.1-flash')

    /* 2026-11-06 用户「什么覆盖默认什么的，没意义」：弹层不再讲「继承平台默认」，
       选择器只列目录里的真实模型。 */
    await openPicker(w, '.sdp-form__grid .mk-mp .mk-mp__control')
    expect(optionIds(w)[0]).toBe('deepseek-v4.1-flash')
    expect(optionIds(w)).not.toContain('用平台默认模型')
    w.unmount()
  })

  it('选到 reasoning 模型：目录分类不上屏', async () => {
    const w = await mountTab()
    await openConfig(w)
    expect(w.text()).not.toContain('模型层级')

    await openPicker(w, '.sdp-form__grid .mk-mp .mk-mp__control')
    const acme = w.findAll('.mk-mp__opt').find((o) => o.find('.mk-mp__id').text() === 'acme-vision')
    expect(acme, '目录里的 reasoning 模型应出现在候选里').toBeTruthy()
    await acme!.trigger('click')
    await flushPromises()

    // 2026-11-04：摘要只陈述供应商 / 能力 / 价格，不再把目录档位枚举印出来
    const meta = w.find('.sdp-meta').text()
    expect(meta).toContain('Acme 网关')
    expect(meta).not.toContain('reasoning')
    expect(w.text()).not.toContain('推理档')
    w.unmount()
  })

  it('卡面只留摘要，配置弹层含模型 / 生成参数 / 请求容错三段', async () => {
    const w = await mountTab()
    expect(w.find('.sdp-nav').exists()).toBe(false)
    expect(w.find('.sdp-live').exists()).toBe(true)
    // 2026-11-04：模型测试块已从本页撑出去（连通性测试在「模型与接入」页每个模型上）
    expect(w.find('#sdp-panel-test').exists()).toBe(false)
    // 未打开弹层时，详细配置不在卡面
    expect(w.find('#sdp-panel-model').exists()).toBe(false)

    await openConfig(w)
    const panels = w.findAll('.sdp-sections > .sdp-panel')
    expect(panels.map((p) => p.find('h4').text())).toEqual(['模型', '生成参数', '请求与容错'])
    // 2026-11-09 设计语言收敛：段头不再悬浮「T=…」读数（temperature 就在下面表单里，
    // 同一项两个出口）；段头只留段名。
    expect(w.find('#sdp-panel-params .sdp-panel__state').exists()).toBe(false)
    /* 2026-11-06 用户「什么覆盖默认什么的，没意义」：四行不再是「来源 + 只读取值」，
       每行就是一个可填的数字输入框（留空＝取 Prompt 声明 / 平台默认）。 */
    expect(w.find('#sdp-panel-params input[aria-label="temperature"]').exists()).toBe(true)
    expect(w.find('#sdp-panel-params input[aria-label="topP"]').exists()).toBe(true)
    expect(w.find('#sdp-panel-params input[aria-label="maxTokens"]').exists()).toBe(true)
    expect(w.find('#sdp-panel-params input[aria-label="maxAttempts"]').exists()).toBe(true)
    expect(w.find('#sdp-panel-request input[aria-label="请求超时毫秒数"]').exists()).toBe(true)
    expect(w.find('#sdp-panel-request .sdp-panel__state').exists()).toBe(false)
    w.unmount()
  })

  it('备用链选择器与顺序链随降级下线：配置弹层不再有这一块', async () => {
    const w = await mountTab()
    await openConfig(w)
    // 2026-11-04 用户「去掉降级这个功能，不要」：备用模型选择器 / 顺序链整块撤除
    expect(w.find('.sdp-fallback').exists()).toBe(false)
    expect(w.find('.sdp-fallback__chain').exists()).toBe(false)
    expect(w.text()).not.toContain('降级顺序')
    w.unmount()
  })

  it('卡头「覆盖平台默认」翻转即落盘：调一次保存接口，且不丢当前配置', async () => {
    const w = await mountTab()
    const api = (await import('@/api/adminApi')).adminSkillsApi as unknown as {
      updateSkillModelConfig: ReturnType<typeof vi.fn>
    }
    api.updateSkillModelConfig.mockClear()
    const sw = w.find('.sdp-head__switch')
    expect(sw.exists(), '卡头应有覆盖开关').toBe(true)
    await sw.trigger('click')
    await flushPromises()
    // 开关本身没有保存钮：翻转必须自己发一次 PUT，否则改动只留在内存里
    expect(api.updateSkillModelConfig).toHaveBeenCalledTimes(1)
    const payload = api.updateSkillModelConfig.mock.calls[0][1] as Record<string, unknown>
    expect(payload.enabled).toBe(false)
    // 其余字段照旧（关掉覆盖只改 enabled 这一项）
    expect(payload.model).toBe('deepseek-v4.1-flash')
    w.unmount()
  })
})

