const mockCallPrompt = jest.fn()

jest.mock('../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}))

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { teachingTurnAgentHandler } from '../teaching-turn'

type DeclaredFieldRole = { direction: string; visibility: string; owner?: string; export?: string }

/**
 * 读取平台层契约的 promptContract.fields，与 runtime 键对账。
 * v4：契约声明上收平台层（prompt-lab manifest），prompt 文件 frontmatter 不再携带 promptContract。
 */
function loadDeclaredFields(fileName: string): Record<string, DeclaredFieldRole> {
  const raw = fs.readFileSync(path.join(process.cwd(), '../prompts/manifests', fileName), 'utf-8')
  const meta = yaml.load(raw) as any
  return (meta?.promptContract?.fields || {}) as Record<string, DeclaredFieldRole>
}

const MINIMAL_INPUT = {
  messages: [
    { role: 'user' as const, content: '闭包到底是什么？' },
    { role: 'assistant' as const, content: '先看词法作用域。' },
    { role: 'user' as const, content: '那变量为什么不会被回收？' },
  ],
  learner: { stableProfile: {}, learningControlState: {} },
  scenario: {
    subject: 'JavaScript',
    topic: '闭包',
    taskTitle: '理解闭包',
    taskDescription: '解释闭包与变量生命周期',
    taskType: 'concept-explanation',
    taskProfile: { knowledgeType: 'conceptual', cognitiveLevel: 'understand', coreConcept: '闭包' },
  },
  knowledge: {
    points: [{ name: '闭包', status: 'learning' as const, progress: 40 }],
  },
  controls: { mode: 'tutor' as const },
}

const SUCCESS_RESULT = {
  success: true,
  output: {
    reply: '因为闭包引用了它。',
    analysis: {
      cognitiveLevel: 'understand',
      levelScore: 0.6,
      understanding: 0.6,
      confusionPoints: [],
      engagement: 0.8,
      emotionalState: 'neutral',
    },
    knowledge: { currentPoint: '闭包', points: [{ name: '闭包', status: 'learning', progress: 50 }] },
    pedagogy: { strategies: ['analogy'] },
    control: { isCompletionCandidate: false, shouldTriggerPeer: false },
  },
  runtimeEnvelope: { stub: true },
  debug: { attempts: [{ attempt: 1, status: 'success' }], systemPromptVersion: 1 },
}

describe('teaching-turn payload snapshot parity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT)
  })

  it('payload contains exactly the keys the prompt input spec declares', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    expect(mockCallPrompt).toHaveBeenCalledTimes(1)
    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})

    expect(Object.keys(payload).sort()).toEqual([
      'classroomContext',
      'classroomEventContext',
      'controls',
      'interactionProfile',
      'knowledge',
      'latestLearnerMessage',
      'learner',
      'promptDirectives',
      'scenario',
    ])
    expect(payload.interactionProfile).toBeNull()
    expect(payload).toMatchSnapshot({
      latestLearnerMessage: expect.any(String),
      promptDirectives: expect.any(Object),
    })
  })

  it('latestLearnerMessage picks the most recent user message', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})

    expect(payload.latestLearnerMessage).toBe('那变量为什么不会被回收？')
  })

  it('fields declaration reconciles with real payload and output keys (File-as-Truth)', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})
    const fields = loadDeclaredFields('teaching-turn.yaml')

    // 声明的 input 字段全部进入 payload；payload 顶层键都声明为 input 或 state
    const declaredInputs = Object.keys(fields).filter((key) => fields[key].direction === 'input')
    expect(declaredInputs.sort()).toEqual([
      'controls',
      'interactionProfile',
      'latestLearnerMessage',
      'promptDirectives',
      'scenario',
    ])
    for (const key of declaredInputs) expect(payload).toHaveProperty(key)
    for (const key of Object.keys(payload)) expect(['input', 'state']).toContain(fields[key]?.direction)

    // normalizeOutput 产出的顶层键都声明为 output 或 state
    const normalized = spec.normalizeOutput({
      reply: '继续。',
      analysis: { cognitiveLevel: 'understand' },
      knowledge: { currentPoint: '闭包', points: [{ name: '闭包', status: 'learning', progress: 50 }] },
      pedagogy: { strategies: ['analogy'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }, input)
    for (const key of Object.keys(normalized)) expect(['output', 'state']).toContain(fields[key]?.direction)

    // 阶段流程控制字段交给编排层；reply 面向用户
    expect(fields.control).toMatchObject({ direction: 'output', visibility: 'handoff' })
    expect(fields.reply).toMatchObject({ direction: 'output', visibility: 'user-visible' })
    expect(fields.knowledge).toMatchObject({ direction: 'state', visibility: 'handoff', owner: 'orchestrator' })
  })

  it('载荷缓存重排：scenario/learner 内逐回合变化的子键提取为尾部顶层键（2026-09-25）', async () => {
    const input = {
      ...MINIMAL_INPUT,
      learner: {
        ...MINIMAL_INPUT.learner,
        backgroundKnowledge: { reusableFoundations: ['作用域'] },
        taskDifficulty: { baseline: 'standard', adjusted: 'easier', reasons: ['fragile_concepts'], evidence: '上一节卡在闭包' },
      },
      scenario: {
        ...MINIMAL_INPUT.scenario,
        pathBackgroundContext: '整条路径的背景（整课恒定）',
        checkpointHistory: { total: 3, passed: 2, failed: 1, skipped: 0, recent: [{ title: '排水判断', passed: false }] },
        behavioralProfile: { avgUnderstanding: 0.62, sampleSize: 8 },
        priorMisconceptions: [{ conceptKey: '闭包', hypothesis: '学生可能混淆闭包与拷贝', canonicalLabel: null, confidence: 0.6, status: 'active', occurrenceCount: 1 }],
        supplementaryMaterial: { title: '补的材料', excerpt: '…' },
      },
    }
    await teachingTurnAgentHandler(input as any)

    const [spec, built] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(built, {})
    const keys = Object.keys(payload)

    // 提取后落在尾部：动态键不再出现在稳定区键名之后
    expect(keys.indexOf('behavioralProfile')).toBeGreaterThan(keys.indexOf('learner'))
    expect(keys.indexOf('checkpointHistory')).toBeGreaterThan(keys.indexOf('learner'))
    expect(keys.indexOf('taskDifficulty')).toBeGreaterThan(keys.indexOf('learner'))
    expect(keys.indexOf('priorMisconceptions')).toBeGreaterThan(keys.indexOf('learner'))
    // scenario/learner 体内不再携带这些动态子键（消除载荷内发散点）
    expect(payload.scenario).not.toHaveProperty('behavioralProfile')
    expect(payload.scenario).not.toHaveProperty('checkpointHistory')
    expect(payload.scenario).not.toHaveProperty('supplementaryMaterial')
    expect(payload.scenario).not.toHaveProperty('priorMisconceptions')
    expect(payload.learner).not.toHaveProperty('taskDifficulty')
    // 稳定子键保留原位
    expect(payload.scenario).toHaveProperty('pathBackgroundContext')
    expect(payload.learner).toHaveProperty('backgroundKnowledge')
    // 提取键的值原样搬运
    expect(payload.taskDifficulty).toEqual({ baseline: 'standard', adjusted: 'easier', reasons: ['fragile_concepts'], evidence: '上一节卡在闭包' })
    expect(payload.behavioralProfile).toEqual({ avgUnderstanding: 0.62, sampleSize: 8 })
    expect(payload.checkpointHistory).toEqual({ total: 3, passed: 2, failed: 1, skipped: 0, recent: [{ title: '排水判断', passed: false }] })
    expect(payload.supplementaryMaterial).toEqual({ title: '补的材料', excerpt: '…' })
    // conditionalRules（低频键）排在每回合必变键之前
    if (keys.includes('conditionalRules')) {
      expect(keys.indexOf('conditionalRules')).toBeLessThan(keys.indexOf('classroomEventContext'))
    }
  })

  it('buildMessages 分流：scenario/learner 并入 system 尾部，user 只留动态块（会话内缓存前缀最大化）', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})
    const messages = spec.buildMessages({ input, systemPrompt: 'SYSTEM', userPayload: JSON.stringify(payload) })

    expect(messages).toHaveLength(5) // system + 3 条历史 + user
    const [system] = messages
    const user = messages[messages.length - 1]
    // system = 原系统提示 + 稳定上下文后缀（scenario/learner 数据在内）
    expect(system.role).toBe('system')
    expect(system.content.startsWith('SYSTEM')).toBe(true)
    expect(system.content).toContain('【课堂稳定上下文】')
    expect(system.content).toContain('"subject":"JavaScript"')
    // user = 动态块 + 输出契约尾语；不再含 scenario/learner
    expect(user.role).toBe('user')
    const userParsed = JSON.parse(user.content.replace(/【输出契约】[\s\S]*$/, ''))
    expect(userParsed.scenario).toBeUndefined()
    expect(userParsed.learner).toBeUndefined()
    expect(userParsed.controls).toBeDefined()
    expect(userParsed.knowledge).toBeDefined()
    expect(user.content).toContain('【输出契约】')
    // 历史消息夹在中间、角色映射不变
    expect(messages.slice(1, -1).every((m: any) => m.role === 'user' || m.role === 'assistant')).toBe(true)
  })

  it('buildMessages 分流可用 PAYLOAD_STABLE_PREFIX=0 关闭（回退整体载荷形态）', async () => {
    const prev = process.env.PAYLOAD_STABLE_PREFIX
    process.env.PAYLOAD_STABLE_PREFIX = '0'
    try {
      await teachingTurnAgentHandler(MINIMAL_INPUT as any)
      const [spec, input] = mockCallPrompt.mock.calls[0]
      const payload = spec.buildUserPayload(input, {})
      const messages = spec.buildMessages({ input, systemPrompt: 'SYSTEM', userPayload: JSON.stringify(payload) })
      const user = messages[messages.length - 1]
      expect(messages[0].content).toBe('SYSTEM')
      expect(JSON.parse(user.content.replace(/【输出契约】[\s\S]*$/, ''))).toHaveProperty('scenario')
    } finally {
      if (prev === undefined) delete process.env.PAYLOAD_STABLE_PREFIX
      else process.env.PAYLOAD_STABLE_PREFIX = prev
    }
  })
})

describe('teaching-turn interactionProfile（认知负荷量测 · 前端情报层）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT)
  })

  const WITH_PROFILE = {
    ...MINIMAL_INPUT,
    scenario: {
      ...MINIMAL_INPUT.scenario,
      interactionProfile: {
        current: { draftMs: 24000, idleMsBefore: 90000, lastIdleMs: 6000, editingCount: 14, deleteCount: 38, charsPerSentence: 12 },
        history: [
          { role: 'assistant' as const, timestamp: '2026-08-07T10:00:00.000Z', meta: null, textLength: 200 },
          { role: 'user' as const, timestamp: '2026-08-07T10:01:00.000Z', meta: { draftMs: 5000, charsPerSentence: 28 }, textLength: 60 },
        ],
        absent: false,
      },
    },
  }

  it('payload carries interactionProfile when provided', async () => {
    await teachingTurnAgentHandler(WITH_PROFILE as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const payload = spec.buildUserPayload(input, {})

    expect(payload.interactionProfile).toMatchObject({
      absent: false,
      current: expect.objectContaining({ draftMs: 24000, charsPerSentence: 12 }),
      history: expect.arrayContaining([
        expect.objectContaining({ role: 'user', textLength: 60, meta: expect.objectContaining({ charsPerSentence: 28 }) }),
      ]),
    })
  })

  it('normalizeOutput defaults loadIndex 0.5 / loadBasis absent when model omits them', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const normalized = spec.normalizeOutput({
      reply: '继续。',
      analysis: { cognitiveLevel: 'understand', understanding: 0.6 },
      knowledge: { currentPoint: '闭包', points: [] },
      pedagogy: { strategies: ['analogy'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }, MINIMAL_INPUT)

    expect(normalized.analysis.loadIndex).toBe(0.5)
    expect(normalized.analysis.loadBasis).toBe('absent')
  })

  it('normalizeOutput clamps loadIndex into 0-1 and validates loadBasis enum', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const normalized = spec.normalizeOutput({
      reply: '继续。',
      analysis: { cognitiveLevel: 'understand', understanding: 0.6, loadIndex: 1.7, loadBasis: 'invented' },
      knowledge: { currentPoint: '闭包', points: [] },
      pedagogy: { strategies: ['analogy'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }, MINIMAL_INPUT)

    expect(normalized.analysis.loadIndex).toBe(1)
    expect(normalized.analysis.loadBasis).toBe('absent')
  })

  it('normalizeOutput keeps valid loadIndex and loadBasis from model', async () => {
    await teachingTurnAgentHandler(MINIMAL_INPUT as any)

    const [spec] = mockCallPrompt.mock.calls[0]
    const normalized = spec.normalizeOutput({
      reply: '继续。',
      analysis: { cognitiveLevel: 'understand', understanding: 0.6, loadIndex: 0.78, loadBasis: 'combined' },
      knowledge: { currentPoint: '闭包', points: [] },
      pedagogy: { strategies: ['analogy'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }, MINIMAL_INPUT)

    expect(normalized.analysis.loadIndex).toBe(0.78)
    expect(normalized.analysis.loadBasis).toBe('combined')
  })
})

describe('teaching-turn 完成判定（2026-08-30 起 LLM 语义判定，不再关键词硬匹配拦截）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCallPrompt.mockResolvedValue(SUCCESS_RESULT)
  })

  // 剪辑 demo 场景：学生口语表达与验收标准措辞完全不同，但语义已达成。
  // 旧逻辑（关键词子串匹配）会拦截；新逻辑：LLM 说完成即放行（由编排层知识硬门禁兜底）。
  const EDITING_INPUT = {
    ...MINIMAL_INPUT,
    scenario: {
      ...MINIMAL_INPUT.scenario,
      taskTitle: '复盘那次后悔点单并记下第一条线索',
      taskType: 'diagnose',
      currentTaskContext: {
        acceptanceCriteria: '复盘那次后悔点单，并记下第一条线索',
      },
      taskProfile: { knowledgeType: 'metacognitive', cognitiveLevel: 'analyze', coreConcept: '点单筛选标准' },
    },
    messages: [
      { role: 'user' as const, content: '我上次熬夜点炸鸡后悔了，下次先定好筛选标准，绑到周三晚上对账。' },
    ],
    knowledge: {
      points: [{ name: '点单筛选标准', status: 'mastered' as const, progress: 100 }],
    },
  }

  it('LLM 判定完成（isCompletionCandidate=true）即放行，即使学生措辞与验收标准完全不同', async () => {
    await teachingTurnAgentHandler(EDITING_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const normalized = spec.normalizeOutput({
      reply: '你这句已经把关键翻过来了——不是一次定完美，而是用下一次的真实感受去校准。这节就收在这里。',
      analysis: { cognitiveLevel: 'analyze', understanding: 0.8 },
      knowledge: {
        currentPoint: '点单筛选标准',
        points: [{ name: '点单筛选标准', status: 'mastered', progress: 100 }],
      },
      pedagogy: { strategies: ['reflect'] },
      control: { isCompletionCandidate: true, shouldTriggerPeer: false },
    }, input)

    // 核心断言：不再被关键词拦截
    expect(normalized.control.isCompletionCandidate).toBe(true)
    // 观测信号仍在：规则判定结果为 rejected（措辞不匹配），但不再影响完成判定
    expect(normalized.control.completionCandidateEvidence).toMatchObject({
      hasCriteria: true,
      decision: 'rejected',
    })
  })

  it('LLM 判定未完成（isCompletionCandidate=false）时保持不完成', async () => {
    await teachingTurnAgentHandler(EDITING_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const normalized = spec.normalizeOutput({
      reply: '我们再确认一下：具体哪条线索记下来？',
      analysis: { cognitiveLevel: 'analyze', understanding: 0.4 },
      knowledge: {
        currentPoint: '点单筛选标准',
        points: [{ name: '点单筛选标准', status: 'learning', progress: 50 }],
      },
      pedagogy: { strategies: ['scaffold'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }, input)

    expect(normalized.control.isCompletionCandidate).toBe(false)
  })

  it('validateParsedOutput：LLM 完成 + 知识点全 mastered 时允许宣布完成', async () => {
    await teachingTurnAgentHandler(EDITING_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const validation = spec.validateParsedOutput({
      reply: '本节已完成，我们进入下一环节。',
      analysis: { cognitiveLevel: 'analyze' },
      knowledge: {
        currentPoint: '点单筛选标准',
        points: [{ name: '点单筛选标准', status: 'mastered', progress: 100 }],
      },
      pedagogy: { strategies: ['reflect'] },
      control: { isCompletionCandidate: true, shouldTriggerPeer: false },
    }, input)

    expect(validation).toEqual({ valid: true })
  })

  it('validateParsedOutput：LLM 未完成但回复宣称完成时仍报 MISMATCH（保留防虚假完成）', async () => {
    await teachingTurnAgentHandler(EDITING_INPUT as any)

    const [spec, input] = mockCallPrompt.mock.calls[0]
    const validation = spec.validateParsedOutput({
      reply: '本节已完成，我们进入下一环节。',
      analysis: { cognitiveLevel: 'analyze' },
      knowledge: {
        currentPoint: '点单筛选标准',
        points: [{ name: '点单筛选标准', status: 'learning', progress: 50 }],
      },
      pedagogy: { strategies: ['reflect'] },
      control: { isCompletionCandidate: false, shouldTriggerPeer: false },
    }, input)

    expect(validation).toEqual({ valid: false, failureReason: 'TEACHING_TURN_REPLY_COMPLETION_MISMATCH' })
  })
})
