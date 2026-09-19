jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import {
  normalizeStory,
  validateScenarioOutput,
  PRIMARY_BLOCK_TYPES,
  RECURRENCE_TYPES,
  VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
} from '../virtual-learner-scenario-designer'
import { logger } from '../../utils/logger'

/** 构造一份通过现有必填校验的最小场景（新标注字段缺失）。 */
function validScenario(): any {
  return {
    personaSeed: {
      nameHint: '老王',
      age: 34,
      occupation: '客服组长',
      education: '大专',
      background: '在一家电商公司带 8 人客服小组，月末最忙。',
      knownConcepts: ['排班'],
      struggleConcepts: ['复盘'],
      emotionalTriggers: ['被投诉'],
      failurePatterns: ['拖到最后一刻'],
      learningStyle: 'doing',
      motivationType: 'career',
      availableTime: 'minimal',
      techComfort: 'medium',
      corePersonality: '先自己扛，扛不住才求助',
      emotionalBaseline: '表面平静，内部焦虑',
      helpSeekingPattern: '先翻聊天记录再问同事',
      adversarialPattern: '被否定时先沉默后反驳',
      metacognitiveProfile: '知道自己方法乱但说不清哪里乱',
      cognitiveLoadTolerance: '低',
      memoryRepairPattern: '用完即忘，不建索引',
      behavioralProfileSummary: '碎片时间学习者，需要被推着走',
      personalityTraits: {
        verbosity: 'normal',
        enthusiasm: 'low',
        confusionStyle: 'hinting',
        patience: 'low',
        questionStyle: 'clarifying',
        emotionalRange: 'moderate',
      },
    },
    story: {
      title: '月末复盘总写成流水账',
      storyOutline: '上周五月度复盘被主管退回，他周末在家重写仍不满意。',
      triggerEvent: '复盘被打回',
      visibleOpening: '我这复盘是不是写得不对？',
      pressurePoints: ['怕被说没有管理能力'],
      behaviorHooks: ['先道歉再提问'],
      problemKnowledge: {
        domainFamiliarity: 'low',
        struggleConcepts: ['归因'],
        selfAssessment: '我知道要提炼结论，但写不出来',
      },
      goalSeed: {
        domain: '复盘写作',
        goalType: 'problem_driven',
        surfaceGoal: '学会写月度复盘',
        realProblem: '他不知道复盘要回答哪几个问题，写完自己也不满意',
        motivation: '不想再被退回',
      },
    },
    consistencyNotes: ['pressurePoints 与 emotionalTriggers 对齐'],
  }
}

describe('normalizeStory 的 goalSeed 问题类型标注', () => {
  it('保留合法的 primaryBlockType / recurrence / blockTypeEvidence', () => {
    const story = normalizeStory({
      goalSeed: {
        primaryBlockType: 'permission_process',
        recurrence: 'once',
        blockTypeEvidence: '账号被管理员锁了，他不知道该找谁开',
      },
    })

    expect(story.goalSeed.primaryBlockType).toBe('permission_process')
    expect(story.goalSeed.recurrence).toBe('once')
    expect(story.goalSeed.blockTypeEvidence).toBe('账号被管理员锁了，他不知道该找谁开')
  })

  it('非法 primaryBlockType 置 null，不默认成 capability', () => {
    const story = normalizeStory({ goalSeed: { primaryBlockType: 'skill_gap' } })

    expect(story.goalSeed.primaryBlockType).toBeNull()
  })

  it('recurrence 只接受 once|recurring，非法值置 null', () => {
    expect(normalizeStory({ goalSeed: { recurrence: 'sometimes' } }).goalSeed.recurrence).toBeNull()
    expect(normalizeStory({ goalSeed: { recurrence: 'recurring' } }).goalSeed.recurrence).toBe('recurring')
  })

  it('三个字段缺失时均为 null 且不抛错', () => {
    const story = normalizeStory({ goalSeed: {} })

    expect(story.goalSeed.primaryBlockType).toBeNull()
    expect(story.goalSeed.recurrence).toBeNull()
    expect(story.goalSeed.blockTypeEvidence).toBeNull()
  })

  it('枚举常量与 core.yaml 口径一致', () => {
    expect([...PRIMARY_BLOCK_TYPES]).toEqual([
      'capability',
      'oneoff_operation',
      'environment_tooling',
      'permission_process',
      'emotion_relationship',
    ])
    expect([...RECURRENCE_TYPES]).toEqual(['once', 'recurring'])
  })
})

describe('validateScenarioOutput 对问题类型标注为非阻塞', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('缺失新字段仍判定 valid，并产生非阻塞告警', () => {
    const result = validateScenarioOutput(validScenario())

    expect(result.valid).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('问题类型标注'),
      expect.objectContaining({ fields: ['primaryBlockType', 'recurrence', 'blockTypeEvidence'] }),
    )
  })

  it('提供合法新字段时 valid 且不告警', () => {
    const scenario = validScenario()
    scenario.story.goalSeed.primaryBlockType = 'emotion_relationship'
    scenario.story.goalSeed.recurrence = 'recurring'
    scenario.story.goalSeed.blockTypeEvidence = '一想到要当众汇报就失眠'

    const result = validateScenarioOutput(scenario)

    expect(result.valid).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('非法新字段值不阻断校验，仅告警', () => {
    const scenario = validScenario()
    scenario.story.goalSeed.primaryBlockType = 'unknown_type'

    const result = validateScenarioOutput(scenario)

    expect(result.valid).toBe(true)
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('scenario-designer 提示词包含问题类型标注定义', () => {
  it('primaryBlockType 枚举与判定口径已写入编译产物', () => {
    for (const token of [
      'primaryBlockType',
      'oneoff_operation',
      'environment_tooling',
      'permission_process',
      'emotion_relationship',
      '哪个阻塞不解决，其它做什么都白搭',
    ]) {
      expect(VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT).toContain(token)
    }
  })

  it('realProblem 反例、recurrence 与 blockTypeEvidence 定义已写入编译产物', () => {
    expect(VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT).toContain('缺乏…能力/认知')
    expect(VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT).toContain('recurrence')
    expect(VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT).toContain('blockTypeEvidence')
  })
})
