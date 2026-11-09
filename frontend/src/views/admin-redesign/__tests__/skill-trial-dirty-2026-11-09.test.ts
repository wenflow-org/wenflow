/**
 * 试跑页签的脏态口径（2026-11-09 走查）。
 *
 * 实况：点一下「填入示例输入」、再点侧栏任意页 → 弹「离开 Skill 详情 · 当前 Skill 有未保存的修改
 * （试跑输入）」。可运营只是"看一眼示例"，什么都没写，却被离开守卫拦一次。
 *
 * 口径定死为：**程序化填入**（契约骨架 / 最近一次真实调用的示例 / 跑过一次的输入）一律重取基线
 * → 不算未保存修改；只有**手写**过的值才算脏（#118 的原意——别让手写的输入静默丢失）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  getCore: vi.fn(),
  getSampleInput: vi.fn(),
}))

vi.mock('@/api/adminApi', () => ({
  adminPromptWorkbenchApi: { getCore: h.getCore },
  adminSkillsApi: { getSampleInput: h.getSampleInput, testSkill: vi.fn(async () => ({ data: { data: {} } })) },
}))
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import TrialTab from '../skill-design/trial-tab.vue'

/** 最后一次上报的脏态（宿主 guard 判据） */
function lastDirty(w: ReturnType<typeof mount>): boolean | null {
  const evts = w.emitted('dirty') as Array<[{ dirty: boolean }]> | undefined
  return evts?.length ? evts[evts.length - 1][0].dirty : null
}

async function mountTab() {
  const w = mount(TrialTab, { props: { skillId: 'goal-conversation', refreshTick: 0 } })
  await flushPromises()
  return w
}

beforeEach(() => {
  h.getCore.mockReset()
  h.getSampleInput.mockReset()
  // 契约：3 个必填输入（与 goal-conversation 的 core.yaml 同形）
  h.getCore.mockResolvedValue({
    data: {
      core: {
        inputs: [
          { name: 'userInput', type: 'string' },
          { name: 'state', type: 'object' },
          { name: 'conversationContext', type: 'object[]' },
        ],
      },
    },
  })
})

describe('试跑输入 · 程序化填入不算未保存修改', () => {
  it('默认载荷就是契约骨架，且一上来不是脏的', async () => {
    const w = await mountTab()
    expect((w.find('textarea').element as HTMLTextAreaElement).value).toContain('"userInput"')
    expect(lastDirty(w)).toBe(false)
    w.unmount()
  })

  it('手写改动仍然算脏（#118 不丢）', async () => {
    const w = await mountTab()
    await w.find('textarea').setValue('{"userInput":"我自己写的"}')
    await flushPromises()
    expect(lastDirty(w)).toBe(true)
    w.unmount()
  })

  it('点「填入示例输入」填进来的值成为新基线 → 不算脏（离开不再被守卫拦）', async () => {
    h.getSampleInput.mockResolvedValue({
      data: { data: { json: '{\n  "userInput": "真吃过的载荷"\n}', origin: 'real-call' } },
    })
    const w = await mountTab()
    // 先手写（脏）→ 再点示例：应被示例覆盖并复位为不脏
    await w.find('textarea').setValue('{"userInput":"半截"}')
    await flushPromises()
    expect(lastDirty(w)).toBe(true)

    const fill = w.findAll('button').find((b) => b.text().includes('填入示例输入'))!
    await fill.trigger('click')
    await flushPromises()

    expect((w.find('textarea').element as HTMLTextAreaElement).value).toContain('真吃过的载荷')
    expect(lastDirty(w)).toBe(false)
    w.unmount()
  })

  it('示例取不到时回落契约骨架，同样不算脏', async () => {
    h.getSampleInput.mockResolvedValue({ data: { data: null } })
    const w = await mountTab()
    await w.find('textarea').setValue('{"userInput":"半截"}')
    await flushPromises()

    const fill = w.findAll('button').find((b) => b.text().includes('填入示例输入'))!
    await fill.trigger('click')
    await flushPromises()

    expect((w.find('textarea').element as HTMLTextAreaElement).value).toContain('"conversationContext"')
    expect(lastDirty(w)).toBe(false)
    w.unmount()
  })
})
