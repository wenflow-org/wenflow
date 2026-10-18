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

  it('#52：code 负证据降级时进度同时回落到达标线下（79），不再保留 100 继续算达标', () => {
    const merged = knowledgeStateService.merge(
      [mastered],
      [review],
      false,
      { codeFailedConceptNames: ['概念A'] },
    )
    expect(merged[0].status).toBe('learning')
    expect(merged[0].progress).toBe(79)
  })

  // #48 活体探针（2026-10-17）：模型这一轮没把失败概念写进 knowledge.points 时，
  // 旧实现完全不动聚合 → mastered 原地不动、下降计数恒 0。负证据必须独立生效。
  it('#48：code 失败概念不在 incoming 里也必须降级（mastered → learning@79）', () => {
    const merged = knowledgeStateService.merge(
      [mastered],
      [{ name: '另一个概念', status: 'learning' as const, progress: 20 }],
      false,
      { codeFailedConceptNames: ['概念A'] },
    )
    const target = merged.find((point) => point.name === '概念A')
    expect(target?.status).toBe('learning')
    expect(target?.progress).toBe(79)
    expect(target?.evidenceSource).toBe('mixed')
  })

  it('#48：高进度但未 mastered 的点同样回落到达标线下', () => {
    const merged = knowledgeStateService.merge(
      [{ name: '概念A', status: 'learning' as const, progress: 90 }],
      [],
      false,
      { codeFailedConceptNames: ['概念A'] },
    )
    expect(merged[0].status).toBe('learning')
    expect(merged[0].progress).toBe(79)
  })

  it('#48：复习课（allowDegrade）不叠加负证据仲裁', () => {
    const merged = knowledgeStateService.merge(
      [mastered],
      [],
      true,
      { codeFailedConceptNames: ['概念A'] },
    )
    expect(merged[0].status).toBe('mastered')
    expect(merged[0].progress).toBe(100)
  })

  it('#48：库里没有该概念时不凭空造点', () => {
    const merged = knowledgeStateService.merge(
      [],
      [],
      false,
      { codeFailedConceptNames: ['不存在'] },
    )
    expect(merged).toEqual([])
  })

  // #94 写入侧稳定键：kcId 随看板落库（knowledgeState 是 JSON 列，结算链据它锚定概念身份）
  it('#94：新点的 kcId 随看板落库；模型没回填时不写该字段', () => {
    const merged = knowledgeStateService.merge([], [
      { name: '光反应', kcId: 'kc-1a', status: 'learning' as const, progress: 40 },
      { name: '暗反应', status: 'pending' as const, progress: 0 },
    ])
    const withKc = merged.find((point) => point.name === '光反应')
    const withoutKc = merged.find((point) => point.name === '暗反应')
    expect(withKc?.kcId).toBe('kc-1a')
    expect(withoutKc).not.toHaveProperty('kcId')
  })

  it('#94：既有点回填的 kcId 生效；模型没回填时保留既有键（不得清空）', () => {
    const merged = knowledgeStateService.merge(
      [{ name: '光反应', kcId: 'kc-1a', status: 'learning' as const, progress: 40 }],
      [{ name: '光反应', status: 'mastered' as const, progress: 100 }],
    )
    expect(merged.find((point) => point.name === '光反应')?.kcId).toBe('kc-1a')

    const refilled = knowledgeStateService.merge(
      [{ name: '光反应', status: 'learning' as const, progress: 40 }],
      [{ name: '光反应', kcId: ' kc-9z ', status: 'mastered' as const, progress: 100 }],
    )
    expect(refilled.find((point) => point.name === '光反应')?.kcId).toBe('kc-9z')
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

describe('KnowledgeStateService.diffMastery（#48 掌握下降可观测）', () => {
  const point = (name: string, status: 'pending' | 'learning' | 'mastered' | 'review', progress: number) =>
    ({ name, status, progress })

  it('进度回落 / mastered 撤销 都算下降事件（同概念一轮只记一次）', () => {
    const result = knowledgeStateService.diffMastery(
      [point('A', 'mastered', 100), point('B', 'learning', 60), point('C', 'learning', 40)],
      [point('A', 'learning', 79), point('B', 'learning', 50), point('C', 'learning', 40)],
    )
    expect(result.count).toBe(2)
    expect(result.concepts).toEqual(['A', 'B'])
  })

  it('只升不降 / 新增概念 / 名字写法不同（归一后同名）都不误报', () => {
    const result = knowledgeStateService.diffMastery(
      [point('概 念 A', 'learning', 40)],
      [point('概念A', 'mastered', 100), point('新概念', 'learning', 10)],
    )
    expect(result).toEqual({ count: 0, concepts: [] })
  })

  it('空输入安全', () => {
    expect(knowledgeStateService.diffMastery(undefined, undefined)).toEqual({ count: 0, concepts: [] })
  })
})
