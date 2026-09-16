/**
 * 共用件单测：MkStatStrip（分格指标条）/ MkEmptyState（空态三件套）。
 * 目的：锁定「标签在上 + 数值在下 + 竖分隔」的文本结构（页头各页依赖 `label value` 子串断言），
 * 以及可点击筛选/空态下一步的交互契约。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MkStatStrip from '../MkStatStrip.vue'
import MkEmptyState from '../MkEmptyState.vue'

describe('MkStatStrip', () => {
  it('渲染标签与数值（保持 `标签 数值` 的文本，供页头断言/读屏顺序）', () => {
    const w = mount(MkStatStrip, {
      props: {
        items: [
          { label: '进行中', value: 0 },
          { label: '完成率', value: '0%' },
        ],
      },
    })
    expect(w.text()).toContain('进行中 0')
    expect(w.text()).toContain('完成率 0%')
    expect(w.findAll('.mk-stat')).toHaveLength(2)
  })

  it('可点击项：点击 emit select(key)，active 加激活类', async () => {
    const w = mount(MkStatStrip, {
      props: {
        items: [
          { key: 'running', label: '进行中', value: 3, clickable: true, active: true },
          { key: 'paused', label: '已暂停', value: 1, clickable: true },
          { label: '今日调用', value: 5 },
        ],
      },
    })
    const clickable = w.findAll('.mk-stat--clickable')
    expect(clickable).toHaveLength(2)
    expect(clickable[0].classes()).toContain('mk-stat--on')

    await clickable[1].trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['paused'])
  })

  it('tone=bad 时数值着色类生效', () => {
    const w = mount(MkStatStrip, {
      props: { items: [{ label: '失败率', value: '12%', tone: 'bad' }] },
    })
    expect(w.find('.mk-stat--bad').exists()).toBe(true)
  })
})

describe('MkEmptyState', () => {
  it('渲染图标 + 标题 + 解释 + 下一步，点击 emit action', async () => {
    const w = mount(MkEmptyState, {
      props: {
        icon: '◌',
        title: '暂无反馈数据',
        description: '学习者提交反馈后自动呈现。',
        actionText: '刷新',
        min: true,
      },
    })
    expect(w.find('.mk-empty__icon').text()).toBe('◌')
    expect(w.text()).toContain('暂无反馈数据')
    expect(w.text()).toContain('学习者提交反馈后自动呈现。')
    expect(w.classes()).toContain('mk-empty--min')

    await w.find('.mk-empty__action').trigger('click')
    expect(w.emitted('action')).toHaveLength(1)
  })

  it('无 actionText 时不渲染按钮（避免空态多出无效动作）', () => {
    const w = mount(MkEmptyState, {
      props: { title: '还没有记录', description: '稍后再来。' },
    })
    expect(w.find('.mk-empty__action').exists()).toBe(false)
  })

  /* R3 的第三种状态：错误态。此前 9 个页面各写 --error 容器 + 手拼重试按钮，
     现由 tone="error" + actionBusy 表达。 */
  it('tone=error：加 --error 修饰并带 role=alert（错误可被读屏播报）', () => {
    const w = mount(MkEmptyState, { props: { tone: 'error', title: '审计日志加载失败' } })
    expect(w.classes()).toContain('mk-empty--error')
    expect(w.attributes('role')).toBe('alert')
  })

  it('中性空态不加 --error、也不加 role（空态不该被当成告警播报）', () => {
    const w = mount(MkEmptyState, { props: { title: '暂无反馈数据' } })
    expect(w.classes()).not.toContain('mk-empty--error')
    expect(w.attributes('role')).toBeUndefined()
  })

  it('actionBusy：按钮禁用并换成进行中文案，且不再 emit action', async () => {
    const w = mount(MkEmptyState, {
      props: { title: '加载失败', actionText: '重试', actionBusyText: '重试中…' },
    })
    const btn = () => w.find('.mk-empty__action')
    expect(btn().text()).toBe('重试')
    expect(btn().attributes('disabled')).toBeUndefined()

    await w.setProps({ actionBusy: true })
    expect(btn().text()).toBe('重试中…')
    expect(btn().attributes('disabled')).toBeDefined()
    await btn().trigger('click')
    expect(w.emitted('action')).toBeUndefined()
  })

  it('actionBusy 但未给 actionBusyText：只禁用、不改文案（不猜动作语义）', () => {
    const w = mount(MkEmptyState, { props: { title: 'x', actionText: '重新探测', actionBusy: true } })
    expect(w.find('.mk-empty__action').text()).toBe('重新探测')
    expect(w.find('.mk-empty__action').attributes('disabled')).toBeDefined()
  })
})
