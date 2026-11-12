/**
 * 页名下方禁止解释文案（2026-11-12 用户走查「下方不允许出现解释文案，删除掉，禁止出现」）。
 *
 * 判据收在 MkPageHead 的 sub：只允许由数据算出的事实口径（如「数据截至 14:20 · 最近活动」），
 * 不允许手写固定说明/使用引导。固定说明应由页签名、卡头 meta 或空态承担，而不是在标题下
 * 再写一段产品文案。计算式 `:sub="headSub"` 不在这条禁令的扫描面内。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DIR = resolve(__dirname, '..')

describe('页头 · 不写解释文案', () => {
  it('所有 MkPageHead 都不带手写 sub 文案', () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith('.vue'))
      .filter((f) => /<MkPageHead[^>]*\ssub="/s.test(readFileSync(resolve(DIR, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
