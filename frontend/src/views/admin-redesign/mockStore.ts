/**
 * Admin 重设计实验室：共享数据仓库
 *
 * 核心概念：一条事故线贯穿全站。
 * - 所有页面读同一份 span 数据（执行日志 / 事件中心 / Skill / 总览看到的
 *   是同一次 429 爆发的不同切面）
 * - intent 驱动跨页排查动线：总览事故卡 → 已过滤的日志 → Trace 瀑布 → Skill 抽屉
 * - labState 全局切换（normal / incident / fresh），全站一致
 */
import { computed, reactive, ref } from 'vue'

export type LabState = 'normal' | 'incident' | 'fresh'

export const labState = ref<LabState>('normal')

/* ---------- Trace Span（全站最小事实单元） ---------- */
export interface TraceSpan {
  id: string
  traceId: string
  kind: 'flow' | 'call'
  agent: string
  stage: string
  title: string
  /** 相对 trace 起点的偏移 ms 与耗时 */
  startMs: number
  durationMs: number
  status: 'ok' | 'warn' | 'err'
  detail: string
  payload?: string
}

/** 成功链路：一次完整的路径生成（Goal → Path） */
const successTrace: TraceSpan[] = [
  { id: 's1', traceId: 'tr:8f31a2', kind: 'flow', agent: 'goal-agent', stage: '目标收集', title: '目标对话完成', startMs: 0, durationMs: 1240, status: 'ok', detail: '抽取 2 个概念：Excel 周报、自动化', payload: '{\n  "round": 7,\n  "concepts": ["Excel 周报", "自动化"],\n  "confidence": 0.86\n}' },
  { id: 's2', traceId: 'tr:8f31a2', kind: 'call', agent: 'goal-conversation', stage: '目标收集', title: 'Prompt 调用', startMs: 120, durationMs: 1100, status: 'ok', detail: 'deepseek-v4-flash · P 860 / C 204' },
  { id: 's3', traceId: 'tr:8f31a2', kind: 'call', agent: 'goal-profile-inference', stage: '目标收集', title: '画像推断调用', startMs: 1260, durationMs: 890, status: 'ok', detail: 'deepseek-v4-flash · P 620 / C 148' },
  { id: 's4', traceId: 'tr:8f31a2', kind: 'flow', agent: 'path-agent', stage: '核心路径生成', title: '路径草稿就绪', startMs: 2260, durationMs: 5100, status: 'ok', detail: '零基础 · 每周 4 小时 · 4 阶段' },
  { id: 's5', traceId: 'tr:8f31a2', kind: 'call', agent: 'generic-planner', stage: '核心路径生成', title: '规划调用', startMs: 2380, durationMs: 4820, status: 'ok', detail: 'deepseek-v4-pro · P 2040 / C 1130', payload: '{\n  "stages": 4,\n  "milestones": 12,\n  "estimatedWeeks": 6\n}' },
  { id: 's6', traceId: 'tr:8f31a2', kind: 'flow', agent: 'path-agent', stage: '阶段任务设计', title: '路径生成完成', startMs: 7360, durationMs: 2600, status: 'ok', detail: '18 任务 · 总用时 9.9s' }
]

/** 事故链路：教学回合遭遇 429 限流并级联 */
const incidentTrace: TraceSpan[] = [
  { id: 'i1', traceId: 'tr:8f31c4', kind: 'flow', agent: 'teaching-agent', stage: '教学执行', title: '教学回合开始', startMs: 0, durationMs: 30000, status: 'err', detail: '阶段 2 · 数据清洗练习', payload: '{\n  "milestone": "m2-3",\n  "user": "user_chenxiao"\n}' },
  { id: 'i2', traceId: 'tr:8f31c4', kind: 'call', agent: 'teaching-round', stage: '教学执行', title: '教学调用 · 尝试 1', startMs: 80, durationMs: 18400, status: 'err', detail: '429 rate limit · 18.4s', payload: '{\n  "error": "RateLimitExceeded",\n  "provider": "deepseek",\n  "retryAfterMs": 20000,\n  "attempt": 1\n}' },
  { id: 'i3', traceId: 'tr:8f31c4', kind: 'call', agent: 'teaching-round', stage: '教学执行', title: '教学调用 · 尝试 2（退避后）', startMs: 20500, durationMs: 9400, status: 'err', detail: '429 rate limit · 9.4s', payload: '{\n  "error": "RateLimitExceeded",\n  "retryAfterMs": 20000,\n  "attempt": 2\n}' },
  { id: 'i4', traceId: 'tr:8f31c4', kind: 'call', agent: 'companion-boost', stage: '教学执行', title: '伴学降级介入', startMs: 30100, durationMs: 1300, status: 'warn', detail: '改用缓存讲解 · 质量分 0.58' },
  { id: 'i5', traceId: 'tr:8f31c4', kind: 'flow', agent: 'learner-agent', stage: '状态回写', title: '疲劳信号上调', startMs: 31600, durationMs: 480, status: 'warn', detail: 'fatigue: 低 → 中（连续失败）' }
]

/** 背景噪音日志（不构成完整 trace） */
const backgroundSpans: TraceSpan[] = [
  { id: 'b1', traceId: 'tr:8f319e', kind: 'call', agent: 'snapshot-refresh', stage: '状态回写', title: '快照刷新', startMs: 0, durationMs: 210, status: 'ok', detail: 'user_1784… · 210ms' },
  { id: 'b2', traceId: 'tr:8f319b', kind: 'call', agent: 'session-wrapup', stage: '课后产出', title: '产出写入', startMs: 0, durationMs: 1600, status: 'ok', detail: '3 条笔记 · 1.6s' },
  { id: 'b3', traceId: 'tr:8f3188', kind: 'call', agent: 'basic-generator', stage: '内容生成', title: '输出接近上限', startMs: 0, durationMs: 2100, status: 'warn', detail: '3800/4000 tokens' }
]

export const spans = computed<TraceSpan[]>(() => {
  if (labState.value === 'fresh') return []
  if (labState.value === 'incident') return [...incidentTrace, ...successTrace.slice(0, 3), ...backgroundSpans]
  return [...successTrace, ...backgroundSpans]
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

export const agentProfiles: AgentProfile[] = [
  { id: 'goal-agent', name: '目标 Agent', description: '收集学习目标与上下文，输出 Goal Understanding。' },
  { id: 'path-agent', name: '路径 Agent', description: '规划学习路径与阶段拆解。' },
  { id: 'teaching-agent', name: '教学 Agent', description: 'AI 教学会话编排：单轮教学、伴学补强、课后产出。' },
  { id: 'learner-agent', name: '学习者 Agent', description: '画像、状态聚合、知识沉淀与快照刷新。' },
  { id: 'virtual-agent', name: '虚拟学习者 Agent', description: '黑盒模拟：故事 → Goal → Path → Learn 运行。' }
]

export function skillsOfAgent(agentId: string): SkillProfile[] {
  return skillProfiles.filter((p) => p.agentId === agentId)
}

export const skillProfiles: SkillProfile[] = [
  { id: 'goal-conversation', name: '目标对话', agentId: 'goal-agent', agentName: '目标 Agent', category: 'analysis', promptVersion: 'v3.2 · 已生效', description: '与用户聊清真实场景，抽取可规划的概念。' },
  { id: 'goal-profile-inference', name: '目标画像推断', agentId: 'goal-agent', agentName: '目标 Agent', category: 'analysis', promptVersion: 'v2.1 · 已生效', description: '从对话推断学习者的基础、偏好与约束。' },
  { id: 'goal-understanding-composer', name: '目标理解合成', agentId: 'goal-agent', agentName: '目标 Agent', category: 'analysis', promptVersion: 'v1.4 · 已生效', description: '把多轮对话合成为结构化的目标理解。' },
  { id: 'dialogue-concept-extractor', name: '对话概念抽取', agentId: 'goal-agent', agentName: '目标 Agent', category: 'analysis', promptVersion: 'v2.0 · 已生效', description: '从对话中抽取候选学习概念。' },
  { id: 'generic-planner', name: '通用路径规划', agentId: 'path-agent', agentName: '路径 Agent', category: 'generation', promptVersion: 'v4.0 · 已生效', description: '把目标拆解为阶段与里程碑。' },
  { id: 'path-scene-framer', name: '路径场景定帧', agentId: 'path-agent', agentName: '路径 Agent', category: 'analysis', promptVersion: 'v1.1 · 已生效', description: '确定路径的使用场景与节奏假设。' },
  { id: 'stage-designer', name: '阶段设计', agentId: 'path-agent', agentName: '路径 Agent', category: 'generation', promptVersion: 'v1.8 · 草案', description: '展开每个阶段的任务与验收标准。' },
  { id: 'teaching-round', name: '教学回合', agentId: 'teaching-agent', agentName: '教学 Agent', category: 'teaching', promptVersion: 'v5.1 · 已生效', description: '单轮教学：讲解、练习、反馈。' },
  { id: 'companion-boost', name: '伴学补强', agentId: 'teaching-agent', agentName: '教学 Agent', category: 'teaching', promptVersion: 'v1.2 · 已生效', description: '在主教学失败或薄弱时介入补强。' },
  { id: 'session-wrapup', name: '课后产出', agentId: 'teaching-agent', agentName: '教学 Agent', category: 'generation', promptVersion: 'v2.4 · 已生效', description: '把会话沉淀为笔记与下一步建议。' },
  { id: 'state-aggregator', name: '状态聚合', agentId: 'learner-agent', agentName: '学习者 Agent', category: 'analysis', promptVersion: 'v1.3 · 已生效', description: '聚合行为数据为学习者状态视图。' },
  { id: 'snapshot-refresh', name: '快照刷新', agentId: 'learner-agent', agentName: '学习者 Agent', category: 'analysis', promptVersion: 'v1.5 · 已生效', description: '聚合行为数据，重算学习者快照。' },
  { id: 'knowledge-distill', name: '知识沉淀', agentId: 'learner-agent', agentName: '学习者 Agent', category: 'analysis', promptVersion: 'v0.9 · 草案', description: '把掌握的知识点沉淀进概念图。' },
  { id: 'turn-simulator', name: '回合模拟', agentId: 'virtual-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v1.0 · 已生效', description: '以虚拟学习者身份模拟教学回合。' },
  { id: 'path-evaluator', name: '路径评估', agentId: 'virtual-agent', agentName: '虚拟学习者 Agent', category: 'simulation', promptVersion: 'v0.8 · 草案', description: '辅助调试：评估生成路径的可学性。' },
  { id: 'basic-generator', name: '基础内容生成', agentId: 'teaching-agent', agentName: '教学 Agent', category: 'generation', promptVersion: 'generated · 默认草案', description: '通用生成兜底。' }
]

export interface SkillStat {
  calls: number
  errors: number
  avgMs: number
  lastAt: string
}

export function skillStatOf(skillId: string): SkillStat {
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
}

export const intent = reactive<InvestigationIntent>({
  scene: 'overview',
  agentFilter: '',
  statusFilter: '',
  traceId: '',
  skillDrawerId: ''
})

/** 总览事故卡 → 执行日志（已过滤该节点 + 失败） */
export function investigateAgent(agentId: string) {
  intent.agentFilter = agentId
  intent.statusFilter = 'err'
  intent.traceId = ''
  intent.scene = 'execution-logs'
}

/** 任意位置点 Trace → 事件中心瀑布视图 */
export function openTrace(traceId: string) {
  intent.traceId = traceId
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.scene = 'event-center'
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
}

/* ---------- 二级页面（drill-in） ---------- */
export type SubPageView = 'learner' | 'virtual' | 'user'

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
  }
]

/* ---------- 总览推导 ---------- */
export const overviewHealth = computed(() => {
  if (labState.value === 'fresh') return { tone: 'muted' as const, score: 100, headline: '系统空闲', subline: '部署完成，等待第一个真实学习者。' }
  const errs = spans.value.filter((s) => s.status === 'err').length
  if (errs > 0) return { tone: 'warn' as const, score: 61, headline: `需要关注：${errs} 次失败`, subline: '教学链路连续 429 限流，伴学已降级介入。' }
  return { tone: 'ok' as const, score: 92, headline: '运行平稳', subline: '学习链路与模型服务都在正常区间。' }
})
