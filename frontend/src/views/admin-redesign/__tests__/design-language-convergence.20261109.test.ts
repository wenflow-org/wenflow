/**
 * 设计语言收敛护栏（2026-11-09 用户逐图走查「组件骨架/表单排版/按钮形态像三四个 AI 各写各的」）。
 *
 * 这一批不是逐像素修，而是把散落的同义写法收进原语，并用源码契约锁住「不许再各写一套」：
 *  1) 动作变体：会改状态的命令 = mk-btn--sm；跳转/展开/表单开关/表格行内 = mk-link。
 *  2) 选中徽章：默认/当前/推荐 = .mk-badge--default（不允许页面自造同义 class）。
 *  3) 可选卡片：唯一选中语法 .mk-choice / .mk-choice--on（蓝描边 + 淡蓝底）；
 *     风险/警示不许借用描边通道。
 *  4) 容器层级：设置页签内不重复页签名、不卡中卡。
 *  5) 弹窗表单：全站顶标签网格（不允许「左标签 + 右输入」横排混进同一个弹窗）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')
const src = (name: string) => read(`../${name}`)
const primitives = read('../../../styles/mk-primitives.css')

describe('动作变体：命令 vs 行内操作', () => {
  it('规范写在原语里（三条判据 + 已清掉的反例）', () => {
    expect(primitives).toContain('动作变体规范')
    expect(primitives).toContain('会改服务状态的命令')
    expect(primitives).toContain('.mk-link--danger')
  })

  it('「连接配置」在对话卡与向量/重排卡是同一形态（都是 mk-link 开关）', () => {
    /* 2026-11-09 用户走查（图 1）：两处的连接编辑都改成卡头「连接配置」打开的小号弹窗，
       写法规格不变——打开弹窗这类开关一律 mk-link，会改服务状态的命令才走 mk-btn--sm。 */
    const api = src('ApiConfig.vue')
    expect(api).toMatch(/class="mk-link"[^>]*@click="openConnDialog"/)
    expect(api).not.toMatch(/class="mk-btn mk-btn--sm"[^>]*@click="openConnDialog"/)
    const infra = src('InfraModelsPanel.vue')
    expect(infra).toMatch(/class="mk-link"[^>]*@click="openConnEditor\(g\.entry\)"/)
    expect(infra).not.toMatch(/class="mk-btn mk-btn--sm"[^>]*@click="openConnEditor/)
  })

  it('字段路由同一格里「编辑 / 删除」同为行内文字操作', () => {
    const routing = src('SkillFieldRouting.vue')
    const start = routing.indexOf('class="sfr__ops"')
    const ops = routing.slice(start, routing.indexOf('</td>', start))
    expect(ops).toContain('class="mk-link"')
    expect(ops).not.toContain('mk-btn--sm')
  })

  it('「查看 →」是跳转不是命令：健康中心用 mk-link，紧邻的「修复」才是 mk-btn--sm', () => {
    const health = src('HealthCenter.vue')
    expect(health).toMatch(/class="mk-link"[^>]*@click="jump\(item\.id\)"/)
    expect(health).toMatch(/class="mk-btn mk-btn--sm"[^>]*@click="fix\(item\.id\)"/)
  })
})

describe('选中徽章：全站唯一 .mk-badge--default', () => {
  it('原语存在，且在暗色档不靠页面私有类', () => {
    expect(primitives).toMatch(/\.mk-badge--default\s*\{[^}]*background:\s*var\(--mk-blue-fill/)
  })

  it('模型卡与基础设施卡都改用它，不再自造 mpp-default-chip', () => {
    expect(src('ModelProvidersPanel.vue')).not.toContain('mpp-default-chip')
    expect(src('InfraModelsPanel.vue')).toContain('mk-badge--default')
  })
})

describe('可选卡片：唯一选中语法 .mk-choice', () => {
  it('原语给默认面与选中面（蓝描边 + 淡蓝底）', () => {
    expect(primitives).toMatch(/\.mk-choice\s*\{[^}]*border-color:\s*var\(--mk-card-line\)/)
    expect(primitives).toMatch(/\.mk-choice--on\s*\{[^}]*border-color:\s*var\(--mk-blue\)[^}]*background:\s*var\(--mk-blue-bg\)/)
  })

  it('三处可选卡片都挂 mk-choice，且各自不再写选中色', () => {
    const access = src('AccessControl.vue')
    expect(access).toContain('class="ac-opt mk-choice')
    expect(access).not.toMatch(/\.ac-opt--on\s*\{/)

    const exp = src('DataExportPanel.vue')
    expect(exp).toContain('class="exp-item mk-choice"')
    expect(exp).not.toMatch(/\.exp-item--on\s*\{/)

    const vlc = src('VirtualLearnerCards.vue')
    expect(vlc).toContain('class="vlc-card mk-choice"')
    expect(vlc).not.toMatch(/\.vlc-card--selected\s*\{/)
  })

  it('选中与警示拆通道：不再有「选中即琥珀描边」的覆盖类', () => {
    const access = src('AccessControl.vue')
    expect(access).not.toContain('ac-opt--risk')
  })
})

describe('容器层级：设置页签只有一层，且不复述页签名', () => {
  it('访问与注册：卡头只有右侧状态，不再有与页签同名的标题', () => {
    const access = src('AccessControl.vue')
    expect(access).not.toContain('<h3 class="mk-card__title">访问与注册设置</h3>')
  })

  it('数据导出：卡题改成「这张卡要你做什么」，不复述页签名', () => {
    const exp = src('DataExportPanel.vue')
    expect(exp).toContain('选择导出内容')
    expect(exp).not.toMatch(/<h4 class="mk-card__title">数据导出<\/h4>/)
  })

  it('会话安全：分组不再套第二张卡，多管理员用分隔线', () => {
    const ss = src('SessionSecurity.vue')
    expect(ss).not.toContain('class="mk-card ss-group"')
    expect(ss).toMatch(/\.ss-group \+ \.ss-group\s*\{[^}]*border-top/)
  })
})

describe('表格行内标记：当前会话与「用户账号」同一位置', () => {
  it('「当前」落在首列身份行，操作列只留占位', () => {
    const ss = src('SessionSecurity.vue')
    // 首列设备名后面挂 mk-badge--self
    expect(ss).toMatch(/ss-device[\s\S]{0,500}mk-badge--self[\s\S]{0,80}>当前</)
    // 旧的悬浮标记类已撤
    expect(ss).not.toContain('class="ss-current"')
    expect(ss).toMatch(/s\.id !== currentId && statusOf\(s\) === 'active'/)
  })
})

describe('弹窗表单：顶标签网格', () => {
  it('Skill 配置弹层不再有「左标签 + 右输入」横排，也不在段头复读 T 值', () => {
    const rt = src('skill-design/runtime-tab.vue')
    expect(rt).not.toMatch(/\.sdp-param\s*\{/)
    expect(rt).not.toContain('sdp-panel__state')
    expect(rt).toContain('sdp-field__range')
  })

  it('模型设置弹窗全程顶标签（mk-field / med 网格）', () => {
    const med = src('ModelEditorDialog.vue')
    expect(med).toContain('mk-field__label')
  })
})
