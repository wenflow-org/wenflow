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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

describe('重复操作入口守卫', () => {
  it('用户行菜单不再有角色切换（角色只在编辑弹窗）', () => {
    const src = read('Users.vue')
    expect(src).not.toContain('menuRole')
    expect(src).not.toContain('设为管理员')
    expect(src).toContain('<span class="mk-field__label">角色</span>')
  })

  it('虚拟画像：学习详情只保留 tabs 行按钮，⋯ 菜单不再重复', () => {
    const src = read('VirtualProfile.vue')
    const hits = src.match(/goRealLearner\(\)/g) || []
    // 按钮一处 + 函数定义一处
    expect(hits.length).toBe(2)
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

  it('运行时配置只有一个保存钮（卡头，脏时才出）', () => {
    const src = read('skill-design/runtime-tab.vue')
    const buttons = src.match(/@click="saveRuntime"/g) || []
    expect(buttons.length).toBe(1)
    expect(src).toContain('v-if="dirtyNow"')
  })

  it('接入页：单组脏不出整页保存条（多组才出）', () => {
    const src = read('ApiConfig.vue')
    expect(src).toContain('v-if="dirty.size > 1" class="ac-save"')
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

  it('审计日志时间范围 chip 只回显，不再与「筛选」钮同开弹层', () => {
    const src = read('AuditLogs.vue')
    // 只留「筛选」钮一个触发点
    expect((src.match(/advOpen = !advOpen/g) || []).length).toBe(1)
    expect(src).toMatch(/<span\s+class="mk-pill al-range"/)
  })

  it('运营中心：公告卡不再重复「全部公告」入口；嵌入空态不给第二颗主钮', () => {
    expect(read('OpsHub.vue')).not.toContain('全部公告 →')
    expect(read('Announcements.vue')).toContain("embedded ? '' : '新建公告'")
    expect(read('Notifications.vue')).toContain("embedded ? '' : '发送第一条通知'")
  })

  it('健康中心：「查看 →」只给真正跨页的检查项', () => {
    const src = read('HealthCenter.vue')
    expect(src).toContain('canJumpAway(item.id)')
    expect(src).toContain("'orchestration-steps',")
  })
})
