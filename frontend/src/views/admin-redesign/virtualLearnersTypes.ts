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
  sessions: number
  /** 进行中会话数（live：后端全量聚合 runningCount，已扣除暂停的自动驾驶） */
  runningCount: number
  /** 已暂停自动驾驶的会话数（autopilot=stopped，会话数据保留） */
  pausedCount: number
  /** 失败/放弃会话累计数（全量聚合） */
  failedCount: number
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
}

/** 启动实验弹窗里的故事条目 */
export interface LaunchStory {
  id: string
  title: string
  runCount: number
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
