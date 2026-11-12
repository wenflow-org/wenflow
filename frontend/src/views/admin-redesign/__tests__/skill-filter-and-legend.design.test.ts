/**
 * Skill 目录状态图例 + 字段流向角色筛选（2026-11-12 用户截图走查「这些地方 UI 设计得不好」）。
 *
 * 两条都是「控件类别用错」：
 *  1. 状态图例把阈值和「需关注」映射全铺在屏上，同一句话出现两遍；改为短档位 + tooltip。
 *  2. 角色筛选是筛选，不是视图切换——按设计系统 §页签语言分工应走 .mk-pill，
 *     之前用 .mk-seg 让一条深色分段条压在表头上方，权重比表格还重。
 */
import { describe, expect, it } from 'vitest'
import SkillsSource from '../Skills.vue?raw'
import SkillDetailSource from '../SkillDetail.vue?raw'

describe('Skill 目录 · 状态点图例', () => {
  it('屏上只留四个短档位，阈值收进 tooltip', () => {
    expect(SkillsSource).toContain('class="sk-health-legend"')
    expect(SkillsSource).toContain('成功率 < 90%：异常档')
    expect(SkillsSource).toContain('成功率 90%–97%')
    // 旧的屏上括注与行尾复述都撤掉
    expect(SkillsSource).not.toContain('有失败（成功率 &lt;97%）')
    expect(SkillsSource).not.toContain('筛选只收红档（异常）')
  })
})

describe('Skill 详情 · 字段角色筛选', () => {
  it('是筛选就用药丸胶囊，不再借用视图切换的分段控件', () => {
    const start = SkillDetailSource.indexOf('class="mk-pills skd-rolefilter"')
    expect(start).toBeGreaterThan(-1)
    const block = SkillDetailSource.slice(start, SkillDetailSource.indexOf('</div>', start))
    expect(block).toContain('mk-pill__count')
    expect(block).toContain(':aria-pressed=')
    expect(block).not.toContain('mk-seg__item')
  })
})
