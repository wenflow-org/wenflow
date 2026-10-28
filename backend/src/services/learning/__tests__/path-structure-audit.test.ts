import { auditPathStructure, reorderTasksForPrerequisites } from '../generation/path-structure-audit'

const tasks = [
  { title: '识别底子', stageNumber: 1, order: 0 },
  { title: '叠加活动倍数', stageNumber: 2, order: 0 },
  { title: '写排班结论', stageNumber: 3, order: 0 },
]

describe('auditPathStructure（#路径结构：前置/重复/课时）', () => {
  it('前置 KC 未被任何任务引入 → prerequisite-gap', () => {
    const result = auditPathStructure({
      kcAnnotation: {
        kcGraph: { edges: [{ from: 'kc-base', to: 'kc-peak', relation: 'prerequisite' }] },
        taskKcLinks: [{ taskTitle: '叠加活动倍数', linkedKCs: ['kc-peak'] }],
      },
      tasks,
      totalMinutes: 180,
      afterHours: 3,
    })
    const gap = result.issues.find((issue) => issue.kind === 'prerequisite-gap')
    expect(gap?.severity).toBe('medium')
    expect(gap?.detail).toContain('kc-base')
    expect(result.stats.missingPrerequisiteKcs).toBe(1)
  })

  it('前置 KC 首次出现晚于后继任务 → low prerequisite-gap（2026-10-26 降噪：kc-mapper 自画边系统性冲突，40/40 全报）', () => {
    const lateTasks = [
      { title: '叠加活动倍数', stageNumber: 1, order: 0 },
      { title: '识别底子', stageNumber: 2, order: 0 },
    ]
    const result = auditPathStructure({
      kcAnnotation: {
        kcGraph: { edges: [{ from: 'kc-base', to: 'kc-peak' }] },
        taskKcLinks: [
          { taskTitle: '叠加活动倍数', linkedKCs: ['kc-peak'] },
          { taskTitle: '识别底子', linkedKCs: ['kc-base'] },
        ],
      },
      tasks: lateTasks,
      totalMinutes: 180,
      afterHours: 3,
    })
    const gap = result.issues.find((issue) => issue.kind === 'prerequisite-gap')
    expect(gap?.severity).toBe('low')
    expect(result.stats.latePrerequisiteEdges).toBe(1)
  })

  it('前序任务说明提到前置 KC 名 → 视为已隐式引入，不报缺口', () => {
    const result = auditPathStructure({
      kcAnnotation: {
        conceptKcs: [{ kcs: [{ kcId: 'kc-base', name: '识别底子' }, { kcId: 'kc-peak', name: '叠加活动倍数' }] }],
        kcGraph: { edges: [{ from: 'kc-base', to: 'kc-peak' }] },
        taskKcLinks: [
          { taskTitle: '叠加活动倍数', linkedKCs: ['kc-peak'] },
          { taskTitle: '识别底子', linkedKCs: ['kc-base'] },
        ],
      },
      tasks: [
        { title: '读原始客流', description: '先识别底子，再谈高峰', stageNumber: 1, order: 0 },
        { title: '叠加活动倍数', stageNumber: 2, order: 0 },
        { title: '识别底子', stageNumber: 3, order: 0 },
      ],
      totalMinutes: 180,
      afterHours: 3,
    })
    expect(result.issues.filter((issue) => issue.kind === 'prerequisite-gap')).toEqual([])
  })

  it('任务标题重复 → duplicate-task', () => {
    const result = auditPathStructure({
      kcAnnotation: {},
      tasks: [...tasks, { title: '写排班结论', stageNumber: 3, order: 1 }],
      totalMinutes: 180,
      afterHours: 3,
    })
    expect(result.issues.some((issue) => issue.kind === 'duplicate-task')).toBe(true)
    expect(result.stats.duplicateTitles).toBe(1)
  })

  it('课时明显偏离且无交付声明 → budget-mismatch；已声明缩水 → 不再报', () => {
    const base = {
      kcAnnotation: {},
      tasks,
      totalMinutes: 600,
      afterHours: 3,
    }
    expect(auditPathStructure(base).issues.some((issue) => issue.kind === 'budget-mismatch')).toBe(true)
    expect(auditPathStructure({ ...base, delivery: 'path' }).issues.some((issue) => issue.kind === 'budget-mismatch')).toBe(false)
  })

  it('结构自洽时零 issue', () => {
    const result = auditPathStructure({
      kcAnnotation: {
        kcGraph: { edges: [{ from: 'kc-base', to: 'kc-peak' }] },
        taskKcLinks: [
          { taskTitle: '识别底子', linkedKCs: ['kc-base'] },
          { taskTitle: '叠加活动倍数', linkedKCs: ['kc-peak'] },
        ],
      },
      tasks,
      totalMinutes: 180,
      afterHours: 3.2,
    })
    expect(result.issues).toEqual([])
    expect(result.stats.budgetRatio).toBeCloseTo(0.94, 2)
  })
})

describe('reorderTasksForPrerequisites（同阶段稳定拓扑）', () => {
  const annotation = {
    kcGraph: { edges: [{ from: 'kc-base', to: 'kc-peak' }] },
    taskKcLinks: [
      { taskTitle: '叠加活动倍数', linkedKCs: ['kc-peak'] },
      { taskTitle: '识别底子', linkedKCs: ['kc-base'] },
    ],
  }

  it('前置任务在后 → 前移到依赖之前（其余保持原相对顺序）', () => {
    const tasks = [
      { title: '叠加活动倍数', keep: 1 },
      { title: '写结论', keep: 2 },
      { title: '识别底子', keep: 3 },
    ]
    const result = reorderTasksForPrerequisites(tasks, annotation)
    expect(result.changed).toBe(true)
    expect(result.tasks.map((task) => task.title)).toEqual(['识别底子', '叠加活动倍数', '写结论'])
    expect(result.tasks.map((task) => task.keep)).toEqual([3, 1, 2])
  })

  it('已满足前置 → 不动', () => {
    const tasks = [{ title: '识别底子' }, { title: '叠加活动倍数' }]
    expect(reorderTasksForPrerequisites(tasks, annotation)).toMatchObject({ changed: false })
  })

  it('有环 → 保持原顺序，不丢任务', () => {
    const cyclic = {
      kcGraph: { edges: [{ from: 'kc-a', to: 'kc-b' }, { from: 'kc-b', to: 'kc-a' }] },
      taskKcLinks: [
        { taskTitle: '甲', linkedKCs: ['kc-a'] },
        { taskTitle: '乙', linkedKCs: ['kc-b'] },
      ],
    }
    const tasks = [{ title: '乙' }, { title: '甲' }]
    const result = reorderTasksForPrerequisites(tasks, cyclic)
    expect(result.changed).toBe(false)
    expect(result.tasks.map((task) => task.title)).toEqual(['乙', '甲'])
  })

  it('R7-1 守卫：收束档不得被前移到建立/应用档之前（R6 的 14/14 倒挂根因）', () => {
    // 收束档在后、KC 边要求它前移——无守卫时 fromIndex(1)>toIndex(0) 会真的重排，
    // 有守卫时约束被丢弃、顺序不变（该用例在去掉守卫后会失败，是有效回归）。
    const closingFirst = {
      kcGraph: { edges: [{ from: 'kc-summary', to: 'kc-deconstruct' }] },
      taskKcLinks: [
        { taskTitle: '复述整条解封装路径', linkedKCs: ['kc-summary'] },
        { taskTitle: '写一遍接收路径', linkedKCs: ['kc-deconstruct'] },
      ],
    }
    const tasks = [
      { title: '写一遍接收路径', type: 'deconstruct' },
      { title: '复述整条解封装路径', type: 'consolidate' },
    ]
    const result = reorderTasksForPrerequisites(tasks, closingFirst)
    expect(result.changed).toBe(false)
    expect(result.reorderedEdges).toBe(0)
    expect(result.tasks.map((task) => task.title)).toEqual(['写一遍接收路径', '复述整条解封装路径'])
  })

  it('R7-1 追加守卫：任何非 acquire 任务不得被 KC 边前移到 acquire 之前（B17 S4 实证）', () => {
    const execBeforeAcquire = {
      kcGraph: { edges: [{ from: 'kc-exec', to: 'kc-acq' }] },
      taskKcLinks: [
        { taskTitle: '手工走一遍配对', linkedKCs: ['kc-acq'] },
        { taskTitle: '让工具跑全量', linkedKCs: ['kc-exec'] },
      ],
    }
    const tasks = [
      { title: '手工走一遍配对', type: 'acquire' },
      { title: '让工具跑全量', type: 'execute' },
    ]
    const result = reorderTasksForPrerequisites(tasks, execBeforeAcquire)
    expect(result.changed).toBe(false)
    expect(result.tasks.map((task) => task.title)).toEqual(['手工走一遍配对', '让工具跑全量'])
  })

  it('R8 建立档守卫：execute 不得被 KC 边前移到 deconstruct 之前（B19 S3 实证）', () => {
    const ann = {
      kcGraph: { edges: [{ from: 'kc-exec', to: 'kc-decon' }] },
      taskKcLinks: [
        { taskTitle: '排名单', linkedKCs: ['kc-decon'] },
        { taskTitle: '写同比', linkedKCs: ['kc-exec'] },
      ],
    }
    const tasks = [
      { title: '排名单', type: 'deconstruct' },
      { title: '写同比', type: 'execute' },
    ]
    const result = reorderTasksForPrerequisites(tasks, ann)
    expect(result.changed).toBe(false)
    expect(result.tasks.map((task) => task.title)).toEqual(['排名单', '写同比'])
  })

  it('R7-1 守卫放行反向：建立档前移越过收束档仍生效', () => {
    const foundationLate = {
      kcGraph: { edges: [{ from: 'kc-base', to: 'kc-summary' }] },
      taskKcLinks: [
        { taskTitle: '识别底子', linkedKCs: ['kc-base'] },
        { taskTitle: '写结论', linkedKCs: ['kc-summary'] },
      ],
    }
    const tasks = [
      { title: '写结论', type: 'consolidate' },
      { title: '识别底子', type: 'acquire' },
    ]
    const result = reorderTasksForPrerequisites(tasks, foundationLate)
    expect(result.changed).toBe(true)
    expect(result.tasks.map((task) => task.title)).toEqual(['识别底子', '写结论'])
  })
})
