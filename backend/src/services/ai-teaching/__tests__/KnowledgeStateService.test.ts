import { knowledgeStateService } from '../KnowledgeStateService'

describe('KnowledgeStateService.merge（知识看板合并）', () => {
  const mastered = { name: '概念A', status: 'mastered' as const, progress: 100 }
  const review = { name: '概念A', status: 'review' as const, progress: 50 }
  const learning = { name: '概念A', status: 'learning' as const, progress: 40 }

  it('普通课：mastered 只升不降（LLM 报 review 不降级）', () => {
    const merged = knowledgeStateService.merge([mastered], [review])
    expect(merged[0].status).toBe('mastered')
    expect(merged[0].progress).toBe(100)
  })

  it('普通课：mastered 后 progress 取 max 不回退', () => {
    const merged = knowledgeStateService.merge([mastered], [learning])
    expect(merged[0].progress).toBe(100)
  })

  it('复习课（allowDegrade）：mastered 可降级为 review（复习失败真实可见）', () => {
    const merged = knowledgeStateService.merge([mastered], [review], true)
    expect(merged[0].status).toBe('review')
    expect(merged[0].progress).toBe(50)
  })

  it('复习课（allowDegrade）：LLM 报 learning 也可降级', () => {
    const merged = knowledgeStateService.merge([mastered], [learning], true)
    expect(merged[0].status).toBe('learning')
    expect(merged[0].progress).toBe(40)
  })

  it('复习课（allowDegrade）：mastered 保持 mastered 时正常', () => {
    const merged = knowledgeStateService.merge([mastered], [{ name: '概念A', status: 'mastered' as const, progress: 90 }], true)
    expect(merged[0].status).toBe('mastered')
  })

  it('新概念直接加入', () => {
    const merged = knowledgeStateService.merge([], [{ name: '新概念', status: 'learning' as const, progress: 10 }])
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('新概念')
  })
})

describe('KnowledgeStateService 收束目标集（P0：锚定冻结目标，防止分母膨胀）', () => {
  type Status = 'pending' | 'learning' | 'mastered' | 'review'
  const p = (name: string, status: Status, progress: number) => ({ name, status, progress })

  it('resolveCompletionTargets：已冻结则原样沿用，不受后续新增点影响', () => {
    const targets = knowledgeStateService.resolveCompletionTargets(
      ['概念A', '概念B'],
      [],
      [p('概念C', 'learning', 10)],
    )
    expect(targets).toEqual(['概念A', '概念B'])
  })

  it('resolveCompletionTargets：优先用开课种子点名', () => {
    const targets = knowledgeStateService.resolveCompletionTargets(
      undefined,
      [p('种子概念', 'pending', 0)],
      [p('模型点', 'learning', 20)],
    )
    expect(targets).toEqual(['种子概念'])
  })

  it('resolveCompletionTargets：无种子时冻结首个教学回合的点集（去重）', () => {
    const targets = knowledgeStateService.resolveCompletionTargets(
      undefined,
      [],
      [p('A', 'learning', 10), p('B', 'review', 30), p('A', 'learning', 10)],
    )
    expect(targets).toEqual(['A', 'B'])
  })

  it('areTargetsConsolidated：目标点 mastered 或进度≥80 即通过', () => {
    const targets = ['A', 'B', 'C']
    const merged = [p('A', 'mastered', 100), p('B', 'review', 80), p('C', 'learning', 85)]
    expect(knowledgeStateService.areTargetsConsolidated(targets, merged)).toBe(true)
  })

  it('areTargetsConsolidated：pending 或进度不足不通过', () => {
    expect(knowledgeStateService.areTargetsConsolidated(['A'], [p('A', 'pending', 0)])).toBe(false)
    expect(knowledgeStateService.areTargetsConsolidated(['A'], [p('A', 'learning', 79)])).toBe(false)
  })

  it('areTargetsConsolidated：目标点缺失（被改名）不通过，避免误判完成', () => {
    expect(knowledgeStateService.areTargetsConsolidated(['A'], [p('改了名的A', 'learning', 90)])).toBe(false)
  })

  it('areTargetsConsolidated：空目标集不算完成', () => {
    expect(knowledgeStateService.areTargetsConsolidated([], [p('A', 'mastered', 100)])).toBe(false)
  })

  it('关键回归：目标集冻结后，模型新增的未掌握点不再阻断收束', () => {
    const frozen = ['A', 'B']
    const merged = [p('A', 'mastered', 100), p('B', 'review', 80), p('新增点C', 'learning', 10)]
    expect(knowledgeStateService.areTargetsConsolidated(frozen, merged)).toBe(true)
  })

  it('averageTargetProgress：取目标集中仍在看板上的点均分，缺失点忽略', () => {
    const merged = [p('A', 'mastered', 100), p('B', 'learning', 60), p('C', 'learning', 80)]
    expect(knowledgeStateService.averageTargetProgress(['A', 'B', 'C'], merged)).toBe(80)
    expect(knowledgeStateService.averageTargetProgress(['A', 'B', 'C'], [p('A', 'mastered', 100), p('B', 'learning', 60)])).toBe(80)
    expect(knowledgeStateService.averageTargetProgress([], merged)).toBe(0)
  })
})
