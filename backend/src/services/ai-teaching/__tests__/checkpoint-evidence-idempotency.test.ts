/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #173-1②③：检查点证据的两条幂等契约
 *
 * ② `recordCheckpointResultEvidence` 的 eventId 必须**稳定**（`checkpoint:<cpId>`，不含时间戳），
 *    重试/重放 upsert 到同一行——此前 eventId 带 `at.getTime()`，一次提交重试就叠加一行。
 * ③ `recordCheckpointAttemptEvidence` 的终局允许升级（unresolved → attempts_exhausted），
 *    但不得被更弱的终局降级；同级重复触发保持首行。
 *
 * DB 用**带唯一键语义的内存替身**：upsert 按 (eventId, evidenceKey) 匹配，命中则原地更新。
 * 这样「行数」是真实可断言的，而不是只看 mock 调用次数。
 */
const evidenceRows = new Map<string, any>()

function rowKey(eventId: string, evidenceKey: string) {
  return `${eventId}\u0000${evidenceKey}`
}

const mockUpsert = jest.fn(async (args: any) => {
  const { eventId, evidenceKey } = args.where.eventId_evidenceKey
  const key = rowKey(eventId, evidenceKey)
  const existing = evidenceRows.get(key)
  if (existing) {
    evidenceRows.set(key, { ...existing, ...(args.update || {}) })
    return evidenceRows.get(key)
  }
  const created = { id: args.create.id, ...args.create }
  evidenceRows.set(key, created)
  return created
})

const mockFindUnique = jest.fn(async (args: any) => {
  const { eventId, evidenceKey } = args.where.eventId_evidenceKey
  const row = evidenceRows.get(rowKey(eventId, evidenceKey))
  if (!row) return null
  return args.select?.payload ? { payload: row.payload } : row
})

const mockCreate = jest.fn(async (args: any) => {
  const key = rowKey(args.data.eventId, args.data.evidenceKey)
  if (evidenceRows.has(key)) {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
  }
  evidenceRows.set(key, args.data)
  return args.data
})

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learner_evidence: {
      create: (args: any) => mockCreate(args),
      upsert: (args: any) => mockUpsert(args),
      findUnique: (args: any) => mockFindUnique(args),
    },
  },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../learner/anchor-probe', () => ({
  shouldRunAnchorProbe: jest.fn(() => false),
  partitionDelayedAnchorCandidates: jest.fn(() => ({ candidates: [], skipped: [] })),
  selectAnchorCandidates: jest.fn(() => []),
  evaluateAnchorProbeOutcome: jest.fn(() => ({ signal: 'consistent', falsified: false })),
}))
jest.mock('../anchor-probe-emit', () => ({
  ANCHOR_RESULT_LOOKBACK: 20,
  summarizeAnchorEvidence: jest.fn(() => ({ lastProbeAt: null, probesSinceLastFlag: 0 })),
  buildAnchorSignalSource: jest.fn(() => ({})),
  buildDelayedAnchorCandidatesFromLearnerSignals: jest.fn(() => []),
  resolveDelayedAnchorDays: jest.fn(() => 7),
  deriveTurnsSinceLastProbe: jest.fn(() => 0),
  buildAnchorCandidatesFromLearnerSignals: jest.fn(() => []),
  buildAnchorResultEvidence: jest.fn(() => ({})),
  anchorResultEvidenceKey: jest.fn(() => ({ eventId: 'e', evidenceKey: 'k' })),
}))
jest.mock('../../../skills/degradation-telemetry', () => ({
  recordDegradation: jest.fn(),
  degradationCause: jest.fn(() => ''),
}))

import {
  checkpointResultEventId,
  recordCheckpointAttemptEvidence,
  recordCheckpointResultEvidence,
} from '../teaching-checkpoint'

const session = { id: 'sess-1', userId: 'user-1', learningPathId: 'path-1', taskId: 'task-1' } as any
const checkpoint = { id: 'cp-1', type: 'short_answer', title: '理解检查', question: 'q' } as any

beforeEach(() => {
  jest.clearAllMocks()
  evidenceRows.clear()
})

describe('#173-1② checkpoint:result 稳定幂等键', () => {
  it('同一 checkpoint 提交重试只产生一行证据（eventId 不含时间戳）', async () => {
    await recordCheckpointResultEvidence(session, checkpoint, {
      passed: false,
      judgedBy: 'code',
      detail: '缺少要点：重新',
      submission: { selectedOptionIds: ['A'] },
    })
    // 模拟网关超时后的同一次提交重试（间隔 1.2s，旧实现会产生第二个带新时间戳的 eventId）
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await recordCheckpointResultEvidence(session, checkpoint, {
      passed: false,
      judgedBy: 'code',
      detail: '缺少要点：重新',
      submission: { selectedOptionIds: ['A'] },
    })

    expect(evidenceRows.size).toBe(1)
    const [key] = Array.from(evidenceRows.keys())
    expect(key).toBe(rowKey('checkpoint:cp-1', 'checkpoint:result:cp-1'))
    expect(checkpointResultEventId('cp-1')).toBe('checkpoint:cp-1')
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    for (const call of mockUpsert.mock.calls) {
      expect(call[0].where.eventId_evidenceKey).toEqual({
        eventId: 'checkpoint:cp-1',
        evidenceKey: 'checkpoint:result:cp-1',
      })
    }
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('同题重答（答错→答对）收敛为最新一次结果，仍只有一行', async () => {
    await recordCheckpointResultEvidence(session, checkpoint, {
      passed: false, judgedBy: 'code', detail: '缺少要点', submission: {},
    })
    await recordCheckpointResultEvidence(session, checkpoint, {
      passed: true, judgedBy: 'code', detail: '作答包含全部要点', submission: {},
    })

    expect(evidenceRows.size).toBe(1)
    const [row] = Array.from(evidenceRows.values())
    const payload = JSON.parse(row.payload)
    expect(payload.passed).toBe(true)
    expect(payload.detail).toBe('作答包含全部要点')
  })
})

describe('#173-1③ checkpoint:attempt 终局可升级但不可降级', () => {
  it('unresolved（收尾仍挂起）之后真答到顶 → 同一行升级为 attempts_exhausted', async () => {
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'unresolved' })
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'attempts_exhausted', attempts: 2 })

    expect(evidenceRows.size).toBe(1)
    const [row] = Array.from(evidenceRows.values())
    const payload = JSON.parse(row.payload)
    expect(payload.outcome).toBe('attempts_exhausted')
    expect(payload.attempts).toBe(2)
    // 第二写走的是 update（不是再插入一行）
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    expect(mockUpsert.mock.calls[1][0].update).toEqual(expect.objectContaining({ occurredAt: expect.any(Date) }))
  })

  it('attempts_exhausted 之后更弱的 unresolved 不覆盖终局', async () => {
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'attempts_exhausted', attempts: 2 })
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'unresolved' })

    expect(evidenceRows.size).toBe(1)
    const [row] = Array.from(evidenceRows.values())
    expect(JSON.parse(row.payload).outcome).toBe('attempts_exhausted')
    // 同终局/更弱终局不再写库
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })

  it('同一终局重复触发保持幂等（不重复写）', async () => {
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'skipped' })
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'skipped' })

    expect(evidenceRows.size).toBe(1)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(JSON.parse(Array.from(evidenceRows.values())[0].payload).outcome).toBe('skipped')
  })
})
