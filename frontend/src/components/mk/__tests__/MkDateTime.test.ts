/**
 * MkDateTime 契约：
 * - 值统一按「YYYY-MM-DD HH:mm」回显（原生 datetime-local 在中文环境里会把空态渲染成
 *   「年 /月/日 --:--」，字距与斜杠位置都不受控，2026-11-01 外部评审点名）；
 * - 空值显示宿主给的占位文案，不冒充「已设置」；
 * - 选择结果原样 emit 本地串（YYYY-MM-DDTHH:mm），时区换算仍归宿主，组件不碰时区。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MkDateTime from '../MkDateTime.vue'

describe('MkDateTime', () => {
  it('有值时回显为「YYYY-MM-DD HH:mm」，不出现 T 与原生量词', () => {
    const w = mount(MkDateTime, { props: { modelValue: '2026-11-08T18:30', label: '过期时间' } })
    const text = w.find('.mdt__text').element as HTMLInputElement
    expect(text.value).toBe('2026-11-08 18:30')
    expect(w.text()).not.toContain('年')
    w.unmount()
  })

  it('空值时显示占位文案（默认「未设置」，可由宿主改写）', () => {
    const w = mount(MkDateTime, { props: { modelValue: '', placeholder: '留空表示不过期' } })
    const text = w.find('.mdt__text').element as HTMLInputElement
    expect(text.value).toBe('')
    expect(text.getAttribute('placeholder')).toBe('留空表示不过期')
    w.unmount()
  })

  it('原生控件选值后 emit 本地串（不转 ISO，时区口径留在宿主）', async () => {
    const w = mount(MkDateTime, { props: { modelValue: '' } })
    const native = w.find('.mdt__native')
    ;(native.element as HTMLInputElement).value = '2026-12-01T09:00'
    await native.trigger('change')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['2026-12-01T09:00'])
    w.unmount()
  })

  it('回显框只读：键盘不能直接改时间（避免手打出非法串）', () => {
    const w = mount(MkDateTime, { props: { modelValue: '' } })
    expect((w.find('.mdt__text').element as HTMLInputElement).readOnly).toBe(true)
    w.unmount()
  })
})
