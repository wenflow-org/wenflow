/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #240：`GET /api/ai-teaching/sessions/:id/detail` 把检查点答案键下发给学生。
 *
 * 真实测评（真实 HTTP + dev.db 只读 SQL）定位到两条泄漏路径：
 *  1. `state.lastRuntimeEnvelope.artifact.control.checkpoint`（写侧模型原始输出，未剥）；
 *  2. `messages[].promptDebug.normalizedOutput.control.checkpoint`（2026-10-08 promptDebug
 *     停写前的存量行）。
 * 本用例直接跑 `getSessionDetail`（而不是只测纯函数），断言**整个响应体**序列化后
 * 不含 `correctOptionIds` / `expectedKeywords`，同时确认回放要用的学员作答与对错仍在。
 */
const mockGetById = jest.fn()
const mockGetCurrentState = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {},
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../skills', () => ({
  executeSkill: jest.fn(),
  peerAgentDefinition: {},
  auxSkillDefinitionMap: {},
}))
jest.mock('../teaching-turn-engine', () => ({ processStudentMessage: jest.fn() }))
jest.mock('../warmup-writeback', () => ({ applyWarmupExtractionForSession: jest.fn(async () => undefined) }))
jest.mock('../TeachingOperationLeaseGuard', () => ({
  TeachingOperationLeaseGuard: class {
    start() {}
    stop() {}
  },
}))
jest.mock('../teaching-classroom-flow', () => ({
  buildTeachingStateWithArtifacts: (state: unknown) => state,
}))
jest.mock('../TeachingSessionRepository', () => {
  const actual = jest.requireActual('../TeachingSessionRepository')
  return {
    ...actual,
    teachingSessionRepository: {
      getById: (...args: unknown[]) => mockGetById(...args),
    },
  }
})
jest.mock('../../learning/learning-state.service', () => ({
  __esModule: true,
  default: { getCurrentState: (...args: unknown[]) => mockGetCurrentState(...args) },
}))

import { getSessionDetail } from '../teaching-session-ops'

const CHECKPOINT = {
  id: 'cp-1',
  title: '理解检查',
  type: 'single_choice' as const,
  question: '执行 a = 5、b = 2.5、c = "3" 后，哪一组类型判断正确？',
  options: [
    { id: 'A', text: 'a 是字符串' },
    { id: 'B', text: 'a 是整数、b 是浮点、c 是字符串' },
  ],
  correctOptionIds: ['B'],
  expectedKeywords: ['值本身的写法'],
  hint: '看值本身的写法…',
  allowSkip: true,
}

/** 真实行形状（dev.db 实测：pending 已剥、lastRuntimeEnvelope 仍为 ["B"]）。 */
function makeSession(pendingCheckpoint: any, withLegacyPromptDebug: boolean) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    taskId: 'task-1',
    learningPathId: null,
    milestoneId: null,
    subject: 'python',
    topic: '变量与类型',
    taskType: 'practice',
    mode: 'teaching',
    status: 'completed',
    revision: 7,
    knowledgeState: [],
    teachingState: {
      pendingCheckpoint,
      checkpointHistory: [
        {
          checkpointId: 'cp-0',
          question: '历史题',
          options: [
            { id: 'A', text: '选项 A' },
            { id: 'B', text: '选项 B' },
          ],
          selectedOptionIds: ['B'],
          submittedOptionIds: ['B'],
          correctOptionIds: ['B'],
          expectedKeywords: ['旧要点'],
          passed: true,
          skipped: false,
        },
      ],
      sessionArtifacts: {
        pendingCheckpoint,
        endReason: 'manual-end',
      },
      lastRuntimeEnvelope: {
        businessState: { phase: 'in-progress', isTerminal: false },
        artifact: {
          reply: '老师回复',
          control: { checkpoint: { ...CHECKPOINT } },
        },
      },
      lastBusinessPhase: 'in-progress',
    },
    messages: [
      { role: 'assistant', content: '我们来看这道题。', timestamp: '2026-10-01T10:00:00.000Z' },
      {
        role: 'user',
        content: 'B',
        timestamp: '2026-10-01T10:01:00.000Z',
        ...(withLegacyPromptDebug
          ? {
              promptDebug: {
                // 存量行实测形状：结构化副本 + **字符串**副本（模型原始输出）
                normalizedOutput: { control: { checkpoint: { ...CHECKPOINT } } },
                rawModelOutput: JSON.stringify({ control: { checkpoint: CHECKPOINT } }),
                extractedJson: JSON.stringify({ control: { checkpoint: CHECKPOINT } }),
                attempts: [{ rawOutput: JSON.stringify({ control: { checkpoint: CHECKPOINT } }) }],
              },
            }
          : {}),
      },
    ],
    wrapup: { summary: '本课小结' },
    advisory: null,
    startTime: new Date('2026-10-01T09:59:00.000Z'),
    endTime: new Date('2026-10-01T10:30:00.000Z'),
    duration: 31,
  }
}

const countAnswerKeys = (value: unknown): number =>
  (JSON.stringify(value).match(/correctOptionIds|expectedKeywords/g) || []).length

beforeEach(() => {
  jest.clearAllMocks()
  mockGetCurrentState.mockResolvedValue(null)
})

describe('getSessionDetail：答案键绝不下发（#240）', () => {
  it('state.lastRuntimeEnvelope.artifact.control.checkpoint 剥离（主路径）', async () => {
    mockGetById.mockResolvedValue(makeSession({ ...CHECKPOINT }, false))

    const detail: any = await getSessionDetail('sess-1', 'user-1')

    const envCheckpoint = detail.state.lastRuntimeEnvelope.artifact.control.checkpoint
    expect(envCheckpoint.question).toBe(CHECKPOINT.question)
    expect(envCheckpoint.options).toEqual(CHECKPOINT.options)
    expect(envCheckpoint).not.toHaveProperty('correctOptionIds')
    expect(envCheckpoint).not.toHaveProperty('expectedKeywords')
  })

  it('存量 messages[].promptDebug 整个信封不出现在响应里（第二路径）', async () => {
    mockGetById.mockResolvedValue(makeSession({ ...CHECKPOINT }, true))

    const detail: any = await getSessionDetail('sess-1', 'user-1')

    // 为什么整份剔除而不是只剥键：存量行里 rawModelOutput / extractedJson 是模型原始输出的
    // **字符串**，嵌着 control.checkpoint.correctOptionIds，按键名递归删不掉字符串里的副本。
    expect(detail.messages[1]).not.toHaveProperty('promptDebug')
    expect(JSON.stringify(detail)).not.toMatch(/promptDebug/)
    // 消息本体照常下发
    expect(detail.messages[1].content).toBe('B')
    expect(detail.messages[0].content).toBe('我们来看这道题。')
  })

  it('穷举式：整个响应体 grep correctOptionIds / expectedKeywords = 0', async () => {
    mockGetById.mockResolvedValue(makeSession({ ...CHECKPOINT }, true))

    const detail = await getSessionDetail('sess-1', 'user-1')
    const body = JSON.stringify({ success: true, data: detail })
    expect(body).not.toMatch(/correctOptionIds/)
    expect(body).not.toMatch(/expectedKeywords/)
    expect(countAnswerKeys({ success: true, data: detail })).toBe(0)
  })

  it('待答题另有未剥副本时（pendingCheckpoint 未剥）出口同样为 0', async () => {
    mockGetById.mockResolvedValue(makeSession({ ...CHECKPOINT }, true))

    const detail: any = await getSessionDetail('sess-1', 'user-1')
    expect(detail.pendingCheckpoint).not.toHaveProperty('correctOptionIds')
    expect(detail.state.pendingCheckpoint).not.toHaveProperty('correctOptionIds')
    expect(detail.state.sessionArtifacts.pendingCheckpoint).not.toHaveProperty('correctOptionIds')
  })

  it('回放所需字段保留：学员选择、对错、选项、题面（只剥答案键）', async () => {
    mockGetById.mockResolvedValue(makeSession({ ...CHECKPOINT }, true))

    const detail: any = await getSessionDetail('sess-1', 'user-1')

    expect(detail.state.checkpointHistory[0]).toEqual({
      checkpointId: 'cp-0',
      question: '历史题',
      options: [
        { id: 'A', text: '选项 A' },
        { id: 'B', text: '选项 B' },
      ],
      selectedOptionIds: ['B'],
      submittedOptionIds: ['B'],
      passed: true,
      skipped: false,
    })
    expect(detail.state.lastRuntimeEnvelope.artifact.reply).toBe('老师回复')
    expect(detail.state.sessionArtifacts.endReason).toBe('manual-end')
    expect(detail.messages).toHaveLength(2)
    expect(detail.messages[1].content).toBe('B')
  })

  it('不泄漏 rev 之外的其它投影：纯函数语义（不改库里的原始行）', async () => {
    const session = makeSession({ ...CHECKPOINT }, true)
    mockGetById.mockResolvedValue(session)

    await getSessionDetail('sess-1', 'user-1')

    expect(session.teachingState.pendingCheckpoint.correctOptionIds).toEqual(['B'])
    expect(session.teachingState.lastRuntimeEnvelope.artifact.control.checkpoint.correctOptionIds).toEqual(['B'])
  })
})
