import { validatePathPlanningOutput } from '../index'

describe('path-planning raw validator', () => {
  const validOutput = {
    name: '前端入门路径',
    milestones: [{ stageNumber: 1, title: '基础概念' }],
    cognitiveCore: { cognitiveDomain: 'understand', coreConcepts: [] },
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
})
