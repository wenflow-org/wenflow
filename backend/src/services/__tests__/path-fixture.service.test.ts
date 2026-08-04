const learningPathFindUnique = jest.fn()
const userFindUnique = jest.fn()
const txPathCreate = jest.fn()
const txMilestoneCreate = jest.fn()
const txSubtaskCreate = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    learning_paths: { findUnique: learningPathFindUnique },
    users: { findUnique: userFindUnique },
    $transaction: jest.fn(async (callback: any) =>
      callback({
        learning_paths: { create: txPathCreate },
        milestones: { create: txMilestoneCreate },
        subtasks: { create: txSubtaskCreate },
      })
    ),
  },
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { pathFixtureService } from '../learning/path-fixture.service'

function buildSourcePath() {
  return {
    id: 'source-path-1',
    userId: 'owner-1',
    title: 'SQL 入门',
    name: 'sql-intro',
    description: 'desc',
    subject: '数据库',
    status: 'active',
    difficulty: 'beginner',
    estimatedHours: 10,
    totalMilestones: 2,
    completedMilestones: 1,
    aiGenerated: true,
    aiPromptTemplate: JSON.stringify({ _generation: { stageDesign: 'succeeded' } }),
    deadline: null,
    deadlineText: '两周',
    replanMode: 'overwrite',
    replanReason: 'x',
    replanTriggerSource: 'y',
    sourcePathId: null,
    activeGenerationRunId: 'run-unique-1',
    milestones: [
      {
        id: 'ms-1',
        stageNumber: 1,
        title: '阶段一',
        description: 'd1',
        goal: 'g1',
        estimatedHours: 5,
        status: 'active',
        order: 0,
        coreConceptId: 'cc-1',
        coreConceptName: '关系模型',
        subtasks: [
          {
            id: 'task-1',
            title: ' SELECT 基础',
            description: 'td',
            taskType: 'acquire',
            estimatedMinutes: 30,
            acceptanceCriteria: '能写出查询',
            order: 0,
            status: 'completed',
            completedAt: new Date('2026-01-01'),
            rating: 5,
            feedback: '好',
            cognitiveLoad: 'medium',
            annotationConfidence: 0.9,
            cognitiveLevel: 'understand',
            coreConcept: '关系模型',
            displayLabel: 'SELECT',
            knowledgeType: 'conceptual',
            learningObjectives: JSON.stringify(['理解 SELECT']),
            transferable: true,
            linkedConceptId: 'lc-1',
            linkedConceptName: '投影',
          },
        ],
      },
      {
        id: 'ms-2',
        stageNumber: 2,
        title: '阶段二',
        description: null,
        goal: null,
        estimatedHours: 5,
        status: 'locked',
        order: 1,
        coreConceptId: null,
        coreConceptName: null,
        subtasks: [],
      },
    ],
  }
}

describe('PathFixtureService.clonePathToUser', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    userFindUnique.mockResolvedValue({ id: 'vl-user-1' })
    learningPathFindUnique.mockResolvedValue(buildSourcePath())
    txPathCreate.mockImplementation(async ({ data }: any) => ({ id: data.id }))
    txMilestoneCreate.mockImplementation(async ({ data }: any) => ({ id: data.id }))
    txSubtaskCreate.mockImplementation(async ({ data }: any) => ({ id: data.id }))
  })

  it('克隆路径结构并重置全部运行状态', async () => {
    const result = await pathFixtureService.clonePathToUser('source-path-1', 'vl-user-1')

    expect(result.sourcePathId).toBe('source-path-1')
    expect(result.targetUserId).toBe('vl-user-1')
    expect(result.milestoneCount).toBe(2)
    expect(result.taskCount).toBe(1)

    const pathData = txPathCreate.mock.calls[0][0].data
    expect(pathData.userId).toBe('vl-user-1')
    expect(pathData.status).toBe('active')
    expect(pathData.completedMilestones).toBe(0)
    expect(pathData.title).toBe('[Fixture] SQL 入门')
    expect(pathData.aiPromptTemplate).toContain('succeeded')
    expect(pathData.sourcePathId).toBe('source-path-1')
    // @unique 字段绝不能照抄
    expect(pathData.activeGenerationRunId).toBeNull()
    expect(pathData.replanMode).toBeNull()
    expect(pathData.id).not.toBe('source-path-1')
  })

  it('第一个阶段解锁、其余锁定，任务状态全部重置且 userId/usersId 双写', async () => {
    await pathFixtureService.clonePathToUser('source-path-1', 'vl-user-1')

    const firstMilestone = txMilestoneCreate.mock.calls[0][0].data
    const secondMilestone = txMilestoneCreate.mock.calls[1][0].data
    expect(firstMilestone.status).toBe('active')
    expect(firstMilestone.completedAt).toBeNull()
    expect(secondMilestone.status).toBe('locked')
    expect(firstMilestone.coreConceptName).toBe('关系模型')

    const taskData = txSubtaskCreate.mock.calls[0][0].data
    expect(taskData.userId).toBe('vl-user-1')
    expect(taskData.usersId).toBe('vl-user-1')
    expect(taskData.status).toBe('todo')
    expect(taskData.completedAt).toBeNull()
    expect(taskData.rating).toBeNull()
    expect(taskData.feedback).toBeNull()
    // 教学标注字段逐字复制
    expect(taskData.taskType).toBe('acquire')
    expect(taskData.knowledgeType).toBe('conceptual')
    expect(taskData.cognitiveLevel).toBe('understand')
    expect(taskData.linkedConceptId).toBe('lc-1')
    expect(taskData.learningObjectives).toBe(JSON.stringify(['理解 SELECT']))
  })

  it('支持自定义标题前缀', async () => {
    await pathFixtureService.clonePathToUser('source-path-1', 'vl-user-1', { titlePrefix: '[夹具] ' })
    expect(txPathCreate.mock.calls[0][0].data.title).toBe('[夹具] SQL 入门')
  })

  it('源路径不存在时拒绝', async () => {
    learningPathFindUnique.mockResolvedValue(null)
    await expect(pathFixtureService.clonePathToUser('missing', 'vl-user-1')).rejects.toThrow('源学习路径不存在')
  })

  it('源路径没有阶段时拒绝', async () => {
    const source = buildSourcePath()
    ;(source as any).milestones = []
    learningPathFindUnique.mockResolvedValue(source)
    await expect(pathFixtureService.clonePathToUser('source-path-1', 'vl-user-1')).rejects.toThrow('没有任何阶段')
  })

  it('目标用户不存在时拒绝', async () => {
    userFindUnique.mockResolvedValue(null)
    await expect(pathFixtureService.clonePathToUser('source-path-1', 'missing-user')).rejects.toThrow('目标用户不存在')
  })
})
