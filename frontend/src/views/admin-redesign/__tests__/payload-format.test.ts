import { describe, expect, it } from 'vitest'
import { prettyPayload } from '../payload-format'

/* prettyPayload：日志负载展示格式化（2026-10-04 外部评审「JSON 未格式化」拍板）。
   契约：可解析的对象/数组 → 两格缩进美化；其余一律原样返回（fail-safe，绝不因格式化丢内容）。 */
describe('prettyPayload', () => {
  it('紧凑 JSON 对象 → 两格缩进美化', () => {
    const out = prettyPayload('{"a":1,"b":{"c":"x"}}')
    expect(out).toBe('{\n  "a": 1,\n  "b": {\n    "c": "x"\n  }\n}')
  })

  it('JSON 数组 → 缩进美化', () => {
    expect(prettyPayload('[1,2]')).toBe('[\n  1,\n  2\n]')
  })

  it('非 JSON（错误文本 / prompt 原文）原样返回', () => {
    const raw = 'Error: fetch failed\n    at ...'
    expect(prettyPayload(raw)).toBe(raw)
  })

  it('截断/损坏的 JSON（parse 失败）原样返回，不抛错', () => {
    const raw = '{"messages":{"count":12,"sample":["[max-depth]"'
    expect(prettyPayload(raw)).toBe(raw)
  })

  it('裸字符串 / 数字标量 → 原样（不加引号不变形）', () => {
    expect(prettyPayload('"just a string"')).toBe('"just a string"')
    expect(prettyPayload('42')).toBe('42')
  })

  it('超长负载（>1MB）不格式化，直接原文', () => {
    const big = `{"k":"${'x'.repeat(1_000_001)}"}`
    expect(prettyPayload(big)).toBe(big)
  })

  it('空串 / 非字符串入参安全', () => {
    expect(prettyPayload('')).toBe('')
    expect(prettyPayload(null)).toBe('')
    expect(prettyPayload(undefined)).toBe('')
  })
})
