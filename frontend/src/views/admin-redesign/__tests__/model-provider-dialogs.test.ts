/**
 * 供应商 / 模型编辑弹层（2026-10-18 BYOK）：
 * 前端先按后端同一套规则拦一遍（id 格式、服务地址必填、思考关掉时不给挡位、改名），
 * 后端再拦一次并把人话原因显示在弹层里；平台通道不出服务地址与密钥字段。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ProviderEditorDialog from '../ProviderEditorDialog.vue'
import ModelEditorDialog from '../ModelEditorDialog.vue'
import { chooseMkSelect, mkSelectBox, mkSelectLabels, mkSelectValue } from '@/components/mk/__tests__/mkSelect'

const { createMock, updateMock, addModelMock, updateModelMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  addModelMock: vi.fn(),
  updateModelMock: vi.fn()
}))

vi.mock('@/api/adminApi', () => ({
  adminModelProvidersApi: {
    create: createMock,
    update: updateMock,
    addModel: addModelMock,
    updateModel: updateModelMock
  }
}))

function btn(w: ReturnType<typeof mount>, text: string) {
  return w.findAll('button').find((b) => b.text().includes(text))!
}

/** 按字段名取那一个字段（弹层改成四段平铺后，按下标取会随排版漂移） */
function fieldOf(w: ReturnType<typeof mount>, label: string) {
  return w.findAll('.mk-field').find((f) => {
    const el = f.find('.mk-field__label')
    return el.exists() && el.text() === label
  })!
}

/** Teleport 就地渲染（弹层内容挂到 body 后就查不到了；这里只要断言弹层内部） */
const mountOptions = { global: { stubs: { teleport: true } } }

/** 表单占位输入（测试夹具，非真实凭据）：避免在断言里内联凭据形态的字面量。 */
const typedFixtureValue = 'fixture-value'

describe('ProviderEditorDialog', () => {
  beforeEach(() => {
    createMock.mockReset()
    updateMock.mockReset()
  })

  it('新建：id 非法时保存禁用并就地提示；合法后可提交，落盘成功即关闭', async () => {
    const w = mount(ProviderEditorDialog, mountOptions)
    w.vm.openWith(null)
    await flushPromises()
    const idInput = w.find('.mk-field__input')
    await idInput.setValue('Bad Id')
    expect(w.text()).toContain('非法')
    expect(btn(w, '保存').attributes('disabled')).toBeDefined()

    await idInput.setValue('acme-gateway')
    await w.findAll('.mk-field__input')[0].setValue('acme-gateway')
    await w.findAll('.mk-field__input')[1].setValue('Acme 网关')
    await w.find('input[placeholder="https://api.example.com/v1"]').setValue('https://gw.acme.com/v1')
    await w.find('input[type="password"]').setValue(typedFixtureValue)
    expect(btn(w, '保存').attributes('disabled')).toBeUndefined()

    createMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(createMock).toHaveBeenCalledWith({
      id: 'acme-gateway',
      name: 'Acme 网关',
      description: '',
      enabled: true,
      baseUrl: 'https://gw.acme.com/v1',
      apiKey: typedFixtureValue,
      supportsSystemRole: null
    })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('后端拒绝时把原因留在弹层里（不关闭、不吞错）', async () => {
    const w = mount(ProviderEditorDialog, mountOptions)
    w.vm.openWith(null)
    await flushPromises()
    const inputs = w.findAll('.mk-field__input')
    await inputs[0].setValue('acme-gateway')
    await inputs[1].setValue('Acme 网关')
    await w.find('input[placeholder="https://api.example.com/v1"]').setValue('https://gw.acme.com/v1')
    createMock.mockRejectedValue({ response: { data: { error: '供应商 ID「acme-gateway」已存在，换一个。' } } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('已存在，换一个')
    expect(w.find('[role="dialog"]').exists()).toBe(true)
  })

  it('弹层打开：面板带 aria-modal、锁背景滚动；Esc 关闭并把焦点还回触发按钮', async () => {
    // 同文件前面的用例可能留下开着未卸载的弹层（body 仍锁滚动），这里先归零再断言
    document.body.style.overflow = ''
    const trigger = document.createElement('button')
    trigger.textContent = '打开供应商设置'
    document.body.appendChild(trigger)
    trigger.focus()

    const w = mount(ProviderEditorDialog, mountOptions)
    w.vm.openWith(null)
    await flushPromises()

    const panel = w.find('[role="dialog"]')
    expect(panel.attributes('aria-modal')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
    w.unmount()
  })

  it('平台提供：不显示服务地址与密钥字段（那两项归连接设置）', async () => {
    const w = mount(ProviderEditorDialog, mountOptions)
    w.vm.openWith({ id: 'platform', name: '平台提供', description: null, enabled: true, baseUrl: null, keyHint: null })
    await flushPromises()
    expect(w.text()).not.toContain('服务地址')
    expect(w.find('input[type="password"]').exists()).toBe(false)
    // 名称仍可改；启用位只在创建时出现（编辑态由供应商行内开关承担，不再给第二个入口）
    expect(w.text()).not.toContain('参与路由')
    updateMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(updateMock).toHaveBeenCalledWith('platform', expect.objectContaining({ name: '平台提供', enabled: true }))
  })

  it('system 角色：三态回填与回写（自动=null / 保留=true / 合并=false）', async () => {
    const w = mount(ProviderEditorDialog, mountOptions)
    w.vm.openWith({
      id: 'acme-gateway', name: 'Acme 网关', description: null, enabled: true,
      baseUrl: 'https://gw.acme.com/v1', keyHint: null, supportsSystemRole: false,
    })
    await flushPromises()
    expect(mkSelectValue(w, '系统提示词')).toBe('fold')

    await chooseMkSelect(w, '系统提示词', 'keep')
    updateMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(updateMock).toHaveBeenCalledWith('acme-gateway', expect.objectContaining({ supportsSystemRole: true }))

    // 未声明 → 自动（null）
    const w2 = mount(ProviderEditorDialog, mountOptions)
    w2.vm.openWith({
      id: 'acme-gateway', name: 'Acme 网关', description: null, enabled: true,
      baseUrl: 'https://gw.acme.com/v1', keyHint: null, supportsSystemRole: null,
    })
    await flushPromises()
    expect(mkSelectValue(w2, '系统提示词')).toBe('auto')
  })
})

describe('ModelEditorDialog', () => {
  beforeEach(() => {
    addModelMock.mockReset()
    updateModelMock.mockReset()
  })

  it('新建：标识 / 能力 / 调用限制 / 价格四段平铺，提交时清空的限额不发 0', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    w.vm.openWith({ providerId: 'acme-gateway', model: null })
    await flushPromises()
    await w.find('.med-modal .med-two input').setValue('acme-chat')
    // 2026-11-05：没有「高级设置」折叠了，限额就在同一屏
    expect(w.text()).not.toContain('高级设置')
    await fieldOf(w, '输出上限').find('input').setValue('65536')

    addModelMock.mockResolvedValue({ data: { success: true, warnings: ['保存时出现 2 条提示…'] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(addModelMock).toHaveBeenCalledWith('acme-gateway', expect.objectContaining({
      id: 'acme-chat',
      tier: 'chat',
      maxOutputTokens: 65536,
      defaultMaxTokens: null,
      pricing: {}
    }))
    // 两个键都不再随保存提交（2026-11-04）：注册表里已有的旧值原样留着——
    // 输出格式功能下线；备用链随降级整条下线，编辑单个模型不再重写它
    expect(addModelMock.mock.calls[0][1]).not.toHaveProperty('defaultResponseFormat')
    expect(addModelMock.mock.calls[0][1]).not.toHaveProperty('fallbacks')
    // 告警随 saved 事件回传面板（不在弹层里常驻展示）
    expect(w.emitted('saved')?.[0]?.[0]).toEqual({ modelId: 'acme-chat', warnings: ['保存时出现 2 条提示…'] })
  })

  it('档位不再让运营选：编辑已有条目时原样带回', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    // 2026-11-04 用户「我们不做模型类型区分」：弹层里没有第二个选对话 / 推理的地方
    w.vm.openWith({ providerId: 'platform', model: null, presetId: 'm-new' })
    await flushPromises()
    expect(w.text()).not.toContain('用途')

    w.vm.openWith({
      providerId: 'platform',
      model: {
        id: 'm-deep', label: 'm-deep', tier: 'reasoning', supportsThinking: true, reasoningEfforts: ['low', 'high'], vision: false,
        maxOutputTokens: null, defaultMaxTokens: null, reasoningReserveTokens: null, maxParallelRequests: null,
        pricing: null, description: null
      }
    })
    await flushPromises()
    updateModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(updateModelMock).toHaveBeenCalledWith('platform', 'm-deep', expect.objectContaining({ tier: 'reasoning' }))
  })

  it('能力在上、默认值在下：思考关着时整块默认值不渲染（不是置灰）', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    w.vm.openWith({ providerId: 'acme-gateway', model: null })
    await flushPromises()
    // 2026-10-28 用户「不要这个，后面的能力也改一下」：能力说明不上屏
    expect(w.text()).not.toContain('只勾模型实际支持的能力')
    expect(w.text()).not.toContain('先思考再回答')
    expect(w.text()).not.toContain('可调节思考深度')
    expect(w.text()).not.toContain('可看图片与截图')
    const caps = w.findAll('.med-cap')
    expect(caps.map((c) => c.text())).toEqual(['思考', '视觉'])

    /* 2026-11-05 用户「能力开关与默认策略上下倒置」：挡位与两个默认项是思考的子配置，
       开关关着就整块不渲染——置灰还会让人以为能填，填了又会被后端拒。 */
    expect(w.find('.med-reasoning').exists()).toBe(false)
    expect(w.find('.med-effort__input').exists()).toBe(false)

    await caps[0].find('input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(w.find('.med-reasoning').exists()).toBe(true)
    // 新模型不预置任何挡（2026-11-05 挡位由运营手填）
    expect(w.findAll('.med-effort')).toHaveLength(0)
    expect(w.find('.med-effort__input').attributes('placeholder')).toBe('添加挡位，如 xhigh')
    // 两个默认项在能力下面，名字与挡位编辑器不再重名
    expect(mkSelectValue(w, '默认思考模式')).toBe('default')
    expect(mkSelectValue(w, '默认推理挡位')).toBe('default')
  })

  it('挡位填什么发什么：自定义词原样进请求体（只做小写与去空白），带空格的词就地拦下', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    w.vm.openWith({ providerId: 'platform', model: null, presetId: 'm-free' })
    await flushPromises()
    await w.findAll('.med-cap input[type="checkbox"]')[0].setValue(true)
    await flushPromises()
    const input = w.find('.med-effort__input')

    // 界面不按自己的词表过滤：上游各家词表不一致，认哪些词只有运营知道
    await input.setValue('very high')
    await input.trigger('keydown.enter')
    expect(w.find('[role="alert"]').text()).toContain('不带空格的短词')
    expect(w.findAll('.med-effort')).toHaveLength(0)

    await input.setValue('XHigh')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(w.findAll('.med-effort__token').map((t) => t.text())).toEqual(['xhigh'])
    expect(mkSelectLabels(w, '默认推理挡位')).toEqual(['不指定（按平台默认）', 'xhigh'])

    addModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(addModelMock).toHaveBeenCalledWith('platform', expect.objectContaining({ reasoningEfforts: ['xhigh'] }))
  })

  it('关掉思考后保存：挡位与两个默认值一并交空，表单里的值不抹', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    w.vm.openWith({
      providerId: 'acme-gateway',
      model: {
        id: 'acme-chat', label: 'acme-chat', tier: 'chat', supportsThinking: true, reasoningEfforts: ['high'], vision: false,
        defaultThinkingMode: 'enabled', defaultReasoningEffort: 'high',
        maxOutputTokens: null, defaultMaxTokens: null, reasoningReserveTokens: null, maxParallelRequests: null,
        pricing: null, description: null
      }
    })
    await flushPromises()
    const thinking = w.findAll('.med-cap input[type="checkbox"]')[0]
    // 关掉再开回来：填过的挡位还在（开关只决定这一程提交什么，不抹表单）
    await thinking.setValue(false)
    await flushPromises()
    expect(w.find('.med-reasoning').exists()).toBe(false)
    await thinking.setValue(true)
    await flushPromises()
    expect(w.findAll('.med-effort__token').map((t) => t.text())).toEqual(['high'])

    await thinking.setValue(false)
    await flushPromises()
    updateModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    /* 2026-11-05：能力与默认值同进同退——没开思考就交空，不落一份
       「声明了挡位却不会思考」的配置（后端会拒，运行时也会被 thinking-policy 裁掉）。 */
    expect(updateModelMock).toHaveBeenCalledWith('acme-gateway', 'acme-chat', expect.objectContaining({
      supportsThinking: false,
      reasoningEfforts: [],
      defaultThinkingMode: null,
      defaultReasoningEffort: null
    }))
  })

  it('单价三档：编辑回填并与输入/输出一起提交（缓存命中价是成本口径的一部分）', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    w.vm.openWith({
      providerId: 'platform',
      model: {
        id: 'm-priced', label: 'm-priced', tier: 'chat', supportsThinking: false, reasoningEfforts: [], vision: false,
        maxOutputTokens: null, defaultMaxTokens: null, reasoningReserveTokens: null, maxParallelRequests: null,
        pricing: { inputPer1M: 0.3, cachedInputPer1M: 0.006, outputPer1M: 1.2 }, description: null
      }
    })
    await flushPromises()
    const [inputIn, cachedIn, output] = w.findAll('.med-price input')
    expect((inputIn.element as HTMLInputElement).value).toBe('0.3')
    expect((cachedIn.element as HTMLInputElement).value).toBe('0.006')
    expect((output.element as HTMLInputElement).value).toBe('1.2')

    updateModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(updateModelMock).toHaveBeenCalledWith('platform', 'm-priced', expect.objectContaining({
      pricing: { inputPer1M: 0.3, cachedInputPer1M: 0.006, outputPer1M: 1.2 }
    }))
  })

  it('编辑：模型 ID 只读（路由按它找模型，改名等于换模型）', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    w.vm.openWith({
      providerId: 'acme-gateway',
      model: {
        id: 'acme-chat', label: 'Acme Chat', tier: 'chat', supportsThinking: true, reasoningEfforts: [], vision: false,
        maxOutputTokens: 65536, defaultMaxTokens: 4096, reasoningReserveTokens: null, maxParallelRequests: 8,
        pricing: { inputPer1M: 0.3 }
      }
    })
    await flushPromises()
    // 占位符随已下线模型归一（deepseek-v4-flash → v4.1-flash）；
    // 「创建后不改」提示已在本次 UI 改造中从对话框移除，断言同步删除
    expect(w.find('.med-modal .med-two input').attributes('disabled')).toBeDefined()
    updateModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(updateModelMock).toHaveBeenCalledWith('acme-gateway', 'acme-chat', expect.objectContaining({
      maxOutputTokens: 65536,
      defaultMaxTokens: 4096,
      pricing: { inputPer1M: 0.3 }
    }))
  })

  it('默认思考模式 / 默认推理挡位：不指定时交 null，显式选择后随模型提交', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    w.vm.openWith({ providerId: 'platform', model: null, presetId: 'm-gen' })
    await flushPromises()
    // 2026-11-04 用户「输出格式这个功能先下掉」：这一格连同它的下拉一起消失
    expect(w.text()).not.toContain('输出格式')
    // 没开思考：两个默认项是思考的子配置，整块不渲染
    expect(w.find('[aria-label="默认推理挡位"]').exists()).toBe(false)

    await w.findAll('.med-cap input[type="checkbox"]')[0].setValue(true)
    await flushPromises()
    expect(mkSelectValue(w, '默认思考模式')).toBe('default')
    expect(mkSelectValue(w, '默认推理挡位')).toBe('default')
    // 一条挡位都没填时下拉只剩一项、整项禁用，且那唯一一项自己说明原因
    expect(mkSelectLabels(w, '默认推理挡位')).toEqual(['这台模型没有声明挡位'])
    expect(mkSelectBox(w, '默认推理挡位').find('button').attributes('disabled')).toBeDefined()

    // 填进 low / high / max 后，默认挡位的候选就是这三个词
    const effortInput = w.find('.med-effort__input')
    for (const token of ['low', 'high', 'max']) {
      await effortInput.setValue(token)
      await effortInput.trigger('keydown.enter')
    }
    await flushPromises()
    expect(mkSelectLabels(w, '默认推理挡位'))
      .toEqual(['不指定（按平台默认）', '低（low）', '高（high）', '最高（max）'])

    // 默认思考模式选「关闭」时，默认挡位没有意义：自动回「不指定」并整项禁用
    await chooseMkSelect(w, '默认思考模式', 'disabled')
    await flushPromises()
    expect(mkSelectValue(w, '默认推理挡位')).toBe('default')
    expect(mkSelectBox(w, '默认推理挡位').find('button').attributes('disabled')).toBeDefined()

    await chooseMkSelect(w, '默认思考模式', 'enabled')
    await chooseMkSelect(w, '默认推理挡位', 'max')
    addModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(addModelMock).toHaveBeenCalledWith('platform', expect.objectContaining({
      supportsThinking: true,
      reasoningEfforts: ['low', 'high', 'max'],
      defaultThinkingMode: 'enabled',
      defaultReasoningEffort: 'max'
    }))
  })

  it('显示名称默认跟随模型 ID，手改后不再覆盖', async () => {
    const w = mount(ModelEditorDialog, mountOptions)
    w.vm.openWith({ providerId: 'platform', model: null, presetId: 'm-one' })
    await flushPromises()
    const id = w.find('.med-modal .med-two input')
    const label = w.find('input[placeholder="默认跟随模型 ID"]')
    expect((label.element as HTMLInputElement).value).toBe('m-one')

    const labelValue = () => (w.find('input[placeholder="默认跟随模型 ID"]').element as HTMLInputElement).value
    await id.setValue('m-two')
    await nextTick()
    expect(labelValue()).toBe('m-two')

    await label.setValue('自定义名称')
    await id.setValue('m-three')
    await nextTick()
    expect(labelValue()).toBe('自定义名称')
  })
})
