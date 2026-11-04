/**
 * 上游模型清单（2026-10-28 用户「应用商店级的选择弹窗」）：
 * 单一入口、搜索、能力标签推断、就地测试、手动录入兜底。
 * 2026-11-04 用户「不分什么对话非对话，这个页面就是拉取列表测试添加」：
 * 分类页签与「建议归入向量/重排」一并撤除，清单原样列出。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PullModelsDialog from '../PullModelsDialog.vue'

const { testMock } = vi.hoisted(() => ({ testMock: vi.fn() }))
vi.mock('@/api/adminApi', () => ({
  adminModelProvidersApi: { test: testMock }
}))

const MODELS = [
  'deepseek-v4.1-flash',
  'agnes-3.0-flash',
  'mimo-v2.5-flash',
  'BAAI/bge-m3',
  'BAAI/bge-reranker-v2-m3',
  'deepseek-r1',
  'gpt-4o',
  'step-fun/step-1v',
]

function mountDialog(registered: string[] = ['deepseek-v4.1-flash'], providerId = '', models = MODELS) {
  return mount(PullModelsDialog, {
    props: { providerId, models, registered },
    global: { stubs: { teleport: true } },
  })
}

async function open(wrapper: ReturnType<typeof mountDialog>) {
  (wrapper.vm as unknown as { openWith: () => void }).openWith()
  await nextTick()
  await flushPromises()
}

function rowOf(wrapper: ReturnType<typeof mountDialog>, needle: string) {
  return wrapper.findAll('.pmd-row').find((r) => r.text().includes(needle))!
}

describe('PullModelsDialog', () => {
  beforeEach(() => { testMock.mockReset() })

  it('清单原样列出：已添加的置灰并沉到末尾，不猜能力', async () => {
    const w = mountDialog()
    await open(w)
    expect(w.find('.mk-modal__title').text()).toBe('添加模型')
    // 2026-11-04 用户「不分什么对话非对话，这个页面就是拉取列表测试添加」：8 个上游模型全在
    expect(w.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual([
      'agnes-3.0-flash', 'mimo-v2.5-flash', 'BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3',
      'deepseek-r1', 'gpt-4o', 'step-fun/step-1v', 'deepseek-v4.1-flash',
    ])

    // 2026-11-04 用户「能力特性我们也不知道吧，这个列表并不能获取这些」：
    // `/v1/models` 只回 id，清单里不再出现任何按名字猜出来的能力标签
    expect(w.text()).not.toContain('能力特性')
    expect(w.findAll('.pmd-row__tags, .pmd-chip')).toHaveLength(0)
    expect(w.find('.pmd-cols').text()).toBe('模型标识状态')
    expect(rowOf(w, 'deepseek-r1').text()).not.toContain('思考')
    expect(rowOf(w, 'gpt-4o').text()).not.toContain('读图')
    expect(rowOf(w, 'deepseek-r1').text()).toContain('可添加')

    // 向量 / 重排不再被挡在外面：照样可勾
    const embedding = rowOf(w, 'BAAI/bge-m3')
    expect(embedding.find('input').attributes('disabled')).toBeUndefined()

    const added = rowOf(w, 'deepseek-v4.1-flash')
    expect(added.text()).toContain('已添加')
    expect(added.find('input').attributes('disabled')).toBeDefined()
  })

  it('勾选后确认：按勾选顺序回传，按钮文案带已选数量', async () => {
    const w = mountDialog()
    await open(w)
    await rowOf(w, 'agnes-3.0-flash').find('input').setValue(true)
    await nextTick()
    await rowOf(w, 'mimo-v2.5-flash').find('input').setValue(true)
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('2')

    // 主按钮不再复述已选数（2026-11-03）：同页脚「已选 N 个」已是唯一出口
    const confirm = w.findAll('button').find((b) => b.text().includes('确认引入'))!
    await confirm.trigger('click')
    expect(w.emitted('confirm')?.[0]).toEqual([['agnes-3.0-flash', 'mimo-v2.5-flash']])
  })

  it('没有分类页签，也没有「建议归入哪张卡」的判词', async () => {
    const w = mountDialog()
    await open(w)
    expect(w.find('.pmd-tab').exists()).toBe(false)
    expect(w.find('.pmd-tabs').exists()).toBe(false)
    expect(w.text()).not.toContain('非对话')
    expect(w.text()).not.toContain('建议归入')
    expect(w.text()).not.toContain('不在此添加')
    expect(w.findAll('.pmd-row')).toHaveLength(MODELS.length)
  })

  it('全选只数可添加的行；空清单给空态', async () => {
    const w = mountDialog()
    await open(w)
    // 默认 8 个上游模型里 1 个已添加 → 可添加 7 个
    expect(w.find('.pmd-all').text()).toContain('全选当前可添加的 7 个模型')
    // 能力在哪里填：引入后逐项确认（清单本身不猜）
    expect(w.text()).toContain('引入时会让你逐项确认')

    const empty = mount(PullModelsDialog, {
      props: { models: [], registered: [] },
      global: { stubs: { teleport: true } },
    })
    await open(empty)
    expect(empty.find('.pmd-empty').text()).toContain('没有拉取到模型')
    expect(empty.find('.pmd-all').exists()).toBe(false)
  })

  it('全选只作用于当前搜索结果里的可添加行', async () => {
    const w = mountDialog(['deepseek-v4.1-flash'])
    await open(w)
    await w.find('.pmd-filter').setValue('flash')
    await nextTick()
    expect(w.findAll('.pmd-row .pmd-row__id').map((r) => r.text()))
      .toEqual(['agnes-3.0-flash', 'mimo-v2.5-flash', 'deepseek-v4.1-flash'])
    await w.find('.pmd-all input').setValue(true)
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('2')

    // 已添加的那一行勾不动，也没被全选带上
    const addedRow = rowOf(w, 'deepseek-v4.1-flash')
    expect((addedRow.find('input').element as HTMLInputElement).checked).toBe(false)
    expect(addedRow.find('input').attributes('disabled')).toBeDefined()
  })

  it('手动录入是兜底出口：点链接只发事件，不携带勾选', async () => {
    const w = mountDialog()
    await open(w)
    await w.find('.pmd-manual').trigger('click')
    expect(w.emitted('manual')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeUndefined()
  })

  /* 2026-11-04 用户「这两个拉取，弹窗怎么还不一样呢」：向量 / 重排复用这同一张弹窗，
     single 模式 = 单选、无全选、无手动录入出口、当前在用的那行标「使用中」。 */
  it('单选模式：一个 radio、无全选、无手动录入，当前在用的标「使用中」', async () => {
    const w = mount(PullModelsDialog, {
      props: { title: '添加向量模型', models: ['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3'], registered: ['BAAI/bge-m3'], single: true, allowManual: false, hint: '' },
      global: { stubs: { teleport: true } },
    })
    await open(w)
    expect(w.find('.mk-modal__title').text()).toBe('添加向量模型')
    expect(w.findAll('input[type="radio"]')).toHaveLength(2)
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(w.find('.pmd-all').exists()).toBe(false)
    expect(w.find('.pmd-manual').exists()).toBe(false)
    expect(w.find('.pmd-hint span').exists()).toBe(false)
    expect(rowOf(w, 'BAAI/bge-m3').text()).toContain('使用中')
    expect(rowOf(w, 'BAAI/bge-m3').find('input').attributes('disabled')).toBeDefined()

    // 单选：点第二个就替换第一个
    await rowOf(w, 'BAAI/bge-reranker-v2-m3').find('input').trigger('change')
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('1')
    await w.findAll('.pmd button').find((b) => b.text() === '确认引入')!.trigger('click')
    expect(w.emitted('confirm')?.[0]).toEqual([['BAAI/bge-reranker-v2-m3']])
  })

  it('全部已添加时不出现全选', async () => {
    const all = mount(PullModelsDialog, {
      props: { models: ['BAAI/bge-m3'], registered: ['BAAI/bge-m3'] },
      global: { stubs: { teleport: true } },
    })
    await open(all)
    expect(all.findAll('.pmd-row')).toHaveLength(1)
    expect(all.find('.pmd-row input').attributes('disabled')).toBeDefined()
    expect(all.find('.pmd-all').exists()).toBe(false)
  })

  /* 2026-10-26 用户「拉取模型那里可以测试了」：勾选前就地验一次，
     结果只落本行；点「测试」不得顺带切换勾选。 */
  it('就地测试：成功显耗时、失败显「连接失败」，且不误触勾选', async () => {
    testMock.mockResolvedValueOnce({ data: { data: { durationMs: 845, content: '好的' } } })
    const w = mountDialog([], 'platform')
    await open(w)

    await rowOf(w, 'deepseek-v4.1-flash').find('.pmd-row__test').trigger('click')
    await flushPromises()
    expect(testMock).toHaveBeenCalledWith('platform', { modelId: 'deepseek-v4.1-flash' })
    const okRes = rowOf(w, 'deepseek-v4.1-flash').find('.pmd-row__res')
    expect(okRes.text()).toBe('已连通 · 845ms')
    expect(okRes.classes()).toContain('is-ok')
    expect((rowOf(w, 'deepseek-v4.1-flash').find('input').element as HTMLInputElement).checked).toBe(false)

    testMock.mockRejectedValueOnce({ message: 'HTTP 401' })
    await rowOf(w, 'agnes-3.0-flash').find('.pmd-row__test').trigger('click')
    await flushPromises()
    const bad = rowOf(w, 'agnes-3.0-flash').find('.pmd-row__res')
    expect(bad.text()).toBe('连接失败')
    expect(bad.classes()).toContain('is-bad')
    expect(bad.attributes('title')).toContain('401')
  })

  it('未传 providerId 时不渲染测试动作（独立复用时保持纯勾选）', async () => {
    const w = mountDialog()
    await open(w)
    expect(w.find('.pmd-row__test').exists()).toBe(false)
  })
})
