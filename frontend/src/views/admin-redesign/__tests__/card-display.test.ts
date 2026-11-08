/**
 * 身份卡展示口径（2026-11-07 卡库走查）：
 * 200 张卡的 name 恒为「想解决 + 目标」，goal 又是「领域：具体场景」——
 * 卡面此前把两句都印出来，还在前面加了一个永远写着「想」的首字头像。
 */
import { describe, expect, it } from 'vitest'
import { cardDisplayTitle, shortCardKey, cardTier, compareTier, isWallHiddenTag } from '../cardDisplay'

describe('cardDisplayTitle：卡名与目标合并成一句', () => {
  it('目标比卡名更具体时，用目标当标题（不再「想解决X / X：…」印两遍）', () => {
    expect(cardDisplayTitle('想解决并发编程', '并发编程：以为加 volatile 能保 i++ 线程安全'))
      .toBe('并发编程：以为加 volatile 能保 i++ 线程安全')
    expect(cardDisplayTitle('想搞懂相关性当因果', '相关性当因果：幸存者偏差诊断'))
      .toBe('相关性当因果：幸存者偏差诊断')
  })

  it('卡名去掉「想解决」后就是目标（同值）时，标题不再是「想解决…」', () => {
    expect(cardDisplayTitle('想解决纯情绪宣泄/急性心理危机（非学习诉求）', '纯情绪宣泄/急性心理危机（非学习诉求）'))
      .toBe('纯情绪宣泄/急性心理危机（非学习诉求）')
  })

  it('目标更短时不拿它当标题：只去掉叙述前缀', () => {
    expect(cardDisplayTitle('想解决亏钱焦虑', '亏钱')).toBe('亏钱焦虑')
  })

  it('不以「想…」开头的名字原样保留（人名 / 自定义卡名）', () => {
    expect(cardDisplayTitle('高一学生小陈', '高中数学·函数补差')).toBe('高一学生小陈')
    expect(cardDisplayTitle('', '目标')).toBe('')
  })
})

describe('shortCardKey：卡号短写法', () => {
  it('「前缀-短号」压成 #短号（整面墙前缀恒同，印它只占宽）', () => {
    expect(shortCardKey('frontier-F100')).toBe('#F100')
    expect(shortCardKey('preset-eng-05')).toBe('preset-eng-05')
  })

  it('非「前缀-短号」形态原样返回；空值原样', () => {
    expect(shortCardKey('w6-math-01')).toBe('w6-math-01')
    expect(shortCardKey('')).toBe('')
  })
})

describe('档位识别与排序', () => {
  it('A–E 与 F1–F5A/B 都算档位，其余不算', () => {
    expect(cardTier(['frontier-100', 'F5B', 'repair'])).toBe('F5B')
    expect(cardTier(['数学'])).toBe('')
  })

  it('排序：A–E 在 F 系列之前，同批 A 在 B 之前', () => {
    const sorted = ['F5B', 'A', 'F4', 'F5A', 'E'].sort(compareTier)
    expect(sorted).toEqual(['A', 'E', 'F4', 'F5A', 'F5B'])
  })
})

describe('卡面不显示的内部 / 批次标签', () => {
  it('批次与样本意图标签不上卡面（卡号已带同一信息；意图属于故事池）', () => {
    for (const t of ['frontier-100', 'golden-100', 'repair', 'negative', 'mastery']) {
      expect(isWallHiddenTag(t), t).toBe(true)
    }
    expect(isWallHiddenTag('F5B')).toBe(false)
    expect(isWallHiddenTag('数学')).toBe(false)
  })
})
