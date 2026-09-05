import { mapKnowledgeStatusToMastery } from '../memory-trace.service'

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
