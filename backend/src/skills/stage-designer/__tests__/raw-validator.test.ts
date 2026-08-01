import { validateStageDesignerOutput } from '../index'

describe('stage-designer raw validator', () => {
  it('accepts a subtasks array and leaves item defaults to the normalizer', () => {
    expect(validateStageDesignerOutput({ subtasks: [{}] })).toEqual({ valid: true })
  })

  it('rejects an object without subtasks before normalization', () => {
    expect(validateStageDesignerOutput({})).toEqual({
      valid: false,
      failureReason: 'STAGE_DESIGNER_SUBTASKS_MISSING',
    })
  })
})
