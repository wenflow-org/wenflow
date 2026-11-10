/**
 * 重复操作入口守卫（2026-10-22 用户「这类操作全检一下」）。
 *
 * 判例：用户行菜单的「设为管理员」与编辑弹窗的「角色」下拉重复（第二个入口 + 多一次确认）
 * → 只留编辑弹窗。同批把同对象、同动作、同屏可达的重复入口一并收敛；本文件按源码扫描
 * 锁住这些收敛结果，防止后续重构把第二个入口加回来。
 *
 * 只锁「已确认删除的入口」，不断言实现细节；每条都写明保留的是哪个入口。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

describe('重复操作入口守卫', () => {
  it('用户行菜单不再有角色切换（角色只在编辑弹窗）', () => {
    const src = read('Users.vue')
    expect(src).not.toContain('menuRole')
    expect(src).not.toContain('设为管理员')
    // 表单已抽成 UserFormDialog（列表行与详情页卡头共用一份），角色字段随之搬家
    expect(src).toContain('UserFormDialog')
    expect(read('UserFormDialog.vue')).toContain('<span class="mk-field__label">角色</span>')
  })

  it('虚拟画像：学习详情只在页头右缘留一处，⋯ 菜单不再重复', () => {
    const src = read('VirtualProfile.vue')
    const hits = src.match(/goRealLearner\(\)/g) || []
    // 按钮一处 + 函数定义一处（2026-10-24 入口从页签行上移到页头右缘）
    expect(hits.length).toBe(2)
    expect(src).toContain('mk-entity__actions')
    expect(src).not.toContain('学习模型 / 证据 / 图谱）" @click="closeMenu(); goRealLearner()')
  })

  it('Skill 试跑只有一个输入与运行入口（TrialTab）', () => {
    const host = read('SkillDetail.vue')
    expect(host).not.toContain('class="skd-ta-foot"')
    // 宿主不再维护试跑输入/结果状态（只经 TrialTab）
    expect(host).not.toContain('trialInput')
    expect(host).not.toContain('runTrial')
    // 宿主不再直接调用 testSkill（只经 TrialTab）
    expect(host).not.toContain('adminSkillsApi.testSkill')
  })

  it('运行时配置只有配置弹层里一颗保存钮，卡头不再有分段保存', () => {
    const src = read('skill-design/runtime-tab.vue')
    // 保存钮只有弹层里一颗
    expect(src.match(/@click="saveRuntime(\(\))?/g) ?? []).toHaveLength(1)
    expect(src).not.toContain('sdp-card__save')
    expect(src).toContain('@click="openConfig"')
    /* 2026-11-10：卡头的「覆盖平台默认」开关撤除——它曾是第二个落盘入口
       （onOverrideToggle → saveRuntime）。现在卡面只陈述当前配置，改值一律进弹层。 */
    expect(src).not.toContain('onOverrideToggle')
    expect(src).not.toContain('MkSwitch')
  })

  /* 2026-11-07 用户「提回去」：连接卡回到页顶常驻，但它仍然只有**一颗**保存钮
     （拉清单会自动落盘，这颗只服务「只改了重试 / RPM」那一路），页面上依然没有整页保存条。 */
  it('接入页：连接与策略只有页顶卡里一颗保存钮，不再有整页保存条', () => {
    const src = read('ApiConfig.vue')
    expect(src).not.toContain('class="ac-save"')
    expect(src).not.toContain('showSaveBar')
    expect(src.match(/@click="saveConn"/g) ?? []).toHaveLength(1)
    /* 三处调用点：连接卡保存（conn + reliability）、「保存清单」只提交 conn。
       注意 saveModelList 里那次是单域保存，不是第二颗按钮。 */
    expect(src.match(/saveGroups\(\[/g) ?? []).toHaveLength(3)
  })

  it('供应商设置弹窗不再重复行内的启用开关与密钥输入（仅创建时出现）', () => {
    const src = read('ProviderEditorDialog.vue')
    expect(src).toContain('<label v-if="isCreate" class="mk-field">')
    expect(src).toContain('<label v-if="isCreate" class="mk-field mk-field--switch">')
  })

  it('插件行不再给与成员按钮同落点的「详情 / 配置」', () => {
    const src = read('Addons.vue')
    expect(src).not.toContain('详情 / 配置')
    expect(src).not.toContain('openSkillDrawer(p.actionId)')
  })

  it('执行日志展开区不再重复 Trace 列的链路入口', () => {
    const src = read('ExecLogs.vue')
    expect(src).not.toContain('查看完整调用链路')
    expect(src).not.toContain('按会话归组查看')
  })

  it('审计日志：时间范围进页头、动作与状态在卡头主栏，没有「筛选」弹层', () => {
    const src = read('AuditLogs.vue')
    /* 2026-10-27：动作维度从弹层上提到主栏后，这一页没有弹层了——
       同类别的多个筛选不得收进菜单/下拉（Carbon），只装一项的弹层更是纯隐藏。 */
    expect(src).not.toContain('advOpen')
    expect(src).not.toContain('mk-adv')
    // 2026-10-24 用户「时间范围和筛选重新设计一下」：胶囊里是真 select，不再是不可点的 <span>
    // 2026-10-26 卡头统一：形态收进共享 MkPillSelect（.mk-pill + 透明 select）
    expect(src).toContain('<MkPillSelect')
    // 2026-11-07 用户「执行日志的时间范围在页头，审计日志却掉到表格工具栏」：改到页头 actions
    expect(src).toContain(':model-value="timeRange"')
    expect(src).toContain('aria-label="时间范围"')
    expect(src).toContain('aria-label="按状态筛选"')
    expect(src).toContain('aria-label="按动作筛选"')
    // 页内不再自带 .al-range 私有类（三页逐字重复的同一段 CSS 已删）
    expect(src).not.toMatch(/^\.al-range/m)
    expect(src).not.toContain('class="mk-pill al-range"')
    expect(src).not.toContain('<span class="mk-cell-sub">时间范围</span>')
  })

  it('运营中心：公告卡不再重复「全部公告」入口；嵌入空态不给第二颗主钮', () => {
    expect(read('OpsHub.vue')).not.toContain('全部公告 →')
    expect(read('Announcements.vue')).toContain("embedded ? '' : '新建公告'")
    expect(read('Notifications.vue')).toContain("embedded ? '' : '发送第一条通知'")
  })

  it('口径开关退役：没有页面再引用 DataScopeToggle，也没有虚拟身份徽章', () => {
    /* 2026-10-21 用户拍板「没有测试，测试只是备注」：
       真实/测试 视角开关整体退役（虚拟学习者归自己的域），列表页不再有身份视角控件；
       账号页只对测试/审计账号给一枚「测试」备注，不再有虚拟学习者行。 */
    const files = readdirSync(resolve(__dirname, '..')).filter((f) => f.endsWith('.vue'))
    const stillUsing = files.filter((f) => read(f).includes('DataScopeToggle'))
    expect(stillUsing).toEqual([])
    for (const f of files) {
      expect(read(f), f).not.toContain('mk-badge--virtual')
    }
  })

  it('健康中心：「查看 →」只给真正跨页的检查项', () => {
    const src = read('HealthCenter.vue')
    expect(src).toContain('canJumpAway(item.id)')
    expect(src).toContain("'orchestration-steps',")
  })

  it('目标对话：行点击与一级「详情」同落座舱，路径页签入口只留在 ⋯ 菜单', () => {
    // 2026-11-09 用户走查「只有孤零零一个 ⋯，最常用的详情被藏进二级菜单」：
    // 操作列恢复「详情」一级按钮（与学习路径/复习积压同构），⋯ 只留次级动作；
    // 路径页签入口继续只留在 ⋯ 菜单里，不新增第二个可见路径入口。
    const src = read('GoalConversations.vue')
    expect(src).toContain('@click="openDetail(r)"')
    expect(src).toContain('@click.stop="openDetail(r)"')
    expect(src).toContain('>详情</button>')
    expect(src).toContain('>查看路径</button>')
    expect(src).toContain('menuOpenPath(r)')
    expect(src).not.toContain('@click.stop="openPathStage(r)"')
    expect(src).toContain('function openPathStage')
    expect(src).toContain("openSubPage('session-real', r.id, { stage: 'path' })")
  })

  it('路径治理：重试生成只服务 failed 行（停滞信号已退役）', () => {
    // 2026-10-22 用户「停滞有必要放在这吗」→「对齐吧」：列表页与座舱 Path 页签同一判据，
    // 「24h 无更新」不是生成状态且真实路径重试必 409，两处都收窄到 failed。
    const list = read('OpsContent.vue')
    expect(list).not.toContain('stalledOnly')
    expect(list).not.toContain('isPathStalled')
    const panel = read('PathJourneyPanel.vue')
    expect(panel).not.toContain('isPathStalled')
    expect(panel).not.toContain('PATH_STALL_HOURS')
    expect(panel).toContain("d.value?.status === 'failed'")
  })

  it('座舱路径面板不再有第二颗刷新，危险动作只住 ⋯ 菜单', () => {
    // 2026-10-22 用户「刷新应该不需要吧，已经有刷新了；下线路径位置不合适」：
    // 刷新跟顶栏 liveRefreshSeq；下线/恢复收进菜单，平铺按钮退役。
    const panel = read('PathJourneyPanel.vue')
    expect(panel).not.toContain('刷新中…')
    expect(panel).toContain('watch(liveRefreshSeq')
    expect(panel).not.toContain('@click="toggleArchive"')
    expect(panel).toContain('menuOpen = false; toggleArchive()')
  })

  it('路径面板任务行不再开任务详情弹层（内容与行内重复）', () => {
    // 2026-10-22 用户「点击后的二级弹窗是做什么的，意义是」→「先去掉，我觉得没用」：
    // 弹层只多一个认知负荷，其余状态/类型/时长在行内已有，还露内部任务 id。
    const panel = read('PathJourneyPanel.vue')
    expect(panel).not.toContain('openTask')
    expect(panel).not.toContain('pd-tk')
    expect(panel).not.toContain('aria-label="任务详情"')
  })
})
