/* eslint-disable @typescript-eslint/no-explicit-any -- 测试夹具：mock session/消息常用 any 构造 */
/**
 * session_load 指标：写入端（commitSessionLoadMetric）与读取端（findSessionLoadMetric）契约。
 *
 * 背景：该指标自上线起没有任何运行时读取方（prompt 里却写着「课后 session_load 聚合消费」），
 * 属「写了没人看」的死仓。现在控制台总结页消费它，两边靠 `session-load:{sessionId}` 这个
 * sourceKey 对上——本用例把键的拼法和服务端聚合口径一起钉住，防止任一侧改字段后静默断链。
 */
const mockUpsert = jest.fn()
const mockFindUnique = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_metrics: { upsert: mockUpsert, findUnique: mockFindUnique },
  },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { commitSessionLoadMetric } from '../teaching-session-views'
import { findSessionLoadMetric } from '../../admin/session-console.repo'

const session = (messages: any[]) => ({
  id: 'sess_1',
  userId: 'u1',
  learningPathId: 'p1',
  taskId: 't1',
  messages,
}) as any

describe('session_load 指标写入 → 读取契约', () => {
  beforeEach(() => jest.clearAllMocks())

  it('按 analysis.loadIndex 聚合均值/峰值/依据分布/轮数', async () => {
    mockUpsert.mockResolvedValue({})
    await commitSessionLoadMetric(session([
      { role: 'assistant', content: 'a', analysis: { loadIndex: 0.2, loadBasis: 'semantic' } },
      { role: 'user', content: 'b', analysis: { loadIndex: 0.6, loadBasis: 'semantic' } },
      { role: 'assistant', content: 'c', analysis: { loadIndex: 0.4, loadBasis: 'structural' } },
      { role: 'assistant', content: 'd', analysis: {} },
    ]))

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const args = mockUpsert.mock.calls[0][0]
    // 键必须与读取端逐字一致，否则 = 又一处「写了没人看」
    expect(args.where).toEqual({ sourceKey: 'session-load:sess_1' })
    expect(args.create.sourceKey).toBe('session-load:sess_1')
    expect(args.create.metricType).toBe('session_load')
    expect(args.create.value).toBeCloseTo(0.4, 3)
    expect(JSON.parse(args.create.metadata)).toEqual({
      max: 0.6,
      basisDist: { semantic: 2, structural: 1 },
      perTurnCount: 3,
      scale: '0-1',
    })
  })

  it('无 loadIndex 证据时不写行（旧会话/纯文本回合）', async () => {
    await commitSessionLoadMetric(session([
      { role: 'assistant', content: 'a', analysis: {} },
      { role: 'user', content: 'b' },
    ]))
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('读取端用同一个 sourceKey（控制台 teaching.sessionLoad）', async () => {
    mockFindUnique.mockResolvedValue({ value: 0.4, metadata: '{"max":0.6}' })
    await findSessionLoadMetric('sess_1')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { sourceKey: 'session-load:sess_1' },
      select: { value: true, metadata: true },
    })
  })
})
