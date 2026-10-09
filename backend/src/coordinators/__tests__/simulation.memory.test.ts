/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 记忆回写接线包（审计 P1-1/P1-2/P1-3 + P2-32）单元测试
 *
 * 钉死的契约：
 * - P1-1：executeSkill 已解包（skills/index.ts return result.output），
 *   消费方不得再检查 `.success`（恒 undefined → 恒 null）。本套构造
 *   **不带 success 字段** 的 output，断言记忆提炼结果非空。
 * - P1-2：不再写死 conceptualMastery=0.85 / selfReportedTaskDone=true；
 *   mastery 取 curator confidence；写回遍历全量名单（curatedConcepts）。
 * - P1-3：收束轮 learnerState / latestLearnerFeedback 挂到最后一轮 turnSequence。
 * - P2-32：evidence/confidence/severity 随名单透传（不再只留 name）。
 */
const mockExecuteSkill = jest.fn()
const mockWriteProfileConcepts = jest.fn()
const mockRecordCompletedArtifact = jest.fn()

jest.mock('../../skills', () => ({
  __esModule: true,
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
  virtualLearnerMemoryCuratorDefinition: { name: 'virtual-learner-memory-curator', version: '1.0.0' },
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    teaching_sessions: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}))

jest.mock('../../services/memory/memory-trace.service', () => ({
  memoryTraceService: { getDueTraces: jest.fn().mockResolvedValue([]) },
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

// 只替换落库出口，保留真实 deriveCuratedSelfState（被测的接线逻辑）
jest.mock('../../virtual-lab/learner-memory', () => {
  const actual = jest.requireActual('../../virtual-lab/learner-memory')
  return {
    __esModule: true,
    ...actual,
    writeProfileConceptsAfterLesson: (...args: unknown[]) => mockWriteProfileConcepts(...args),
    recordCompletedArtifact: (...args: unknown[]) => mockRecordCompletedArtifact(...args),
  }
})

import {
  persistAssistedLearnerMemory,
  runAssistedMemoryCurator,
} from '../simulation.memory'

function assistedSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vs1',
    userId: 'u1',
    stageResults: JSON.stringify({
      teaching: {
        teachingSessionId: 'teach1',
        learnerState: { conceptualMastery: 0.5, taskUnderstanding: 0.6, wantsHint: true },
        latestLearnerFeedback: { selfReportedTaskDone: false, confidence: 0.4, wantsMoreHelp: true, remainingBlockers: ['白平衡'] },
        conversationHistory: [
          { role: 'learner', content: '我先按教程试了一下' },
          { role: 'learner', content: '还是不太会，白平衡搞不定' },
        ],
      },
    }),
    virtual_learner_profiles: {
      profile: JSON.stringify({ learningStyle: 'doing' }),
      learningGoal: '学会剪辑',
    },
    ...overrides,
  } as any
}

const task = {
  id: 't1',
  title: '探店视频初剪',
  linkedConcept: '剪辑节奏',
  acceptanceCriteria: '剪出 30 秒卡点',
  taskType: 'project',
} as any

describe('P1-1：executeSkill 已解包，不得再检查 .success', () => {
  beforeEach(() => jest.clearAllMocks())

  it('output 不带 success 字段时，记忆提炼结果仍非空（旧代码恒 null）', async () => {
    // 关键：构造的 output 上没有 success —— 正是 skills/index.ts executeSkill 的真实返回形状
    mockExecuteSkill.mockResolvedValue({
      masteredConcepts: [{ name: '剪辑节奏', evidence: '自己剪了一段能对上', confidence: 0.8 }],
      struggleConcepts: [{ name: '调色', blocker: '白平衡搞不定', severity: 'high' }],
      selfCalibration: '高估倾向，自评需打折',
      memoryDelta: '这课我掌握了剪辑节奏，调色还不行。',
    })

    const curated = await runAssistedMemoryCurator(assistedSession(), { conversationHistory: [] }, task)

    expect(curated).not.toBeNull()
    expect(curated!.masteredConcepts.map((m) => m.name)).toEqual(['剪辑节奏'])
    expect(curated!.struggleConcepts.map((s) => s.name)).toEqual(['调色'])
    expect(curated!.memoryDelta).toContain('剪辑节奏')
  })

  it('executeSkill 返回 null 时才走 fallback（return null）', async () => {
    mockExecuteSkill.mockResolvedValue(null)
    const curated = await runAssistedMemoryCurator(assistedSession(), { conversationHistory: [] }, task)
    expect(curated).toBeNull()
  })
})

describe('P1-3：收束轮 learnerState / learnerFeedback 挂到最后一轮 turnSequence', () => {
  beforeEach(() => jest.clearAllMocks())

  it('最后一轮带 learnerState/learnerFeedback，其余轮缺席', async () => {
    mockExecuteSkill.mockResolvedValue({ masteredConcepts: [], struggleConcepts: [] })
    const session = assistedSession()
    const learningState = JSON.parse(session.stageResults).teaching as Record<string, unknown>

    await runAssistedMemoryCurator(session, learningState, task)

    const input = mockExecuteSkill.mock.calls[0][1] as any
    const turns = input.turnSequence
    expect(turns).toHaveLength(2)
    expect(turns[0].learnerState).toBeUndefined()
    expect(turns[0].learnerFeedback).toBeUndefined()
    expect(turns.at(-1).learnerState).toEqual(expect.objectContaining({ conceptualMastery: 0.5, wantsHint: true }))
    expect(turns.at(-1).learnerFeedback).toEqual(expect.objectContaining({
      selfReportedTaskDone: false, confidence: 0.4, remainingBlockers: ['白平衡'],
    }))
    // P2-32：assisted 链无绝对轮号（conversationHistory 上游已 trim 到 ≤6），turn 即窗口内序号
    expect(turns.map((t: any) => t.turn)).toEqual([1, 2])
  })
})

describe('P1-2：mastery 来自 curator confidence，不再写死 0.85', () => {
  beforeEach(() => jest.clearAllMocks())

  it('confidence 0.55 的 mastered → conceptualMastery=0.55（非 0.85），taskDone=false', async () => {
    mockExecuteSkill.mockResolvedValue({
      masteredConcepts: [{ name: '剪辑节奏', evidence: '感觉还行', confidence: 0.55 }],
      struggleConcepts: [],
      selfCalibration: '自评偏高',
      memoryDelta: '这课我勉强算学会了剪辑节奏。',
    })

    await persistAssistedLearnerMemory('vs1', assistedSession(), task)

    expect(mockRecordCompletedArtifact).toHaveBeenCalledTimes(1)
    const arg = mockRecordCompletedArtifact.mock.calls[0][0] as any
    expect(arg.selfState.conceptualMastery).toBe(0.55)
    expect(arg.selfState.conceptualMastery).not.toBe(0.85)
    expect(arg.selfState.selfReportedTaskDone).toBe(false)
  })

  it('学习者原话 selfReportedTaskDone 被尊重（curator 不得代答）', async () => {
    mockExecuteSkill.mockResolvedValue({
      masteredConcepts: [{ name: '剪辑节奏', evidence: '会了', confidence: 0.9 }],
      struggleConcepts: [],
      selfCalibration: '较准',
      memoryDelta: '掌握了剪辑节奏。',
    })
    const session = assistedSession()
    const stage = JSON.parse(session.stageResults)
    stage.teaching.latestLearnerFeedback = { selfReportedTaskDone: false, confidence: 0.9 }
    session.stageResults = JSON.stringify(stage)

    await persistAssistedLearnerMemory('vs1', session, task)

    const arg = mockRecordCompletedArtifact.mock.calls[0][0] as any
    expect(arg.selfState.selfReportedTaskDone).toBe(false)
    expect(arg.selfState.conceptualMastery).toBe(0.9)
  })

  it('写回遍历 curator 全量名单（curatedConcepts），不是单 conceptName', async () => {
    mockExecuteSkill.mockResolvedValue({
      masteredConcepts: [
        { name: '剪辑节奏', evidence: 'a', confidence: 0.8 },
        { name: '转场', evidence: 'b', confidence: 0.75 },
      ],
      struggleConcepts: [
        { name: '调色', blocker: '白平衡', severity: 'high' },
        { name: '曲线', blocker: '不会用', severity: 'medium' },
      ],
      selfCalibration: '较准',
      memoryDelta: '多个概念',
    })

    await persistAssistedLearnerMemory('vs1', assistedSession(), task)

    const writeArg = mockWriteProfileConcepts.mock.calls[0][2] as any
    expect(writeArg.curatedConcepts.mastered).toEqual(['剪辑节奏', '转场'])
    expect(writeArg.curatedConcepts.struggling).toEqual(['调色', '曲线'])
  })
})

describe('P2-32：evidence/confidence/severity 随名单落库', () => {
  beforeEach(() => jest.clearAllMocks())

  it('memoryCurated 保留 evidence 与 severity（不再只留 name）', async () => {
    mockExecuteSkill.mockResolvedValue({
      masteredConcepts: [{ name: '剪辑节奏', evidence: '第23轮自己发现的', confidence: 0.8 }],
      struggleConcepts: [{ name: '调色', blocker: '白平衡搞不定', severity: 'high' }],
      selfCalibration: '较准',
      memoryDelta: 'x',
    })

    await persistAssistedLearnerMemory('vs1', assistedSession(), task)

    const arg = mockRecordCompletedArtifact.mock.calls[0][0] as any
    expect(arg.memoryCurated.mastered[0]).toEqual(expect.objectContaining({
      name: '剪辑节奏', evidence: '第23轮自己发现的', confidence: 0.8,
    }))
    expect(arg.memoryCurated.struggling[0]).toEqual(expect.objectContaining({
      name: '调色', blocker: '白平衡搞不定', severity: 'high',
    }))
  })
})