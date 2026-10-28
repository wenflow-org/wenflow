/**
 * 模型资产选择器（2026-10-28 用户「应用商店级的选择弹窗」）：
 * 单一入口、搜索与分类页签、能力标签推断、向量/重排建议分流、手动录入兜底。
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
    props: { providerName: '平台', providerId, models, registered },
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

  it('按模型名推断能力与用途：思考 / 读图 / 向量 / 重排各有标签与去向提示', async () => {
    const w = mountDialog()
    await open(w)
    expect(w.findAll('.pmd-row')).toHaveLength(MODELS.length)
    expect(w.find('.mk-modal__title').text()).toBe('添加对话模型')

    const r1 = rowOf(w, 'deepseek-r1')
    expect(r1.text()).toContain('思考')
    expect(r1.text()).toContain('推理强度')
    expect(r1.text()).toContain('新发现')

    const gpt = rowOf(w, 'gpt-4o')
    expect(gpt.text()).toContain('读图')

    const embedding = rowOf(w, 'BAAI/bge-m3')
    expect(embedding.text()).toContain('建议归入向量模型')
    expect(embedding.find('input').attributes('disabled')).toBeDefined()

    const rerank = rowOf(w, 'BAAI/bge-reranker-v2-m3')
    expect(rerank.text()).toContain('建议归入重排模型')
    expect(rerank.find('input').attributes('disabled')).toBeDefined()

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

    const confirm = w.findAll('button').find((b) => b.text().includes('确认引入（已选 2）'))!
    await confirm.trigger('click')
    expect(w.emitted('confirm')?.[0]).toEqual([['agnes-3.0-flash', 'mimo-v2.5-flash']])
  })

  it('分类页签：思考与读图只留推断命中的模型', async () => {
    const w = mountDialog()
    await open(w)
    const tab = (label: string) => w.findAll('.pmd-tab').find((t) => t.text().startsWith(label))!

    expect(tab('全部').text()).toContain('8')
    expect(tab('深度思考/推理').text()).toContain('1')
    expect(tab('多模态读图').text()).toContain('2')
    expect(w.text()).not.toContain('推荐预设')

    await tab('深度思考/推理').trigger('click')
    await nextTick()
    expect(w.findAll('.pmd-row')).toHaveLength(1)
    expect(w.findAll('.pmd-row')[0].text()).toContain('deepseek-r1')

    await tab('多模态读图').trigger('click')
    await nextTick()
    expect(w.findAll('.pmd-row').map((r) => r.text())).toHaveLength(2)
    expect(w.text()).toContain('gpt-4o')
    expect(w.text()).toContain('step-1v')
  })

  it('分类页签 0 命中时隐藏，并说明能力标签可能为空', async () => {
    const w = mountDialog([], '', ['agnes-3.0-flash'])
    await open(w)
    expect(w.findAll('.pmd-tab').map((t) => t.text())).toEqual(['全部 (1)'])
    expect(w.text()).toContain('推断不出的留空')
    expect(rowOf(w, 'agnes-3.0-flash').text()).toContain('—')
  })

  it('全选作用于当前分类里可添加的对话模型，已添加与向量/重排不勾', async () => {
    const w = mountDialog(['deepseek-v4.1-flash', 'agnes-3.0-flash'])
    await open(w)
    await w.find('.pmd-filter').setValue('flash')
    await nextTick()
    const rows = w.findAll('.pmd-row')
    expect(rows).toHaveLength(3)
    await w.find('.pmd-all input').setValue(true)
    await nextTick()
    // 勾选后列表会重绘，旧 DOMWrapper 失效：重新查询再读 checked
    const checks = w
      .findAll('.pmd-row')
      .map((r) => (r.find('input').element as HTMLInputElement).checked)
    expect(checks).toEqual([false, false, true])
    expect(w.find('.pmd-foot__count').text()).toContain('1')
  })

  it('手动录入是兜底出口：点链接只发事件，不携带勾选', async () => {
    const w = mountDialog()
    await open(w)
    await w.find('.pmd-manual').trigger('click')
    expect(w.emitted('manual')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('全部不可添加时全选禁用；空清单给空态', async () => {
    const w = mount(PullModelsDialog, {
      props: { providerName: '平台', models: ['BAAI/bge-m3'], registered: ['BAAI/bge-m3'] },
      global: { stubs: { teleport: true } },
    })
    await open(w)
    expect(w.findAll('.pmd-row')).toHaveLength(1)
    expect(w.find('.pmd-all input').attributes('disabled')).toBeDefined()

    const empty = mount(PullModelsDialog, {
      props: { providerName: '平台', models: [], registered: [] },
      global: { stubs: { teleport: true } },
    })
    await open(empty)
    expect(empty.find('.pmd-empty').text()).toContain('没有拉取到模型')
    expect(empty.find('.pmd-all input').attributes('disabled')).toBeDefined()
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
