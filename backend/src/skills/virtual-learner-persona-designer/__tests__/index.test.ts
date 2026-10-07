import { validatePersonaOutput, normalizePersonaOutput, detectStudentStage, validateStageAgeConsistency } from '../index'

function validPersonaSeed() {
  return {
    nameHint: '销售主管',
    age: 32,
    occupation: '销售主管',
    education: '本科',
    background: '带 6 人团队，日常被消息打断，复盘全靠感觉。',
    knownConcepts: ['销售漏斗', '客户分层'],
    struggleConcepts: ['复盘结构', '优先级排序'],
    learningStyle: 'doing',
    availableTime: 'minimal',
    techComfort: 'medium',
    corePersonality: '结果导向，但容易在压力下过度揽活。',
    emotionalBaseline: '平时稳定，被质疑时容易防御。',
    helpSeekingPattern: '先自己硬撑，撑不住才开口，开口也只说表面症状。',
    adversarialPattern: '对理想化建议会直接说"现在没时间"。',
    selfAwarenessPattern: '通常要等撞墙了才承认自己没懂。',
    planningFollowThrough: '计划很满，掉队后容易放弃整个计划。',
    overloadReaction: '信息一多就烦躁，会跳过细节直接干。',
    memoryRepairPattern: '忘了会先含糊带过，被追问才承认。',
    behavioralProfileSummary: '高压下先做再说，受挫后容易全盘否定。',
    personalityDrivers: ['被认可', '掌控感'],
    emotionalTriggers: ['当众被指出错误', '时间被压缩'],
    failurePatterns: ['学了开头就放弃', '复盘总停留在情绪层'],
  }
}

describe('virtual-learner-persona-designer validate/normalize', () => {
  it('完整合法输出通过校验', () => {
    const result = validatePersonaOutput({ personaSeed: validPersonaSeed() })
    expect(result.valid).toBe(true)
  })

  it('缺少 emotionalTriggers / failurePatterns / personalityDrivers 时拒绝（与 canonical 对齐）', () => {
    const seed = validPersonaSeed() as any
    delete seed.emotionalTriggers
    expect(validatePersonaOutput({ personaSeed: seed }).valid).toBe(false)

    const seed2 = validPersonaSeed() as any
    seed2.failurePatterns = []
    expect(validatePersonaOutput({ personaSeed: seed2 }).valid).toBe(false)

    const seed3 = validPersonaSeed() as any
    delete seed3.personalityDrivers
    expect(validatePersonaOutput({ personaSeed: seed3 }).valid).toBe(false)
  })

  it('normalize 保留 canonical 扩展字段并补齐 legacy 字段', () => {
    const seed = {
      ...validPersonaSeed(),
      priorAttempts: '去年学过但没坚持',
      communicationStyle: '先说症状，被追问才展开',
      motivationOrientation: '避免出错的压力驱动',
      resiliencePattern: '失败后先沉默再复盘',
      digitalLiteracy: '会用常用办公软件',
      behaviorBoundaries: ['不会主动汇报进展'],
      learningPreferences: ['边做边学'],
      metacognitiveProfile: '很少自我检查',
    }
    const output = normalizePersonaOutput({ personaSeed: seed })
    const p = output.personaSeed

    expect(p.personalityDrivers).toEqual(['被认可', '掌控感'])
    expect(p.emotionalTriggers).toEqual(['当众被指出错误', '时间被压缩'])
    expect(p.failurePatterns).toEqual(['学了开头就放弃', '复盘总停留在情绪层'])
    expect(p.priorAttempts).toBe('去年学过但没坚持')
    expect(p.communicationStyle).toBe('先说症状，被追问才展开')
    expect(p.motivationOrientation).toBe('避免出错的压力驱动')
    expect(p.resiliencePattern).toBe('失败后先沉默再复盘')
    expect(p.digitalLiteracy).toBe('会用常用办公软件')
    expect(p.behaviorBoundaries).toEqual(['不会主动汇报进展'])
    expect(p.learningPreferences).toEqual(['边做边学'])
    // legacy backfill 不受影响
    expect(p.metacognitiveProfile).toBe('很少自我检查')
    expect(p.selfRegulationStyle).toBe(seed.planningFollowThrough)
  })

  it('normalize 对缺少 canonical 扩展字段的输出给出空数组/null 而非报错', () => {
    const output = normalizePersonaOutput({ personaSeed: validPersonaSeed() })
    expect(output.personaSeed.communicationStyle).toBeNull()
    expect(output.personaSeed.behaviorBoundaries).toEqual([])
  })
})

/**
 * P1-15（PD-1）：age 不再被 [18,60] 硬夹——学生身份与年龄必须自洽，越界校验失败重试而非夹值。
 * 实证：36 条「小学四年级学生|age=18」落库并整包进模拟器 payload（扮演上下文年龄与身份矛盾）。
 */
describe('virtual-learner-persona-designer P1-15：学段与年龄一致性（不夹值）', () => {
  it('detectStudentStage：识别义务教育/高中学生身份', () => {
    expect(detectStudentStage({ nameHint: '小学四年级学生' })).toBe('小学')
    expect(detectStudentStage({ nameHint: '九年级在读学生' })).toBe('初中')
    expect(detectStudentStage({ nameHint: '高三学生', occupation: '高三在读' })).toBe('高中')
  })

  it('detectStudentStage：家长/教师/陪读语境不判为学生（避免误伤）', () => {
    expect(detectStudentStage({ nameHint: '四年级陪读妈妈-计算关' })).toBeNull()
    expect(detectStudentStage({ nameHint: '编内小学语文老师·想靠图文起号' })).toBeNull()
    expect(detectStudentStage({ nameHint: '母婴店店员转行考小学教资' })).toBeNull()
    expect(detectStudentStage({ nameHint: '销售主管' })).toBeNull()
  })

  it('detectStudentStage：语境词只跳过所在字段——nameHint 带「妈妈」但 occupation/education 是学生时仍判学段', () => {
    // 实证：DB 行 nameHint='初二英语妈妈-小宇'、occupation='学生'、education='初中八年级（初二）'、age=18
    expect(
      detectStudentStage({ nameHint: '初二英语妈妈-小宇', occupation: '学生', education: '初中八年级（初二）' })
    ).toBe('初中')
    expect(
      detectStudentStage({
        nameHint: 'rw-school5-16｜四年级女生·全科八十几分·妈妈陪学半小时',
        occupation: '小学生（四年级在读）',
        education: '小学四年级（人教版，语数英全科）',
      })
    ).toBe('小学')
    // 全字段都是家长语境时才排除
    expect(detectStudentStage({ nameHint: '陪读妈妈', occupation: '家长', education: '本科' })).toBeNull()
  })

  it('validateStageAgeConsistency：小学生 age=18 → 校验失败（不夹值）', () => {
    const result = validateStageAgeConsistency({ nameHint: '小学四年级学生', age: 18 })
    expect(result.valid).toBe(false)
    expect(result.failureReason).toContain('小学')
    expect(result.failureReason).toContain('18')
  })

  it('validatePersonaOutput：小学学生 age=18 被拒绝（走重试，而非 normalize 夹成 18）', () => {
    const seed = { ...validPersonaSeed(), nameHint: '小学四年级学生', occupation: '学生', education: '小学四年级', age: 18 }
    const result = validatePersonaOutput({ personaSeed: seed })
    expect(result.valid).toBe(false)
    expect(result.failureReason).toContain('PERSONA_OUTPUT_INVALID')
  })

  it('validatePersonaOutput：小学学生 age=10 通过；初中 13 岁、高中 16 岁通过', () => {
    expect(validatePersonaOutput({ personaSeed: { ...validPersonaSeed(), nameHint: '小学四年级学生', age: 10 } }).valid).toBe(true)
    expect(validatePersonaOutput({ personaSeed: { ...validPersonaSeed(), nameHint: '初二在读学生', age: 13 } }).valid).toBe(true)
    expect(validatePersonaOutput({ personaSeed: { ...validPersonaSeed(), nameHint: '高三学生', age: 16 } }).valid).toBe(true)
  })

  it('成人身份不受学段区间约束：63 岁退休自学者保留 63（不再被夹到 60）', () => {
    const seed = { ...validPersonaSeed(), nameHint: '63岁退休机修工·零基础英语自学者', occupation: '退休机修工', age: 63 }
    expect(validatePersonaOutput({ personaSeed: seed }).valid).toBe(true)
    const output = normalizePersonaOutput({ personaSeed: seed })
    expect(output.personaSeed.age).toBe(63)
  })

  it('normalize 不再把小学生夹成 18：age=10 原样保留', () => {
    const output = normalizePersonaOutput({ personaSeed: { ...validPersonaSeed(), nameHint: '小学四年级学生', age: 10 } })
    expect(output.personaSeed.age).toBe(10)
  })

  it('normalize 通用兜底仅压明显异常值（3-100），不夹学段', () => {
    const low = normalizePersonaOutput({ personaSeed: { ...validPersonaSeed(), age: 1 } })
    expect(low.personaSeed.age).toBe(3)
    const high = normalizePersonaOutput({ personaSeed: { ...validPersonaSeed(), age: 200 } })
    expect(high.personaSeed.age).toBe(100)
    const missing = normalizePersonaOutput({ personaSeed: { ...validPersonaSeed(), age: undefined } })
    expect(missing.personaSeed.age).toBe(28)
  })
})
