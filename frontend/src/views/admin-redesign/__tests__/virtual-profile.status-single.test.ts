/**
 * 画像页「当前状态」只显示一处（2026-10-19 运营走查「同屏三处」）：
 * 状态此前在 hero 徽章、概览状态条、画像设定 kv 各渲染一遍（同一个 lifeLabel 三写）。
 * 保留 hero 徽章——它在页签之上，任何页签都在屏；另两处撤除。
 *
 * 用 ?raw 白盒断言（先例 distband-collapse / dataFlow）：本页挂载依赖大量接口 mock，
 * 而这里要锁的是「不要在模板里再长出第二处状态读数」，源文本判据更稳。
 */
import { describe, expect, it } from 'vitest'
import ProfileSource from '../VirtualProfile.vue?raw'

describe('VirtualProfile · 当前状态单点', () => {
  it('模板里只有 hero 徽章一处状态标签（lifeLabel 插值唯一）', () => {
    expect(ProfileSource.split('{{ lifeLabel }}').length - 1).toBe(1)
    expect(ProfileSource).toContain('class="vp-life"')
  })

  it('状态条与画像设定 kv 不再复读状态', () => {
    // 状态条（MkStatStrip items）里不许再有「当前状态」格
    const statItemsBlock = ProfileSource.slice(
      ProfileSource.indexOf('const statItems = computed'),
      ProfileSource.indexOf('const statItems = computed') + 1600
    )
    expect(statItemsBlock).not.toContain('当前状态')
    // 画像设定 kv 里的那一行已撤（标签字面量只剩注释/别处说明）
    const kvBlock = ProfileSource.slice(
      ProfileSource.indexOf('<dl class="vp-kv">'),
      ProfileSource.indexOf('</dl>', ProfileSource.indexOf('<dl class="vp-kv">'))
    )
    expect(kvBlock).not.toContain('当前状态')
    expect(kvBlock).not.toContain('lifeLabel')
  })

  it('派生走 vlab-controls 单源（视图里不再留一份聚合判定）', () => {
    expect(ProfileSource).toContain('deriveVsLifecycleStateFromRuns')
    // 原内联聚合里的那行（先找暂停中的活跃会话）已迁走；running/created 的另外两处
    // （activeSessionId / isRunActive）是「挑活跃会话」与「筛片」的判据，不是状态派生，保留。
    expect(ProfileSource).not.toContain('pausedRun')
  })
})
