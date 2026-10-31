/**
 * roving tablist 共享实现（2026-10-21 交互走查）：
 * 方向键在行内循环、Home/End 跳首尾、非方向键不拦、切换后焦点跟随新页签。
 */
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { onTabRowKeydown } from '../rovingTablist'

function row(labels: string[], activate: (i: number) => void) {
  const host = document.createElement('div')
  host.setAttribute('role', 'tablist')
  const btns = labels.map((label, i) => {
    const b = document.createElement('button')
    b.setAttribute('role', 'tab')
    b.tabIndex = i === 0 ? 0 : -1
    b.textContent = label
    host.appendChild(b)
    return b
  })
  // 真组件里这句由模板的 @keydown 绑定完成
  host.addEventListener('keydown', (e) => onTabRowKeydown(e, activate))
  document.body.appendChild(host)
  return { host, btns }
}

function press(host: HTMLElement, key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  host.dispatchEvent(e)
  return e
}

describe('onTabRowKeydown', () => {
  it('ArrowRight / ArrowLeft 行内循环，并把焦点带到新页签', async () => {
    const activate = vi.fn()
    const { host, btns } = row(['甲', '乙', '丙'], activate)
    btns[2].focus()
    press(host, 'ArrowRight')
    expect(activate).toHaveBeenCalledWith(0)
    await nextTick()
    expect(document.activeElement).toBe(btns[0])

    btns[0].focus()
    press(host, 'ArrowLeft')
    expect(activate).toHaveBeenLastCalledWith(2)
    await nextTick()
    expect(document.activeElement).toBe(btns[2])
    host.remove()
  })

  it('Home / End 跳首尾；其它按键不拦、不激活', () => {
    const activate = vi.fn()
    const { host, btns } = row(['甲', '乙', '丙'], activate)
    btns[1].focus()

    const enter = press(host, 'Enter')
    expect(activate).not.toHaveBeenCalled()
    expect(enter.defaultPrevented).toBe(false)

    press(host, 'Home')
    expect(activate).toHaveBeenLastCalledWith(0)
    btns[1].focus()
    press(host, 'End')
    expect(activate).toHaveBeenLastCalledWith(2)
    host.remove()
  })

  it('焦点不在行内页签上时不动选中项（避免拦截别处的方向键）', () => {
    const activate = vi.fn()
    const { host } = row(['甲', '乙'], activate)
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    press(host, 'ArrowRight')
    expect(activate).not.toHaveBeenCalled()
    outside.remove()
    host.remove()
  })
})
