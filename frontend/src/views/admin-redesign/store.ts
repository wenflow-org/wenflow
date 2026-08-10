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
export const liveOverview = ref<{ tone: 'ok' | 'warn' | 'muted'; score: number; headline: string; subline: string } | null>(null)

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
}

/** 成功链路：一次完整的路径生成（Goal → Path） */
const successTrace: TraceSpan[] = [
  { id: 's1', traceId: 'tr:8f31a2', kind: 'flow', agent: 'goal-agent', stage: '目标收集', title: '目标对话完成', startMs: 0, durationMs: 1240, status: 'ok', detail: '抽取 2 个概念：Excel 周报、自动化', payload: '{\n  "round": 7,\n  "concepts": ["Excel 周报", "自动化"],\n  "confidence": 0.86\n}' },
  { id: 's2', traceId: 'tr:8f31a2', kind: 'call', agent: 'goal-conversation', stage: '目标收集', title: 'Prompt 调用', startMs: 120, durationMs: 1100, status: 'ok', detail: 'deepseek-v4-flash · P 860 / C 204' },
  { id: 's3', traceId: 'tr:8f31a2', kind: 'call', agent: 'goal-conversation', stage: '目标收集', title: '画像推断调用', startMs: 1260, durationMs: 890, status: 'ok', detail: 'deepseek-v4-flash · P 620 / C 148' },
  { id: 's4', traceId: 'tr:8f31a2', kind: 'flow', agent: 'path-agent', stage: '核心路径生成', title: '路径草稿就绪', startMs: 2260, durationMs: 5100, status: 'ok', detail: '零基础 · 每周 4 小时 · 4 阶段' },
  { id: 's5', traceId: 'tr:8f31a2', kind: 'call', agent: 'path-planning', stage: '核心路径生成', title: '规划调用', startMs: 2380, durationMs: 4820, status: 'ok', detail: 'deepseek-v4-pro · P 2040 / C 1130', payload: '{\n  "stages": 4,\n  "milestones": 12,\n  "estimatedWeeks": 6\n}' },
  { id: 's6', traceId: 'tr:8f31a2', kind: 'flow', agent: 'path-agent', stage: '阶段任务设计', title: '路径生成完成', startMs: 7360, durationMs: 2600, status: 'ok', detail: '18 任务 · 总用时 9.9s' }
]

/** 教学链路：一节课的完整执行（教学 → 伴学 → 产出 → 状态回写） */
const teachingTrace: TraceSpan[] = [
  { id: 't1', traceId: 'tr:8f31b7', kind: 'flow', agent: 'teaching-agent', stage: '教学执行', title: '教学回合完成', startMs: 0, durationMs: 14200, status: 'ok', detail: '阶段 2 · 数据清洗练习 · 一次通过', payload: '{\n  "milestone": "m2-2",\n  "user": "user_chenxiao",\n  "masteryDelta": 0.12\n}' },
  { id: 't2', traceId: 'tr:8f31b7', kind: 'call', agent: 'teaching-turn', stage: '教学执行', title: '教学调用', startMs: 120, durationMs: 12600, status: 'ok', detail: 'deepseek-v4-pro · P 3120 / C 1890' },
  { id: 't3', traceId: 'tr:8f31b7', kind: 'call', agent: 'peer-reinforcement', stage: '教学执行', title: '伴学轻量补强', startMs: 12800, durationMs: 940, status: 'ok', detail: '概念「绝对引用」小贴士' },
  { id: 't4', traceId: 'tr:8f31b7', kind: 'call', agent: 'session-wrapup', stage: '课后产出', title: '产出写入', startMs: 13800, durationMs: 1600, status: 'ok', detail: '3 条笔记 · 1 条练习建议' },
  { id: 't5', traceId: 'tr:8f31b7', kind: 'call', agent: 'learner-model', stage: '状态回写', title: '状态聚合', startMs: 15500, durationMs: 380, status: 'ok', detail: '行为事件 ×14 → 状态视图' },
  { id: 't6', traceId: 'tr:8f31b7', kind: 'call', agent: 'lesson-knowledge-enricher', stage: '状态回写', title: '快照刷新', startMs: 15900, durationMs: 460, status: 'ok', detail: '置信 0.82 · v15' },
  { id: 't7', traceId: 'tr:8f31b7', kind: 'call', agent: 'lesson-knowledge-enricher', stage: '状态回写', title: '知识沉淀', startMs: 16400, durationMs: 720, status: 'ok', detail: '掌握 +2 · 脆弱 -1' }
]

/** 模拟链路：虚拟学习者的一轮黑盒评估 */
const simulationTrace: TraceSpan[] = [
  { id: 'v1', traceId: 'tr:8f31c9', kind: 'flow', agent: 'simulation-agent', stage: '黑盒模拟', title: 'Learn 回合模拟完成', startMs: 0, durationMs: 9400, status: 'ok', detail: '样本 vl-001 · 5 轮 · 未触发疲劳', payload: '{\n  "story": "疲惫的运营小张",\n  "rounds": 5,\n  "friction": "normal"\n}' },
  { id: 'v2', traceId: 'tr:8f31c9', kind: 'call', agent: 'virtual-learner-learn-turn-simulator', stage: '黑盒模拟', title: '回合模拟', startMs: 100, durationMs: 8200, status: 'ok', detail: '角色保真 0.91' },
  { id: 'v3', traceId: 'tr:8f31c9', kind: 'call', agent: 'virtual-learner-path-evaluator', stage: '黑盒模拟', title: '路径可学性评估', startMs: 8400, durationMs: 860, status: 'ok', detail: '难度评分 0.64 · 通过' }
]

/** 理解与规划链路：概念抽取到阶段设计 */
const planningTrace: TraceSpan[] = [
  { id: 'p1', traceId: 'tr:8f31d1', kind: 'call', agent: 'goal-conversation', stage: '目标收集', title: '概念抽取', startMs: 0, durationMs: 2100, status: 'ok', detail: '候选概念 ×3 · 置信 0.88' },
  { id: 'p2', traceId: 'tr:8f31d1', kind: 'call', agent: 'goal-conversation', stage: '目标收集', title: '目标理解合成', startMs: 2200, durationMs: 1700, status: 'ok', detail: '场景：周报自动化' },
  { id: 'p3', traceId: 'tr:8f31d1', kind: 'call', agent: 'path-planning', stage: '核心路径生成', title: '场景定帧', startMs: 4000, durationMs: 1100, status: 'ok', detail: '办公桌面 · 每周五 30 分钟' },
  { id: 'p4', traceId: 'tr:8f31d1', kind: 'call', agent: 'stage-designer', stage: '阶段任务设计', title: '阶段展开', startMs: 5200, durationMs: 3400, status: 'ok', detail: '阶段 3/4 · 6 任务' }
]

/** 背景噪音日志（不构成完整 trace） */
const backgroundSpans: TraceSpan[] = [
  { id: 'b1', traceId: 'tr:8f319e', kind: 'call', agent: 'lesson-knowledge-enricher', stage: '状态回写', title: '快照刷新', startMs: 0, durationMs: 210, status: 'ok', detail: 'user_1784… · 210ms' },
  { id: 'b2', traceId: 'tr:8f319b', kind: 'call', agent: 'session-wrapup', stage: '课后产出', title: '产出写入', startMs: 0, durationMs: 1600, status: 'ok', detail: '3 条笔记 · 1.6s' },
  { id: 'b3', traceId: 'tr:8f3188', kind: 'call', agent: 'teaching-turn', stage: '教学执行', title: '输出接近上限', startMs: 0, durationMs: 2100, status: 'warn', detail: '3800/4000 tokens' },
  { id: 'b4', traceId: 'tr:8f3185', kind: 'call', agent: 'teaching-turn', stage: '教学执行', title: '教学调用', startMs: 0, durationMs: 9800, status: 'ok', detail: '阶段 1 · 提问训练' },
  { id: 'b5', traceId: 'tr:8f3182', kind: 'call', agent: 'learner-model', stage: '状态回写', title: '状态聚合', startMs: 0, durationMs: 340, status: 'ok', detail: 'user_2211 · 340ms' }
]

/** demo 模式链路集合（离线演示数据；live 模式不得回退使用） */
const demoSpans: TraceSpan[] = [...successTrace, ...teachingTrace, ...simulationTrace, ...planningTrace, ...backgroundSpans]

export const spans = computed<TraceSpan[]>(() => {
  // live：严格按 ref 是否已写入判断（空数组也算已就绪，不回退 demo 数据）
  if (dataSource.value === 'live' && liveSpans.value !== null) return liveSpans.value
  return demoSpans
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
}

export const intent = reactive<InvestigationIntent>({
  scene: 'overview',
  agentFilter: '',
  statusFilter: '',
  traceId: '',
  skillDrawerId: '',
  sessionId: '',
  quickAction: ''
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
}

/* ---------- 二级页面（drill-in） ---------- */
export type SubPageView = 'learner' | 'virtual' | 'user' | 'session'

export const subPage = ref<{ view: SubPageView; id: string } | null>(null)

export function openSubPage(view: SubPageView, id: string) {
  subPage.value = { view, id }
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

export const learnerDetails: LearnerDetail[] = [
  {
    id: 'l1',
    name: '陈晓',
    email: 'chenxiao@example.com',
    joined: '12 天前',
    trend: 'up',
    fatigue: '低',
    path: 'Excel 自动化入门',
    stage: '阶段 2 · 数据清洗',
    task: '用公式替代手工汇总',
    pct: 46,
    concepts: {
      mastered: ['单元格引用', 'SUMIF', '筛选'],
      struggling: ['数据透视表'],
      fragile: ['数组公式']
    },
    trend7d: [3, 4, 4, 5, 6, 6, 7],
    sessions: [
      { time: '6 分钟前', title: '数据清洗练习 2/3', result: '完成 · 掌握 +0.12', tone: 'ok' },
      { time: '昨天 21:14', title: 'SUMIF 实战', result: '完成 · 一次通过', tone: 'ok' },
      { time: '3 天前', title: '数据透视表入门', result: '中途退出 · 标记复习', tone: 'warn' }
    ],
    snapshot: { version: 'v14', generatedAt: '6 分钟前' }
  },
  {
    id: 'l2',
    name: '刘一帆',
    email: 'liu**@163.com',
    joined: '5 天前',
    trend: 'flat',
    fatigue: '低',
    path: '数据分析思维',
    stage: '阶段 1 · 提问训练',
    task: '把模糊问题拆成可验证假设',
    pct: 22,
    concepts: {
      mastered: ['假设检验直觉'],
      struggling: ['采样偏差'],
      fragile: ['辛普森悖论']
    },
    trend7d: [2, 3, 3, 3, 4, 4, 4],
    sessions: [
      { time: '22 分钟前', title: '提问训练 1/4', result: '完成 · 概念「采样偏差」挣扎', tone: 'warn' }
    ],
    snapshot: { version: 'v6', generatedAt: '22 分钟前' }
  },
  {
    id: 'l3',
    name: '赵敏',
    email: 'zhaomin@example.com',
    joined: '21 天前',
    trend: 'down',
    fatigue: '高',
    path: 'SQL 基础',
    stage: '阶段 3 · JOIN 实战',
    task: '多表关联去重',
    pct: 61,
    concepts: {
      mastered: ['SELECT', 'WHERE', 'GROUP BY'],
      struggling: ['LEFT JOIN', 'JOIN 去重'],
      fragile: ['子查询']
    },
    trend7d: [7, 6, 6, 5, 4, 3, 3],
    sessions: [
      { time: '4 分钟前', title: 'JOIN 实战 3/4', result: '失败 · 连续第 3 次', tone: 'bad' },
      { time: '昨天', title: 'JOIN 实战 2/4', result: '失败 · 已伴学介入', tone: 'bad' },
      { time: '2 天前', title: 'GROUP BY 复习', result: '完成', tone: 'ok' }
    ],
    snapshot: { version: 'v21', generatedAt: '4 分钟前' }
  },
  {
    id: 'l4',
    name: '孙可',
    email: 'sunke@example.com',
    joined: '30 天前',
    trend: 'down',
    fatigue: '中',
    path: 'Python 入门',
    stage: '阶段 2 · 函数',
    task: '参数与返回值',
    pct: 38,
    concepts: {
      mastered: ['变量', '列表'],
      struggling: ['默认参数'],
      fragile: ['作用域']
    },
    trend7d: [5, 5, 4, 4, 3, 2, 2],
    sessions: [
      { time: '13 分钟前', title: '函数练习 2/5', result: '完成 · 用时偏长', tone: 'warn' }
    ],
    snapshot: { version: 'v11', generatedAt: '13 分钟前' }
  }
]

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

export const virtualProfiles: VirtualProfile[] = [
  {
    id: 'vl-001',
    name: '疲惫的运营小张',
    archetype: '高压实用主义者',
    story: '28 岁，电商运营。每周五花 3 小时做周报，最怕临时加需求。学过两次 Excel 课都放弃了，因为"用不上"。这次只想解决周报自动化这一件事。',
    goal: '把 Excel 周报自动化',
    traits: ['时间稀缺', '畏难脚本', '模板驱动', '目标单一'],
    runs: [
      { time: '今天 15:20', stage: 'Learn 3/5', result: '数据清洗练习通过，未触发疲劳', tone: 'ok' },
      { time: '今天 14:02', stage: 'Path 生成', result: '4 阶段 · 难度评分合适', tone: 'ok' },
      { time: '今天 13:47', stage: 'Goal 对话', result: '8 轮收敛，概念抽取完整', tone: 'ok' },
      { time: '昨天 18:30', stage: 'Goal 对话（旧稿）', result: '故事代入感不足，弃用', tone: 'bad' }
    ],
    aiProfile: [
      { label: '耐心阈值', value: '低（<10 分钟无反馈会流失）' },
      { label: '示例偏好', value: '先看成品再理解原理' },
      { label: '最佳时段', value: '午休 / 通勤' }
    ]
  },
  {
    id: 'vl-002',
    name: '转行的前教师',
    archetype: '系统型转行者',
    story: '34 岁，十年教龄转行数据分析。自律、笔记工整，但容易陷入"把课全学完再动手"的陷阱，需要被推着早做项目。',
    goal: '系统学数据分析',
    traits: ['自律', '过度准备', '理论先行'],
    runs: [
      { time: '今天 11:15', stage: 'Path 生成', result: '6 阶段 · 含 3 个实战项目', tone: 'ok' }
    ],
    aiProfile: [
      { label: '学习风格', value: '体系化，容忍长课程' },
      { label: '风险', value: '项目逃避 → 需里程碑倒逼' }
    ]
  },
  {
    id: 'vl-003',
    name: '拖延的研究生',
    archetype: '截止线驱动者',
    story: '26 岁，研三，论文初稿拖了两个月。状态起伏大，weekday 低效、周末爆发。对"打卡"" streak"类机制反感，对"还有 X 天"敏感。',
    goal: '30 天写完论文初稿',
    traits: ['起伏大', '反感打卡', '死线敏感'],
    runs: [
      { time: '今天 09:40', stage: 'Learn 完成', result: '全程 5 轮，后段疲劳上调', tone: 'warn' }
    ],
    aiProfile: [
      { label: '激励模型', value: '倒计时 > 连续打卡' },
      { label: '内容粒度', value: '25 分钟小任务' }
    ]
  }
]

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

export const userDetails: UserDetail[] = [
  {
    id: 'u1',
    name: '陈晓',
    email: 'chenxiao@example.com',
    role: '用户',
    joined: '12 天前',
    lastLogin: '12 分钟前',
    stats: [
      { label: '目标', value: '1' },
      { label: '路径', value: '1' },
      { label: '任务完成', value: '23' },
      { label: '连续学习', value: '5 天' }
    ],
    recentPaths: [
      { title: 'Excel 自动化入门', stage: '阶段 2/4 · 数据清洗', pct: 46, tone: 'ok' }
    ],
    activity: [
      { time: '6 分钟前', text: '完成「数据清洗练习 2/3」' },
      { time: '昨天 21:14', text: '完成「SUMIF 实战」' },
      { time: '3 天前', text: '创建目标：把 Excel 周报自动化' }
    ]
  },
  {
    id: 'u2',
    name: '刘一帆',
    email: 'liu**@163.com',
    role: '用户',
    joined: '5 天前',
    lastLogin: '1 小时前',
    stats: [
      { label: '目标', value: '1' },
      { label: '路径', value: '1' },
      { label: '任务完成', value: '7' },
      { label: '连续学习', value: '2 天' }
    ],
    recentPaths: [
      { title: '数据分析思维', stage: '阶段 1/3 · 提问训练', pct: 22, tone: 'warn' }
    ],
    activity: [
      { time: '22 分钟前', text: '完成「提问训练 1/4」' },
      { time: '5 天前', text: '注册并创建目标' }
    ]
  },
  {
    id: 'u3',
    name: '赵敏',
    email: 'zhaomin@example.com',
    role: '用户',
    joined: '21 天前',
    lastLogin: '3 天前',
    stats: [
      { label: '目标', value: '2' },
      { label: '路径', value: '2' },
      { label: '任务完成', value: '31' },
      { label: '连续学习', value: '0 天' }
    ],
    recentPaths: [
      { title: 'SQL 基础', stage: '阶段 3/4 · JOIN 实战', pct: 61, tone: 'warn' },
      { title: 'Excel 进阶', stage: '已完成', pct: 100, tone: 'ok' }
    ],
    activity: [
      { time: '4 分钟前', text: '「JOIN 实战 3/4」失败，已伴学介入' },
      { time: '昨天', text: '「JOIN 实战 2/4」失败' },
      { time: '2 天前', text: '完成「GROUP BY 复习」' },
      { time: '3 天前', text: '连续 3 天未登录' }
    ]
  },
  {
    id: 'u9',
    name: '郑爽',
    email: 'zhengshuang@example.com',
    role: '用户',
    joined: '16 天前',
    lastLogin: '26 分钟前',
    stats: [
      { label: '目标', value: '2' },
      { label: '路径', value: '2' },
      { label: '任务完成', value: '18' },
      { label: '连续学习', value: '9 天' }
    ],
    recentPaths: [
      { title: '产品经理入门', stage: '阶段 2/5 · 需求文档', pct: 38, tone: 'ok' },
      { title: '数据分析思维', stage: '阶段 1/3 · 提问训练', pct: 30, tone: 'ok' }
    ],
    activity: [
      { time: '26 分钟前', text: '完成「PRD 结构拆解 2/3」' },
      { time: '昨天 23:02', text: '完成「用户访谈提纲」' },
      { time: '2 天前', text: '创建目标：两周上手需求文档' }
    ]
  }
]

/* ---------- 总览推导 ---------- */
export const overviewHealth = computed(() => {
  // 真实数据模式：用后端统计推导
  if (dataSource.value === 'live' && liveOverview.value) return liveOverview.value
  const errs = spans.value.filter((s) => s.status === 'err').length
  if (errs > 0) return { tone: 'warn' as const, score: 61, headline: `需要关注：${errs} 次失败`, subline: '教学链路连续 429 限流，伴学已降级介入。' }
  return { tone: 'ok' as const, score: 92, headline: '运行平稳', subline: '学习链路与模型服务都在正常区间。' }
})
