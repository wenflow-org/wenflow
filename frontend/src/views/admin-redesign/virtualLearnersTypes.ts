/**
 * 虚拟学习者列表页（VirtualLearners）拆分后的共享类型：
 * 父页面与子组件（RunningBar / BatchCreate / Launch …）通过本文件对齐数据结构，
 * 避免同一形状在多个组件里各写一份而漂移。仅类型，无运行时状态。
 */

/** 列表行（liveVirtuals 映射后的视图模型） */
export interface VirtualLearnerRow {
  id: string
  name: string
  goal: string
  storyCount: number
  /** 已生成的路径数（distinct learningPathId）：故事是复杂情景、路径是情景里走出来的
      学习路线，一个故事可衍生多条路径（每次运行生成一条），故可能大于故事条数；
      同一路径的多次会话不重复计 */
  pathCount: number
  sessions: number
  /** 进行中会话数（live：后端全量聚合 runningCount，已扣除暂停的自动驾驶） */
  runningCount: number
  /** 已暂停自动驾驶的会话数（autopilot=stopped，会话数据保留） */
  pausedCount: number
  /** 失败/放弃会话累计数（全量聚合）。F20：含人为终止，分解见 abandonedCount 与单元格 title */
  failedCount: number
  /** 人为终止（止停/回收/放弃）会话累计数（全量聚合，F20 与 failedCount 分列；旧缓存缺省 0） */
  abandonedCount?: number
  /** 卡死（running 超回收阈值无写入）会话数 */
  stalledCount: number
  /** 进行中会话 id（会话样本内，用于「进行中」列直达座舱） */
  runningSessionIds: string[]
  /** 已暂停会话 id（autopilot=stopped） */
  pausedSessionIds?: string[]
  /** 阶段进度（轴 B）：Goal/Path/Learn 三态 + 任务进度 */
  stageProgress?: {
    goalReady: boolean
    pathReady: boolean
    learnStarted: boolean
    taskDone: number
    taskTotal: number
  } | null
  /** 逐条活跃会话（多路径可同时运行；运行在前、暂停在后） */
  activeRuns?: ActiveRun[]
  /** 无活跃运行时的历史摘要：按学习路径归并，每条路径最近一次运行 */
  recentRuns?: RecentRun[]
  /** 历史摘要涉及的路径/阶段组总数（> recentRuns.length 时出「+N」） */
  recentRunTotal?: number
  /** 活跃会话全量数（含逐条展示上限之外未展开的余量） */
  activeRunTotal?: number
  /** 日期模拟进度（只读）：会话时钟或画像级；无则 null */
  simulation?: {
    enabled: boolean
    dayIndex: number
    baseDate: string | null
    autoAdvance: boolean
  } | null
  /** 最近一个进行中会话的阶段（无进行中时回退最近会话阶段） */
  currentStage: string | null
  /** 原始创建时间（ISO），仅供排序；显示文案见 created */
  createdAt: string
  created: string
  /** 画像 tags（persona id / cohort key 即 tag）——清理向导保留名单匹配用；旧缓存可能缺 */
  tags?: string[]
}

/** 一条活跃会话（后端 activeRuns 项）：生命周期 + 阶段 + 任务进度 */
export interface ActiveRun {
  sessionId: string
  /** 这条运行在做哪条学习路径（null = 还没产出路径的目标阶段运行） */
  pathId?: string | null
  /** 路径标题（后端一次查好，列表直接展示；缺省回落到「目标阶段」） */
  pathTitle?: string | null
  /** running = 真在跑；paused = 自动驾驶已暂停 */
  state: 'running' | 'paused'
  currentStage: string | null
  goalReady: boolean
  pathReady: boolean
  learnStarted: boolean
  taskDone: number
  taskTotal: number
  /** 超过回收阈值无写入（与「无响应」列同源；暂停会话恒 false） */
  stalled: boolean
}

/** 无活跃运行时的历史运行（按学习路径归并后的最近一次） */
export interface RecentRun {
  sessionId: string
  pathId: string | null
  pathTitle?: string | null
  status: string | null
  currentStage: string | null
  updatedAt: string | null
  goalReady: boolean
  pathReady: boolean
  learnStarted: boolean
  taskDone: number
  taskTotal: number
}

/** 启动实验弹窗里的故事条目 */
export interface LaunchStory {
  id: string
  title: string
  runCount: number
  /** 该故事已衍生的路径条数（每运行一次生成一条，同一路径多次会话不重复计） */
  pathCount: number
  pathId: string | null
}

/** 一键回收 dryRun 清单项 */
export interface ReclaimPreviewItem {
  id: string
  status: string
  currentStage: string
  staleMs: number
  updatedAt: string
}

/** 干跑清单里被豁免（本轮不回收）的候选，skipReason 与后端保护链一一对应（B8-F4-2） */
export interface ReclaimSkippedItem extends ReclaimPreviewItem {
  skipReason: 'live-generation' | 'active-lease' | 'held' | 'paused' | 'active-autopilot' | string
}

/** 批量创建后台任务（服务端队列，前端轮询推进） */
export interface BatchTask {
  active: boolean
  status: 'creating' | 'running' | 'done' | 'error'
  /** 后端任务 id（服务端队列） */
  batchId: string
  total: number
  created: number
  totalStories: number
  storiesDone: number
  /** 剩余待生成身份的人数 */
  personaLeft: number
  /** 每人的队列：{ profileId, name, storyCount, needsPersona }（前端不再驱动，保留类型兼容） */
  queue: Array<{ profileId: string; name: string; storyCount: number; needsPersona: boolean }>
  /** 失败项（重试用） */
  failed: Array<{ profileId: string; name: string; storyCount: number; needsPersona: boolean }>
  error: string
  /** 当前处理索引 */
  currentIdx: number
  /** 详情行是否展开 */
  expanded: boolean
}
