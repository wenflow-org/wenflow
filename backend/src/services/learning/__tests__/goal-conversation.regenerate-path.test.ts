/* eslint-disable @typescript-eslint/no-explicit-any -- 测试桩：模拟 prisma/服务行形状不追求类型精度（仓库探针脚本同惯例） */
/**
 * 管理端「生成 / 重新生成学习路径」入口（`generateLearningPathFromConversation`）回归。
 *
 * 2026-11-01 实测缺陷：本入口生成路径后**不回写** `goal_conversations.learningPathId`，
 * 于是管理端走完「生成学习路径」后：对话仍停在「未生成路径」，新路径也没有任何对话指向它，
 * 学习路径列表点详情只能落在「该路径没有关联的目标对话」空态（孤儿路径）。
 * `regeneratePath` 一直有这段回写，本入口是唯一遗漏的调用点。
 */
const conversationRow: any = {
  id: 'gc_1',
  userId: 'user_1',
  description: '把六家门店流水合成一张表',
  collectedData: JSON.stringify({ understanding: { real_problem: '对不上账' }, collected: {}, confidence: 0.9 }),
  learningPathId: null,
  stage: 'understanding',
  status: 'active',
  revision: 1,
}

const lifecycleCalls: any[] = []
const prismaMock: any = {
  goal_conversations: {
    findUnique: jest.fn(async () => ({ ...conversationRow })),
  },
}

jest.mock('../../../config/database', () => ({ __esModule: true, default: prismaMock }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../goal-conversation.lifecycle', () => ({
  applyConversationLifecycle: jest.fn(async (...args: any[]) => {
    lifecycleCalls.push(args[2])
    return true
  }),
}))

/* 只把「路径生成」这一步换掉：入口到回写之间的接线（含返回值形状）保持真实 */
const generateFromGoal = jest.fn()
jest.mock('../../../coordinators/path.coordinator', () => ({
  __esModule: true,
  default: { generateFromGoal: (...args: any[]) => generateFromGoal(...args) },
}))

import { generateLearningPathFromConversation } from '../goal-conversation.service'

describe('generateLearningPathFromConversation（管理端生成路径入口）', () => {
  beforeEach(() => {
    lifecycleCalls.length = 0
    generateFromGoal.mockReset()
  })

  it('生成路径后回写 learningPathId，让对话不再停在「未生成路径」', async () => {
    generateFromGoal.mockResolvedValue({ id: 'lp_new', name: '门店流水对账', status: 'generating' })

    const path = await generateLearningPathFromConversation('gc_1')

    expect(path).toEqual(expect.objectContaining({ id: 'lp_new' }))
    expect(lifecycleCalls).toHaveLength(1)
    expect(lifecycleCalls[0]).toEqual(expect.objectContaining({
      stage: 'completed',
      status: 'completed',
      learningPathId: 'lp_new',
      learningPath: { id: 'lp_new', status: 'generating' },
    }))
  })

  it('生成失败（拿不到路径 id）时不回写，保留原状态', async () => {
    generateFromGoal.mockResolvedValue(null)

    await generateLearningPathFromConversation('gc_1')

    expect(lifecycleCalls).toHaveLength(0)
  })
})
