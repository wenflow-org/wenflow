/**
 * PathDetail 路径深链适配层（2026-10-12 拍板：路径不再有独立详情页）。
 *
 * 断言 = 解析行为与数据诚实性：
 *  - 有关联对话 → 就地换开座舱（?view=session-real&id=gc_x&stage=path），from 原样带走
 *  - 无关联对话（孤儿路径）→ 明确空态 + 返回列表，不静默、不假开
 *  - 接口失败 → 错误态可重试
 * 路径内容体（进度/阶段手风琴/任务弹层/治理动作）的断言在
 * sessionCockpit.real.test.ts（座舱 Path 页签内嵌 PathJourneyPanel）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PathDetail from '../PathDetail.vue'
import { subPage, closeSubPage } from '../store'

const detailMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/adminApi', () => ({
  adminLearningContentApi: {
    getPathDetail: detailMock
  }
}))

vi.mock('../live', () => ({
  timeAgo: (v?: string | null) => (v ? '3 天前' : '—'),
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  shortId: (id: string, h: number, t: number) => (id ? `${id.slice(0, h)}…${id.slice(-t)}` : id)
}))

async function settle() {
  await flushPromises()
  await nextTick()
  await flushPromises()
}

function mountShim() {
  return mount(PathDetail)
}

beforeEach(() => {
  detailMock.mockReset()
  subPage.value = { view: 'path', id: 'lp_1' }
})

afterEach(() => {
  document.body.innerHTML = ''
  closeSubPage()
})

describe('PathDetail 路径深链适配层', () => {
  it('有关联对话 → 换开座舱并落 Path 页签；from 原样带走（返回键回到来源详情）', async () => {
    detailMock.mockResolvedValue({ data: { data: { id: 'lp_1', title: '数据分析入门', conversationId: 'gc_9' } } })
    subPage.value = {
      view: 'path',
      id: 'lp_1',
      from: { view: 'learner', id: 'u_1', label: '张三' }
    }
    const w = mountShim()
    await settle()
    expect(detailMock).toHaveBeenCalledWith('lp_1')
    expect(subPage.value).toEqual({
      view: 'session-real',
      id: 'gc_9',
      stage: 'path',
      from: { view: 'learner', id: 'u_1', label: '张三' }
    })
    w.unmount()
  })

  it('无关联对话（孤儿路径）→ 空态明示 + 返回列表；不换开座舱', async () => {
    detailMock.mockResolvedValue({ data: { data: { id: 'lp_1', title: '孤儿路径', conversationId: null } } })
    const w = mountShim()
    await settle()
    expect(w.text()).toContain('该路径没有关联的目标对话')
    expect(subPage.value?.view).toBe('path')
    // 「返回列表」= closeSubPage（无 from → 回一级列表）
    const btn = w.findAll('button').find((b) => b.text() === '返回列表')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    await nextTick()
    expect(subPage.value).toBeNull()
    w.unmount()
  })

  it('接口失败 → 错误态给重试，不假开座舱', async () => {
    detailMock.mockRejectedValue(new Error('网络不可达'))
    const w = mountShim()
    await settle()
    expect(w.text()).toContain('路径打开失败')
    expect(w.text()).toContain('网络不可达')
    expect(subPage.value?.view).toBe('path')
    // 重试成功后正常换开
    detailMock.mockResolvedValue({ data: { data: { conversationId: 'gc_9' } } })
    const retry = w.findAll('button').find((b) => b.text() === '重试')
    await retry!.trigger('click')
    await settle()
    expect(subPage.value).toMatchObject({ view: 'session-real', id: 'gc_9', stage: 'path' })
    w.unmount()
  })
})
