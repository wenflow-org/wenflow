/**
 * 排序复位出口守卫（2026-10-26 动线收口）。
 *
 * 判例：`useTableSort` 把排序态写 localStorage——用户点过任一表头后，下次进来仍是那个序。
 * 六个列表页（用户账号 / 教学会话 / 学习路径 / 反馈 / 执行日志 / 审计日志）此前都只有
 * 「点表头改序」这一条路，没有回默认序的出口；同一功能在 Skills / GoalConversations /
 * LearnerCenter 已经各自手写过一遍。现在由 hook 的 `isDefault` + `reset` 统一提供，
 * 本文件按源码扫描锁住「用了 storageKey 的页必须同时暴露复位出口」，防止新页再漏。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

/** 排序态持久化的列表页：storageKey 一旦存在，视图状态就会跨会话留存 → 必须有复位出口 */
const PERSISTED_SORT_PAGES = [
  'Users.vue',
  'TeachingSessions.vue',
  'OpsContent.vue',
  'Feedback.vue',
  'ExecLogs.vue',
  'AuditLogs.vue',
  'Skills.vue',
  'GoalConversations.vue',
  'LearnerCenter.vue',
  'Announcements.vue',
  'Notifications.vue',
  'OpsAchievements.vue'
]

describe('排序复位出口', () => {
  for (const file of PERSISTED_SORT_PAGES) {
    it(`${file}：持久化排序 → 解构 reset/isDefault，且工具条出复位按钮`, () => {
      const src = read(file)
      expect(src).toContain('storageKey:')
      // hook 侧：必须解构 reset 与 isDefault（缺任一，页内就写不出条件按钮）
      expect(src).toMatch(/reset:\s*\w+/)
      expect(src).toMatch(/isDefault:\s*\w+/)
      // 模板侧：条件按钮存在，且文案全站一致（不写「恢复默认排序」「默认序」等第二种叫法）
      expect(src).toContain('恢复默认序')
    })
  }

  it('useTableSort 暴露 isDefault（默认列 + 默认方向才算默认态）', () => {
    const src = readFileSync(resolve(__dirname, '..', 'useTableSort.ts'), 'utf8')
    expect(src).toContain('isDefault')
    // 默认方向必须按该列的 defaultDirOf 取，否则「重置」会给出一个从未出现过的组合
    expect(src).toMatch(/isDefault\s*=\s*computed/)
  })
})
