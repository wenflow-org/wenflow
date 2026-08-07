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
})
