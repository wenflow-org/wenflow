/**
 * Confirm `busy` 模式契约。
 *
 * 期望语义（也是调用方的既有写法）：
 *   const ok = await askConfirm({ busy: true, ... })
 *   if (!ok) return
 *   …async 业务…
 *   doneConfirm()            // 成功：关闭弹窗
 *   failConfirm()            // 失败：关闭弹窗（调用方自行 toast）
 *
 * 即：**点确认后必须立即 resolve(true)** 让调用方开始干活；弹窗则保持打开并进入
 * busy 态（按钮禁用 + 「处理中…」），由 done()/failConfirm() 真正关闭。
 *
 * 原实现点确认时只置 `busy = true` 而不 settle → 调用方 `await` 永久挂起、
 * 业务代码永不执行、`doneConfirm()` 永不被调用 → **死锁**（弹窗停在「处理中…」）。
 * 本文件把这个契约钉住。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import Confirm from '../Confirm.vue'
import { askConfirm, confirmState, doneConfirm, failConfirm } from '../useConfirm'

// 官方自动卸载：Correct 处理 Teleport 到 body 的节点，避免手工删 DOM 破坏 Vue 的锚点
enableAutoUnmount(afterEach)

/** 判定 Promise 是否已在 ms 内 settle（避免整测超时挂死） */
function raceSettled(p: Promise<unknown>, ms = 60): Promise<'settled' | 'pending'> {
  return Promise.race([
    p.then(() => 'settled' as const).catch(() => 'settled' as const),
    new Promise<'pending'>((r) => setTimeout(() => r('pending'), ms)),
  ])
}

/** Confirm 用 Teleport 到 body，故按钮需从 document 查询（wrapper.findAll 看不到） */
const confirmButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.mk-confirm button')]

async function clickConfirm() {
  const btns = confirmButtons()
  expect(btns.length).toBe(2) // [0] 取消 / [1] 确认
  btns[1].click()
  await Promise.resolve()
}

describe('Confirm busy 模式', () => {
  beforeEach(() => {
    // 单例状态复位（弹窗 DOM 由 enableAutoUnmount 负责清理）
    confirmState.open = false
    confirmState.busy = false
    confirmState.busyMode = false
    confirmState.resolve = null
  })

  it('点确认后立即 resolve(true)（不卡死调用方），弹窗保持打开且进入 busy', async () => {
    const w = mount(Confirm, { attachTo: document.body })
    const p = askConfirm({ title: '删除', message: '确认删除？', confirmText: '删除', busy: true })
    await w.vm.$nextTick()

    await clickConfirm()

    expect(await raceSettled(p)).toBe('settled')
    expect(await p).toBe(true)
    expect(confirmState.open).toBe(true)
    expect(confirmState.busy).toBe(true)

    doneConfirm()
    expect(confirmState.open).toBe(false)
    
  })

  it('busy 期间按钮禁用，且确认按钮文案为「处理中…」', async () => {
    const w = mount(Confirm, { attachTo: document.body })
    askConfirm({ title: '删除', message: '确认删除？', busy: true })
    await w.vm.$nextTick()
    await clickConfirm()
    await w.vm.$nextTick()

    const btns = confirmButtons()
    expect(btns[0].disabled).toBe(true)
    expect(btns[1].disabled).toBe(true)
    expect(btns[1].textContent || '').toContain('处理中')
    
  })

  it('failConfirm 关闭弹窗', async () => {
    const w = mount(Confirm, { attachTo: document.body })
    const p = askConfirm({ title: '删除', message: '确认删除？', busy: true })
    await w.vm.$nextTick()
    await clickConfirm()
    expect(await p).toBe(true)

    failConfirm()
    expect(confirmState.open).toBe(false)
    
  })

  it('非 busy 模式行为不变：点确认立即 settle(true) 且关闭', async () => {
    const w = mount(Confirm, { attachTo: document.body })
    const p = askConfirm({ title: '删除', message: '确认删除？' })
    await w.vm.$nextTick()
    await clickConfirm()

    expect(await p).toBe(true)
    expect(confirmState.open).toBe(false)
    
  })
})
