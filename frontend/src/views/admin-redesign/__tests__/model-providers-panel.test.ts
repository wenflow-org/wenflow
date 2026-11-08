/**
 * 接入通道面板（ModelProvidersPanel，BYOK 2026-10-18；2026-10-27 收敛为单通道）：
 * 平台通道详情（页签 / 模型表 / 增删改）、后端人话原因可见、只读降级、上游清单登记、
 * 运行面读数（告警）。
 * 2026-11-04 用户「去掉降级这个功能，不要」：备用链 / 冷却读数随降级下线，用例同步收口。
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
  models?: Array<{
    id: string
    tier?: 'chat' | 'reasoning'
    /** 模型级生成默认（④ 的参数摘要读它）：null/缺省 = 不指定，由上游按自身默认处理 */
    defaultThinkingMode?: 'enabled' | 'disabled' | null
    defaultReasoningEffort?: 'low' | 'high' | 'max' | null
    defaultResponseFormat?: 'none' | 'json_object' | null
    pricing?: { inputPer1M?: number; cachedInputPer1M?: number; outputPer1M?: number } | null
  }>
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
      reasoningEfforts: [],
      maxOutputTokens: null,
      defaultMaxTokens: null,
      reasoningReserveTokens: null,
      maxParallelRequests: null,
      defaultThinkingMode: m.defaultThinkingMode ?? null,
      defaultReasoningEffort: m.defaultReasoningEffort ?? null,
      defaultResponseFormat: m.defaultResponseFormat ?? null,
      pricing: m.pricing ?? null,
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
      providerView({ id: 'acme-gateway', name: 'Acme 网关', baseUrl: 'https://gw.acme.com/v1', apiKeyEnv: 'PROVIDER_ACME_GATEWAY_API_KEY', keyHint: '····9xQv', models: [{ id: 'acme-chat' }, { id: 'acme-chat-2' }] })
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
    getModelRegistryMock.mockResolvedValue({ data: { data: { models: [], warnings: [] } } })
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
    // 卡头是能力卡身份：对话模型 + LLM，连接状态由宿主注入
    expect(w.find('.mk-card__head').text()).toContain('对话模型')
    expect(w.find('.mk-card__head').find('.mpp-type').text()).toBe('LLM')
    expect(w.find('.mk-card__head').text()).not.toContain('一条通道 =')
    // 状态徽标只出「能不能用」，这一档由下面的连接徽标回答 → 不出徽标
    expect(w.find('.mk-card__head').findAll('.mk-badge')).toHaveLength(0)
    /* 2026-11-05 用户「连接设置和添加模型合并到一起吧，只保留添加模型」：
       卡头右组只剩「＋ 添加模型」——连接（地址 / 密钥 / 重试 / 重置）搬进了弹窗，
       所以卡面既没有连接槽，也没有「连接设置」按钮。 */
    expect(w.findAll('.mpp-step, .mpp-step__no, .mpp-step__head')).toHaveLength(0)
    expect(w.find('.mpp-body > .mpp-side').exists()).toBe(false)
    expect(w.find('#mpp-platform-panel-conn').exists()).toBe(false)
    expect(w.findAll('.mpp .ac-conn-open')).toHaveLength(0)
    expect(w.find('#mpp-platform-panel-models.mpp-models').exists()).toBe(true)
    expect(w.find('#mpp-platform-panel-models.mpp-models').classes()).not.toContain('mpp-side')
    // 独立的「上游清单 + 重新获取」已撤（2026-11-04 用户「多此一举」），
    // 拉清单是「添加模型」自身的第一步，不另起第二条路
    expect(w.find('.mpp-upstream').exists()).toBe(false)
    expect(w.text()).not.toContain('上游清单')
    expect(w.find('.mpp-toolbar__meta').exists()).toBe(false)
    // 2026-11-04 用户「这个彻底不要」：模型区不再有工具栏行
    expect(w.find('.mpp-toolbar').exists()).toBe(false)
    expect(w.find('.mpp-models__count').exists()).toBe(false)
    expect(w.findAll('.mpp-model-row')).toHaveLength(2)
    // 添加入口只有这一颗主按钮（手动录入在弹窗底栏）
    expect(w.findAll('.mpp-add')).toHaveLength(1)
    expect(w.find('.mpp-add').text()).toBe('＋ 添加模型')
    expect(w.text()).not.toContain('手动录入')
  })

  it('「＋ 添加模型」是唯一入口：开弹窗并请宿主向上游重拉', async () => {
    const w = await mountPanel({ upstream: ['deepseek-v4-flash', 'mystery-1'] })
    const addBtn = w.find('.mpp-add')
    await addBtn.trigger('click')
    await nextTick()
    // 弹窗（连接 + 清单）就在这一处打开；清单由宿主拉（它持有地址与密钥并负责落盘连接）
    expect(w.find('.pmd').exists()).toBe(true)
    expect(w.emitted('fetchUpstream')).toHaveLength(1)
  })

  it('模型为空时给下一步：平台通道直接开添加弹窗，不铺一张空表', async () => {
    seedView({ providers: [providerView({ id: 'platform', name: '平台', models: [] })] })
    const w = await mountPanel()
    const setup = w.find('.mpp-setup')
    expect(setup.exists()).toBe(true)
    expect(setup.text()).toContain('还没有挂载模型')
    expect(setup.text()).toContain('填服务地址与密钥')
    // 2026-10-28 对话模型为空时不铺空列表；向量 / 重排已拆成宿主的独立能力卡
    expect(w.find('.mpp-models__list').exists()).toBe(false)
    expect(w.findAll('.mpp-model-row')).toHaveLength(0)
    await btn(w, '添加模型')!.trigger('click')
    await nextTick()
    // 连接与清单都在这一张弹窗里，不必先去别处配连接
    expect(w.find('.pmd').exists()).toBe(true)
    expect(w.emitted('fetchUpstream')).toHaveLength(1)
  })

  it('本卡只负责对话与推理：模型清单常驻，向量 / 重排已拆到宿主', async () => {
    const w = await mountPanel()
    // 2026-10-27 用户「把 tab 解散了」：没有二级页签，内容全在 DOM 里且都可见
    expect(w.findAll('.mpp-subtabs').length).toBe(0)
    expect(w.find('[role="tab"]').exists()).toBe(false)
    expect(shown(w, '#mpp-platform-panel-models')).toBe(true)
    expect(w.find('#mpp-platform-panel-generation').exists()).toBe(false)
    // 2026-10-28 三卡重构：向量 / 重排不再嵌在对话卡里
    expect(w.find('#mpp-platform-panel-infra').exists()).toBe(false)
    // 2026-11-05 合并弹窗：卡头不再有连接表单，也没有点了几乎不动的「设置」
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
      if (m.id === 'think-fast') return { ...m, supportsThinking: true, reasoningEfforts: ['low', 'high'] }
      return m
    })
    seedView({ providers: [platform] })
    const w = await mountPanel()
    // 没有「区名 + 条数」这种列表标题，能力标签直接跟在模型 id 后面
    expect(w.find('.mpp-toolbar').exists()).toBe(false)
    expect(w.findAll('.mpp-group')).toHaveLength(0)

    const rows = modelRows(w)
    expect(rows).toHaveLength(3)
    const caps = (i: number) => rows[i].findAll('.mpp-fn__chip').map((c) => c.text())
    expect(caps(0)).toEqual([])
    expect(caps(1)).toEqual(['视觉'])
    // 强度标签带档位读数（2026-11-05）：只写「推理强度」看不出这台模型认哪几档
    expect(caps(2)).toEqual(['思考', '推理强度 low / high'])
    // 能力标签有可读文本，不只靠颜色
    expect(rows[1].findAll('.mpp-fn__chip').map((c) => c.text())).toEqual(['视觉'])
  })

  /* 2026-11-04 用户「不要这种文案，上『Avoid unnecessary secondary labels and descriptions.
     Let the layout do the explaining.』」：每行下面的参数摘要整行撤除，行上只有
     id / 默认徽标 / 能力标签 / 动作——参数在「配置」弹层里。 */
  it('模型行只有 id 与能力标签，没有参数摘要这类次级说明行', async () => {
    seedView({
      providers: [providerView({ id: 'platform', name: '平台', models: [
        { id: 'chat-plain' },
        { id: 'think-configured', defaultThinkingMode: 'enabled', defaultReasoningEffort: 'high', pricing: { inputPer1M: 1, outputPer1M: 2 } }
      ] }) ]
    })
    const w = await mountPanel()
    const rows = modelRows(w)
    expect(w.find('.mpp-model-params').exists()).toBe(false)
    expect(w.text()).not.toContain('参数全部跟随默认')
    expect(w.text()).not.toContain('默认输出')
    expect(w.text()).not.toContain('已配单价')
    // 行正文只剩 id（与有能力的模型才有的胶囊）
    expect(rows[0].find('.mpp-model-row__idline').text()).toBe('chat-plain')
    expect(rows[1].find('.mpp-model-row__idline').text()).toContain('think-configured')
  })

  it('只读（配置文件不可写）：写入口全部禁用并给出说明', async () => {
    seedView({ readOnly: true })
    const w = await mountPanel()
    // 2026-11-06 文案排查 §7.2：只读说明不再讲「注册表文件所在目录」这类机制，改为直说只读与找谁开放
    expect(w.text()).toContain('当前为只读状态')
    // 2026-10-28 新人视角：不再从清单里「新建供应商」，只编辑平台通道
    expect(w.text()).not.toContain('添加供应商')
    /* 模型行的写入口（设为默认 / 配置 / 删除）一并禁用；「测试」是只读动作，仍可用。
       2026-11-07 用户「设为默认从 ⋯ 里提出来，平铺成 设为默认 / 配置 / 测试 / 删除」：
       四枚都是行内链接，不再有 ⋯ 二级菜单。 */
    const rowBtn = (text: string) => w.findAll('.mpp-rowacts .mk-link').find((b) => b.text() === text)!
    expect(rowBtn('配置').attributes('disabled')).toBeDefined()
    expect(rowBtn('测试').attributes('disabled')).toBeUndefined()
    expect(rowBtn('删除').attributes('disabled')).toBeDefined()
    expect(w.find('.mpp-rowacts .mk-menu__btn').exists(), '⋯ 菜单已撤').toBe(false)
  })

  it('「确认引入」直接按模型名预判入库：不再有第二层能力弹窗', async () => {
    addModelsMock.mockResolvedValue({ data: { data: {} } })
    const w = await mountPanel({ upstream: ['gpt-4o', 'deepseek-r1'] })
    ;(w.vm as unknown as { openPull: () => void }).openPull()
    await nextTick()
    await w.findAll('.pmd-list .pmd-row input')[0].setValue(true)
    await nextTick()
    await w.findAll('.pmd-list .pmd-row input')[1].setValue(true)
    await nextTick()
    await w.findAll('.pmd .mk-modal__foot .mk-btn--primary')[0].trigger('click')
    await flushPromises()

    /* 2026-11-07 用户「砍掉」：勾完直接入库，一次点击完成引入。
       能力来自 inferModelCapabilities 的预判（gpt-4o 带视觉、deepseek-r1 带思考与三档），
       要精修就去行内「配置」——那里本来就是胶囊选择器。 */
    expect(w.find('.mcc').exists(), '二层「确认模型能力」弹窗已下线').toBe(false)
    expect(w.find('.pmd').exists()).toBe(false)
    expect(addModelsMock).toHaveBeenCalledTimes(1)
    const [providerId, models] = addModelsMock.mock.calls[0]
    expect(providerId).toBe('platform')
    expect(models).toEqual([
      { id: 'gpt-4o', supportsThinking: false, reasoningEfforts: [], vision: true },
      { id: 'deepseek-r1', supportsThinking: true, reasoningEfforts: ['low', 'high', 'max'], vision: false },
    ])
    // 引入后不自动弹配置弹层：要改能力得自己点该行的「配置」
    expect(w.find('.med-modal').exists()).toBe(false)
    expect(w.findAll('.mpp-rowacts .mk-link').map((b) => b.text())).toContain('配置')
  })

  it('单模型测试走真实调用，结果回显在该模型行内', async () => {
    const w = await mountPanel()
    testMock.mockResolvedValue({ data: { data: { model: 'deepseek-v4-flash', durationMs: 1234, content: '可以' } } })
    await btn(w, '测试')!.trigger('click')
    await flushPromises()
    expect(testMock).toHaveBeenCalledWith('platform', { modelId: 'deepseek-v4-flash' })
    const result = w.find('.mk-rowres')
    expect(result.text()).toContain('调用通过')
    expect(result.text()).toContain('1234ms')
    expect(result.attributes('title')).toContain('可以')
  })

  it('状态列只在有告警时出现：没有那枚常驻小绿点', async () => {
    const w = await mountPanel()
    const rows = modelRows(w)
    /* 2026-11-02：「可用」被读成「连通过了」，改成直说行为的「可调用」；
       2026-11-04 弱化成一枚小圆点；
       2026-11-05 用户「这个小绿点代表什么」：小圆点整枚删除——它无条件渲染，
       每一行都亮着同一枚点，含义退化成「这一行存在」，等于没有信息。
       现在没有告警的模型行不渲染状态格，只有 ⚠ 徽标那一种状态。 */
    expect(rows[0].find('.mpp-dot').exists()).toBe(false)
    expect(rows[1].find('.mpp-dot').exists()).toBe(false)
    expect(rows[1].find('.mpp-model-row__status').exists()).toBe(false)
    expect(rows[1].text()).not.toContain('可调用')
    expect(rows[1].find('.mk-badge--ok').exists()).toBe(false)
    expect(w.text()).not.toContain('冷却中')
  })

  it('配置告警不只给图标：别名未引用的模型在状态列写明「未被引用」，细节留在 title', async () => {
    getModelRegistryMock.mockResolvedValue({
      data: {
        data: {
          models: [],
          warnings: ['模型「deepseek-v4-flash」未被任何别名引用（只能通过具体 id 使用）。']
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
    /* 2026-11-04 用户「不分什么对话非对话，这个页面就是拉取列表测试添加」：
       清单原样列出，已添加的置灰并沉到末尾 */
    const rows = w.findAll('.pmd-row')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.find('.pmd-row__id').text())).toEqual(['mystery-1', 'mystery-2', 'deepseek-v4-flash'])
    expect(rows[0].text()).not.toContain('已添加')
    expect(rows[0].find('input').attributes('disabled')).toBeUndefined()
    const added = rows[2]
    expect(added.text()).toContain('已添加')
    expect(added.find('input').attributes('disabled')).toBeDefined()
    expect(w.find('.mpp-chip').exists()).toBe(false)
  })

  it('上游清单原样列出：向量 / 图像 / 视频模型不再置灰，也不劝去别的卡', async () => {
    const upstream = ['deepseek-v4-flash', 'BAAI/bge-m3', 'agnes-image-2.5-flash', 'jev-latest', 'agnes-video-2.5']
    const w = await mountPanel({ upstream })
    ;(w.vm as unknown as { openPull: () => void }).openPull()
    await nextTick()
    const rows = w.findAll('.pmd-row')
    expect(rows).toHaveLength(5)
    expect(w.text()).not.toContain('建议归入')
    expect(w.text()).not.toContain('不在此添加')
    const embedding = rows.find((r) => r.text().includes('BAAI/bge-m3'))!
    expect(embedding.find('input').attributes('disabled')).toBeUndefined()
    const image = rows.find((r) => r.text().includes('agnes-image-2.5-flash'))!
    expect(image.find('input').attributes('disabled')).toBeUndefined()
    const video = rows.find((r) => r.text().includes('agnes-video-2.5'))!
    expect(video.find('input').attributes('disabled')).toBeUndefined()
    expect(w.text()).not.toContain('基础设施配置')
    expect(w.text()).not.toContain('插件配置')
    expect(w.text()).not.toContain('暂未接入')
  })

  /* P0（2026-11-04）：平台默认模型是平台能不能跑起来的前提——没单独指定模型的 Skill
     都走它，缺省时运行时直接抛 AI model is not configured。
     2026-11-04 晚用户「这个彻底不要」：工具栏的「默认：<id>」读数撤除，
     这条事实只由命中行的「默认」徽章承担。 */
  describe('平台默认模型（P0）', () => {
    it('卡头与正文都不复述默认；行内「默认」徽章只在命中的模型行出现', async () => {
      const w = await mountPanel({ defaultModel: 'agnes-3.0-flash' })
      expect(w.find('.mpp-toolbar').exists()).toBe(false)
      expect(w.find('.mpp-models').text()).not.toContain('默认：')
      const rows = modelRows(w)
      const deepseekRow = rows.find((r) => r.text().includes('deepseek-v4-flash'))!
      const agnesRow = rows.find((r) => r.text().includes('agnes-3.0-flash'))!
      expect(deepseekRow.find('.mpp-default-chip').exists()).toBe(false)
      expect(agnesRow.find('.mpp-default-chip').exists()).toBe(true)
    })

    it('默认缺省时不出现「未设置」读数（该事实由行徽章承担）', async () => {
      const w = await mountPanel()
      expect(w.find('.mpp-toolbar').exists()).toBe(false)
      expect(w.find('.mpp-models').text()).not.toContain('未设置')
      expect(w.findAll('.mpp-default-chip')).toHaveLength(0)
    })

    it('默认行不渲染「设为默认」；删除**不**置灰（#177：删除默认模型是允许的）', async () => {
      const w = await mountPanel({ defaultModel: 'deepseek-v4-flash' })
      const firstRow = modelRows(w)[0]
      const acts = firstRow.findAll('.mpp-rowacts .mk-link').map((b) => b.text())
      /* 已是默认 → 「设为默认」没有可做的事，直接不渲染。
         删除**可点**：后端 #177（2026-11-05）下线了「运行期引用门禁」，DB 默认是可修复的——
         删完宿主 onModelRemoved 会把默认改指下一个已挂载模型（ApiConfig.vue）。
         此前这里连 DB 默认一起置灰，等于把 #177 允许、且修复流程已写好的动作锁死，
         提示语还指向错的源（「先设为默认」照做也解不开）。 */
      expect(acts).toEqual(['配置', '测试', '删除'])
      const del = firstRow.findAll('.mpp-rowacts .mk-link').find((b) => b.text() === '删除')!
      expect(del.attributes('disabled')).toBeUndefined()
      expect(del.attributes('title')).toBe('删除这个模型')
      // 面板自身不写注册表文件（默认存 DB，由宿主落盘）
      expect(updateModelMock).not.toHaveBeenCalled()
    })

    it('被注册表文件 defaults 引用的行：删除置灰并点名是哪一处（后端会拒）', async () => {
      getModelRegistryMock.mockResolvedValue({
        data: { data: { models: [], warnings: [], registry: { fileDefaults: { chat: 'deepseek-v4-flash', reasoning: 'deepseek-v4-flash' } } } }
      })
      const w = await mountPanel({ defaultModel: 'agnes-3.0-flash' })
      const fileDefaultRow = modelRows(w).find((r) => r.text().includes('deepseek-v4-flash'))!
      const del = fileDefaultRow.findAll('.mpp-rowacts .mk-link').find((b) => b.text() === '删除')!
      expect(del.attributes('disabled')).toBeDefined()
      expect(del.attributes('title')).toContain('注册表文件里的默认模型')
      // 而 DB 默认那一行仍可删（两处判据不同，不能互相顶替）
      const dbDefaultRow = modelRows(w).find((r) => r.text().includes('agnes-3.0-flash'))!
      const del2 = dbDefaultRow.findAll('.mpp-rowacts .mk-link').find((b) => b.text() === '删除')!
      expect(del2.attributes('disabled')).toBeUndefined()
    })

    it('非默认行点「设为默认」只发意图（不带档位参数）', async () => {
      const w = await mountPanel({ defaultModel: 'deepseek-v4-flash' })
      const secondRow = modelRows(w)[1]
      // 行内四枚平铺：「设为默认」在第一位，不用先点 ⋯
      const setDefault = secondRow.findAll('.mpp-rowacts .mk-link').find((b) => b.text() === '设为默认')!
      expect(setDefault.attributes('disabled')).toBeUndefined()
      await setDefault.trigger('click')
      await flushPromises()
      expect(w.emitted('setDefault')).toEqual([['agnes-3.0-flash']])
      expect(updateModelMock).not.toHaveBeenCalled()
    })

    it('平台通道模型 id 单独回传宿主（默认候选不含自建 / 停用供应商）', async () => {
      const w = await mountPanel()
      expect(w.emitted('platformModels')?.at(-1)).toEqual([['deepseek-v4-flash', 'agnes-3.0-flash']])
    })
  })
})
