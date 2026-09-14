import { mapKnowledgeStatusToMastery, normalizeConceptKey } from '../memory-trace.service'

describe('mapKnowledgeStatusToMastery（确定性内化强度映射）', () => {
  it('mastered 满进度 → 0.9 stable', () => {
    expect(mapKnowledgeStatusToMastery('mastered', 100)).toEqual({ masteryScore: 0.9, stability: 'stable' })
  })
  it('mastered → 0.85 stable', () => {
    expect(mapKnowledgeStatusToMastery('mastered', 60)).toEqual({ masteryScore: 0.85, stability: 'stable' })
  })
  it('review → 0.5 fragile', () => {
    expect(mapKnowledgeStatusToMastery('review', 50)).toEqual({ masteryScore: 0.5, stability: 'fragile' })
  })
  it('learning → 0.35 developing', () => {
    expect(mapKnowledgeStatusToMastery('learning', 40)).toEqual({ masteryScore: 0.35, stability: 'developing' })
  })
  it('pending → 0.2 unknown', () => {
    expect(mapKnowledgeStatusToMastery('pending', 0)).toEqual({ masteryScore: 0.2, stability: 'unknown' })
  })
  it('非法 progress 按 0 处理', () => {
    expect(mapKnowledgeStatusToMastery('mastered', NaN)).toEqual({ masteryScore: 0.85, stability: 'stable' })
  })
})

describe('normalizeConceptKey（知识点键归一化：同一概念不再多条痕迹）', () => {
  it('去引号：「靠「动作先发生」取胜」与「靠动作先发生取胜」合并', () => {
    expect(normalizeConceptKey('触发载体靠「动作先发生」而非「视觉更显眼」取胜'))
      .toBe(normalizeConceptKey('触发载体靠动作先发生而非视觉更显眼取胜'))
  })

  it('去冒号后的解释性从句：同一概念的不同解释合并', () => {
    expect(normalizeConceptKey('离开前翻页立好：动作先于「偷懒」评价发生')).toBe('离开前翻页立好')
    expect(normalizeConceptKey('离开前翻页立好：靠物理状态生效，不靠记得去翻')).toBe('离开前翻页立好')
    expect(normalizeConceptKey('离开前翻页立好')).toBe('离开前翻页立好')
  })

  it('冒号前主体过短时不截，保留原意', () => {
    expect(normalizeConceptKey('A：B')).toBe('A：B')
  })

  it('去尾部标点、压缩内部空白', () => {
    expect(normalizeConceptKey('  最小重启动作与加码冲动的对冲机制， ')).toBe('最小重启动作与加码冲动的对冲机制')
    expect(normalizeConceptKey('a  b')).toBe('a b')
  })

  it('幂等 & 空值', () => {
    const once = normalizeConceptKey('离开前翻页立好：靠物理状态生效，不靠记得去翻')
    expect(normalizeConceptKey(once)).toBe(once)
    expect(normalizeConceptKey('')).toBe('')
    expect(normalizeConceptKey(undefined)).toBe('')
  })
})
