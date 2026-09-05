import { validatePathPlanningOutput } from '../index'

describe('path-planning raw validator', () => {
  const validOutput = {
    name: '前端入门路径',
    milestones: [{ stageNumber: 1, title: '识别布局关系', coreConcept: 'concept-1' }],
    cognitiveCore: {
      cognitiveDomain: 'understand',
      coreConcepts: [{ id: 'concept-1', name: '布局关系的识别与稳定控制', role: 'hub' }],
    },
  }

  it('accepts the minimum model output consumed by the normalizer', () => {
    expect(validatePathPlanningOutput(validOutput)).toEqual({ valid: true })
  })

  it('rejects missing required top-level fields before normalization', () => {
    expect(validatePathPlanningOutput({ ...validOutput, name: '  ' })).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_NAME_MISSING',
    })
    expect(validatePathPlanningOutput({ ...validOutput, milestones: [] })).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_MILESTONES_MISSING',
    })
    expect(validatePathPlanningOutput({ ...validOutput, cognitiveCore: null })).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_COGNITIVE_CORE_MISSING',
    })
  })

  it('requires exactly one hub concept when coreConcepts are declared', () => {
    expect(validatePathPlanningOutput({
      ...validOutput,
      cognitiveCore: { coreConcepts: [{ id: 'concept-1', role: 'supporting' }] },
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_HUB_CONCEPT_MISSING' })
    expect(validatePathPlanningOutput({
      ...validOutput,
      cognitiveCore: {
        coreConcepts: [
          { id: 'concept-1', role: 'hub' },
          { id: 'concept-2', role: 'hub' },
        ],
      },
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_HUB_CONCEPT_MULTIPLE' })
  })

  it('rejects milestones bound to an undeclared core concept', () => {
    expect(validatePathPlanningOutput({
      ...validOutput,
      milestones: [{ stageNumber: 1, title: 't', coreConcept: 'ghost-9' }],
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_MILESTONE_CONCEPT_UNBOUND' })
  })

  it('rejects legacy task-level fields on milestones', () => {
    expect(validatePathPlanningOutput({
      ...validOutput,
      milestones: [{ stageNumber: 1, title: 't', coreConcept: 'concept-1', subtasks: [{ title: 's' }] }],
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_LEGACY_TASK_FIELDS' })
  })

  it('rejects non-contiguous stage numbers', () => {
    expect(validatePathPlanningOutput({
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-1' },
        { stageNumber: 3, title: 't2', coreConcept: 'concept-1' },
      ],
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_STAGE_NUMBER_GAP' })
  })

  it('enforces exact milestone count when expectedMilestones is provided', () => {
    const output3 = {
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-1' },
        { stageNumber: 2, title: 't2', coreConcept: 'concept-1' },
        { stageNumber: 3, title: 't3', coreConcept: 'concept-1' },
      ],
    }
    // 数量匹配 → 通过
    expect(validatePathPlanningOutput(output3, 3)).toEqual({ valid: true })
    // 数量不匹配 → 打回（关键：prompt 要求精确输出 N 个，代码层仍然是硬校验）
    expect(validatePathPlanningOutput(output3, 4)).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_MILESTONE_COUNT_MISMATCH(expected=4, got=3)',
    })
  })

  it('reports insufficient hub reuse as warning (non-blocking audit)', () => {
    // 3 个 milestone，hub(concept-1) 只在首阶段出现 → 非首阶段复用 0 次 < 2 → 产生 warning 但 valid 仍为 true
    const sparseHub = {
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-1' }, // hub
        { stageNumber: 2, title: 't2', coreConcept: 'concept-2' }, // supporting
        { stageNumber: 3, title: 't3', coreConcept: 'concept-2' }, // supporting
      ],
      cognitiveCore: {
        cognitiveDomain: 'understand',
        coreConcepts: [
          { id: 'concept-1', name: 'hub关系', role: 'hub' },
          { id: 'concept-2', name: '支撑关系', role: 'supporting' },
        ],
      },
    }
    const result = validatePathPlanningOutput(sparseHub)
    expect(result.valid).toBe(true)
    expect((result as any).warnings).toEqual(['PATH_PLANNING_HUB_REUSE_INSUFFICIENT(reused=0, required=2)'])
  })

  it('accepts hub reuse across non-first milestones without warning', () => {
    // hub(concept-1) 在 stage 2/3 被复用 → 非首阶段复用 2 次 ≥ 2 → 无 warning
    const goodHub = {
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-2' },
        { stageNumber: 2, title: 't2', coreConcept: 'concept-1' },
        { stageNumber: 3, title: 't3', coreConcept: 'concept-1' },
      ],
      cognitiveCore: {
        cognitiveDomain: 'understand',
        coreConcepts: [
          { id: 'concept-1', name: 'hub关系', role: 'hub' },
          { id: 'concept-2', name: '支撑关系', role: 'supporting' },
        ],
      },
    }
    expect(validatePathPlanningOutput(goodHub)).toEqual({ valid: true })
  })

  it('reports excessive concept count as warning (CLT audit)', () => {
    // 9 个 milestone 各挂不同概念 → 唯一概念数 9 > 8 → 产生 warning 但 valid 仍为 true
    const manyConcepts = {
      ...validOutput,
      milestones: Array.from({ length: 9 }, (_, i) => ({
        stageNumber: i + 1,
        title: `t${i + 1}`,
        coreConcept: `concept-${i + 1}`,
      })),
      cognitiveCore: {
        cognitiveDomain: 'understand',
        coreConcepts: Array.from({ length: 9 }, (_, i) => ({
          id: `concept-${i + 1}`,
          name: `关系${i + 1}`,
          role: i === 0 ? 'hub' as const : 'supporting' as const,
        })),
      },
    }
    const result = validatePathPlanningOutput(manyConcepts)
    expect(result.valid).toBe(true)
    expect((result as any).warnings).toContain('PATH_PLANNING_CONCEPT_COUNT_HIGH(totalConcepts=9, cap=8)')
  })
})
