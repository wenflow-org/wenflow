/**
 * Path 内容视图域（SessionCockpit.vue 拆分）：
 * 里程碑/任务树归一、标题/摘要/元信息、评审标签映射 —— 纯函数；
 * 生成状态机与就绪判定（hasPath / pathStartable / readiness 等）留在 SFC
 */
import { asRecord, firstText, normalized, numberValue } from './cockpitFormat'

export function collectPathMilestones(
  pathStatusPath: Record<string, unknown>,
  pathStatus: Record<string, unknown> | null,
  stageResultsPath: unknown
) {
  const milestones = pathStatusPath.milestones
    || pathStatusPath.stages
    || pathStatus?.milestones
    || pathStatus?.stages
    || asRecord(stageResultsPath).milestones
  return Array.isArray(milestones) ? milestones.map(asRecord) : []
}

export interface PathMilestoneTaskView {
  id: string
  title: string
  completed: boolean
  current: boolean
}

export interface PathMilestoneView {
  stageNumber: number
  title: string
  description: string
  estimatedHours: number | null
  tasks: PathMilestoneTaskView[]
}

export function buildPathMilestonesView(
  milestones: Record<string, unknown>[],
  currentTaskId: string | null
): PathMilestoneView[] {
  return milestones.map((m, index) => {
    const rawTasks = m.subtasks || m.tasks
    const tasks = (Array.isArray(rawTasks) ? rawTasks : []).map(asRecord).map((t) => {
      const id = firstText(t.id)
      return {
        id,
        title: firstText(t.title, t.name) || '未命名任务',
        completed: normalized(t.status) === 'completed',
        current: !!id && id === currentTaskId
      }
    })
    return {
      stageNumber: numberValue(m.stageNumber) ?? index + 1,
      title: firstText(m.title, m.name) || `里程碑 ${index + 1}`,
      description: firstText(m.description),
      estimatedHours: numberValue(m.estimatedHours),
      tasks
    }
  })
}

export function pathReviewDecisionLabelOf(decision: string) {
  return ({
    accept: '接受',
    modify: '需要修改',
    reject: '拒绝',
    pending: '待评审'
  }[decision] || decision)
}

export function pathReviewStatusLabelOf(status: string) {
  return ({
    pending: '评审完成，待人工处理',
    accepted: '已接受',
    replanning: '重规划中',
    replanned: '已生成新版 Path，待再次评审',
    failed: '评审失败'
  }[status] || status)
}

export function buildPathDetailTitle(pathStatusPath: Record<string, unknown>, stageResultsPath: unknown) {
  return firstText(pathStatusPath.title, pathStatusPath.name)
    || firstText(asRecord(stageResultsPath).title, asRecord(stageResultsPath).name)
    || '学习路径'
}

export function buildPathDetailSummary(pathStatusPath: Record<string, unknown>, stageResultsPath: unknown) {
  return firstText(pathStatusPath.summary, pathStatusPath.description)
    || firstText(asRecord(stageResultsPath).summary, asRecord(stageResultsPath).description)
}

export function buildPathDetailMeta(
  hasPathValue: boolean,
  pathStatusPath: Record<string, unknown>,
  stageResultsPath: unknown,
  milestonesCount: number
) {
  if (!hasPathValue) return ''
  const parts: string[] = []
  const srPath = asRecord(stageResultsPath)
  const difficulty = firstText(pathStatusPath.difficulty, srPath.difficulty)
  const hours = numberValue(pathStatusPath.estimatedHours) ?? numberValue(srPath.estimatedHours)
  const total = numberValue(pathStatusPath.totalMilestones)
    ?? numberValue(srPath.totalMilestones)
    ?? milestonesCount
  if (difficulty) parts.push(`难度 ${difficulty}`)
  if (hours !== null) parts.push(`约 ${hours} 小时`)
  if (total) parts.push(`${total} 个里程碑`)
  return parts.join(' · ')
}
