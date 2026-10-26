/**
 * Skill 模型路由覆盖矩阵：来源筛选 + 搜索 + 下钻（2026-10-20 走查）。
 *
 * 这张表此前只有排序：看不出「多少 Skill 在用平台默认、多少独立配置」，
 * 也无法从矩阵跳到某个 Skill 的运行时配置。钉住四件事：
 * - 计数是全局口径（不随其它筛选变化）；
 * - 来源 pills 与搜索 AND 组合，筛空保留筛选控件并给清除入口；
 * - 全选只作用当前可见行（否则「筛 1 行、选全部 32 个」是静默误选）；
 * - Skill 名是下钻入口（打开该 Skill 详情，默认落运行时页签）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SkillModelCoverage from '../SkillModelCoverage.vue'

const ROWS = [
  { skillId: 'stage-designer', endpoint: null, model: null, tier: 'chat', source: 'platform-default', paramOverrides: null, fallbackChain: null },
  { skillId: 'teaching-turn', endpoint: null, model: 'deepseek-v4.1-flash', tier: 'chat', source: 'skill-model-only', paramOverrides: { temperature: 0.3 }, fallbackChain: null },
  { skillId: 'session-wrapup', endpoint: 'http://10.0.0.1:30001', model: 'agnes-3.0-flash', tier: 'chat', source: 'skill-channel', paramOverrides: null, fallbackChain: ['agnes-3.0-flash'] },
  { skillId: 'path-planner', endpoint: null, model: null, tier: 'reasoning', source: 'platform-default', paramOverrides: null, fallbackChain: ['deepseek-v4.1-flash'] }
]

const getSkillModelCoverage = vi.fn(async () => ({ data: { data: { skills: ROWS } } }))
const bulkApplyMock = vi.fn(async (_payload: { skillIds: string[]; clearModel?: boolean; endpoint?: string }) => ({ data: { data: { applied: 0, failed: 0, results: [] } } }))

vi.mock('@/api/adminApi', () => ({
  adminSkillsApi: {
    getSkillModelCoverage: (...args: unknown[]) => getSkillModelCoverage(...(args as [])),
    bulkApplySkillModelConfig: (...args: Parameters<typeof bulkApplyMock>) => bulkApplyMock(...args)
  },
  adminApiConfigApi: {
    getModelCatalog: vi.fn(async () => ({ data: { data: { models: [] } } }))
  }
}))
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))

async function mountCoverage(props: Record<string, unknown> = {}) {
  const w = mount(SkillModelCoverage, {
    props: { platformDefaultModel: 'deepseek-v4.1-flash', platformDefaultReasoningModel: 'deepseek-v4.1-flash', ...props }
  })
  await flushPromises()
  await flushPromises()
  return w
}

function pill(w: Awaited<ReturnType<typeof mountCoverage>>, label: string) {
  return w.findAll('.mk-pill').find((p) => p.text().startsWith(label))
}
function skillIds(w: Awaited<ReturnType<typeof mountCoverage>>): string[] {
  return w.findAll('.skc__name').map((b) => b.text())
}

describe('SkillModelCoverage · 来源筛选与下钻', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('计数取全量口径：用平台默认 / 技能覆盖 / 独立通道 / 有备用模型', async () => {
    const w = await mountCoverage()
    expect(pill(w, '全部')?.text()).toBe('全部4')
    expect(pill(w, '用平台默认')?.text()).toBe('用平台默认2')
    expect(pill(w, '技能覆盖')?.text()).toBe('技能覆盖1')
    expect(pill(w, '独立通道')?.text()).toBe('独立通道1')
    expect(pill(w, '自定义备用模型')?.text()).toBe('自定义备用模型2')
    expect(skillIds(w)).toHaveLength(4)
    w.unmount()
  })

  it('来源 pill 收窄表格；计数保持不变（筛的是视图不是数据）', async () => {
    const w = await mountCoverage()
    await pill(w, '独立通道')!.trigger('click')
    expect(skillIds(w)).toEqual(['session-wrapup'])
    expect(w.find('.mk-card__meta').text()).toContain('命中 1 / 共 4')
    expect(pill(w, '用平台默认')?.text()).toBe('用平台默认2')

    // 叠加搜索：独立通道 ∧ 命中关键字
    await w.find('.mk-filter__input').setValue('agnes')
    expect(skillIds(w)).toEqual(['session-wrapup'])
    await w.find('.mk-filter__input').setValue('deepseek')
    expect(skillIds(w)).toEqual([])
    w.unmount()
  })

  it('筛空保留筛选控件与清除入口', async () => {
    const w = await mountCoverage()
    await w.find('.mk-filter__input').setValue('不存在的技能')
    expect(w.find('.mk-pills').exists()).toBe(true)
    expect(w.text()).toContain('没有符合筛选的技能')
    const clear = w.findAll('button').find((b) => b.text() === '清除筛选')
    expect(clear).toBeTruthy()
    await clear!.trigger('click')
    expect(skillIds(w)).toHaveLength(4)
    w.unmount()
  })

  it('全选只选当前可见行', async () => {
    const w = await mountCoverage()
    await pill(w, '独立通道')!.trigger('click')
    await w.find('thead input[type="checkbox"]').setValue(true)
    expect(w.find('.skc__apply .mk-btn--primary').text()).toBe('套用到 1 个技能')

    // 切回全部：已选的那行保留，全选框不是「全选」态
    await pill(w, '全部')!.trigger('click')
    expect((w.find('thead input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(w.find('.skc__apply .mk-btn--primary').text()).toBe('套用到 1 个技能')
    w.unmount()
  })

  it('Skill 名是下钻入口，发出 open-skill', async () => {
    const w = await mountCoverage()
    await w.findAll('.skc__name')[1].trigger('click')
    expect(w.emitted('open-skill')?.[0]).toEqual(['teaching-turn'])
    w.unmount()
  })

  it('model 单元格只给模型名：chat 档不挂内部枚举，推理档才带中文徽标', async () => {
    const w = await mountCoverage()
    const rowOf = (id: string) => w.findAll('tbody tr').find((r) => r.text().includes(id))!
    const chatCell = rowOf('teaching-turn').find('.skc__model')
    // 2026-10-24 用户「还 chat 上了，没有这种了」：tier 是档位字段，不是模型名后缀
    expect(chatCell.text()).not.toContain('chat')
    expect(chatCell.find('.mk-badge').exists()).toBe(false)
    // 推理档仍要给提示（未配模型时它决定走哪条平台默认链），且用中文
    expect(rowOf('path-planner').find('.skc__model').text()).toContain('推理')
    w.unmount()
  })

  it('未配模型的技能显示实际用到的平台默认并标「平台默认」（默认不物化成覆盖）', async () => {
    const w = await mountCoverage({ platformDefaultModel: 'agnes-3.0-flash', platformDefaultReasoningModel: 'deepseek-v4.1-flash' })
    const cells = w.findAll('.skc__model')
    const inherited = cells.filter((c) => c.text().includes('平台默认'))
    // stage-designer（chat）与 path-planner（reasoning）两行都用平台默认
    expect(inherited).toHaveLength(2)
    expect(inherited[0].text()).toContain('agnes-3.0-flash')
    // 推理档用平台推理默认，而不是对话默认
    expect(inherited[1].text()).toContain('deepseek-v4.1-flash')
    w.unmount()
  })

  it('「用平台默认模型」只发 clearModel，不重复写模型/通道', async () => {
    const w = await mountCoverage()
    await w.find('thead input[type="checkbox"]').setValue(true)
    const btn = w.findAll('button').find((b) => b.text() === '用平台默认模型')
    expect(btn, '批量区应有「用平台默认模型」').toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()
    const payload = bulkApplyMock.mock.calls[0]?.[0] as { skillIds: string[]; clearModel?: boolean; endpoint?: string }
    expect(payload.clearModel).toBe(true)
    expect(payload.skillIds).toHaveLength(4)
    expect(payload.endpoint).toBeUndefined()
    w.unmount()
  })
})
