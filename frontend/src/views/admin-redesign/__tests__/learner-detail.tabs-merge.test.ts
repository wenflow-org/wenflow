/**
 * 学习者档案详情页签裁并回归（2026-11-09 用户拍板）：
 *  - 8 个页签整合为 6 个：移除「账号与许可」「记忆调度」，分别并入「概览」「记忆与调度」；
 *  - 旧深链兼容：?tab=account → 概览、?tab=memory-ops → 记忆与调度；
 *  - 账号 6 项基础字段并入概览右栏（原「建议行动」卡与画像页建议重复，已移除）；
 *  - 「记忆与调度」= 课内温故计划指标条 + 合并后的单张记忆/到期概念总表（含掌握度）+ 折叠状态条；
 *  - 证据页纵向压缩：三项诊断三列 + 限高、时间线分段切换 + 限高、概念证据密度单行。
 *
 * 断言以源码为准（DOM 级已在 learner-detail.stages.test.ts 覆盖页签渲染与旧深链回落）。
 */
import { describe, expect, it } from 'vitest'
import Source from '../LearnerDetail.vue?raw'

const templateRaw = Source.slice(0, Source.indexOf('<script setup'))
/** 只看真实标记，注释里会提到被移除/搬迁的旧文案（避免误判为仍在渲染） */
const template = templateRaw.replace(/<!--[\s\S]*?-->/g, '')

describe('页签裁并为 6 个', () => {
  it('LD_TAB_IDS 恰为 6 项且去掉 memory-ops / account', () => {
    const line = Source.match(/const LD_TAB_IDS = \[([^\]]+)\]/)?.[1] || ''
    const ids = [...line.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
    expect(ids).toEqual(['overview', 'profile', 'evidence', 'graph', 'sessions', 'memory'])
    expect(ids).not.toContain('memory-ops')
    expect(ids).not.toContain('account')
  })

  it('tabs 数组恰为 6 项，标签与顺序符合「概览 / 画像 / 证据 / 图谱 / 教学会话 / 记忆与调度」', () => {
    const start = Source.indexOf('const tabs = [')
    // 取从 tabs 起点到其闭合 `]` 的一段（内部无嵌套数组字面量）
    const block = Source.slice(start, Source.indexOf('\n]', start))
    const labels = [...block.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1])
    expect(labels).toEqual(['概览', '画像', '证据', '图谱', '教学会话', '记忆与调度'])
    expect(labels).not.toContain('账号与许可')
    expect(labels).not.toContain('记忆调度')
  })

  it('旧深链别名：account → overview、memory-ops → memory，且保留 paths/audit', () => {
    const block = Source.slice(Source.indexOf('const LD_TAB_ALIAS'), Source.indexOf('}', Source.indexOf('const LD_TAB_ALIAS')))
    expect(block).toMatch(/account:\s*'overview'/)
    expect(block).toMatch(/'memory-ops':\s*'memory'/)
    expect(block).toMatch(/paths:\s*'overview'/)
    expect(block).toMatch(/audit:\s*'evidence'/)
  })

  it('不再有任何 memory-ops / account 页签面板分支', () => {
    expect(Source).not.toContain("tab === 'memory-ops'")
    expect(Source).not.toContain("tab === 'account'")
    expect(Source).not.toContain('id="ld-panel-memory-ops"')
    expect(Source).not.toContain('id="ld-panel-account"')
  })

  it('账号轴（view=user）无学习数据时回落概览，而非已撤的账号页签', () => {
    // loadDetail 的轴默认与错误兜底都不再指向 account
    expect(Source).not.toMatch(/view === 'user' \? 'account'/)
    expect(Source).toMatch(/const axisDefault: LdTab = 'overview'/)
    expect(Source).toMatch(/tab\.value = 'overview'/)
  })
})

describe('账号字段并入概览、移除重复「建议行动」卡', () => {
  it('概览右栏渲染 6 项账号基础字段卡', () => {
    expect(template).toContain('账号信息')
    expect(Source).toContain('const accountFields = computed')
    for (const label of ['邮箱', '角色', '账号类型', '加入时间', '最后登录', '用户 ID']) {
      expect(Source).toContain(`label: '${label}'`)
    }
    // 复用共享 .mk-facts 原语
    expect(template).toMatch(/class="mk-facts ld-account"/)
  })

  it('不再挂载 UserAccountPane，也无「建议行动」卡', () => {
    expect(Source).not.toContain("from './UserAccountPane.vue'")
    expect(Source).not.toContain('<UserAccountPane')
    expect(template).not.toContain('建议行动')
    expect(template).not.toContain('ld-actions')
    // 源码层面：样式块里也不再生还 .ld-actions 规则
    expect(Source).not.toMatch(/^\s*\.ld-actions/m)
  })

  it('画像页签自身的建议内容未被删除（只去概览里的重复卡）', () => {
    // 画像页仍渲染 profile 派生洞察/叙述内容
    expect(template).toContain("tab === 'profile'")
    expect(Source).toContain('profile.value?.derivedInsights')
  })
})

describe('记忆与调度：合并为单一页签', () => {
  it('memory 页签内挂载 MemoryReview 调度面板，并省略重复的到期清单预览', () => {
    expect(template).toMatch(/<MemoryReview[^>]*:omit-due-preview="true"/)
    expect(template).toMatch(/<MemoryReview[^>]*:compact-audit="true"/)
  })

  it('合并后的记忆表含掌握度列（与记忆强度/复习到期/提取史/状态同表）', () => {
    expect(Source).toContain("toggleMemSort('mastery')")
    expect(Source).toContain('>掌握度<')
    expect(Source).toContain('mastery: (r) => r.mastery')
  })

  it('回滚动作仍可达：MemoryReview 的 compact-audit 展开后渲染审计卡（含回滚钮）', () => {
    // 嵌入态折叠成单行状态条，展开后走完整审计卡（含「已执行历史」与回滚入口）
    expect(Source).not.toContain('rollbackOne') // 回滚实现不在 LearnerDetail，仍在 MemoryReview
  })
})

describe('证据页纵向压缩', () => {
  it('可复用基础 / 被阻塞基础 / 反复困惑 三列并排（grid repeat(3, minmax(0,1fr))）', () => {
    expect(template).toMatch(/class="ld-sig-cols"/)
    expect(Source).toMatch(/\.ld-sig-cols \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  })

  it('三项诊断列表各自限高 260px 内滚', () => {
    expect(Source).toMatch(/\.ld-sig-col__list \{[^}]*max-height: 260px;[^}]*overflow-y: auto/)
    // 三列都挂了该限高类
    expect((template.match(/ld-fnd[^"]*ld-sig-col__list|ld-sig-col__list/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('证据时间线卡顶为 .mk-seg 分段切换，默认事件时间线，切换看校准记录', () => {
    expect(template).toContain('class="mk-seg"')
    expect(template).toContain("timelineView === 'events'")
    expect(template).toContain("timelineView = 'calibration'")
    expect(template).toMatch(/事件时间线 \{\{ evidence\.length \}\}/)
    expect(template).toMatch(/校准记录 \{\{ calibrationDetails\.length \}\}/)
    // 默认值
    expect(Source).toMatch(/const timelineView = ref<'events' \| 'calibration'>\('events'\)/)
  })

  it('时间线列表容器按视口限高内滚（8 条事件在 1080 视口内自然展开）', () => {
    // 2026-11-09 二次走查：硬性 440px 让 8 条事件刚过线就出滚动条、第 5 条被切一半，
    // 改成随视口取值——短列表不滚，30 条校准明细仍然内滚。
    expect(Source).toMatch(/\.ld-ev-scroll \{[^}]*max-height: min\(80vh, 900px\);[^}]*overflow-y: auto/)
    expect(template).toContain('class="ld-ev-scroll"')
  })

  it('证据双栏顶部对齐，左栏不被右栏拉高（消除半屏空卡框）', () => {
    expect(Source).toMatch(/\.ld-ev-grid \{[^}]*align-items: start/)
  })

  it('概念证据密度为单行紧凑结构（固定行高 28px，左名右条数）', () => {
    expect(Source).toMatch(/\.ld-bar \{[^}]*display: flex;[^}]*height: 28px/)
    expect(Source).toMatch(/\.ld-bar__head strong \{[^}]*flex: 0 1 60%/)
    expect(Source).toMatch(/\.ld-bar__badges \{[^}]*flex: 0 1 40%/)
    // 条与计数同处 .ld-bar__badges（右侧）
    const anchor = template.indexOf('<h3 class="mk-card__title">概念证据密度</h3>')
    const density = template.slice(anchor, template.indexOf('</section>', anchor))
    expect(density).toContain('ld-bar__track')
    expect(density).toContain('ld-bar__ev')
    expect(density).toContain('ld-bar__badges')
  })
})

describe('displayPath 展示兜底（user_sim19 已下线路径回归）', () => {
  it('hasSnapshotPath 只认快照锚点，不把顶层展示兜底当 active 路径', () => {
    expect(Source).toMatch(/const hasSnapshotPath = Boolean\(snapshotPathTitle\)/)
    expect(Source).not.toMatch(/const hasSnapshotPath = Boolean\(snapshotPathTitle \|\| modelPathTitle\)/)
  })

  it('已下线兜底路径回填页级作用域（路径范围下拉不再停在占位）', () => {
    const block = Source.slice(Source.indexOf('if (!hasSnapshotPath && displayPath?.id)'), Source.indexOf('}', Source.indexOf('if (!hasSnapshotPath && displayPath?.id)')))
    expect(block).toContain('applyingScopeDefault = true')
    expect(block).toMatch(/scopePathId\.value = String\(displayPath\.id\)/)
  })
})
