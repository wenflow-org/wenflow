/**
 * 表格方言回归门禁（2026-10-26，全站表格统一批次）。
 *
 * 背景：表格是最容易被各页「各写一套」的组件——同一件事（单元格不换行、分组行、
 * 表内空行、内边距档位）在不同页用私有 CSS 覆写，视觉上读起来像两个产品：
 *
 *   - 13 个页面各自写了 `.xx-table td { white-space: nowrap }`，
 *     而 SPEC（ADMIN_VISUAL_LAYER_SPEC §2）早已把 nowrap 定为表级修饰类 `.mk-table--nowrap`；
 *   - ExecLogs 把 th/td 内边距覆写成 8×13，SPEC 要求表头与单元格左右同档 10×16；
 *   - ModelProvidersPanel / ModelRegistryOverview 的分组行用 6px / 8px 纵向内边距，
 *     把单行小字行压到 30px，低于 SPEC §3 的 40px 行高下限
 *     （SkillReconciliation 早在审核 #80 就踩过并留了判例）。
 *
 * 本门禁锁死这些退化，避免下一批改动又长出页私有拷贝。匹配前剥离注释，
 * 只拦真实样式声明（文档性提及放行）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(__dirname, '..')

/** 剥离 CSS / HTML 注释，只对真实代码匹配 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
}

/** 取 .vue 的 <style> 块（只查样式声明，模板里的 class 使用不在此列） */
function styleBlock(file: string): string {
  const src = readFileSync(join(dir, file), 'utf8')
  const m = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  return stripComments(m ? m[1] : '')
}

const PAGES = [
  'Announcements.vue',
  'Notifications.vue',
  'PromptEvalPanel.vue',
  'SkillDetail.vue',
  'Skills.vue',
  'Feedback.vue',
  'FieldRoutingTable.vue',
  'PromptWorkbench.vue',
  'ServerToolsPanel.vue',
  'SkillFieldRouting.vue',
  'ExecLogs.vue',
  'ModelProvidersPanel.vue',
  'ModelRegistryOverview.vue',
  'SessionSecurity.vue',
  'skill-design/routing-tab.vue',
  'LearnerDetail.vue',
  'GoalConversations.vue',
  'TeachingSessions.vue',
  'OpsContent.vue',
  'MemoryReviewOverview.vue',
  'ModelRegistryOverview.vue',
] as const

describe('表格方言回归门禁', () => {
  it('单元格 nowrap 只走表级修饰类，不在页内对 td 覆写', () => {
    const offenders: string[] = []
    for (const page of PAGES) {
      const css = styleBlock(page)
      // 匹配形如 `.xxx td { ... white-space: nowrap ... }` 的页私有覆写
      for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const [, sel, body] = m
        if (!/\btd\b/.test(sel)) continue
        if (!/white-space\s*:\s*nowrap/.test(body)) continue
        offenders.push(`${page}: ${sel.trim().replace(/\s+/g, ' ').slice(0, 60)}`)
      }
    }
    expect(
      offenders,
      'td 的 nowrap 请改用表级 .mk-table--nowrap（SPEC §2 / ADMIN_COLUMN_WIDTH_SPEC §3）',
    ).toEqual([])
  })

  it('表格单元格内边距不得越档：页内只允许横向收窄（padding-inline），不改纵向基准', () => {
    const offenders: string[] = []
    for (const page of PAGES) {
      const css = styleBlock(page)
      for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const [, sel, body] = m
        if (!/\b(th|td)\b/.test(sel)) continue
        // padding 简写里同时给了纵向值即为越档（padding-inline 是 SPEC 允许的中宽档收窄手段）
        const shorthand = body.match(/(?:^|;)\s*padding\s*:\s*([^;]+)/)
        if (shorthand && !/^\s*0(\s|;|$)/.test(shorthand[1])) {
          offenders.push(`${page}: ${sel.trim().replace(/\s+/g, ' ').slice(0, 50)} → padding:${shorthand[1].trim()}`)
        }
        const block = body.match(/(?:^|;)\s*padding-(?:block|top|bottom)\s*:\s*([^;]+)/)
        if (block && !/^\s*0(\s|;|$)/.test(block[1])) {
          offenders.push(`${page}: ${sel.trim().replace(/\s+/g, ' ').slice(0, 50)} → padding-block:${block[1].trim()}`)
        }
      }
    }
    expect(
      offenders,
      '表格行高由 .mk-table 的档位统一给（SPEC §2：10×16，≥40px 行高）；页内只允许 padding-inline 收窄',
    ).toEqual([])
  })

  /* 行可点却不挂 .mk-table--click：鼠标没有 pointer 光标、键盘聚焦没有描边，
     等于「半套交互」——用户看得见能点，却读不出可点。 */
  it('可点行必须挂表级 .mk-table--click（cursor + 键盘焦点描边）', () => {
    const offenders: string[] = []
    for (const page of PAGES) {
      const src = stripComments(readFileSync(join(dir, page), 'utf8'))
      // 逐表切段（不能用固定字符窗口：长表会超窗漏检，LearnerDetail 就因此漏过一次）
      for (const m of src.matchAll(/<table([^>]*)>([\s\S]*?)<\/table>/g)) {
        const cls = (m[1].match(/class="([^"]*)"/) || ['', ''])[1]
        const clickable = /<tr[^>]*(?:tabindex="0"|@click=)/.test(m[2])
        if (clickable && !cls.includes('mk-table--click')) {
          offenders.push(`${page}: class="${cls}"`)
        }
      }
    }
    expect(
      offenders,
      '行带 tabindex/@click 时表必须挂 .mk-table--click，否则鼠标无 pointer、键盘聚焦无描边',
    ).toEqual([])
  })

  /* 2026-10-28 用户「既然是个列表，就遵守列表的设计」：字段路由是字段条目清单，
     不是需要横向对齐的宽表。锁死列表形态，防止下一次改动又退回列头 + 横向滚动。 */
  it('字段路由保持列表形态，不回退成宽表', () => {
    const src = stripComments(readFileSync(join(dir, 'FieldRoutingTable.vue'), 'utf8'))
    expect(src).not.toMatch(/<table[\s>]/)
    expect(src).toMatch(/<ul class="frt__list"/)
    expect(src).toMatch(/<li[^>]*class="frt__item"/)
  })

  /* Skill 目录同为条目清单（2026-10-28 重新设计）：一行一个 Skill。
     批量模型配置弹窗里的对照表在子组件 SkillModelCoverage 内，不属本页主列表。 */
  it('Skill 目录保持列表形态，主区不回退成宽表', () => {
    const src = stripComments(readFileSync(join(dir, 'Skills.vue'), 'utf8'))
    expect(src).not.toMatch(/<table[\s>]/)
    expect(src).toMatch(/<div[^>]*class="sk-list"/)
    expect(src).toMatch(/<div[^>]*class="sk-item"/)
  })
})
