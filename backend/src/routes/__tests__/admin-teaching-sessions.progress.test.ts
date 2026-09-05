// 教学会话进度推导测试（遗留项「教学会话进度列」后端补字段）：
// - 任务序号/总数：会话任务在所属里程碑 subtasks 中的位置（按 order）
// - 里程碑序号/总数：会话里程碑在路径 milestones 中的位置（按 order）
// - 缺指针兜底：无 milestoneId 时由 taskId 反查所属里程碑；老数据 → null
// - 查询批量性：每会话不放大为 N+1
export {}
const milestoneFindMany = jest.fn()
const subtaskFindMany = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    milestones: { findMany: milestoneFindMany },
    subtasks: { findMany: subtaskFindMany }
  }
}))

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}))

import { deriveTeachingSessionProgress } from '../admin/teaching-sessions.progress'
import type { SessionProgress } from '../admin/teaching-sessions.progress'

const milestone = (id: string, pathId: string, order = 0) => ({
  id,
  learningPathId: pathId,
  order,
  stageNumber: order + 1
})
const subtask = (id: string, milestoneId: string, order = 0) => ({ id, milestoneId, order })

function session(overrides: Partial<{ id: string; taskId: string | null; milestoneId: string | null; learningPathId: string | null }>) {
  return {
    id: 's-' + (overrides.id || Math.random().toString(36).slice(2, 8)),
    taskId: null,
    milestoneId: null,
    learningPathId: null,
    ...overrides
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('deriveTeachingSessionProgress', () => {
  it('任务序号 = 任务在里程碑 subtasks（按 order）中的位置，总数 = 里程碑任务数', async () => {
    milestoneFindMany.mockImplementation(({ where }: any) => {
      if (where.id) {
        return Promise.resolve([milestone('m1', 'p1', 0)])
      }
      return Promise.resolve([milestone('m1', 'p1', 0)])
    })
    subtaskFindMany.mockResolvedValue([
      subtask('t1', 'm1', 0),
      subtask('t2', 'm1', 1),
      subtask('t3', 'm1', 2),
      subtask('t4', 'm1', 3)
    ])

    const map = await deriveTeachingSessionProgress([
      session({ id: 'a', taskId: 't3', milestoneId: 'm1', learningPathId: 'p1' })
    ])

    const progress = map.get('a') as SessionProgress
    expect(progress).toEqual({ taskIndex: 3, totalTasks: 4, milestoneIndex: 1, totalMilestones: 1 })
  })

  it('里程碑序号 = 里程碑在路径（按 order）中的位置；乱序 order 也按序计数', async () => {
    milestoneFindMany.mockImplementation(({ where }: any) => {
      if (where.id) {
        return Promise.resolve([milestone('m3', 'p1', 0)])
      }
      return Promise.resolve([
        milestone('m1', 'p1', 0),
        milestone('m2', 'p1', 2),
        milestone('m3', 'p1', 1)
      ])
    })
    subtaskFindMany.mockResolvedValue([subtask('t1', 'm3', 0)])

    const map = await deriveTeachingSessionProgress([
      session({ id: 'a', taskId: 't1', milestoneId: 'm3', learningPathId: 'p1' })
    ])

    // m1(order0) → m3(order1) → m2(order2)：m3 排第 2
    const progress = map.get('a') as SessionProgress
    expect(progress).toEqual({ taskIndex: 1, totalTasks: 1, milestoneIndex: 2, totalMilestones: 3 })
  })

  it('缺 milestoneId：由 taskId 反查所属里程碑并补取完整任务序（两阶段）', async () => {
    milestoneFindMany.mockResolvedValue([])
    subtaskFindMany
      .mockResolvedValueOnce([subtask('t2', 'm9', 1)])
      .mockResolvedValueOnce([subtask('t1', 'm9', 0), subtask('t2', 'm9', 1), subtask('t3', 'm9', 2)])

    const map = await deriveTeachingSessionProgress([
      session({ id: 'a', taskId: 't2', milestoneId: null, learningPathId: 'p1' })
    ])

    expect(subtaskFindMany).toHaveBeenCalledTimes(2)
    const progress = map.get('a') as SessionProgress
    expect(progress).toEqual({ taskIndex: 2, totalTasks: 3, milestoneIndex: 0, totalMilestones: 0 })
  })

  it('仅里程碑可推导（任务不在序中）：里程碑有值、任务归零', async () => {
    milestoneFindMany.mockImplementation(({ where }: any) => {
      if (where.id) {
        return Promise.resolve([milestone('m1', 'p1', 0)])
      }
      return Promise.resolve([milestone('m1', 'p1', 0)])
    })
    subtaskFindMany.mockResolvedValue([subtask('tx', 'm1', 0)])

    const map = await deriveTeachingSessionProgress([
      session({ id: 'a', taskId: 't-unknown', milestoneId: 'm1', learningPathId: 'p1' })
    ])

    const progress = map.get('a') as SessionProgress
    expect(progress).toEqual({ taskIndex: 0, totalTasks: 1, milestoneIndex: 1, totalMilestones: 1 })
  })

  it('老数据（无任何指针/不在任何序中）→ null', async () => {
    milestoneFindMany.mockResolvedValue([])
    subtaskFindMany.mockResolvedValue([])

    const map = await deriveTeachingSessionProgress([
      session({ id: 'a', taskId: 't-x', milestoneId: 'm-x', learningPathId: null })
    ])

    expect(map.get('a')).toBeNull()
  })

  it('空列表直接返回，不发起查询', async () => {
    const map = await deriveTeachingSessionProgress([])
    expect(milestoneFindMany).not.toHaveBeenCalled()
    expect(subtaskFindMany).not.toHaveBeenCalled()
    expect(map.size).toBe(0)
  })

  it('批量推导：多个会话共享同一批查询（milestones 2 次 / subtasks 1 次）', async () => {
    milestoneFindMany.mockResolvedValue([milestone('m1', 'p1', 0), milestone('m2', 'p1', 1)])
    subtaskFindMany.mockResolvedValue([
      subtask('t1', 'm1', 0),
      subtask('t2', 'm1', 1),
      subtask('t3', 'm2', 0)
    ])

    const map = await deriveTeachingSessionProgress([
      session({ id: 'a', taskId: 't2', milestoneId: 'm1', learningPathId: 'p1' }),
      session({ id: 'b', taskId: 't3', milestoneId: 'm2', learningPathId: 'p1' })
    ])

    expect(milestoneFindMany).toHaveBeenCalledTimes(2)
    expect(subtaskFindMany).toHaveBeenCalledTimes(1)
    expect((map.get('a') as SessionProgress).taskIndex).toBe(2)
    expect((map.get('b') as SessionProgress).milestoneIndex).toBe(2)
  })
})
