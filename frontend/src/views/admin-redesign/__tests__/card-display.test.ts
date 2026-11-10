/**
 * 身份卡展示口径（2026-11-07 卡库走查）：
 * 200 张卡的 name 恒为「想解决 + 目标」，goal 又是「领域：具体场景」——
 * 卡面此前把两句都印出来，还在前面加了一个永远写着「想」的首字头像。
 */
import { describe, expect, it } from 'vitest'
import {
  cardDisplayTitle, shortCardKey, cardTier, compareTier, isWallHiddenTag,
  isWantSentence, syntheticPersonaName, personaDisplayName,
} from '../cardDisplay'

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

/**
 * 2026-11-08 用户「虚拟学习者的名称也太逗了」：
 * 400 张合成卡的 nickname 全是学习诉求句，虚拟学习者列表整列读作「想解决…」。
 * 诉求句不是人名 → 按诉求句派生稳定人名；真人名 / 预置卡原样保留。
 */
describe('isWantSentence：识别「诉求句冒充昵称」', () => {
  it('合成卡的诉求句判定为真', () => {
    expect(isWantSentence('想解决2024新《公司法》认缴制')).toBe(true)
    expect(isWantSentence('想搞懂宏观经济学主流流派在争什么、背后的逻辑脉络')).toBe(true)
  })

  it('真人名 / 自定义名 / 空值判定为假', () => {
    expect(isWantSentence('陈默')).toBe(false)
    expect(isWantSentence('周敏')).toBe(false)
    expect(isWantSentence('')).toBe(false)
    expect(isWantSentence('高一学生小陈')).toBe(false)
  })
})

describe('syntheticPersonaName：按人设短语稳定派生人名', () => {
  it('同一句诉求恒定同名（跨渲染、跨页面不漂移）', () => {
    expect(syntheticPersonaName('想解决2024新《公司法》认缴制')).toBe(syntheticPersonaName('想解决2024新《公司法》认缴制'))
    expect(syntheticPersonaName('想搞懂宏观经济学主流流派在争什么')).toBe(syntheticPersonaName('想搞懂宏观经济学主流流派在争什么'))
  })

  it('空白归一：同一句诉求夹带空格也算同一个人', () => {
    expect(syntheticPersonaName('想解决 纯行政审批/权限阻塞')).toBe(syntheticPersonaName('想解决纯行政审批/权限阻塞'))
  })

  it('不同诉求大多得到不同名字（400 张卡实测）', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => `想解决场景编号 ${i + 1} 的诉求`)
    const names = new Set(seeds.map(syntheticPersonaName))
    expect(names.size).toBeGreaterThan(120)
  })

  it('派生出的是中文人名（2–4 字，不含「想」）', () => {
    const n = syntheticPersonaName('想解决2024新《公司法》认缴制')
    expect(n.length).toBeGreaterThanOrEqual(2)
    expect(n.length).toBeLessThanOrEqual(4)
    expect(n).not.toContain('想')
  })

  it('无种子文本时返回空串（不编造）', () => {
    expect(syntheticPersonaName('')).toBe('')
    expect(syntheticPersonaName('   ')).toBe('')
  })
})

describe('personaDisplayName：展示名链的最后一层', () => {
  it('诉求句 → 派生人名（种子就是诉求句本身）', () => {
    const n = personaDisplayName('想解决2024新《公司法》认缴制')
    expect(n).toBe(syntheticPersonaName('想解决2024新《公司法》认缴制'))
    expect(isWantSentence(n)).toBe(false)
  })

  it('同一个人在两处（列表与详情）拿同一个名字——种子不依赖卡号', () => {
    // 回归：此前按 cardKey 派生，而人设句相同的两个数据行卡号不同
    // （卡库 frontier-F99 / 实例 vl-3f2a19c4）→ 同一个人读出两个名字。
    const sentence = '想解决纯行政审批/权限阻塞（外部卡点）'
    expect(personaDisplayName(sentence)).toBe(personaDisplayName(sentence))
    expect(personaDisplayName(sentence)).not.toBe(syntheticPersonaName('frontier-F99'))
  })

  it('真人名 / 预置卡名原样保留，不被改写', () => {
    expect(personaDisplayName('陈默')).toBe('陈默')
    expect(personaDisplayName('周敏')).toBe('周敏')
    expect(personaDisplayName('高一学生小陈')).toBe('高一学生小陈')
    expect(personaDisplayName('')).toBe('')
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
