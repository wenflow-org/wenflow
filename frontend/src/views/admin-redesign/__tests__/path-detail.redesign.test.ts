/**
 * PathDetail 路径详情二级页（原型 renderPathDetail / openTaskDetail 的落点，2026-10-01 新建）。
 *
 * 断言 = 原型版式的每一块 + 数据诚实性：
 *  - hero（路头像 / 标题 / 学习者·阶段·更新副文 / 状态 + 当前阶段 pills）
 *  - statstrip（阶段/任务/时长/更新四个真实读数）
 *  - 总体进度（meterrow + mono % + meter 条）
 *  - stagecard 手风琴（默认首阶段展开、点击头切换）+ taskrow 三态 pill
 *  - 任务详情三段式弹层（序号圆 + 任务名 + 阶段名 / 状态 + 真实事实 / 关闭），
 *    并显式断言原型有而接口没有的「验收点 / 关联产出 / 学习证据」不出现。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PathDetail from '../PathDetail.vue'
import { subPage, closeSubPage } from '../store'

const detailMock = vi.hoisted(() => vi.fn())
const archiveMock = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const restoreMock = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('@/api/adminApi', () => ({
  adminLearningContentApi: {
    getPathDetail: detailMock,
    archivePath: archiveMock,
    restorePath: restoreMock
  }
}))

vi.mock('../live', () => ({
  timeAgo: (v?: string | null) => (v ? '3 天前' : '—'),
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  shortId: (id: string, h: number, t: number) => (id ? `${id.slice(0, h)}…${id.slice(-t)}` : id),
  liveAnnouncements: { value: [] }
}))

/** 详情契约 = 后端 findLearningPathDetail 原行（users 关系字段名 + milestones.subtasks select） */
const detail = {
  id: 'lp_1',
  title: '数据分析入门',
  subject: '数据分析入门',
  status: 'active',
  description: '从零开始建立数据分析的最小可用系统',
  estimatedHours: 12,
  totalMilestones: 3,
  completedMilestones: 1,
  updatedAt: '2026-09-28T00:00:00Z',
  users: { id: 'u_1', name: '张三', email: 'zs@wenflow.local', isVirtualLearner: false },
  milestones: [
    {
      id: 'm1',
      stageNumber: 1,
      title: '澄清目标',
      status: 'completed',
      estimatedHours: 4,
      description: '把真实问题写成一句话',
      subtasks: [
        { id: 't1', title: '写下真实问题', status: 'completed', taskType: 'reflection', estimatedMinutes: 30, completedAt: '2026-09-01T00:00:00Z', cognitiveLoad: 'low' },
        { id: 't2', title: '盘点已有基础', status: 'completed', taskType: 'practice', estimatedMinutes: 45, cognitiveLoad: 'medium' }
      ]
    },
    {
      id: 'm2',
      stageNumber: 2,
      title: '搭建最小系统',
      status: 'in_progress',
      estimatedHours: 5,
      subtasks: [
        { id: 't3', title: '选择收集入口', status: 'in_progress', taskType: 'practice', estimatedMinutes: 20, cognitiveLoad: 'medium' },
        { id: 't4', title: '定义归档规则', status: 'todo', taskType: 'acquire', estimatedMinutes: 30, cognitiveLoad: 'high' }
      ]
    },
    { id: 'm3', stageNumber: 3, title: '建立复盘机制', status: 'locked', estimatedHours: 3, subtasks: [] }
  ]
}

function mountPage() {
  subPage.value = { view: 'path', id: 'lp_1' }
  return mount(PathDetail)
}

beforeEach(() => {
  detailMock.mockResolvedValue({ data: { data: detail } })
})
afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  closeSubPage()
})

describe('PathDetail 路径详情二级页（renderPathDetail 落点）', () => {
  it('hero：路头像 + 标题 + 学习者/阶段/更新副文 + 状态与当前阶段 pills', async () => {
    const w = mountPage()
    await flushPromises()
    await nextTick()

    expect(w.find('.mk-hero__avatar').text()).toBe('路')
    expect(w.find('.mk-hero__title').text()).toBe('数据分析入门')
    const sub = w.find('.mk-hero__sub').text()
    expect(sub).toContain('学习者 张三')
    expect(sub).toContain('1 / 3 阶段完成')
    expect(sub).toContain('最近更新 3 天前')

    const pills = w.findAll('.mk-hero__pills .mk-badge').map((b) => b.text())
    expect(pills[0]).toBe('学习中')
    // 当前阶段 = 优先进行中（里程碑 status=in_progress）
    expect(pills[1]).toBe('当前：搭建最小系统')
    // 预计时长原在 statstrip，撤带后收进 pills（fixture estimatedHours=12）
    expect(pills[2]).toBe('预计 ~12h')

    // hero actions：真实能力（下线路径 / 刷新 / 查看学习者），不搬导出/重规划假按钮
    const actions = w.findAll('.mk-hero__actions button').map((b) => b.text())
    expect(actions).toEqual(['下线路径', '刷新', '查看学习者 →'])

    w.unmount()
  })

  it('总体进度卡：任务完成数 + 33% meter（真实里程碑派生）；statstrip 已撤（2026-10-02 用户拍板，原型路径详情无此带）', async () => {
    const w = mountPage()
    await flushPromises()
    await nextTick()

    // 反向断言：第二统计带不再渲染（阶段完成/最近更新已在 hero 副文，不再复读）
    expect(w.find('.statstrip').exists()).toBe(false)
    expect(w.findAll('.statstrip__label').length).toBe(0)

    // 总体进度卡：meterrow「总体进度」+ 任务完成数（原 statstrip 唯一不重复读数）+ 33% meter
    expect(w.find('.pd-meterrow').text()).toContain('总体进度')
    expect(w.find('.pd-meterrow__tasks').text()).toBe('任务 2 / 4')
    expect(w.find('.pd-meterrow__num').text()).toBe('33%')
    expect((w.find('.pd-meter .mk-minibar__fill').element as HTMLElement).style.width).toBe('33%')

    w.unmount()
  })

  it('stagecard 手风琴：默认首阶段展开、点击头切换；taskrow 三态 pill 与修饰类', async () => {
    const w = mountPage()
    await flushPromises()
    await nextTick()

    const stages = w.findAll('.pd-stage')
    expect(stages.length).toBe(3)
    // 阶段头：序号圆（真实 stageNumber）/ 阶段名 / X-Y 任务 / 状态 pill
    const heads = w.findAll('.pd-stage__head')
    expect(heads[0].find('.pd-stage__n').text()).toBe('1')
    expect(heads[0].text()).toContain('澄清目标')
    expect(heads[0].text()).toContain('2 / 2 任务')
    expect(heads[0].find('.mk-badge').text()).toBe('已完成')
    expect(heads[1].find('.mk-badge').text()).toBe('进行中')
    expect(heads[2].find('.mk-badge').text()).toBe('未解锁')

    // 默认仅首阶段展开（原型 state.expanded.stage = 0）
    expect(w.findAll('.pd-stage__body').length).toBe(1)
    expect(stages[0].find('.pd-stage__body').exists()).toBe(true)
    expect(heads[0].attributes('aria-expanded')).toBe('true')

    // 点击第二阶段头 → 单开切换
    await heads[1].trigger('click')
    expect(w.findAll('.pd-stage__body').length).toBe(1)
    expect(stages[0].find('.pd-stage__body').exists()).toBe(false)
    expect(stages[1].find('.pd-stage__body').exists()).toBe(true)
    expect(w.findAll('.pd-stage__head')[1].attributes('aria-expanded')).toBe('true')

    // 再点同一头 → 收起（切换语义）
    await w.findAll('.pd-stage__head')[1].trigger('click')
    expect(w.findAll('.pd-stage__body').length).toBe(0)

    // taskrow：完成态修饰 + ok pill；进行中 info；未开始 mute
    await heads[0].trigger('click')
    const doneTasks = stages[0].findAll('.pd-task')
    expect(doneTasks.length).toBe(2)
    expect(doneTasks[0].classes()).toContain('pd-task--done')
    expect(doneTasks[0].find('.mk-badge--ok').text()).toBe('已完成')
    // 副行 = 真实字段（任务类型 · 预计用时），不是原型的「验收点」
    expect(doneTasks[0].find('.pd-task__sub').text()).toBe('反思 · 30 分钟')
    expect(doneTasks[0].text()).not.toContain('验收点')

    await w.findAll('.pd-stage__head')[1].trigger('click')
    const activeTasks = stages[1].findAll('.pd-task')
    expect(activeTasks[0].classes()).toContain('pd-task--active')
    expect(activeTasks[0].find('.mk-badge--info').text()).toBe('进行中')
    expect(activeTasks[1].find('.mk-badge--muted').text()).toBe('未开始')

    // 空阶段：明确说明行（第三阶段无子任务）
    await w.findAll('.pd-stage__head')[2].trigger('click')
    expect(stages[2].find('.pd-none').text()).toBe('该阶段暂无任务')

    w.unmount()
  })

  it('任务详情弹层：序号圆+任务名+阶段名；状态 + 真实事实；无验收点/关联产出/学习证据；关闭/遮罩/Esc 可收', async () => {
    const w = mountPage()
    await flushPromises()
    await nextTick()

    // 打开第二阶段进行中任务
    await w.findAll('.pd-stage__head')[1].trigger('click')
    await w.findAll('.pd-stage')[1].findAll('.pd-task')[0].trigger('click')
    await nextTick()

    const modal = document.body.querySelector('.mk-modal')
    expect(modal).not.toBeNull()
    expect(modal!.querySelector('.pd-tk__num')!.textContent).toContain('2')
    expect(modal!.querySelector('.mk-modal__title')!.textContent).toContain('选择收集入口')
    expect(modal!.querySelector('.pd-tk__sub')!.textContent).toContain('搭建最小系统')
    expect(modal!.querySelector('.pd-tk__row .mk-badge')!.textContent).toContain('进行中')

    // 事实栅格只放接口真有的字段；未完成无「完成时间」
    const factLabels = Array.from(modal!.querySelectorAll('.mk-facts > div > span')).map((e) => e.textContent)
    const factValues = Array.from(modal!.querySelectorAll('.mk-facts > div > strong')).map((e) => e.textContent!.trim())
    expect(factLabels).toEqual(['任务类型', '预计用时', '认知负荷'])
    expect(factValues).toEqual(['练习', '20 分钟', '中'])
    // 原型有而接口无的字段一律不渲染（不硬造）
    expect(modal!.textContent).not.toContain('验收点')
    expect(modal!.textContent).not.toContain('关联产出')
    expect(modal!.textContent).not.toContain('学习证据')

    // 关闭钮收起
    ;(modal!.querySelector('.mk-modal__close') as HTMLButtonElement).click()
    await nextTick()
    expect(document.body.querySelector('.mk-modal')).toBeNull()

    // 已完成任务：补「完成时间」事实；Esc 可收（先展开第一阶段）
    await w.findAll('.pd-stage__head')[0].trigger('click')
    await w.findAll('.pd-stage')[0].findAll('.pd-task')[0].trigger('click')
    await nextTick()
    const modal2 = document.body.querySelector('.mk-modal')!
    const labels2 = Array.from(modal2.querySelectorAll('.mk-facts > div > span')).map((e) => e.textContent)
    expect(labels2).toEqual(['任务类型', '预计用时', '认知负荷', '完成时间'])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.body.querySelector('.mk-modal')).toBeNull()

    w.unmount()
  })

  it('加载失败：错误空态 + 重试（重试成功后渲染 hero）', async () => {
    detailMock.mockRejectedValueOnce(new Error('boom'))
    const w = mountPage()
    await flushPromises()
    await nextTick()

    expect(w.find('.mk-empty--error').exists()).toBe(true)
    expect(w.text()).toContain('路径详情加载失败')
    expect(w.text()).toContain('boom')

    await w.find('.mk-empty__action').trigger('click')
    await flushPromises()
    await nextTick()
    expect(w.find('.mk-hero__title').text()).toBe('数据分析入门')

    w.unmount()
  })
})
