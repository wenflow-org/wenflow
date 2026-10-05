/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H1 检查点尝试留痕（checkpoint:attempt）单测：
 *  - skipped / attempts_exhausted / unresolved 三类终局各落一行，payload 带 outcome（到顶带 attempts）；
 *  - 幂等键由 checkpointId 派生（同一终局 upsert 到同一 (eventId, evidenceKey)，update 为空=终局不可变）；
 *  - 失败吞掉：DB 抛错不影响主链（只 warn，不抛）。
 *
 * 只 mock 外部协作者（DB/logger/邻接域模块），被测的留痕实现走真实代码。
 */
const mockUpsert = jest.fn(async (..._args: any[]) => undefined)

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { learner_evidence: { upsert: (...args: any[]) => mockUpsert(...(args as [])) } },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
// 邻接域模块只为让 teaching-checkpoint 可加载；本测试不触达其实现
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

import { recordCheckpointAttemptEvidence } from '../teaching-checkpoint'

const session = { id: 'sess-1', userId: 'user-1', learningPathId: 'path-1', taskId: 'task-1' } as any
const checkpoint = { id: 'cp-1', type: 'short_answer', title: '理解检查', question: 'q' } as any

beforeEach(() => {
  jest.clearAllMocks()
  mockUpsert.mockResolvedValue(undefined)
})

describe('checkpoint:attempt 留痕（H1）', () => {
  it('skipped：落一行，幂等键/归属/置信度正确', async () => {
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'skipped' })

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const arg = mockUpsert.mock.calls[0][0] as any
    expect(arg.where.eventId_evidenceKey).toEqual({
      eventId: 'checkpoint-attempt:cp-1',
      evidenceKey: 'checkpoint:attempt:cp-1',
    })
    expect(arg.create).toEqual(expect.objectContaining({
      userId: 'user-1',
      pathId: 'path-1',
      taskId: 'task-1',
      sessionId: 'sess-1',
      evidenceType: 'checkpoint:attempt',
      confidence: 1,
    }))
    expect(String(arg.create.id)).toMatch(/^lev_cpa_cp-1_\d+$/)
    expect(JSON.parse(arg.create.payload)).toEqual(expect.objectContaining({
      checkpointId: 'cp-1',
      type: 'short_answer',
      title: '理解检查',
      outcome: 'skipped',
    }))
    // 终局不可变：update 为空
    expect(arg.update).toEqual({})
  })

  it('attempts_exhausted：payload 带累计作答次数', async () => {
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'attempts_exhausted', attempts: 27 })

    const arg = mockUpsert.mock.calls[0][0] as any
    expect(JSON.parse(arg.create.payload)).toEqual(expect.objectContaining({
      checkpointId: 'cp-1',
      outcome: 'attempts_exhausted',
      attempts: 27,
    }))
  })

  it('unresolved：收尾未作答同样留痕（outcome 正确）', async () => {
    await recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'unresolved' })

    const arg = mockUpsert.mock.calls[0][0] as any
    expect(JSON.parse(arg.create.payload).outcome).toBe('unresolved')
  })

  it('DB 抛错：吞掉不抛（best-effort，不影响课堂）', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('SQLITE_BUSY'))

    await expect(
      recordCheckpointAttemptEvidence(session, checkpoint, { outcome: 'skipped' }),
    ).resolves.toBeUndefined()
  })
})
