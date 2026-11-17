/**
 * P1-15（PD-1）scenario-designer 侧配套：同款 age 硬夹 [18,60] 二次固化点（index.ts:255）同步修复。
 *
 * 契约：scenario-designer 的 personaSeed.age 也必须与身份学段自洽——学生身份越界 → 校验失败重试，
 * 不夹值；成人身份保留真实年龄。
 */
import {
  detectScenarioStudentStage,
  validateScenarioStageAge,
  validateScenarioOutput,
} from '../index'

function validStory() {
  return {
    title: '期末前的合并汇总练习',
    storyOutline: '期末临近，需要在两天内完成一份合并汇总脚本。',
    triggerEvent: '老师布置了期末项目，要求独立完成合并汇总。',
    visibleOpening: '老师发来期末项目说明，要求把三张表合并汇总。',
    pressurePoints: ['期末截止节点'],
    behaviorHooks: ['先问有没有模板'],
    problemKnowledge: {
      domainFamiliarity: 'medium',
      struggleConcepts: ['分组聚合'],
      selfAssessment: '会用基础公式但不熟聚合',
    },
    goalSeed: {
      domain: 'Excel 数据处理',
      goalType: 'exam_prep',
      surfaceGoal: '完成期末项目',
      realProblem: '合并汇总不会拆步',
      motivation: '期末成绩压力',
    },
  }
}

function validPersona(overrides: Record<string, unknown> = {}) {
  return {
    nameHint: '高三学生',
    age: 17,
    occupation: '学生',
    education: '高中三年级',
    background: '备考阶段，晚自习与周末补课占满时间。',
    knownConcepts: ['合并', '筛选'],
    struggleConcepts: ['分组聚合'],
    learningStyle: 'doing',
    motivationType: 'necessity',
    availableTime: 'minimal',
    techComfort: 'medium',
    corePersonality: '目标导向但容易焦虑。',
    emotionalBaseline: '平时稳定，考试前焦虑。',
    helpSeekingPattern: '先自己硬撑，撑不住才问。',
    adversarialPattern: '对抽象建议会说"没时间"。',
    metacognitiveProfile: '撞墙才承认没懂。',
    cognitiveLoadTolerance: 'normal',
    memoryRepairPattern: '忘了先含糊带过。',
    behavioralProfileSummary: '高压下先做再说。',
    personalityDrivers: ['考好'],
    emotionalTriggers: ['排名下滑'],
    failurePatterns: ['考前突击'],
    personalityTraits: {
      verbosity: 'normal',
      enthusiasm: 'normal',
      confusionStyle: 'direct',
      patience: 'normal',
      questionStyle: 'clarifying',
      emotionalRange: 'moderate',
    },
    ...overrides,
  }
}

describe('P1-15：scenario-designer 学段与年龄一致性（不夹值）', () => {
  it('detectScenarioStudentStage：识别学生身份，家长/教师语境不误伤', () => {
    expect(detectScenarioStudentStage({ nameHint: '九年级在读学生' })).toBe('初中')
    expect(detectScenarioStudentStage({ nameHint: '小学四年级学生' })).toBe('小学')
    expect(detectScenarioStudentStage({ nameHint: '四年级陪读妈妈' })).toBeNull()
    expect(detectScenarioStudentStage({ nameHint: '小学语文老师' })).toBeNull()
  })

  it('detectScenarioStudentStage：语境词只跳过所在字段（nameHint 带家长、occupation 是学生仍判学段）', () => {
    expect(
      detectScenarioStudentStage({ nameHint: '初二英语妈妈-小宇', occupation: '学生', education: '初中八年级（初二）' })
    ).toBe('初中')
    expect(
      detectScenarioStudentStage({ nameHint: '陪读妈妈', occupation: '家长', education: '本科' })
    ).toBeNull()
  })

  it('validateScenarioStageAge：小学生 age=18 → 校验失败（不夹值）', () => {
    const result = validateScenarioStageAge({ nameHint: '小学四年级学生', age: 18 })
    expect(result.valid).toBe(false)
    expect(result.failureReason).toContain('小学')
  })

  it('validateScenarioOutput：小学学生 age=18 被拒绝（走重试）', () => {
    const parsed = {
      personaSeed: validPersona({ nameHint: '小学四年级学生', occupation: '学生', education: '小学四年级', age: 18 }),
      story: validStory(),
    }
    const result = validateScenarioOutput(parsed)
    expect(result.valid).toBe(false)
    expect(result.failureReason).toContain('SCENARIO_OUTPUT_INVALID')
  })

  it('validateScenarioOutput：高三学生 age=17 通过', () => {
    const parsed = { personaSeed: validPersona({ age: 17 }), story: validStory() }
    const result = validateScenarioOutput(parsed)
    expect(result.failureReason).toBeUndefined()
    expect(result.valid).toBe(true)
  })

  it('成人身份不受学段区间约束：63 岁自学者 age=63 通过', () => {
    const parsed = {
      personaSeed: validPersona({ nameHint: '63岁退休机修工', occupation: '退休机修工', education: '自学', age: 63 }),
      story: validStory(),
    }
    expect(validateScenarioOutput(parsed).valid).toBe(true)
  })
})