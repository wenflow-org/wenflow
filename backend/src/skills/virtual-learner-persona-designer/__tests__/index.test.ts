import { validatePersonaOutput, normalizePersonaOutput } from '../index'

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
