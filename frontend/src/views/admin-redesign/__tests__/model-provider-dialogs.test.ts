/**
 * 供应商 / 模型编辑弹层（2026-10-18 BYOK）：
 * 前端先按后端同一套规则拦一遍（id 格式、服务地址必填、勾强度没勾思考、改名），
 * 后端再拦一次并把人话原因显示在弹层里；平台通道不出服务地址与密钥字段。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ProviderEditorDialog from '../ProviderEditorDialog.vue'
import ModelEditorDialog from '../ModelEditorDialog.vue'
import { chooseMkSelect, mkSelectValue } from '@/components/mk/__tests__/mkSelect'

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

  it('新建：字段分三层（标识 / 能力与限额 / 备用链与单价），提交时清空的限额不发 0', async () => {
    const w = mount(ModelEditorDialog, { props: { fallbackOptions: ['platform/m-chat'] }, ...mountOptions })
    w.vm.openWith({ providerId: 'acme-gateway', model: null })
    await flushPromises()
    await w.find('.med-modal .med-two input').setValue('acme-chat')
    await chooseMkSelect(w, '用途', 'reasoning')
    await w.findAll('.med-adv-body .med-two')[1].findAll('input')[0].setValue('65536')

    addModelMock.mockResolvedValue({ data: { success: true, warnings: ['备用链写了 2 条…'] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(addModelMock).toHaveBeenCalledWith('acme-gateway', expect.objectContaining({
      id: 'acme-chat',
      tier: 'reasoning',
      maxOutputTokens: 65536,
      defaultMaxTokens: null,
      fallbacks: [],
      pricing: {}
    }))
    // 告警随 saved 事件回传面板（不在弹层里常驻展示）
    expect(w.emitted('saved')?.[0]?.[0]).toEqual({ modelId: 'acme-chat', warnings: ['备用链写了 2 条…'] })
  })

  it('勾了推理强度没勾思考：保存时就地拦下并说明依赖（不发请求）', async () => {
    const w = mount(ModelEditorDialog, { props: { fallbackOptions: [] }, ...mountOptions })
    w.vm.openWith({
      providerId: 'acme-gateway',
      model: {
        id: 'acme-chat', label: 'acme-chat', tier: 'chat', supportsThinking: false, supportsReasoningEffort: false, vision: false,
        maxOutputTokens: null, defaultMaxTokens: null, reasoningReserveTokens: null, maxParallelRequests: null,
        fallbacks: [], pricing: null, description: null
      }
    })
    await flushPromises()
    const [thinking, effort] = w.findAll('.mk-field--switch input[type="checkbox"]')
    // 强度仍可勾（不做一个「表面禁用、模型值却是 true」的假控件）
    expect(effort.attributes('disabled')).toBeUndefined()
    await effort.setValue(true)
    await flushPromises()
    expect((thinking.element as HTMLInputElement).checked).toBe(false)

    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('必须同时支持思考模式')
    expect(updateModelMock).not.toHaveBeenCalled()

    // 补勾思考后即可保存，两项一起提交
    await thinking.setValue(true)
    updateModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(updateModelMock).toHaveBeenCalledWith('acme-gateway', 'acme-chat', expect.objectContaining({
      supportsThinking: true,
      supportsReasoningEffort: true
    }))
  })

  it('单价三档：编辑回填并与输入/输出一起提交（缓存命中价是成本口径的一部分）', async () => {
    const w = mount(ModelEditorDialog, { props: { fallbackOptions: [] }, ...mountOptions })
    w.vm.openWith({
      providerId: 'platform',
      model: {
        id: 'm-priced', label: 'm-priced', tier: 'chat', supportsThinking: false, supportsReasoningEffort: false, vision: false,
        maxOutputTokens: null, defaultMaxTokens: null, reasoningReserveTokens: null, maxParallelRequests: null,
        fallbacks: [], pricing: { inputPer1M: 0.3, cachedInputPer1M: 0.006, outputPer1M: 1.2 }, description: null
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
    const w = mount(ModelEditorDialog, { props: { fallbackOptions: [] }, ...mountOptions })
    w.vm.openWith({
      providerId: 'acme-gateway',
      model: {
        id: 'acme-chat', label: 'Acme Chat', tier: 'chat', supportsThinking: true, supportsReasoningEffort: false, vision: false,
        maxOutputTokens: 65536, defaultMaxTokens: 4096, reasoningReserveTokens: null, maxParallelRequests: 8,
        fallbacks: [], pricing: { inputPer1M: 0.3 }, description: '主用'
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
      pricing: { inputPer1M: 0.3 },
      description: '主用'
    }))
  })

  it('生成参数：默认跟随平台，显式选择后随模型提交', async () => {
    const w = mount(ModelEditorDialog, { props: { fallbackOptions: [] }, ...mountOptions })
    w.vm.openWith({ providerId: 'platform', model: null, presetId: 'm-gen' })
    await flushPromises()
    expect(mkSelectValue(w, '思考模式')).toBe('default')
    expect(mkSelectValue(w, '思考强度')).toBe('default')
    expect(mkSelectValue(w, '输出格式')).toBe('default')

    await chooseMkSelect(w, '思考模式', 'disabled')
    await chooseMkSelect(w, '思考强度', 'max')
    await chooseMkSelect(w, '输出格式', 'json_object')
    addModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(addModelMock).toHaveBeenCalledWith('platform', expect.objectContaining({
      defaultThinkingMode: 'disabled',
      defaultReasoningEffort: 'max',
      defaultResponseFormat: 'json_object'
    }))
  })

  it('显示名称默认跟随模型 ID，手改后不再覆盖', async () => {
    const w = mount(ModelEditorDialog, { props: { fallbackOptions: [] }, ...mountOptions })
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

  it('备用模型：勾选顺序即尝试顺序，可单条移除', async () => {
    const w = mount(ModelEditorDialog, {
      props: { fallbackOptions: ['platform/m-chat', 'platform/m-backup', 'platform/m-third'] },
      ...mountOptions
    })
    w.vm.openWith({ providerId: 'platform', model: null, presetId: 'm-main' })
    await flushPromises()
    const rows = w.findAll('.med-fb__row')
    await rows[1].find('input').setValue(true)
    await rows[2].find('input').setValue(true)
    expect(w.findAll('.med-fb__chip .med-fb__name').map((e) => e.text())).toEqual(['platform/m-backup', 'platform/m-third'])
    expect(w.findAll('.med-fb__order').map((e) => e.text())).toEqual(['1', '2'])

    await w.findAll('.med-fb__remove')[0].trigger('click')
    expect(w.findAll('.med-fb__chip .med-fb__name').map((e) => e.text())).toEqual(['platform/m-third'])
    expect(w.findAll('.med-fb__order').map((e) => e.text())).toEqual(['1'])

    addModelMock.mockResolvedValue({ data: { success: true, warnings: [] } })
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(addModelMock).toHaveBeenCalledWith('platform', expect.objectContaining({
      fallbacks: ['platform/m-third']
    }))
  })
})
