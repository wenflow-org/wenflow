/**
 * 表格列宽稳定性守卫（2026-10-22 用户「翻页不同页码时候，列宽怎么还在变呢」）。
 *
 * 判例：`.mk-table` 默认自动布局 + `--nowrap`——列宽由当页最长内容决定，
 * 「课堂 / 用户 / 摘要 / 路径」这类文本列每翻一页就重新分宽，整表横向跳动。
 * 三个多页表格（教学会话 / 目标对话 / 学习路径）改为 `.mk-table--fixed` +
 * 逐列表头宽度类：列宽由表头定死，余量按各列宽度权重摊开，翻页不再变。
 * 本文件按源码扫描锁住结构，防止后续改列时把 fixed 或宽度类删回去。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

const PAGES = [
  { file: 'TeachingSessions.vue', prefix: 'ts-c-', minWidthCols: 10 },
  { file: 'GoalConversations.vue', prefix: 'gc-c-', minWidthCols: 8 },
  { file: 'OpsContent.vue', prefix: 'oc-c-', minWidthCols: 7 },
  { file: 'Users.vue', prefix: 'u-c-', minWidthCols: 7 },
  // 撤「完成度」「类别」「操作」三列后（2026-10-24 / 10-26）剩 8 个宽度类：
  // Skill / 归属 / 版本 / 路由 / 调用 / P95 / 成功率 / 最近调用
  { file: 'Skills.vue', prefix: 'sk-c-', minWidthCols: 8 },
  { file: 'ExecLogs.vue', prefix: 'ex-c-', minWidthCols: 6 },
  { file: 'AuditLogs.vue', prefix: 'al-c-', minWidthCols: 8 },
  { file: 'MemoryReviewOverview.vue', prefix: 'mr-c-', minWidthCols: 7 },
  { file: 'VirtualLearners.vue', prefix: 'vl-c-', minWidthCols: 9 },
  { file: 'LearnerCenter.vue', prefix: 'lc-c-', minWidthCols: 7 },
  { file: 'Feedback.vue', prefix: 'fb-c-', minWidthCols: 8 },
  { file: 'OpsAchievements.vue', prefix: 'ach-c-', minWidthCols: 6 }
]

describe('表格列宽稳定性', () => {
  for (const { file, prefix, minWidthCols } of PAGES) {
    it(`${file}：表格 fixed + 每个表头都带宽度类`, () => {
      const src = read(file)
      expect(src).toContain('mk-table--fixed')
      const widthCols = src.match(new RegExp(`\\.${prefix}[a-z0-9-]+ \\{ width:`, 'g')) || []
      expect(widthCols.length).toBeGreaterThanOrEqual(minWidthCols)
      // 固定表的每个 <th> 都必须带宽度类：漏一个该列就退回平分剩余，仍会被文本撑开。
      // 按 </table> 切段，只检查挂了 mk-table--fixed 的表（同页可能还有弹层小表）。
      const tables = src.split('</table>').filter((seg) => /<table\b[^>]*mk-table--fixed/.test(seg))
      expect(tables.length).toBeGreaterThanOrEqual(1)
      for (const seg of tables) {
        const ths = seg.match(/<th\b[^>]*>/g) || []
        expect(ths.length).toBeGreaterThanOrEqual(4)
        expect(ths.filter((th) => !th.includes(prefix))).toEqual([])
      }
    })
  }

  it('列宽契约里不再保留「自动布局、列按内容自然分宽」的旧注释', () => {
    for (const { file } of PAGES) {
      expect(read(file)).not.toContain('width:100% 自动布局')
    }
  })
})
