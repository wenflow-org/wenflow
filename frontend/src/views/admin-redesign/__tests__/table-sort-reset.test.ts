/**
 * 排序复位契约（2026-10-27 用户「恢复默认序太丑」后改）。
 *
 * 背景：`useTableSort` 把排序态写 localStorage——用户点过任一表头后，下次进来仍是那个序，
 * 所以必须有回默认序的出口。旧实现是在卡头左组挂一条蓝色文字链「恢复默认序」；
 * 2026-10-27 用户否掉了这条链，出口改为**同一列表头的第三次点击**：
 *   首击 → 该列默认方向；再击 → 反序；再击 → 回默认序。
 *
 * 本文件同时守住「工具条不再长回文字链」：有 storageKey 的页一律不许出现该文案。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useTableSort } from '../useTableSort'

/** 排序态持久化的列表页：一旦出现这条文字链就是回潮 */
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

describe('排序复位：表头第三次点击', () => {
  it('无默认键：默认方向 → 反序 → 回原始序', () => {
    const { sortKey, sortDir, toggle } = useTableSort({ keys: ['a'], defaultDir: 'desc' })

    toggle('a')
    expect([sortKey.value, sortDir.value]).toEqual(['a', 'desc'])
    toggle('a')
    expect([sortKey.value, sortDir.value]).toEqual(['a', 'asc'])
    toggle('a')
    expect([sortKey.value, sortDir.value]).toEqual(['', 'desc'])
  })

  it('分列默认方向：复位回到默认列的默认方向（不是该列的反序）', () => {
    const { sortKey, sortDir, toggle } = useTableSort({
      keys: ['a', 'b'],
      defaultKey: 'a',
      defaultDir: 'desc',
      defaultDirOf: { a: 'asc' }
    })

    toggle('b')
    expect([sortKey.value, sortDir.value]).toEqual(['b', 'desc'])
    toggle('b')
    expect([sortKey.value, sortDir.value]).toEqual(['b', 'asc'])
    toggle('b')
    expect([sortKey.value, sortDir.value]).toEqual(['a', 'asc'])
  })

  it('换列不误触发复位：每次换列都从该列默认方向开始', () => {
    const { sortKey, sortDir, toggle } = useTableSort({ keys: ['a', 'b'], defaultDir: 'desc' })

    toggle('a')
    toggle('b')
    expect([sortKey.value, sortDir.value]).toEqual(['b', 'desc'])
  })
})

describe('排序复位入口不再占工具条', () => {
  for (const file of PERSISTED_SORT_PAGES) {
    it(`${file}：不再出现「恢复默认序」文字链`, () => {
      const src = readFileSync(resolve(__dirname, '..', file), 'utf8')
      expect(src).toContain('storageKey:')
      expect(src).not.toContain('恢复默认序')
    })
  }

  it('useTableSort 仍暴露 isDefault（给需要显示默认序提示的页面）', () => {
    const src = readFileSync(resolve(__dirname, '..', 'useTableSort.ts'), 'utf8')
    expect(src).toMatch(/isDefault\s*=\s*computed/)
  })
})
