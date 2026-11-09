/**
 * 会话监控页 · 头部降噪与阶段条重构护栏（2026-11-09 逐图走查：图 1/2/4/5/6）。
 *
 * 走查结论：1920×1080 下「面包屑 + 标题栏 + 教学建议 + 阶段推进卡」吃掉约 42% 视高，
 * 下方对话/课程与右侧「会话日志」被挤到下半屏。这一批做减法，逐条锁住：
 *  1) 阶段推进：去外层卡与整个卡头，四枚瓦片压成一行 40px 分段步骤条；
 *  2) 页头去重：返回钮（与面包屑同目标）、「查看学习者」按钮（与学习者徽章同一件事）、
 *     阶段胶囊（与 stepper 高亮瓦片重复）、默认档「正课」标签、总结卡里第三次出现的课程标题；
 *  3) 教学建议条：可收起，且默认单行省略；
 *  4) 正文：四列摘要拉开列间距；真实模式学习者气泡改右侧对齐（原「左缩进 12%」像二级回复）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const CP = readFileSync(resolve(here, '../SessionCockpit.vue'), 'utf8')

describe('阶段推进 · 从「大卡套大卡」压成单行步骤条', () => {
  it('外层 mk-card 与整个卡头撤除（标题 / 阶段已推进 N/4 / 下游直达按钮）', () => {
    expect(CP).not.toContain('mk-card cp-stepcard')
    expect(CP).not.toContain('cp-stepcard__spacer')
    expect(CP).not.toContain('cp-stepjumps')
    expect(CP).not.toContain('stageJumpTargets')
  })

  it('保留为分段 tablist，完成口径搬到本条 title（语义不丢）', () => {
    expect(CP).toMatch(/class="cp-stepper"[\s\S]{0,200}role="tablist"/)
    expect(CP).toContain('阶段完成＝本会话课堂已收尾或已出总结')
  })

  it('瓦片高度约 40px：状态点 + 阶段名 + 读数同行（名字可省略号，读数不换行）', () => {
    expect(CP).toMatch(/\.cp-stp \{[\s\S]{0,400}?min-height: 40px/)
    expect(CP).toMatch(/\.cp-stp__dot \{[\s\S]{0,300}?width: 18px; height: 18px/)
    expect(CP).toMatch(/\.cp-stp__name \{[\s\S]{0,200}?text-overflow: ellipsis/)
    expect(CP).not.toContain('cp-stp__body')
  })
})

describe('页头去重', () => {
  it('真实模式动作区不再有第二颗返回钮（面包屑已承担）', () => {
    const real = CP.slice(CP.indexOf('<template v-if="isRealMode">'), CP.indexOf('<!-- 动作区只放真实能力'))
    expect(real).not.toContain('goBack')
    expect(real).not.toContain('backTip')
    expect(real).toContain('执行日志')
  })

  it('学习者徽章即入口：读数与跳转合并成同一枚可点徽章', () => {
    expect(CP).toMatch(/class="mk-badge mk-badge--muted cp-hero__learner cp-hero__learner--link"/)
    expect(CP).toContain('@click="openLearnerDetail"')
    expect(CP).not.toContain('>查看学习者<')
    expect(CP).toMatch(/\.cp-hero__learner--link \{[\s\S]{0,160}?cursor: pointer/)
  })

  it('阶段胶囊撤（当前阶段归 stepper 高亮瓦片）；默认档「正课」不挂标签', () => {
    expect(CP).not.toContain('stageLabel(displayStage)')
    expect(CP).not.toContain('const displayStage = computed')
    expect(CP).toContain("classroomMode !== 'tutor'")
  })

  it('总结卡的「学习目标」与页 H1 同文时不再复读第三次', () => {
    expect(CP).toMatch(/v-if="pathDetailTitle && pathDetailTitle !== heroTitle"/)
  })
})

describe('教学建议条 · 可收起', () => {
  it('有收起/展开钮，收起态只剩标题行并收紧行高', () => {
    expect(CP).toContain('cp-advisory__toggle')
    expect(CP).toContain('advisoryCollapsed')
    expect(CP).toMatch(/\.cp-advisory--collapsed \{ padding: 5px 12px;/)
    expect(CP).toMatch(/\.cp-advisory--collapsed \.cp-advisory__text \{ display: none;/)
  })

  it('正文默认单行省略，完整文案始终在 title；收起态按建议身份重置', () => {
    expect(CP).toMatch(/\.cp-advisory__text \{[\s\S]{0,200}?text-overflow: ellipsis/)
    expect(CP).toContain(':title="advisoryFullText"')
    expect(CP).toMatch(/watch\(advisoryKey, \(\) => \{ advisoryCollapsed\.value = false \}\)/)
  })
})

describe('正文排版两处瑕疵', () => {
  it('四列摘要拉开列间距（时间预算的省略号不再贴住时间范围）', () => {
    expect(CP).toMatch(/\.cp-goal-u \.cp-goal-u__facts \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); column-gap: 24px; \}/)
  })

  it('真实模式学习者气泡靠右对齐并限宽（不再是「左缩进 12%」的伪缩进）', () => {
    expect(CP).toMatch(/\.cp-transcript__message\.is-learner\.is-real-learner \{[\s\S]{0,300}?margin-left: auto;/)
    expect(CP).toMatch(/\.cp-transcript__message\.is-learner\.is-real-learner \{[\s\S]{0,300}?max-width: 78%;/)
    expect(CP).not.toContain('margin-left: 12%')
  })
})
