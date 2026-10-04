/**
 * 共享交互件「操作习惯」收口钉（对照 newui/UI-分支优化设计/index.html 原型）：
 * - Pagination = 原型 pager()：信息行「共 N 条 · 每页 S 条 · 第 P / T 页」恒显（.pager__info 口径），
 *   页码钮组当前页实心（brand 底白字）+ aria-current，当前页钮不 disabled（原型形态）。
 * - Confirm = 原型 openConfirm()：.ovl__head（shield 图标 + 标题）/ .ovl__body / .ovl__foot
 *   （取消左、危险确认右）；遮罩点击关闭 + Esc 关闭顶层。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Pagination from '../Pagination.vue'
import Confirm from '../Confirm.vue'
import { askConfirm, confirmState } from '../useConfirm'

enableAutoUnmount(afterEach)

describe('Pagination 原型口径收口', () => {
  const mountPager = (props: Record<string, unknown> = {}) =>
    mount(Pagination, { props: { page: 1, total: 378, pageSize: 30, ...props } })

  it('信息行恒显「共 N 条 · 第 P / T 页」（P3-28，设计评审 4.3-28：撤「每页 S 条」——与右侧「S条/页」下拉同屏复读，条数单源在下拉）', () => {
    const w = mountPager()
    expect(w.find('.mk-pagination__total').text()).toBe('共 378 条 · 第 1 / 13 页')
  })

  it('信息行不再加粗当前页（原型为统一 muted 信息行，无 <strong>）', () => {
    const w = mountPager()
    expect(w.find('.mk-pagination__total').find('strong').exists()).toBe(false)
  })

  it('当前页钮 = 实心态（--active）+ aria-current=page，且不 disabled（原型当前页可点）', () => {
    const w = mountPager({ page: 5 })
    const active = w.find('.mk-pagination__num--active')
    expect(active.text()).toBe('5')
    expect(active.attributes('aria-current')).toBe('page')
    expect(active.attributes('disabled')).toBeUndefined()
  })

  it('上一页/下一页 + 页码钮同为 30px 描边钮组（形状收口：btn 与 num 同规则命名空间）', () => {
    const w = mountPager()
    // btn（翻页）与 num（页码）共享同一形态规则；此处钉类名锚点不回退
    expect(w.findAll('.mk-pagination__btn').length).toBe(2)
    expect(w.findAll('.mk-pagination__num').length).toBeGreaterThan(0)
  })
})

describe('Confirm 原型口径收口', () => {
  /** Confirm Teleport 到 body，从 document 查询 */
  const panel = () => document.querySelector('.mk-confirm')!

  beforeEach(() => {
    confirmState.open = false
    confirmState.busy = false
    confirmState.busyMode = false
    confirmState.resolve = null
  })

  it('head = shield 线性图标 + h2 标题（原型 .ovl__head 形态）', async () => {
    mount(Confirm, { attachTo: document.body })
    askConfirm({ title: '确认停用账户？', message: '停用后将无法登录。' })
    await nextTick()
    const head = panel().querySelector('.mk-confirm__head')!
    expect(head).toBeTruthy()
    expect(head.querySelector('svg')).toBeTruthy()
    const title = head.querySelector('h2')!
    expect(title.textContent).toBe('确认停用账户？')
    expect(title.id).toBe('mk-confirm-title')
  })

  it('foot = [取消, 确认] 顺序，危险操作确认钮带 mk-btn--danger（取消左、危险确认右）', async () => {
    mount(Confirm, { attachTo: document.body })
    askConfirm({ title: '删除', message: '确认删除？', confirmText: '确认删除' })
    await nextTick()
    const btns = [...panel().querySelectorAll<HTMLButtonElement>('button')]
    expect(btns.map((b) => b.textContent?.trim())).toEqual(['取消', '确认删除'])
    expect(btns[1].classList.contains('mk-btn--danger')).toBe(true)
    expect(btns[0].classList.contains('mk-btn--danger')).toBe(false)
  })

  it('Esc 关闭顶层（resolve false）', async () => {
    mount(Confirm, { attachTo: document.body })
    const p = askConfirm({ title: '删除', message: '确认删除？' })
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(await p).toBe(false)
    expect(confirmState.open).toBe(false)
  })

  it('遮罩点击（mask 上按下并松开）关闭', async () => {
    mount(Confirm, { attachTo: document.body })
    const p = askConfirm({ title: '删除', message: '确认删除？' })
    await nextTick()
    const mask = document.querySelector('.mk-modal')!
    mask.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    mask.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(await p).toBe(false)
    expect(confirmState.open).toBe(false)
  })

  it('非危险确认：确认钮走 mk-btn--primary（danger=false 口径开关）', async () => {
    mount(Confirm, { attachTo: document.body })
    askConfirm({ title: '生成', message: '确认生成？', danger: false, confirmText: '生成' })
    await nextTick()
    const btns = [...panel().querySelectorAll<HTMLButtonElement>('button')]
    expect(btns[1].classList.contains('mk-btn--primary')).toBe(true)
    expect(btns[1].classList.contains('mk-btn--danger')).toBe(false)
  })
})
