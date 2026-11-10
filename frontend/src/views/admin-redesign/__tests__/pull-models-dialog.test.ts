/**
 * 上游模型清单（2026-10-28 用户「应用商店级的选择弹窗」）：
 * 单一入口、搜索、预判标签、就地测试、手动录入兜底。
 * 2026-11-04 用户「不分什么对话非对话，这个页面就是拉取列表测试添加」：
 * 分类页签与「建议归入向量/重排」一并撤除，清单原样列出。
 * 2026-11-09 用户走查（图 2）：满屏绿色「可添加」既无信息量又与「已添加」打架。
 * 现在默认只看「未添加」，中间列改成**预判标签**，全选移到表头第一列，
 * 相关断言按新形态重写（旧断言钉的是 `.pmd-all` 尾行 + 每行一枚「可添加」）。
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

const rowIds = (wrapper: ReturnType<typeof mountDialog>) =>
  wrapper.findAll('.pmd-row .pmd-row__id').map((r) => r.text())

/** 切视图（未添加 / 已添加 / 全部）：按分段控件的可见文案点 */
async function switchView(wrapper: ReturnType<typeof mountDialog>, prefix: string) {
  const item = wrapper.findAll('.pmd-view .mk-seg__item').find((b) => b.text().startsWith(prefix))!
  await item.trigger('click')
  await nextTick()
}

describe('PullModelsDialog', () => {
  beforeEach(() => { testMock.mockReset() })

  it('默认只看未添加：已添加的在「已添加 / 全部」里，且置灰不可勾', async () => {
    const w = mountDialog()
    await open(w)
    expect(w.find('.mk-modal__title').text()).toBe('添加模型')
    // 默认「未添加」：上游 8 个里 1 个已添加 → 列表 7 行，且已添加那行不出现
    expect(rowIds(w)).toEqual([
      'agnes-3.0-flash', 'mimo-v2.5-flash', 'BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3',
      'deepseek-r1', 'gpt-4o', 'step-fun/step-1v',
    ])
    expect(w.find('.pmd-view').text()).toContain('未添加 (7)')
    expect(w.find('.pmd-view').text()).toContain('已添加 (1)')

    // 已添加视图：只剩那一行，勾不动
    await switchView(w, '已添加')
    expect(rowIds(w)).toEqual(['deepseek-v4.1-flash'])
    const added = rowOf(w, 'deepseek-v4.1-flash')
    expect(added.text()).toContain('已添加')
    expect(added.find('input').attributes('disabled')).toBeDefined()

    // 全部视图：8 行，已添加的沉到末尾
    await switchView(w, '全部')
    expect(rowIds(w)).toEqual([
      'agnes-3.0-flash', 'mimo-v2.5-flash', 'BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3',
      'deepseek-r1', 'gpt-4o', 'step-fun/step-1v', 'deepseek-v4.1-flash',
    ])

    // 每次开窗都回到「未添加」（默认视图是「这次能挂什么」）
    await open(w)
    expect(rowIds(w)).not.toContain('deepseek-v4.1-flash')
  })

  it('中间列是预判标签（列头就写明是预判），不再满屏「可添加」', async () => {
    const w = mountDialog([], '', MODELS)
    await open(w)
    // 表头：勾选列 + 四列，全选已移到表头第一列
    expect(w.find('.pmd-cols').text()).toBe('模型标识预判标签连通状态操作')
    expect(w.find('.pmd-cols__pick input').exists()).toBe(true)

    // 预判标签：非对话给用途，对话给能力，判不出的对话模型给「对话」
    expect(rowOf(w, 'BAAI/bge-m3').find('.pmd-row__tags').text()).toBe('向量')
    expect(rowOf(w, 'BAAI/bge-reranker-v2-m3').find('.pmd-row__tags').text()).toBe('重排')
    expect(rowOf(w, 'deepseek-r1').find('.pmd-row__tags').text()).toContain('思考')
    expect(rowOf(w, 'gpt-4o').find('.pmd-row__tags').text()).toContain('视觉')
    expect(rowOf(w, 'agnes-3.0-flash').find('.pmd-row__tags').text()).toBe('对话')

    // 「可添加」整列退场（连文字都不该留在正文里），能力特性也不回来
    expect(w.text()).not.toContain('可添加')
    expect(w.text()).not.toContain('能力特性')
    expect(w.findAll('.pmd-chip')).toHaveLength(0)
  })

  it('勾选后确认：按勾选顺序回传，底部只留已选数 + 取消 + 确认引入', async () => {
    const w = mountDialog()
    await open(w)
    await rowOf(w, 'agnes-3.0-flash').find('input').setValue(true)
    await nextTick()
    await rowOf(w, 'mimo-v2.5-flash').find('input').setValue(true)
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('2')

    // 主按钮不再复述已选数：页脚「已选 N 个」已是唯一出口
    const confirm = w.findAll('button').find((b) => b.text().includes('确认引入'))!
    await confirm.trigger('click')
    expect(w.emitted('confirm')?.[0]).toEqual([['agnes-3.0-flash', 'mimo-v2.5-flash']])
  })

  it('没有分类页签，也没有「建议归入哪张卡」的判词', async () => {
    const w = mountDialog([], '', MODELS)
    await open(w)
    expect(w.find('.pmd-tab').exists()).toBe(false)
    expect(w.find('.pmd-tabs').exists()).toBe(false)
    expect(w.text()).not.toContain('非对话')
    expect(w.text()).not.toContain('建议归入')
    expect(w.text()).not.toContain('不在此添加')
    expect(w.findAll('.pmd-row')).toHaveLength(MODELS.length)
  })

  it('表头全选只数可添加的行；空清单给空态且勾不动', async () => {
    const w = mountDialog()
    await open(w)
    // 默认 8 个上游模型里 1 个已添加 → 可添加 7 个
    expect(w.find('.pmd-cols__pick input').attributes('aria-label')).toBe('全选当前可添加的 7 个模型')
    // 能力在哪里改：引入后点「配置」（清单本身不猜；不再有逐项确认层）
    expect(w.text()).toContain('引入后可点该行的「配置」调整')

    await w.find('.pmd-cols__pick input').setValue(true)
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('7')

    const empty = mount(PullModelsDialog, {
      props: { models: [], registered: [] },
      global: { stubs: { teleport: true } },
    })
    await open(empty)
    expect(empty.find('.pmd-empty').text()).toContain('没有拉取到模型')
    // 空清单：表头那枚全选点不动，标题也说明没有可添加的
    expect(empty.find('.pmd-cols__pick input').attributes('disabled')).toBeDefined()
    expect(empty.find('.pmd-cols__pick').attributes('title')).toBe('当前列表没有可添加的模型')
  })

  it('全选只作用于当前搜索结果里的可添加行', async () => {
    const w = mountDialog(['deepseek-v4.1-flash'])
    await open(w)
    await w.find('.pmd-filter').setValue('flash')
    await nextTick()
    expect(rowIds(w)).toEqual(['agnes-3.0-flash', 'mimo-v2.5-flash'])
    await w.find('.pmd-cols__pick input').setValue(true)
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('2')

    // 切到「全部」，已添加那行仍在搜索命中里，但它勾不动、也没被全选带上
    await switchView(w, '全部')
    const addedRow = rowOf(w, 'deepseek-v4.1-flash')
    expect((addedRow.find('input').element as HTMLInputElement).checked).toBe(false)
    expect(addedRow.find('input').attributes('disabled')).toBeDefined()
  })

  it('分段控件兑现 tablist 键盘契约：roving tabindex + 方向键切视图', async () => {
    const w = mountDialog()  // 已添加 deepseek-v4.1-flash
    await open(w)
    expect(w.findAll('.pmd-view .mk-seg__item').map((b) => b.attributes('tabindex')))
      .toEqual(['0', '-1', '-1'])

    await w.findAll('.pmd-view .mk-seg__item')[0].trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect(w.findAll('.pmd-view .mk-seg__item').map((b) => b.attributes('aria-selected')))
      .toEqual(['false', 'true', 'false'])
    expect(w.findAll('.pmd-view .mk-seg__item')[1].attributes('tabindex')).toBe('0')
    // 真的换了视图：只剩已添加的那一行
    expect(w.findAll('.pmd-row .pmd-row__id').map((r) => r.text())).toEqual(['deepseek-v4.1-flash'])

    await w.findAll('.pmd-view .mk-seg__item')[1].trigger('keydown', { key: 'Home' })
    await nextTick()
    expect(w.findAll('.pmd-view .mk-seg__item')[0].attributes('aria-selected')).toBe('true')
    expect(w.findAll('.pmd-row')).toHaveLength(7)
  })

  it('手动录入是兜底出口：点链接只发事件，不携带勾选', async () => {
    const w = mountDialog()
    await open(w)
    await w.find('.pmd-manual').trigger('click')
    expect(w.emitted('manual')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeUndefined()
  })

  /* 2026-11-04 用户「这两个拉取，弹窗怎么还不一样呢」：向量 / 重排复用这同一张弹窗。
     2026-11-05 模型池上线后它不再是单选——一次可以勾几个进池子，
     所以这里钉的是「同形状 + 已有模型标已添加 + 不给手动录入」。 */
  it('向量 / 重排也用这张弹窗：标题带上文、多选、已有模型标「已添加」、不给手动录入', async () => {
    const w = mount(PullModelsDialog, {
      props: { title: '添加向量模型（Embedding）', models: ['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3'], registered: ['BAAI/bge-m3'], allowManual: false, hint: '' },
      global: { stubs: { teleport: true } },
    })
    await open(w)
    expect(w.find('.mk-modal__title').text()).toBe('添加向量模型（Embedding）')
    // 与对话卡同一张弹窗：勾选框 + 表头全选、没有 radio；hint 空串时说明行整条不渲染
    expect(w.findAll('input[type="radio"]')).toHaveLength(0)
    expect(w.findAll('.pmd-row input[type="checkbox"]')).toHaveLength(1)
    expect(w.find('.pmd-cols__pick input').exists()).toBe(true)
    expect(w.find('.pmd-hint').exists()).toBe(false)
    expect(w.find('.pmd-manual').exists()).toBe(false)

    // 已添加的那个在「未添加」里不出现；勾上剩下那个就回传
    await rowOf(w, 'BAAI/bge-reranker-v2-m3').find('input').setValue(true)
    await nextTick()
    expect(w.find('.pmd-foot__count').text()).toContain('1')
    await w.findAll('.pmd button').find((b) => b.text() === '确认引入')!.trigger('click')
    expect(w.emitted('confirm')?.[0]).toEqual([['BAAI/bge-reranker-v2-m3']])
  })

  /* 2026-11-05 合并弹窗：连接段由宿主注入，弹窗只负责标题下那行读数与本段动作。 */
  /* 2026-11-07：弹窗只做「搜索并勾选模型」——连接回页顶的「服务连接」卡，
     弹窗里既没有 conn 槽也没有标题下那行连接读数（两处同一事实会互相打架）。 */
  it('弹窗不含连接段与连接读数：连接只属于页顶那张卡', async () => {
    const w = mount(PullModelsDialog, {
      props: { models: ['m-1'], registered: [] },
      global: { stubs: { teleport: true } },
    })
    await open(w)
    expect(w.find('.pmd-conn').exists()).toBe(false)
    expect(w.find('.pmd-head__state').exists()).toBe(false)
    // 标题行只剩「标题 + 关闭」两件事，没有标题下方的读数行
    expect(w.find('.mk-modal__head').text()).toBe('添加模型✕')
  })

  /* 合并弹窗后「获取模型 / 重新获取」在弹窗里：拉取归宿主（它持有地址与密钥），
     弹窗只发意图；拉取中与过期时清单区说清状态，确认按钮点不动。 */
  it('「获取模型」只发 refetch；拉取中与过期时清单区说清状态', async () => {
    const w = mount(PullModelsDialog, {
      props: { models: [], registered: [] },
      global: { stubs: { teleport: true } },
    })
    await open(w)
    await w.findAll('.pmd-toolbar button').find((b) => b.text() === '获取模型')!.trigger('click')
    expect(w.emitted('refetch')).toHaveLength(1)

    await w.setProps({ loading: true })
    expect(w.find('.pmd-list').text()).toContain('正在向上游拉取模型清单')
    // 拉取中不摆出旧行，确认按钮也点不动
    expect(w.findAll('.pmd-row')).toHaveLength(0)
    expect(w.findAll('.pmd-foot button').find((b) => b.text() === '确认引入')!.attributes('disabled')).toBeDefined()

    await w.setProps({ loading: false, error: '连接被拒绝' })
    expect(w.find('.pmd-empty--bad').text()).toBe('连接被拒绝')

    await w.setProps({ error: '', models: ['m-1', 'm-2'], stale: true })
    expect(w.find('.pmd-list--stale').text()).toContain('先点「重新获取」')
    expect(w.findAll('.pmd-foot button').find((b) => b.text() === '确认引入')!.attributes('disabled')).toBeDefined()
  })

  it('全部已添加时空态说明「都已添加」，表头全选点不动', async () => {
    const all = mount(PullModelsDialog, {
      props: { models: ['BAAI/bge-m3'], registered: ['BAAI/bge-m3'] },
      global: { stubs: { teleport: true } },
    })
    await open(all)
    expect(all.findAll('.pmd-row')).toHaveLength(0)
    expect(all.find('.pmd-empty').text()).toBe('上游模型都已添加')
    expect(all.find('.pmd-cols__pick input').attributes('disabled')).toBeDefined()

    await switchView(all, '已添加')
    expect(all.findAll('.pmd-row')).toHaveLength(1)
    expect(all.find('.pmd-row input').attributes('disabled')).toBeDefined()
  })

  /* 2026-10-26 用户「拉取模型那里可以测试了」：勾选前就地验一次，
     结果只落本行；点「测试」不得顺带切换勾选。 */
  it('就地测试：成功显耗时、失败显「连接失败」（原因进 title），且不误触勾选', async () => {
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
