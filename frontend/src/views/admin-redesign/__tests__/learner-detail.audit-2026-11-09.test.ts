/**
 * 学员档案详情页 · 2026-11-09 逐图走查修复护栏（韩磊 8 图）。
 *
 * 这一批修的是「同屏自相矛盾 / 同页两种画法 / 数据被截坏」，每一处都在下面锁一条契约：
 *  1) 概览：用户 ID 不再被短化函数切掉前缀；当前进度条补百分比；
 *     学习动态与「最近课堂」按真实时间合并（不再出现「左边 2 天前上了 5 节课、右边最近动态是 8 天前」）。
 *  2) 证据：时间线不再锁死 440px 矮窗，双栏顶部对齐（消除左栏半屏空卡框）。
 *  3) 记忆与调度：两张表的「记忆强度」同一渲染（.mk-meter），右对齐数字列右邻补间距。
 *  4) 画像：11 枚「初始默认值」胶囊收敛为「灰字 + 卡头一句图例」；叙述文本清洗句读与英文枚举。
 *  5) 图谱：图例补形状/大小说明；画布高度收窄，右下角缩放钮不被视口底边裁掉。
 *  6) 全局：路径范围控件只在受控页签出现；面包屑补当前栏目（与左侧菜单一致）；URL 的 tab 参数回默认页签时删除。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { tidyNarrativeText, levelWordZh } from '../learner-profile'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')
const LD = read('../LearnerDetail.vue')
const CONSOLE = read('../AdminConsole.vue')
const GRAPH_EXPLORER = read('../../../components/mk/MkGraphExplorer.vue')
const PRIMITIVES = read('../../../styles/mk-primitives.css')

describe('概览 · 账号信息与当前进度', () => {
  it('shortId 不再吃掉前缀（user_sim19 曾被切成 er_sim19）', () => {
    expect(LD).not.toMatch(/s\.length <= 8 \? s : s\.slice\(-8\)/)
    expect(LD).toMatch(/s\.length <= 18 \? s : `\$\{s\.slice\(0, 12\)\}…\$\{s\.slice\(-6\)\}`/)
  })

  it('当前进度条带百分比读数（不再只有一根光秃秃的蓝条）', () => {
    expect(LD).toContain('ld-progress__pct')
    expect(LD).toMatch(/\{\{ d\.pct \}\}%/)
  })
})

describe('概览 · 学习动态是真时间线', () => {
  it('合并证据事件 + 最近课堂 + 目标对话，按绝对时刻倒序', () => {
    expect(LD).toMatch(/const activityFeed = computed<ActivityEntry\[\]>/)
    expect(LD).toContain('activeSessionRows.value')
    expect(LD).toContain('recentGoalRows.value')
    expect(LD).toMatch(/items\.sort\(\(a, b\) => b\.at - a\.at\)/)
  })

  it('模板渲染的是 activityFeed，不再是只含证据事件的旧列表', () => {
    expect(LD).toMatch(/v-for="\(s, i\) in activityFeed"/)
    expect(LD).not.toMatch(/v-for="\(s, i\) in recentActivityMerged"/)
  })
})

describe('证据页 · 时间线不再憋在小盒子里', () => {
  it('限高随视口取值（8 条事件自然展开，长列表仍内滚）', () => {
    expect(LD).toMatch(/\.ld-ev-scroll \{[^}]*max-height: min\(80vh, 900px\)/)
  })

  it('双栏顶部对齐，左栏不被右栏拉高', () => {
    expect(LD).toMatch(/\.ld-ev-grid \{[\s\S]{0,400}?align-items: start/)
  })

  it('三列诊断的滚动条就地声明成 4px 主题滑块（不回落 Windows 原生亮槽）', () => {
    expect(LD).toMatch(/\.ld-sig-col__list::-webkit-scrollbar \{ width: 4px; \}/)
    // 不写 scrollbar-width/scrollbar-color：一写 Chromium 就关掉自绘、改回原生槽
    const block = LD.slice(LD.indexOf('.ld-sig-col__list {'), LD.indexOf('.ld-sig-col__list::-webkit-scrollbar-thumb:hover'))
    // 只看真实声明（注释里会提到这两个属性名，说明为什么不能用它们）
    const decls = block.split(String.fromCharCode(10)).map((x) => x.trim())
    expect(decls.some((l) => /^scrollbar-(width|color)\s*:/.test(l))).toBe(false)
  })
})

describe('记忆与调度 · 同字段同一渲染', () => {
  it('两表的率值格都走全站原语 .mk-meter，本地不再自造 meter', () => {
    expect(LD).not.toMatch(/\.ld-mt\s*\{/)
    expect(LD).toMatch(/class="mk-meter"/)
    const mr = read('../MemoryReview.vue')
    expect(mr).not.toMatch(/\.mr-pct\s*\{/)
    expect(mr).toMatch(/class="mk-meter"/)
  })

  it('原语与右对齐列间距都在 mk-primitives 里（一处改、全站生效）', () => {
    expect(PRIMITIVES).toMatch(/\.mk-meter \{[\s\S]{0,200}?display: inline-flex/)
    expect(PRIMITIVES).toMatch(/\.mk-table td\.mk-num \+ td \{ padding-left: 24px; \}/)
  })
})

describe('画像 · 去噪与文案清洗', () => {
  it('不再逐格挂「初始默认值」胶囊，改为灰字 + 卡头图例', () => {
    expect(LD).not.toContain('ld-kv__prior')
    expect(LD).toContain("const PRIOR_LEGEND = '灰字 = 初始默认值'")
    expect(LD).toMatch(/ld-kv__val--prior/)
  })

  it('tidyNarrativeText：句读连排与裸露等级枚举在展示层兜底', () => {
    expect(tidyNarrativeText('精力已耗尽。；当前自述水平：intermediate；主要卡点：A'))
      .toBe('精力已耗尽。当前自述水平：进阶；主要卡点：A')
    expect(tidyNarrativeText('当前自述水平为 Beginner，需要继续观察'))
      .toBe(`当前自述水平为 ${levelWordZh('beginner')}，需要继续观察`)
    // 正常文本不动
    expect(tidyNarrativeText('先建立概念，再配合例子验证。')).toBe('先建立概念，再配合例子验证。')
  })
})

describe('图谱 · 图例与高度', () => {
  it('图例解释形状与大小（不只是颜色）', () => {
    expect(GRAPH_EXPLORER).toContain('圆点=核心概念')
    expect(GRAPH_EXPLORER).toContain('方块=知识组件')
    expect(GRAPH_EXPLORER).toContain('节点越大=关系越多')
  })

  it('画布高度留出底部余量，缩放钮与图例不被视口底边裁掉', () => {
    expect(LD).toMatch(/--ld-graph-h: calc\(100vh - 512px\)/)
  })

  /* 2026-11-10 用户走查「这个知识图谱，看看也做一屏」：2920/3840 等缩放档下 512 这类常数
     估不准（1920 实测卡底离视口底还空 121px，4K 反过来被裁）。大屏改成纯 flex 撑满，
     常数只留作矮窗口的滚动回退。 */
  it('图谱页签大屏走 flex 一屏（页面 → 卡片 → 画布，全部吃剩余高度）', () => {
    expect(LD).toContain(`:class="{ 'ld--fit': tab === 'graph' }"`)
    expect(LD).toMatch(/\.ld\.ld--fit \{[\s\S]*?height: 100%/)
    // 组件内部节点必须 :deep()，否则 scoped 选择器命不中
    for (const sel of ['.mk-ge__card', '.mk-ge__body', '.mk-ge__canvas', '.mk-graph-wrap', '.mk-graph']) {
      expect(LD, `缺少 :deep(${sel}) 自适应节点`).toContain(`.ld.ld--fit :deep(${sel})`)
    }
  })

  it('矮窗口/窄屏不启用一屏（保留页面滚动，画布不被压没）', () => {
    const fit = LD.slice(LD.indexOf('.ld.ld--fit {'))
    const start = LD.lastIndexOf('@media', LD.indexOf('.ld.ld--fit {'))
    expect(LD.slice(start, start + 80)).toMatch(/@media \(min-width: 900px\) and \(min-height: 640px\)/)
    expect(fit).toContain('overflow: hidden')
  })
})

describe('全局 · 筛选器、面包屑与 URL', () => {
  it('路径范围只出现在受控页签（概览/证据/图谱/教学会话）', () => {
    expect(LD).toMatch(/const SCOPE_TABS: LdTab\[\] = \['overview', 'evidence', 'graph', 'sessions'\]/)
    expect(LD).toMatch(/v-if="scopeAppliesToTab" class="ld-scope"/)
  })

  it('面包屑补当前栏目，与左侧菜单一致（下钻页如「会话监控」不在菜单里）', () => {
    expect(CONSOLE).toMatch(/const sectionLabel = MOCK_SCENES\.find\(\(s\) => s\.id === scene\.value\)\?\.label/)
    expect(CONSOLE).toMatch(/chain\.unshift\(sectionLabel\)/)
    expect(CONSOLE).toContain("import { MOCK_SCENES } from './manifest'")
  })
})
