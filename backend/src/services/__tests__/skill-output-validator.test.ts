import {
  validateOutputAgainstFields,
  validateCoreFieldDeclarations,
  validateSkillOutputFields,
  isFieldValidatedSkill,
  type CoreFieldDeclaration,
} from '../skill-output-validator'

const FIELDS: CoreFieldDeclaration[] = [
  { name: 'reply', type: 'string', desc: '回复正文', turn: true },
  { name: 'confidence', type: 'number' },
  { name: 'isCompleted', type: 'boolean' },
  { name: 'stage', type: 'enum', desc: 'understanding | proposing | ready' },
  { name: 'points', type: 'object[]' },
  { name: 'tags', type: 'string[]' },
  { name: 'optionalPayload', type: 'object?' },
  { name: 'optionalNote', type: 'string?' },
]

describe('validateOutputAgainstFields', () => {
  it('合法输出通过', () => {
    const result = validateOutputAgainstFields({
      reply: '好的',
      confidence: 0.8,
      isCompleted: false,
      stage: 'proposing',
      points: [{ name: 'x', status: 'learning' }],
      tags: ['a', 'b'],
    }, FIELDS)
    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('必填字段缺失报 missing-required', () => {
    const result = validateOutputAgainstFields({ reply: '好的' }, FIELDS)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.field === 'confidence' && i.code === 'missing-required')).toBe(true)
    expect(result.issues.some((i) => i.field === 'stage' && i.code === 'missing-required')).toBe(true)
  })

  it('类型不匹配报 type-mismatch', () => {
    const result = validateOutputAgainstFields({
      reply: 123,
      confidence: '0.8',
      isCompleted: 'yes',
      stage: 'proposing',
      points: 'not-array',
      tags: [1, 2],
    }, FIELDS)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.field === 'reply' && i.code === 'type-mismatch')).toBe(true)
    expect(result.issues.some((i) => i.field === 'confidence' && i.code === 'type-mismatch')).toBe(true)
    expect(result.issues.some((i) => i.field === 'points' && i.code === 'type-mismatch')).toBe(true)
    expect(result.issues.some((i) => i.field === 'tags' && i.code === 'type-mismatch')).toBe(true)
  })

  it('enum 越界报 enum-out-of-range', () => {
    const result = validateOutputAgainstFields({
      reply: 'x',
      confidence: 0.5,
      isCompleted: false,
      stage: 'finished',
    }, FIELDS)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.field === 'stage' && i.code === 'enum-out-of-range')).toBe(true)
  })

  it('可选字段（?）缺失合法', () => {
    const result = validateOutputAgainstFields({
      reply: 'x',
      confidence: 0.5,
      isCompleted: false,
      stage: 'ready',
      points: [],
      tags: [],
    }, FIELDS)
    expect(result.valid).toBe(true)
  })

  it('object[]? 字段（opening quickReplies 场景）：缺失/空数组合法，非数组仍拦', () => {
    const OPENING_FIELDS: CoreFieldDeclaration[] = [
      { name: 'message', type: 'string' },
      { name: 'question', type: 'string?' },
      { name: 'quickReplies', type: 'object[]?' },
      { name: 'mode', type: 'enum?', desc: 'example-first|predict|self-assess' },
    ]
    // 模型合理省略动作与引导（重学/收束场景）：缺失合法
    expect(validateOutputAgainstFields({ message: '继续上次内容' }, OPENING_FIELDS).valid).toBe(true)
    // 空数组动作也合法
    expect(validateOutputAgainstFields({ message: 'x', question: 'q', quickReplies: [], mode: 'predict' }, OPENING_FIELDS).valid).toBe(true)
    // 存在但类型错（输出成对象/字符串）仍拦截，契约不放松畸形结构
    const bad = validateOutputAgainstFields({ message: 'x', quickReplies: { text: '开始' } }, OPENING_FIELDS)
    expect(bad.valid).toBe(false)
    expect(bad.issues.some((i) => i.field === 'quickReplies' && i.code === 'type-mismatch')).toBe(true)
  })

  it('根对象非对象报失败', () => {
    expect(validateOutputAgainstFields('not-object', FIELDS).valid).toBe(false)
    expect(validateOutputAgainstFields(null, FIELDS).valid).toBe(false)
  })
})

describe('validateCoreFieldDeclarations', () => {
  it('重复声明与非法类型报错', () => {
    const errors = validateCoreFieldDeclarations([
      { name: 'a', type: 'string' },
      { name: 'a', type: 'string' },
      { name: 'b', type: 'weird-type' },
    ])
    expect(errors.some((e) => e.includes('重复'))).toBe(true)
    expect(errors.some((e) => e.includes('weird-type'))).toBe(true)
  })

  it('受控词表全部合法', () => {
    const errors = validateCoreFieldDeclarations([
      { name: 's', type: 'string' },
      { name: 'n', type: 'number' },
      { name: 'b', type: 'boolean' },
      { name: 'e', type: 'enum' },
      { name: 'o', type: 'object' },
      { name: 'oa', type: 'object[]' },
      { name: 'sa', type: 'string[]' },
      { name: 'o?', type: 'object?' },
    ])
    expect(errors).toEqual([])
  })
})

describe('validateSkillOutputFields（P3 运行时入口）', () => {
  it('默认启用的 skill 从 core 文件加载 fields 并校验', async () => {
    expect(isFieldValidatedSkill('skill:teaching-turn')).toBe(true)
    expect(isFieldValidatedSkill('skill:generic-chat')).toBe(false)
    expect(isFieldValidatedSkill('skill:semantic-freeze-judge')).toBe(false)
    const result = await validateSkillOutputFields('skill:teaching-turn', {
      reply: '讲解一下',
      analysis: { understanding: 0.6 },
      knowledge: { currentPoint: '闭包', points: [] },
      pedagogy: { strategies: ['explain'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    })
    // teaching-turn 的 fields 含必填 reply/analysis/knowledge/pedagogy/control
    expect(result).not.toBeNull()
    expect(result!.valid).toBe(true)
  })

  it('排除名单内的 skill 返回 null（跳过）', async () => {
    expect(await validateSkillOutputFields('skill:generic-chat', {})).toBeNull()
    expect(await validateSkillOutputFields('skill:virtual-learner-referee', {})).toBeNull()
  })

  it('delta 模式仅验类型，缺席合法', async () => {
    const result = await validateSkillOutputFields('skill:goal-conversation', {
      reply: '再问一个问题',
    })
    expect(result).not.toBeNull()
    expect(result!.valid).toBe(true)
  })
})
