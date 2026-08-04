import { normalizeSceneFramingOutput, validatePathSceneFramingOutput } from '../index'

describe('normalizeSceneFramingOutput', () => {
  it('derives planning hints from normalized facts instead of model or seed hints', () => {
    const output = normalizeSceneFramingOutput({
      normalizedInput: {
        resources: {
          timeBudget: '20分钟',
          timeBudgetCadence: 'per_day',
          timePerSession: '60分钟',
          timeHorizon: '1天'
        },
        confirmedProposal: {
          keyStages: ['基础概念', '综合应用']
        },
        planningHints: {
          paceSignal: 'extended',
          milestoneRange: [99, 100],
          conceptRange: [99, 100],
          subtasksPerStageRange: [99, 100],
          subtaskMinutesRange: [99, 100],
          maxWeeks: 99
        }
      }
    }, {
      goal: '测试目标',
      normalizedInput: {
        planningHints: {
          paceSignal: 'standard',
          milestoneRange: [7, 8],
          conceptRange: [7, 8],
          subtasksPerStageRange: [7, 8],
          subtaskMinutesRange: [7, 8],
          maxWeeks: 7
        }
      }
    })

    expect(output.normalizedInput.planningHints).toEqual({
      paceSignal: 'compact',
      milestoneRange: [2, 3],
      conceptRange: [2, 2],
      subtasksPerStageRange: [2, 3],
      subtaskMinutesRange: [18, 48],
      maxWeeks: 2
    })
  })

  it('requires the top-level normalizedInput object before normalization', () => {
    expect(validatePathSceneFramingOutput({ normalizedInput: {} })).toEqual({ valid: true })
    expect(validatePathSceneFramingOutput({})).toEqual({
      valid: false,
      failureReason: 'PATH_SCENE_FRAMING_NORMALIZED_INPUT_MISSING',
    })
  })
})
