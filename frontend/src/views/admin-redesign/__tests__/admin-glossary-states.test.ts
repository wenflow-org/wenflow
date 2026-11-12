/**
 * 术语表数据态守卫（截图评审 R1/R2/R6）：
 * - 接口失败时不得把半套词条当正常结果渲染（空分组会被读成「没有这个词条」）
 * - 分类下拉的数字相加必须等于「全部」，文档链接也要有对应类目
 * - 同一词条不在同一页出现两次（override-record 同时是健康语义位与健康检查项）
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AdminGlossary from '../AdminGlossary.vue'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
vi.mock('@/api/adminApi', () => ({ adminGlossaryApi: { get: getMock } }))

const payload = {
  promptRoles: [
    { id: 'hard-required', label: '必填', hint: '缺了就无法推进' },
    { id: 'soft-info', label: '可选补充', hint: '拿到更好' },
    { id: 'hidden-inference', label: '隐式推断', hint: '内部推理' },
    { id: 'public-reply', label: '公开回复', hint: '给用户看' },
    { id: 'proposal-output', label: '方案产出', hint: '确认的结论' },
    { id: 'derived-presentation', label: '派生展示', hint: '界面展示用' },
    { id: 'control-signal', label: '控制信号', hint: '流程控制用' },
  ],
  completionStates: [
    { status: 'draft', label: '草稿', short: '草稿', hint: '仅登记' },
    { status: 'handler-ready', label: 'handler 就绪', short: 'handler', hint: '入口已注册' },
    { status: 'core-ready', label: 'core 就绪', short: 'core', hint: '核心文件就绪' },
    { status: 'fields-synced', label: '字段已同步', short: '同步', hint: '数据流已打通' },
    { status: 'live', label: '已上线', short: 'live', hint: 'ACTIVE 生效' },
  ],
  semantics: [
    { id: 'baseline-drift', label: '基准漂移', hint: '偏离基准' },
    { id: 'consistency', label: '一致性偏差', hint: '两边对等' },
    { id: 'override-record', label: '覆盖记录', hint: 'admin 手工改过的行' },
    { id: 'runtime-info', label: '运行时观测', hint: '只读观察' },
  ],
  stages: Array.from({ length: 5 }, (_, i) => ({ id: `stage-${i}`, label: `阶段${i}`, hint: '说明' })),
  terms: [
    ...Array.from({ length: 17 }, (_, i) => ({ term: `概念${i}`, def: '定义', category: 'concept' as const })),
    ...Array.from({ length: 15 }, (_, i) => ({ term: `健康项${i}`, def: '定义', category: 'health' as const })),
    { term: 'override-record', def: 'admin 手工覆盖行的清单', category: 'health' as const },
  ],
  docs: [
    { title: '编排文件运营阅读指南', path: 'prompts/orchestration/_README.md', desc: '怎么看字段路由' },
    { title: 'Skill 协议 V4', path: 'doc/SKILL_PROTOCOL_V4.md', desc: '协议定义' },
  ],
}

async function mountGlossary() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/glossary', component: AdminGlossary }],
  })
  await router.push('/admin/glossary')
  await router.isReady()
  const w = mount(AdminGlossary, { global: { plugins: [router] } })
  await flushPromises()
  await flushPromises()
  return w
}

describe('术语表数据态', () => {
  it('接口失败时只报错误，不渲染词条分组与分类计数', async () => {
    getMock.mockRejectedValueOnce(new Error('接口不可用'))
    const w = await mountGlossary()
    expect(w.text()).toContain('术语表加载失败')
    expect(w.text()).toContain('不代表没有这个词条')
    expect(w.findAll('.mg__grid').length).toBe(0)
    expect(w.find('.mk-pillselect').exists()).toBe(false)
    w.unmount()
  })

  it('分类下拉各段相加等于「全部」，同名词条只出现一次', async () => {
    getMock.mockResolvedValueOnce({ data: { data: payload } })
    const w = await mountGlossary()
    const nums = w.findAll('.mk-listbox-opt').map((o) => Number(/（(\d+)）/.exec(o.text())?.[1]))
    expect(nums.length).toBeGreaterThan(1)
    expect(nums[0]).toBe(nums.slice(1).reduce((a, b) => a + b, 0))
    const names = w.findAll('.mg__term-name').map((n) => n.text())
    expect(names.filter((t) => t.includes('override-record')).length).toBe(1)
    w.unmount()
  })

  it('段标题用 h2（h1 之下不跳级），目录不列 0 条分组', async () => {
    // docs 置空：目录里若仍出现「文档链接」，点进去会落在不渲染的 section 上（点了没反应）
    getMock.mockResolvedValueOnce({ data: { data: { ...payload, docs: [] } } })
    const w = await mountGlossary()
    const titles = w.findAll('.mg__section-title')
    expect(titles.length).toBeGreaterThan(0)
    for (const t of titles) expect(t.element.tagName).toBe('H2')
    const toc = w.findAll('.mg__toc-item').map((a) => a.text())
    expect(toc.length).toBeGreaterThan(0)
    expect(toc.some((t) => t.includes('文档链接'))).toBe(false)
    w.unmount()
  })

  it('搜索无命中走共享空态（MkEmptyState），清空搜索后词条回来', async () => {
    getMock.mockResolvedValueOnce({ data: { data: payload } })
    const w = await mountGlossary()
    await w.find('input[type="search"]').setValue('不存在的术语')
    await flushPromises()
    expect(w.find('.mk-empty').exists()).toBe(true)
    expect(w.text()).toContain('没有匹配「不存在的术语」的词条')
    await w.find('.mk-empty button').trigger('click')
    await flushPromises()
    expect((w.find('input[type="search"]').element as HTMLInputElement).value).toBe('')
    expect(w.find('.mk-empty').exists()).toBe(false)
    expect(w.findAll('.mg__term').length).toBeGreaterThan(0)
    w.unmount()
  })
})