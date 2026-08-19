/**
 * Admin 重设计实验室：共享数据仓库
 *
 * 核心概念：一条事故线贯穿全站。
 * - 所有页面读同一份 span 数据（执行日志 / 事件中心 / Skill / 总览看到的
 *   是同一次 429 爆发的不同切面）
 * - intent 驱动跨页排查动线：总览事故卡 → 已过滤的日志 → Trace 瀑布 → Skill 抽屉
 */
import { computed, reactive, ref } from 'vue'

/* ---------- 数据源：演示 / 真实 ---------- */
export const dataSource = ref<'demo' | 'live'>('demo')
/** 数据源是否为真实模式（页面统一引用，替代各页重复定义） */
export const isLive = computed(() => dataSource.value === 'live')
export const liveSpans = ref<TraceSpan[] | null>(null)
export const liveSkillStatsMap = ref<Record<string, SkillStat> | null>(null)
export const liveOverview = ref<{ tone: 'ok' | 'warn' | 'bad' | 'muted'; score: number | null; headline: string; subline: string } | null>(null)

/* ---------- Trace Span（全站最小事实单元） ---------- */
export interface TraceSpan {
  id: string
  traceId: string
  kind: 'flow' | 'call'
  agent: string
  stage: string
  title: string
  /** 该 trace 内相对起点偏移 ms（自起点 0 计） */
  startMs: number
  durationMs: number
  status: 'ok' | 'warn' | 'err'
  detail: string
  payload?: string
  /** 绝对时间戳（live 日志行） */
  ts?: number
  /** live 扩展字段：执行层/模型/状态码/重试/错误码 */
  execLayer?: string
  model?: string
  statusCode?: number
  attempts?: number
  maxAttempts?: number
  recoveredByRetry?: boolean
  errorCategory?: string
  errorCode?: string
  errorMessage?: string
  /** 合并的网关行耗时（同一次调用的 api-gateway 记录） */
  gatewayDurMs?: number
  /** 业务会话 ID（教学/目标对话等业务链路，用于会话归组） */
  sessionId?: string
  /** agent_call_logs 传输层 token 统计（无数据 = 未统计） */
  promptTokens?: number | null
  completionTokens?: number | null
}

/* demo 链路数据已移除 — 非 live 模式返回空数组，live 模式从后端拉取 */

/** demo 模式链路集合（离线演示数据；live 模式不得回退使用） */
export const spans = computed<TraceSpan[]>(() => {
  // live：严格按 ref 是否已写入判断（空数组也算已就绪，不回退 demo 数据）
  if (dataSource.value === 'live' && liveSpans.value !== null) return liveSpans.value
  return [] // demo 数据已移除，非 live 模式返回空数组
})

/* ---------- Skill 档案（统计由 spans 推导） ---------- */
export interface SkillProfile {
  id: string
  name: string
  agentId: string
  agentName: string
  category: string
  promptVersion: string
  description: string
}

export interface AgentProfile {
  id: string
  name: string
  description: string
}

/* ---------- 身份色（拓扑 / 编排 / 抽屉 / 设计页共用，单源） ---------- */
/** 各顶层 Agent 的身份色；key = Agent id。历史重复定义（SkillDesignPage/SkillDrawer 内嵌）已收敛至此 */
export const AGENT_TONES: Record<string, { hue: string; soft: string }> = {
  'goal-agent': { hue: '#4f46e5', soft: 'rgba(79, 70, 229, 0.1)' },
  'path-agent': { hue: '#0d9488', soft: 'rgba(13, 148, 136, 0.1)' },
  'teaching-agent': { hue: '#3478f6', soft: 'rgba(52, 120, 246, 0.1)' },
  'profile-agent': { hue: '#d97706', soft: 'rgba(217, 119, 6, 0.1)' },
  'simulation-agent': { hue: '#7c3aed', soft: 'rgba(124, 58, 237, 0.1)' }
}

// demo-only：演示/离线模式的 Agent 档案。
// live 模式由 live.ts 的真实注册表驱动（drawer 以 skill 维度展示），本表仅离线兜底。
export const agentProfiles: AgentProfile[] = [
  { id: 'goal-agent', name: '目标 Agent', description: '收集学习目标与上下文，输出 Goal Understanding。' },
  { id: 'path-agent', name: '路径 Agent', description: '规划学习路径与阶段拆解。' },
  { id: 'teaching-agent', name: '教学 Agent', description: 'AI 教学会话编排：单轮教学、伴学补强、课后产出。' },
  { id: 'profile-agent', name: '学习者 Agent', description: '画像、状态聚合、知识沉淀与快照刷新。' },
  { id: 'simulation-agent', name: '虚拟学习者 Agent', description: '人设 + 故事驱动：产生学习需求后与平台交互（Goal / Path / Learn）。' }
]

export function skillsOfAgent(agentId: string): SkillProfile[] {
  // demo-only：仅离线兜底（drawer 的 Agent 视图）；live 模式走拓扑/注册表
  return skillProfiles.filter((p) => p.agentId === agentId)
}

// demo-only：演示/离线模式的 Skill 档案（含演示统计口径）。
// live 模式由 live.ts 的 liveSkillProfiles（真实注册表）驱动，本表不得污染 live 展示。
export const skillProfiles: SkillProfile[] = [
  { id: 'goal-conversation', name: '目标对话', agentId: 'goal-agent', agentName: '目标 Agent', category: 'analysis', promptVersion: 'v3.2 · 已生效', description: '与用户聊清真实场景，抽取可规划的概念。' },
  { id: 'path-planning', name: '路径规划', agentId: 'path-agent', agentName: '路径 Agent', category: 'generation', promptVersion: 'v2.1 · 已生效', description: '生成认知核心与阶段化路径骨架。' },
  { id: 'stage-designer', name: '阶段设计', agentId: 'path-agent', agentName: '路径 Agent', category: 'generation', promptVersion: 'v1.8 · 草案', description: '展开每个阶段的任务与验收标准。' },
  { id: 'teaching-turn', name: '教学回合', agentId: 'teaching-agent', agentName: '教学 Agent', category: 'teaching', promptVersion: 'v5.1 · 已生效', description: '单轮教学：讲解、练习、反馈与认知负荷判定。' },
  { id: 'peer-reinforcement', name: '伴学补强', agentId: 'teaching-agent', agentName: '教学 Agent', category: 'teaching', promptVersion: 'v1.2 · 已生效', description: '以同伴视角引导讨论与理解补强。' },
  { id: 'session-wrapup', name: '课后产出', agentId: 'teaching-agent', agentName: '教学 Agent', category: 'generation', promptVersion: 'v2.4 · 已生效', description: '把会话沉淀为笔记、评估与下一步建议。' },
  { id: 'learner-model', name: '学习者聚合', agentId: 'profile-agent', agentName: '学习者 Agent', category: 'analysis', promptVersion: 'handler-only', description: '聚合画像、状态、知识记忆与教学控制态（确定性）。' },
  { id: 'lesson-knowledge-enricher', name: '会话知识蒸馏', agentId: 'profile-agent', agentName: '学习者 Agent', category: 'analysis', promptVersion: 'v1.1 · 已生效', description: '从教学会话蒸馏概念账本与基础概念。' },
  { id: 'virtual-learner-learn-turn-simulator', name: '回合模拟', agentId: 'simulation-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v1.0 · 已生效', description: '以虚拟学习者身份模拟教学回合。' },
  { id: 'virtual-learner-path-evaluator', name: '路径评估', agentId: 'simulation-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v0.8 · 草案', description: '辅助调试：评估生成路径的可学性。' },
  { id: 'virtual-learner-goal-dialogue-simulator', name: '目标对话模拟', agentId: 'simulation-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v1.0 · 已生效', description: '以虚拟学习者身份参与目标澄清对话。' },
  { id: 'virtual-learner-referee', name: '平台质量裁判', agentId: 'simulation-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v1.0 · 已生效', description: '黑盒实验终态的平台质量评审。' },
  { id: 'virtual-learner-actor-auditor', name: '角色保真审计', agentId: 'simulation-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v1.0 · 已生效', description: '审计虚拟学习者的角色保真度。' },
  { id: 'virtual-learner-persona-designer', name: 'Persona 设计', agentId: 'simulation-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v1.0 · 已生效', description: '为虚拟学习者设计稳定人设。' },
  { id: 'virtual-learner-scenario-designer', name: '场景设计', agentId: 'simulation-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v1.0 · 已生效', description: '设计虚拟学习者的故事与场景。' }
]

export interface SkillStat {
  calls: number
  errors: number
  avgMs: number
  lastAt: string
}

export function skillStatOf(skillId: string): SkillStat {
  // 真实数据模式：直接用注册表统计
  if (dataSource.value === 'live' && liveSkillStatsMap.value?.[skillId]) {
    return liveSkillStatsMap.value[skillId]
  }
  const mine = spans.value.filter((s) => s.kind === 'call' && s.agent === skillId)
  const errors = mine.filter((s) => s.status === 'err').length
  const avgMs = mine.length ? Math.round(mine.reduce((a, s) => a + s.durationMs, 0) / mine.length) : 0
  return {
    calls: mine.length,
    errors,
    avgMs,
    lastAt: mine.length ? '刚刚' : '从未'
  }
}

export function recentSpansOf(skillId: string, limit = 5): TraceSpan[] {
  return spans.value.filter((s) => s.agent === skillId).slice(0, limit)
}

/* ---------- 排查意图（跨页动线） ---------- */
export interface InvestigationIntent {
  scene: string
  agentFilter: string
  statusFilter: string
  traceId: string
  skillDrawerId: string
  /** 业务会话 ID（跳瀑布时优先进入会话分组视图） */
  sessionId: string
  /** 页面级快捷动作（命令面板「新建用户」等直达并触发页面动作） */
  quickAction: string
  /** 失败归因/异常流跳转：执行日志错误类别筛选（'' = 不过滤） */
  errorCategory: string
  /** 执行日志时间范围快捷筛选（'' = 页面默认） */
  timeRange: string
}

export const intent = reactive<InvestigationIntent>({
  scene: 'overview',
  agentFilter: '',
  statusFilter: '',
  traceId: '',
  skillDrawerId: '',
  sessionId: '',
  quickAction: '',
  errorCategory: '',
  timeRange: ''
})

/** 命令面板 → 页面快捷动作（如打开新建弹窗），页面消费后需清空 */
export function queueQuickAction(sceneId: string, action: string) {
  intent.quickAction = action
  intent.scene = sceneId
}

/** 总览事故卡 → 执行日志（已过滤该节点 + 失败） */
export function investigateAgent(agentId: string) {
  intent.agentFilter = agentId
  intent.statusFilter = 'err'
  intent.traceId = ''
  intent.errorCategory = ''
  intent.timeRange = ''
  intent.scene = 'execution-logs'
}

/** 任意位置点 Trace → 独立 Trace 瀑布页（预填该链路） */
export function openTrace(traceId: string) {
  intent.traceId = traceId
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.scene = 'trace-waterfall'
}

/** 任意位置点会话 → Trace 瀑布页（优先会话分组视图） */
export function openSession(sessionId: string) {
  intent.traceId = ''
  intent.sessionId = sessionId
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.scene = 'trace-waterfall'
}

/** 打开 Skill 详情抽屉（不切换场景） */
export function openSkillDrawer(skillId: string) {
  intent.skillDrawerId = skillId
}

export function closeSkillDrawer() {
  intent.skillDrawerId = ''
}

export function clearInvestigation() {
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceId = ''
  intent.sessionId = ''
  intent.errorCategory = ''
  intent.timeRange = ''
}

/* ---------- 二级页面（drill-in） ---------- */
export type SubPageView = 'learner' | 'virtual' | 'user' | 'session' | 'session-real'

export const subPage = ref<{ view: SubPageView; id: string; label?: string; includeTest?: boolean } | null>(null)

export function openSubPage(view: SubPageView, id: string, opts?: { includeTest?: boolean }) {
  subPage.value = opts?.includeTest ? { view, id, includeTest: true } : { view, id }
}

/** 二级页加载出名称后回写（面包屑显示中文名/短标识；未设置时回退 ID 截断） */
export function setSubPageLabel(label: string) {
  if (subPage.value && label) subPage.value = { ...subPage.value, label }
}

export function closeSubPage() {
  subPage.value = null
}

/* ---------- 学习者详情数据 ---------- */
export interface LearnerDetail {
  id: string
  name: string
  email: string
  joined: string
  trend: 'up' | 'down' | 'flat'
  fatigue: '低' | '中' | '高'
  path: string
  stage: string
  task: string
  pct: number
  concepts: { mastered: string[]; struggling: string[]; fragile: string[] }
  trend7d: number[]
  sessions: { time: string; title: string; result: string; tone: 'ok' | 'warn' | 'bad' }[]
  snapshot: { version: string; generatedAt: string }
}

export const learnerDetails: LearnerDetail[] = [] // demo 数据已移除

/* ---------- 虚拟学习者画像数据 ---------- */
export interface VirtualProfile {
  id: string
  name: string
  archetype: string
  story: string
  goal: string
  traits: string[]
  runs: { time: string; stage: string; result: string; tone: 'ok' | 'warn' | 'bad' }[]
  aiProfile: { label: string; value: string }[]
}

export const virtualProfiles: VirtualProfile[] = [] // demo 数据已移除

/* ---------- 用户详情数据 ---------- */
export interface UserDetail {
  id: string
  name: string
  email: string
  role: string
  joined: string
  lastLogin: string
  stats: { label: string; value: string }[]
  recentPaths: { title: string; stage: string; pct: number; tone: 'ok' | 'warn' }[]
  activity: { time: string; text: string }[]
}

export const userDetails: UserDetail[] = [] // demo 数据已移除

/* ---------- 总览推导 ---------- */
export const overviewHealth = computed(() => {
  // 真实数据模式：用后端统计推导
  if (dataSource.value === 'live' && liveOverview.value) return liveOverview.value
  const errs = spans.value.filter((s) => s.status === 'err').length
  if (errs > 0) return { tone: 'warn' as const, score: 61, headline: `需要关注：${errs} 次失败`, subline: '教学链路连续 429 限流，伴学已降级介入。' }
  return { tone: 'ok' as const, score: 92, headline: '运行平稳', subline: '学习链路与模型服务都在正常区间。' }
})
