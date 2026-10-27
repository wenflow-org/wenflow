/**
 * 卡头工具条形态守卫（2026-10-26 统一，用户「表头部分需要重新设计，包括 pill 筛选 搜索统一设计」）。
 *
 * 契约（一条卡头＝一套控件语言）：
 * 1. **维度下拉**（选一个值筛列表）一律走共享 `MkPillSelect`（`.mk-pill` + 透明原生 select）。
 *    禁止再页内私搓「胶囊内嵌下拉」——统一前 ExecLogs 有 .logs-range/.logs-agent 两份、
 *    AuditLogs 有 .al-range 一份，三段 CSS 逐字重复且字重 700/800 不一致。
 * 2. **次级动作**（列 / 筛选 / 按 ID 定位）一律「文字链 + 图标」（`.mk-link` + `.mk-adv-trigger`），
 *    描边按钮 `.mk-btn` 留给页头主操作——两级层次不能塌成「一排按钮」。
 * 3. **搜索**一律 `MkFilterSearch`（共享清空按钮 + 可访问名回落），且在右组首位。
 *
 * 这里只锁「结构性方言」，不管某个页面具体放几个 pill。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

/** 前端源码里全部 .vue（表头/工具条几何的扫描面：页面与 mk 原语都算） */
function allVueFiles(dir = resolve(__dirname, '../../../..')): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
      out.push(...allVueFiles(p))
    } else if (name.endsWith('.vue')) {
      out.push(p)
    }
  }
  return out
}

/** 有列表卡头的页面（壳/弹窗/详情面板不在内） */
const LIST_PAGES = [
  'Users.vue',
  'TeachingSessions.vue',
  'OpsContent.vue',
  'GoalConversations.vue',
  'LearnerCenter.vue',
  'MemoryReviewOverview.vue',
  'Skills.vue',
  'ExecLogs.vue',
  'AuditLogs.vue',
  'Feedback.vue',
  'Announcements.vue',
  'Notifications.vue',
  'OpsAchievements.vue',
  'SessionSecurity.vue',
  /* 非 .mk-card__head 形态、但有自己筛选行的面板与工具条：
     上面的组标签守卫按整份源码扫，加入后一并受约束 */
  'SkillModelCoverage.vue',
  'SkillReconciliation.vue',
  'AdminGlossary.vue',
  'TraceWaterfall.vue',
]

describe('卡头工具条形态', () => {
  it('不再有页面私搓「胶囊内嵌下拉」（私有 __pick / __v 三段式）', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      // 私有实现的特征：类名 `xx__pick` 包裹 `xx__v` 的 select
      for (const m of src.matchAll(/class="([a-z0-9-]+)__pick"/g)) {
        offenders.push(`${file}: .${m[1]}__pick`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('卡头里的原生 select 必须是 MkPillSelect 内的，不再裸挂 .mk-filter__select', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      const head = src.match(/<div class="mk-card__head"[^>]*>([\s\S]*?)\n      <\/div>/)
      if (!head) continue
      // 卡头区内出现带 .mk-filter__select 的 <select> = 裸下拉（.mk-adv 弹层内的除外）
      const advIdx = head[1].indexOf('mk-adv')
      const body = advIdx >= 0 ? head[1].slice(0, advIdx) : head[1]
      if (/<select[^>]*class="[^"]*mk-filter__select/.test(body)) {
        offenders.push(`${file}: 卡头主栏裸 select`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('「筛选」弹层触发器走共享 .mk-adv-trigger（文字链档），不再用描边小按钮', () => {
    for (const file of LIST_PAGES) {
      const src = read(file)
      if (!src.includes('advOpen')) continue
      expect(src, `${file} 的筛选触发器应为 .mk-link + .mk-adv-trigger`).not.toMatch(
        /class="mk-btn[^"]*"[\s\S]{0,120}advOpen = !advOpen/
      )
    }
  })

  it('列表卡头搜索一律走 MkFilterSearch（不手搓带「搜索」placeholder 的裸 input）', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      const head = src.match(/<div class="mk-card__head"[^>]*>([\s\S]*?)\n      <\/div>/)
      if (!head) continue
      /* 只看卡头区：弹窗里的收件人搜索（发放成就 / 发送通知）是表单字段，
         走 .mk-field__input 是正确的，不属于列表工具条。 */
      for (const m of head[1].matchAll(/<input[^>]*placeholder="([^"]*搜索[^"]*)"/g)) {
        offenders.push(`${file}: 手搓搜索框「${m[1]}」`)
      }
    }
    expect(offenders).toEqual([])
  })

  /* 2026-10-27 用户「不仅是教学区，其他区域也有」：教学会话重建的三职责语法
     （视图 = 可移除胶囊 / 标志 = 独立多选组 / 维度 = 胶囊下拉）推广到其余列表页。
     下面两条锁住最容易复发的那一半：多组 chip 并排时，用户只能靠可访问名分辨行为。 */
  it('每组筛选 chip 都带 role=group + 非空 aria-label（单选 / 多选并排时靠它区分）', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      for (const m of src.matchAll(/class="mk-pills[^"]*"([^>]*)>/g)) {
        const attrs = m[1]
        if (!/role="group"/.test(attrs) || !/aria-label="[^"]+"/.test(attrs)) {
          offenders.push(`${file}: ${m[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /* 2026-10-27 用户「需要统一调整」：列表筛选统一为「KPI 卡（读数 + 快捷入口）+
     维度下拉 + 生效时的已应用 token」，全站不再有常驻「标志筛选」chip 组。
     视图模式切换（Trace 的链路/会话）与表单多选（导出范围）不是列表筛选，不在此列。 */
  it('全站不再有常驻「标志筛选」chip 组（开关已并入 KPI 卡或维度下拉）', () => {
    const offenders = allVueFiles()
      .filter((file) => readFileSync(file, 'utf8').includes('aria-label="标志筛选"'))
      .map((file) => relative(resolve(__dirname, '../../../..'), file))
    expect(offenders).toEqual([])
  })

  /* 2026-10-27 用户「这明显设计的都不一样，我需要一个新的、好用的表头」：
     两张截图（教学会话 vs 路径列表）的差异不在几何，而在**单选维度用了两种控件**
     —— 一边是带标签的胶囊下拉，一边是带计数的 chip 组。统一后：单选维度一律
     MkPillSelect（KPI 卡仍可作同一维度的快捷入口）；2026-10-27「需要统一调整」后，
     常驻 chip 组也全部退场，只保留生效时的已应用 token。 */
  /* 2026-10-27 用户「清除筛选我也不太想要」：工具条不再挂这条文字链，每个控件自己复位
     （下拉选回「全部」、chip 再点取消、搜索框 ✕）。空态里的「清除筛选」CTA 不在卡头内，不受限。 */
  it('卡头不再挂「清除筛选」文字链', () => {
    /* 只看「工具条里的文字链按钮」这一种形态：
       空态 CTA 走 MkEmptyState 的 action-text、深链横幅带「×」前缀，都不会命中。 */
    const offenders = LIST_PAGES.filter((file) =>
      /<button[^>]*class="mk-link[^"]*"[^>]*>清除筛选<\/button>/.test(read(file))
    )
    expect(offenders).toEqual([])
  })

  it('卡头主栏不再有常驻 chip 组（筛选 = 维度下拉 + 已应用 token）', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      const idx = src.indexOf('mk-card__head')
      if (idx < 0) continue
      const tableIdx = src.indexOf('<table', idx)
      const block = src.slice(idx, tableIdx > 0 ? tableIdx : idx + 6000)
      if (/<div class="mk-pills/.test(block)) offenders.push(`${file}: 卡头主栏仍有 chip 组`)
    }
    expect(offenders).toEqual([])
  })

  /* 2026-10-27 用户「去掉这个 pill，综合设计 KPI 面板和筛选」：教学组定稿为
     KPI 卡承担读数与快捷筛选入口，卡头不再常驻标志 chip 组（筛选生效时才出 token）。 */
  it('教学组列表页不再有常驻 chip 组（KPI 卡 = 读数 + 筛选入口）', () => {
    const teachingGroup = [
      'GoalConversations.vue',
      'TeachingSessions.vue',
      'OpsContent.vue',
      'LearnerCenter.vue',
      'MemoryReviewOverview.vue',
    ]
    const offenders = teachingGroup.filter((file) => /class="mk-pills/.test(read(file)))
    expect(offenders).toEqual([])
  })

  /* 2026-10-27 用户「没有统一排序，先下拉还是先 pill」：收敛为**维度在前、标志在后**。
     维度是每一页都有的主筛选轴（读作「先缩小范围」），标志是叠加精修（读作「再开关一类」）；
     多数页面本就是此序，教学会话把标志组写在四个下拉前属历史漂移。这里锁死，防止再掺回来。
     已应用视图胶囊（激活才出现）不在组内，位置不受限。 */
  it('卡头主栏顺序：维度下拉在前，标志 chip 组在后', () => {
    const offenders: string[] = []
    for (const file of LIST_PAGES) {
      const src = read(file)
      const head = src.match(/<div class="mk-card__head"[^>]*>([\s\S]*?)\n      <\/div>/)
      if (!head) continue
      const body = head[1]
      const firstSelect = body.indexOf('<MkPillSelect')
      const firstFlags = body.indexOf('class="mk-pills"')
      if (firstSelect >= 0 && firstFlags >= 0 && firstFlags < firstSelect) {
        offenders.push(`${file}: 标志组排在下拉前`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * 卡头工具条几何（2026-10-27 复核）：用户「所有表格的表头部分看看如何统一设计了」。
 *
 * 统一前实测（Playwright，1280/1440/1920 三档）：用户 / 审计日志卡头 97px，右组被
 * flex-wrap 挤到第二行左边缘、右边空一大片，其余页 57px；同一条工具条上 pill 33px /
 * pillselect 29px / 输入框 32px 三种高度；目标对话搜索框固定 180px 把占位
 * 「搜索用户 / 邮箱 / 目标摘要」裁成「…目标摘」；表头行高 41 / 45 / 46 三档；
 * 可排序列箭头静止 opacity 0（扫一眼看不出哪列能排）。
 *
 * 这些几何量**只能由原语一处定义**：页面各写一份覆盖，就是下一轮「不统一」的来源。
 * 下面把原语里的定值与「页面不许再覆盖」同时钉住。
 */
describe('卡头工具条几何', () => {
  /* 注释里写着「原为 opacity: 0」这类历史值，取值前先把注释剥掉，
     否则断言读到的是注释里那个数字，而不是规则生效的值 */
  const css = readFileSync(resolve(__dirname, '../../../../src/styles/mk-primitives.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const block = (selector: string) => {
    const lit = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return css.match(new RegExp(`(?:^|\\n)${lit} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  }
  /** 同一断点可能有多段（各管各的卡），取含目标选择器的那一段 */
  const mediaBlock = (width: number, needle: string) => {
    for (const m of css.matchAll(new RegExp(`@media \\(max-width: ${width}px\\) \\{([\\s\\S]*?)\\n\\}`, 'g'))) {
      if (m[1].includes(needle)) return m[1]
    }
    return ''
  }
  const num = (body: string, prop: string) => {
    const m = body.match(new RegExp(`${prop}:\\s*([\\d.]+)`))
    return m ? Number(m[1]) : NaN
  }

  it('工具条单行：右组恒与左组同行贴右，窄屏（≤900）才允许折行', () => {
    expect(block('.mk-card__head')).toContain('flex-wrap: nowrap')
    expect(block('.mk-card__head > :first-child')).toContain('min-width: 0')
    expect(block('.mk-card__head-right')).toContain('margin-left: auto')
    const narrow = mediaBlock(900, '.mk-card__head {')
    expect(narrow, '窄屏兜底：右组不许被左组挤没').toMatch(/\.mk-card__head \{[^}]*flex-wrap: wrap/)
  })

  it('同一行盒：pill / 胶囊下拉 / 列按钮都锚在 32px', () => {
    expect(block('.mk-pill')).toContain('height: 32px')
    // 胶囊下拉靠共用 .mk-pill 拿高度，自己只调左右内衬（原先 padding: 3px 8px 3px 11px → 29px）
    expect(block('.mk-pillselect')).not.toMatch(/^\s*height:/m)
    expect(block('.mk-pillselect')).toMatch(/padding: 0 [\d]+px 0 [\d]+px/)
    const cols = readFileSync(resolve(__dirname, '../../../components/mk/MkCols.vue'), 'utf8')
    expect(cols).toMatch(/\.mk-cols__trigger \{[^}]*min-height: 32px/)
  })

  /* 2026-10-27 用户「那个列，干嘛的」：入口只写一个「列」字，看不出是列显隐、
     也看不出当前藏过列。契约：可见文案 = 列设置；有隐藏列时带计数；菜单有「显示列」头
     与「恢复默认」（回到该页首访默认集，而不是一律全显）。 */
  it('列设置入口自解释：可见文案 + 隐藏计数 + 恢复默认', () => {
    const cols = readFileSync(resolve(__dirname, '../../../components/mk/MkCols.vue'), 'utf8')
    expect(cols).toContain('列设置')
    expect(cols).toMatch(/mk-cols__count/)
    expect(cols).toMatch(/mk-cols__reset[^>]*>\s*恢复默认/)
  })

  it('搜索框按占位文本自适应，长占位不再被裁', () => {
    const b = block('.mk-card__head-right .mk-search > .mk-filter__input')
    expect(b).toContain('field-sizing: content')
    expect(num(b, 'min-width')).toBeGreaterThanOrEqual(200)
    expect(num(b, 'max-width')).toBeGreaterThanOrEqual(280)
  })

  it('表头行高 44px：有没有排序列都是同一条基线', () => {
    expect(num(block('.mk-table thead th'), 'height')).toBe(44)
  })

  it('可排序列常驻淡指示器（静止可见、悬停加重、激活满显）', () => {
    const rest = num(block('.mk-th__caret'), 'opacity')
    const hover = num(css.match(/\.mk-table th\.mk-th--sortable:hover \.mk-th__caret \{([^}]*)\}/)?.[1] ?? '', 'opacity')
    expect(rest, '静止即淡显，不然用户看不出哪列能排').toBeGreaterThanOrEqual(0.2)
    expect(hover).toBeGreaterThan(rest)
  })

  it('中宽档单元格内衬只在原语一处定义，页面不再各写一份 12px 覆盖', () => {
    const offenders: string[] = []
    for (const file of allVueFiles()) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const [, selector, body] = m
        if (!/padding-inline/.test(body)) continue
        if (/\.mk-table\b[^{]*\bth\b/.test(selector) && /12px/.test(body)) {
          offenders.push(`${relative(resolve(__dirname, '../../../..'), file)}: 页面重复中宽档内衬`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('深层收紧档（≤1365 / ≤1439）必须同时对 th 与 td 生效，否则表头与行错位', () => {
    const offenders: string[] = []
    for (const file of allVueFiles()) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const [, selector, body] = m
        if (!/padding-inline/.test(body)) continue
        if (!/table/.test(selector) || !/\btd\b/.test(selector)) continue
        if (!/\bth\b/.test(selector)) {
          offenders.push(`${relative(resolve(__dirname, '../../../..'), file)}: ${selector.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('标了 mk-th--sortable 的表头必须渲染 .mk-th__caret', () => {
    const offenders: string[] = []
    for (const file of allVueFiles()) {
      const src = readFileSync(file, 'utf8')
      if (src.includes('mk-th--sortable') && !src.includes('mk-th__caret')) {
        offenders.push(relative(resolve(__dirname, '../../../..'), file))
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * 共享原语自身的守卫：维度下拉必须是自绘 listbox，不能再回退到原生 `<select>`。
 *
 * 2026-10-27 用户「这个下拉，完全没有设计」：原生弹层由浏览器进程绘制，option 只能改
 * 文字色/底色，改不了弹层圆角、描边、行内边距与选中态——点开就是系统默认的蓝底菜单，
 * 与页面其它浮层（列设置、行菜单）两套语言。现在触发器是 button[role=combobox]，
 * 弹层是 ul[role=listbox]，参数与 MkCols 菜单同源（surface / line / shadow-pop / z-menu）。
 */
describe('MkPillSelect：自绘 listbox 而非原生弹层', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../components/mk/MkPillSelect.vue'),
    'utf8'
  )

  it('不再渲染 <select>，触发器带 combobox 语义', () => {
    // 只看模板且去掉模板内注释：注释里会引用「原生 <select>」，不能算实现
    const template = src
      .slice(0, src.indexOf('</template>'))
      .replace(/<!--[\s\S]*?-->/g, '')
    expect(template).not.toMatch(/<select\b/)
    expect(src).toContain('role="combobox"')
    expect(src).toContain('aria-haspopup="listbox"')
    expect(src).toContain('aria-expanded')
  })

  it('弹层是可键盘操作的 listbox / option', () => {
    expect(src).toContain('role="listbox"')
    expect(src).toContain('role="option"')
    expect(src).toContain('aria-activedescendant')
  })

  it('弹层样式与 MkCols 菜单同参数；原生 option 补丁退役', () => {
    // 2026-10-27：select/listbox 外壳已提到全局 mk-select.css（用户/V2 路由也要加载）
    const css = readFileSync(
      resolve(__dirname, '../../../../src/styles/mk-select.css'),
      'utf8'
    )
    // 弹层外壳已抽成两个下拉原语共用的 .mk-listbox-pop（MkSelect 也用它）
    const menu = css.match(/\.mk-listbox-pop \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(menu).toContain('var(--mk-surface)')
    expect(menu).toContain('var(--mk-line)')
    expect(menu).toContain('var(--mk-shadow-pop)')
    expect(menu).toContain('var(--mk-z-menu)')
    expect(css).not.toMatch(/\.mk-pillselect__v\b/)
  })

  it('MkSelect 与 MkPillSelect 共用弹层外壳，表单下拉不再回退原生 select', () => {
    const select = readFileSync(
      resolve(__dirname, '../../../components/mk/MkSelect.vue'),
      'utf8'
    )
    const template = select
      .slice(0, select.indexOf('</template>'))
      .replace(/<!--[\s\S]*?-->/g, '')
    expect(template).not.toMatch(/<select\b/)
    expect(select).toContain('mk-listbox-pop')
    expect(select).toContain('role="combobox"')
    expect(select).toContain('role="listbox"')
    expect(select).toContain('useListbox')
  })
})
