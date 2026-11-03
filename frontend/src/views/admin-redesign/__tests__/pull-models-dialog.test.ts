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

function tabOf(wrapper: ReturnType<typeof mountDialog>, label: string) {
  return wrapper.findAll('.pmd-tab').find((t) => t.text().startsWith(label))!
}

async function switchTab(wrapper: ReturnType<typeof mountDialog>, label: string) {
  await tabOf(wrapper, label).trigger('click')
  await nextTick()
}

describe('PullModelsDialog', () => {
  beforeEach(() => { testMock.mockReset() })

  it('按模型名推断能力与用途：思考 / 读图 / 向量 / 重排各有标签与去向提示', async () => {
    const w = mountDialog()
    await open(w)
    expect(w.find('.mk-modal__title').text()).toBe('添加对话模型')
    /* 默认落「可引入」（2026-11-03）：打开就是这一屏能勾的对话模型，已添加与向量/重排不在里面 */
    expect(w.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual([
      'agnes-3.0-flash', 'mimo-v2.5-flash', 'deepseek-r1', 'gpt-4o', 'step-fun/step-1v',
    ])

    const r1 = rowOf(w, 'deepseek-r1')
    expect(r1.text()).toContain('思考')
    expect(r1.text()).toContain('推理强度')
    expect(r1.text()).toContain('新发现')

    expect(rowOf(w, 'gpt-4o').text()).toContain('读图')

    await switchTab(w, '已添加')
    expect(w.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual(['deepseek-v4.1-flash'])
    const added = rowOf(w, 'deepseek-v4.1-flash')
    expect(added.text()).toContain('已添加')
    expect(added.find('input').attributes('disabled')).toBeDefined()

    await switchTab(w, '非对话模型')
    expect(w.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual([
      'BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3',
    ])
    const embedding = rowOf(w, 'BAAI/bge-m3')
    expect(embedding.text()).toContain('建议归入向量模型')
    expect(embedding.find('input').attributes('disabled')).toBeDefined()

    const rerank = rowOf(w, 'BAAI/bge-reranker-v2-m3')
    expect(rerank.text()).toContain('建议归入重排模型')
    expect(rerank.find('input').attributes('disabled')).toBeDefined()
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

  it('页签口径：可引入只数对话模型，已添加与非对话模型互不重叠', async () => {
    const w = mountDialog()
    await open(w)
    expect(w.findAll('.pmd-tab').map((t) => t.text()))
      .toEqual(['可引入 (5)', '已添加 (1)', '非对话模型 (2)'])
    expect(w.text()).not.toContain('推荐预设')

    /* 已添加的模型不再出现在「可引入」这一屏：不用在勾不动的行里扫雷 */
    await switchTab(w, '已添加')
    expect(w.findAll('.pmd-row')).toHaveLength(1)
    expect(w.text()).toContain('deepseek-v4.1-flash')

    await switchTab(w, '非对话模型')
    expect(w.findAll('.pmd-row')).toHaveLength(2)
    expect(w.text()).toContain('BAAI/bge-m3')
    expect(w.text()).toContain('bge-reranker')
  })

  it('页签恒为三项且都可点：0 命中不置灰，改由该分类的空态说明缘由', async () => {
    const w = mountDialog([], '', ['agnes-3.0-flash'])
    await open(w)
    /* 0 命中不再整条抽掉、也不再置灰：页签消失会被读成「这里没有按能力筛选」的筛选维度，
       而置灰只是把同一条信息推给用户去猜 */
    const tabs = w.findAll('.pmd-tab')
    expect(tabs.map((t) => t.text())).toEqual(['可引入 (1)', '已添加 (0)', '非对话模型 (0)'])
    expect(tabs.map((t) => t.attributes('disabled'))).toEqual([undefined, undefined, undefined])
    // 说明文案 2026-11-02 改写：讲清能力标签与「非对话模型」的口径
    expect(w.text()).toContain('判不出的记')
    expect(rowOf(w, 'agnes-3.0-flash').text()).toContain('—')

    await switchTab(w, '已添加')
    expect(w.find('.pmd-empty').text()).toBe('这个供应商还没有已添加的模型')

    await switchTab(w, '非对话模型')
    expect(w.find('.pmd-empty').text()).toBe('上游没有图像、视频或向量模型')
  })

  it('全选作用于当前页签的可见行，勾选不蔓延到别的页签', async () => {
    const w = mountDialog(['deepseek-v4.1-flash'])
    await open(w)
    await w.find('.pmd-filter').setValue('flash')
    await nextTick()
    expect(w.findAll('.pmd-row .pmd-row__id').map((r) => r.text()))
      .toEqual(['agnes-3.0-flash', 'mimo-v2.5-flash'])
    await w.find('.pmd-all input').setValue(true)
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('2')

    /* 已添加的 flash 在另一个页签，勾选碰不到它；该页签没有可勾选行，全选入口整体不出现 */
    await switchTab(w, '已添加')
    const addedRow = rowOf(w, 'deepseek-v4.1-flash')
    expect((addedRow.find('input').element as HTMLInputElement).checked).toBe(false)
    expect(addedRow.find('input').attributes('disabled')).toBeDefined()
    expect(w.find('.pmd-all').exists()).toBe(false)
  })

  it('手动录入是兜底出口：点链接只发事件，不携带勾选', async () => {
    const w = mountDialog()
    await open(w)
    await w.find('.pmd-manual').trigger('click')
    expect(w.emitted('manual')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('无可引入时给该分类的空态且不出现全选；空清单给另一句空态', async () => {
    const w = mount(PullModelsDialog, {
      props: { providerName: '平台', models: ['BAAI/bge-m3'], registered: ['BAAI/bge-m3'] },
      global: { stubs: { teleport: true } },
    })
    await open(w)
    expect(w.find('.pmd-empty').text()).toBe('上游的对话模型都已添加')
    expect(w.find('.pmd-all').exists()).toBe(false)
    expect(w.findAll('.pmd-row')).toHaveLength(0)

    const empty = mount(PullModelsDialog, {
      props: { providerName: '平台', models: [], registered: [] },
      global: { stubs: { teleport: true } },
    })
    await open(empty)
    expect(empty.find('.pmd-empty').text()).toContain('没有拉取到模型')
    expect(empty.find('.pmd-all').exists()).toBe(false)
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
