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

vi.mock('@/api/adminApi', () => ({
  adminSkillsApi: {
    getSkillModelCoverage: (...args: unknown[]) => getSkillModelCoverage(...(args as [])),
    bulkApplySkillModelConfig: vi.fn(async () => ({ data: { data: { applied: 0, failed: 0, results: [] } } }))
  },
  adminApiConfigApi: {
    getModelCatalog: vi.fn(async () => ({ data: { data: { models: [] } } }))
  }
}))
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))

async function mountCoverage() {
  const w = mount(SkillModelCoverage)
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

  it('计数取全量口径：平台默认 / 仅技能模型 / 独立通道 / 有备用模型', async () => {
    const w = await mountCoverage()
    expect(pill(w, '全部')?.text()).toBe('全部4')
    expect(pill(w, '平台默认')?.text()).toBe('平台默认2')
    expect(pill(w, '仅技能模型')?.text()).toBe('仅技能模型1')
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
    expect(pill(w, '平台默认')?.text()).toBe('平台默认2')

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

  it('model 单元格带层级徽标（按能力核对）', async () => {
    const w = await mountCoverage()
    const modelCell = w.findAll('tbody tr')[1].find('.skc__model')
    expect(modelCell.text()).toContain('deepseek-v4.1-flash')
    expect(modelCell.text()).toContain('chat')
    w.unmount()
  })
})
