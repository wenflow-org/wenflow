/**
 * 系统工具页原型对齐护栏（2026-10-01 用户点名师查「系统工具完全不一样」后的复刻收口）：
 * 原型 renderOpsCenter（newui index.html 1848-1886）骨架 = pageTitle(副标+右上主钮)
 * → 单张卡内「.tabs 页签 + 页签体」；数据导出页签 = 范围 chips 多选 + 右对齐「开始导出」。
 * 后端导出接口不支持时间范围 / JSONL 格式，对应控件不得渲染（不暗示不存在的功能）。
 * 2026-10-04 修订（P3-33/34，全站设计评审 4.3）：页头「导出数据」主钮做的是 tab 导航、
 * 与页签栏完全重复入口 → 撤（页签即唯一入口）；页签「会话安全」未知态角标「—」→「待访问」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const apiObject = vi.hoisted(() => {
  const ok = <T,>(data: T) => ({ data: { data } })
  return {
    adminDevtoolsApi: {
      advanceTime: vi.fn(async () => ok({})),
      getOutboxDead: vi.fn(async () => ok({ deadCount: 0, items: [] })),
      requeueOutboxDead: vi.fn(async () => ok({ requeued: 0 })),
    },
    adminAxios: { get: vi.fn(async () => ({ headers: {}, data: new Blob(['x']) })) },
  }
})

vi.mock('@/api/adminApi', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>()
  return { ...orig, adminDevtoolsApi: apiObject.adminDevtoolsApi, adminAxios: apiObject.adminAxios }
})

import OpsCenter from '../OpsCenter.vue'

async function mountPage(route = '/admin/ops-center') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div/>' } }],
  })
  router.push(route)
  await router.isReady()
  const wrapper = mount(OpsCenter, {
    global: { plugins: [router], stubs: { MkLoading: true, MkEmptyState: true, SessionSecurity: true } },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('系统工具页原型对齐', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('页头有副标；「导出数据」页头主钮已撤（P3-33：主钮只做 tab 导航，页签即入口）；状态条（mk-status）退役', async () => {
    const w = await mountPage()
    expect(w.find('.mk-pagehead__sub').text()).toContain('数据导出')
    expect(
      w.findAll('button').find((b) => b.text() === '导出数据'),
      '页头不再有「导出数据」主钮——导出入口唯一在页签栏'
    ).toBeUndefined()
    expect(w.find('.mk-status').exists(), '本页无状态条（信息各归其位）').toBe(false)
  })

  it('页签「会话安全」未访问角标显「待访问」弱灰小字（P3-34：原「—」孤悬破折号像渲染残留）', async () => {
    const w = await mountPage()
    const tab = w.findAll('.tabs .tab').find((t) => t.text().includes('会话安全'))
    expect(tab?.text()).toContain('待访问')
    expect(tab?.text()).not.toContain('—')
  })

  it('页签在单张卡内（tabs 与页签体同卡；页签体内嵌工具卡=原型 tools 卡片格形态）', async () => {
    const w = await mountPage()
    const card = w.find('.oc-card')
    expect(card.exists()).toBe(true)
    expect(card.find('.tabs .tab').exists()).toBe(true)
    expect(card.find('.oc-card__body').exists()).toBe(true)
    expect(card.find('.oc-card__body .mk-card').exists(), '工具页签体内嵌工具卡（原型卡片格）').toBe(true)
    /* 卡外不得再有游离页签条（旧骨架 tabs 悬在卡外） */
    expect(w.findAll('.tabs').length).toBe(1)
  })

  it('数据导出 = 范围 chips 多选 + 「开始导出」；无选中时主钮禁用', async () => {
    const w = await mountPage('/admin/ops-center?tab=export')
    const chips = w.findAll('.mk-pill')
    expect(chips.length, '六个导出范围 chips').toBe(6)
    const go = w.findAll('button').find((b) => b.text() === '开始导出')
    expect(go?.attributes('disabled')).toBeDefined()
    await chips[0]!.trigger('click')
    await chips[1]!.trigger('click')
    expect(w.findAll('.mk-pill.mk-pill--active').map((c) => c.text())).toEqual(['用户', '教学会话'])
    expect(w.text()).toContain('已选 2 项')
    const go2 = w.findAll('button').find((b) => b.text() === '开始导出')
    expect(go2?.attributes('disabled')).toBeUndefined()
  })

  it('后端不支持的导出控件（时间范围输入 / JSONL 格式单选）不渲染', async () => {
    const w = await mountPage('/admin/ops-center?tab=export')
    expect(w.text()).not.toContain('JSONL')
    expect(w.findAll('input[type="datetime-local"], input[placeholder*="时间"]').length).toBe(0)
  })
})
