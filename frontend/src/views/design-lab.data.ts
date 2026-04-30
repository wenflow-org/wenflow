export type DeviceId = 'desktop' | 'mobile';
export type SceneId = 'home' | 'dashboard' | 'requirement' | 'paths' | 'path-detail' | 'learning' | 'evaluation';
export type Tone = 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'danger';

export interface ThemeTokens {
  canvas: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  navBg: string;
  chip: string;
  shadow: string;
  heroGradient: string;
  userBubble: string;
  aiBubble: string;
  track: string;
  cardRadius: string;
  pillRadius: string;
  displayFont: string;
  bodyFont: string;
}

export interface ThemeCopy {
  tagline: string;
  homeTitle: string;
  homeSubtitle: string;
  dashboardTitle: string;
  dashboardSubtitle: string;
  plannerTitle: string;
  plannerSubtitle: string;
  pathsTitle: string;
  pathsSubtitle: string;
  learningTitle: string;
  learningBanner: string;
  evaluationTitle: string;
  signature: string[];
}

export interface LabTheme {
  id: string;
  name: string;
  shortName: string;
  source: string;
  summary: string;
  emphasis: string;
  tokens: ThemeTokens;
  copy: ThemeCopy;
}

export interface LabScene {
  id: SceneId;
  index: string;
  title: string;
  route: string;
  summary: string;
  focus: string[];
}

export const themes: LabTheme[] = [
  {
    id: 'friendly-companion',
    name: '友好陪伴风',
    shortName: 'Companion',
    source: '陪伴式学习板 + 渐变卡片 + 鼓励式任务反馈',
    summary: '更亲和、更鼓励式，重点是让用户敢开始、能持续，并在每个场景里先看到下一步动作。',
    emphasis: '更像一位会陪你把问题拆小的学习陪练。',
    tokens: {
      canvas: '#edf4ff',
      surface: '#ffffff',
      surfaceAlt: '#f7f9ff',
      border: '#d2dbf3',
      borderStrong: '#b7c7ea',
      text: '#1d3150',
      muted: '#7085a6',
      primary: '#3478f6',
      secondary: '#43b0d8',
      accent: '#8d6bff',
      success: '#31b16f',
      warning: '#f4aa46',
      danger: '#ef7578',
      navBg: 'rgba(255, 255, 255, 0.9)',
      chip: 'rgba(141, 107, 255, 0.12)',
      shadow: '0 30px 90px rgba(58, 101, 197, 0.16)',
      heroGradient: 'linear-gradient(135deg, rgba(52, 120, 246, 0.18), rgba(141, 107, 255, 0.13) 54%, rgba(67, 176, 216, 0.10))',
      userBubble: '#3478f6',
      aiBubble: '#f1f5ff',
      track: '#dee8fb',
      cardRadius: '34px',
      pillRadius: '999px',
      displayFont: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
      bodyFont: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
    },
    copy: {
      tagline: '友好陪伴风',
      homeTitle: '想学的东西很多，先把真正的问题想清楚',
      homeSubtitle: '从真实问题出发，再进入 AI 规划、对话学习和进度追踪。',
      dashboardTitle: '欢迎回来，今天先推进一个最容易开始的小任务',
      dashboardSubtitle: '先给你一个可以马上行动的起点，再看进度和状态。',
      plannerTitle: '先把真正要解决的问题说清楚',
      plannerSubtitle: '围绕真实困扰、时间窗口和已有基础，把学习目标慢慢收敛。',
      pathsTitle: '学习路径',
      pathsSubtitle: '管理和追踪你的所有学习计划。',
      learningTitle: '陪练中：把异常处理讲成你真的能用的东西',
      learningBanner: '本节目标：把异常处理和日志记录讲清楚。',
      evaluationTitle: '授课结束评估',
      signature: ['更柔和的蓝紫渐变', '鼓励式任务反馈', '先给动作再给数据']
    }
  }
];

export const scenes: LabScene[] = [
  {
    id: 'home',
    index: '01',
    title: '首页',
    route: '/',
    summary: '把平台方法讲清楚，并给出进入学习流程的入口。',
    focus: ['首页承担筛选与引导，不只是营销大图。', '把路径样例提前展示，让用户先看结果。', 'CTA 要连接真实业务链，而不是只做注册入口。']
  },
  {
    id: 'dashboard',
    index: '02',
    title: '学习台',
    route: '/dashboard',
    summary: '展示今日推进、状态解释和下一步动作。',
    focus: ['优先告诉用户今天该做什么。', '数据卡服务行动决策，而不是单独存在。', '右侧区域给节奏解释和提醒。']
  },
  {
    id: 'requirement',
    index: '03',
    title: '需求测',
    route: '/goal-conversation',
    summary: '用对话澄清真实问题、约束和期望周期。',
    focus: ['理解摘要要始终可见。', '对话不是闲聊，而是为了生成可执行路径。', '快速回复和约束卡帮助用户持续补充关键信息。']
  },
  {
    id: 'paths',
    index: '04',
    title: '路径列表',
    route: '/learning-paths',
    summary: '同时容纳生成中、失败和推进中的路径。',
    focus: ['列表页就要提供状态解释。', '异常状态必须可重试，不应消失。', '把主路径和次路径区分清楚。']
  },
  {
    id: 'path-detail',
    index: '05',
    title: '路径详情',
    route: '/learning-path/1',
    summary: '把阶段、任务、目标和下次学习安排说清楚。',
    focus: ['让用户知道当前在第几阶段。', '任务卡应可读，不要被状态样式盖住。', '右侧区域放推进建议和下次学习窗口。']
  },
  {
    id: 'learning',
    index: '06',
    title: '授课页',
    route: '/learn/task-1',
    summary: '展示知识点侧栏、课堂对话、检核题和输入区。',
    focus: ['聊天区必须像真实授课页面。', '知识点侧栏和课堂检核题不能只当装饰。', '结束评估入口需要自然衔接学习流程。']
  },
  {
    id: 'evaluation',
    index: '07',
    title: '评估页',
    route: '/learn/task-1?report=1',
    summary: '解释掌握情况、亮点、压力和下一步行动。',
    focus: ['评估要解释为什么，而不只是打分。', '知识证据、关键收获和行动计划要并列可读。', '延续真实授课页的上下文，而不是突然跳风格。']
  }
];

export const appNavItems = ['学习台', 'AI 规划', '学习路径', '学习状态'];

export const homeJourneySteps = [
  { step: '01', title: '先把困扰说出来', desc: '不用先会很多，只要把你眼前最真实的麻烦讲清楚。' },
  { step: '02', title: '一起拆成小步骤', desc: '把目标拆成你能开始、能坚持、也能看见进展的任务。' },
  { step: '03', title: '边学边确认自己真的会了', desc: '通过对话、检核和复盘，让学习尽量贴近真实使用。' }
];

export const homeMethodSteps = [
  { title: '从真实问题开场', desc: '先把你想解决的麻烦说清楚，而不是泛泛地说想学什么。' },
  { title: '路径围绕约束生成', desc: '时间、基础和真实场景会一起影响学习路径怎么拆。' },
  { title: '边学边确认自己会了', desc: '通过对话、检核和复盘，把知识拉回真实使用场景。' }
];

export const homePrinciples = [
  'AI 规划：把模糊目标拆成能开始的学习路径。',
  '对话学习：围绕你的真实任务继续追问和讲解。',
  '状态追踪：在掌握、压力和下一步行动之间保持节奏。'
];

export const featuredPaths = [
  { title: 'Python 自动化提效', badge: '工作减负', tone: 'primary' as Tone, desc: '围绕每周 Excel 报表，3 周搭起自动化最小闭环。', tags: ['3 周', '9 个任务', '先做异常处理'] },
  { title: '概率论错题修复', badge: '考试修复', tone: 'success' as Tone, desc: '从错题回推概念，把“会做但说不清”慢慢补回来。', tags: ['2 周', '6 个任务', '概念复述'] },
  { title: '英语复述表达训练', badge: '表达练习', tone: 'accent' as Tone, desc: '通过复述和反馈循环提升连续表达的稳定性。', tags: ['轻任务', '每日 20 分钟', '即时反馈'] }
];

export const homeProofCards = [
  { title: '目标拆解', desc: '把“想学”先拆成一个你今天就能开始的小任务。' },
  { title: 'AI 对话学习', desc: '边学边问，像陪练一样围绕你的真实问题推进。' },
  { title: '学习状态追踪', desc: '看到节奏、疲劳和长期积累，知道下一步该怎么走。' }
];

export const dashboardWelcomeSubtitle = '继续围绕真实问题推进，先做一个最容易开始的小任务。';

export const dashboardOverviewCards = [
  { tag: '路径', value: '2', label: '正在推进的路径', hint: '你现在有 2 条路径正在继续整理和推进', footer: '先聚焦一条主路径会更轻松', tone: 'primary' as Tone },
  { tag: '投入', value: '51', label: '最近学习分钟', hint: '最近几次学习累计 51 分钟，已经开始形成手感', footer: '先保持发生，再慢慢拉长时长', tone: 'success' as Tone },
  { tag: '节奏', value: '20%', label: '完整收口率', hint: '最近已经开始了不少学习，但真正完整结束的次数还不多', footer: '先把一次学习完整做完，比继续加内容更重要', tone: 'warning' as Tone },
  { tag: '状态', value: 'LSB +3.6', label: '当前状态脉冲', hint: 'KTL 6.8 / LF 3.2，说明还有余力，但不适合猛冲', footer: '建议继续轻量推进', tone: 'accent' as Tone },
];

export const dashboardPathRadar = [
  {
    title: '在会议讨论中主动表达后避免误解的清晰表达入门',
    badge: '主路径',
    tone: 'primary' as Tone,
    status: 'active',
    estimatedHours: '18 小时',
    milestones: '0 / 4 节点',
    deadline: '1-2 天见效',
    updatedAt: '最近更新：今天 10:41',
    summary: '围绕真实会议场景训练表达前澄清、表达中收束、表达后确认的完整闭环。',
    nextStep: '下一步：进入一次“冲突经历地图”反思练习'
  },
  {
    title: '跨部门协作冲突解决入门路径：从意见分歧到高效共识',
    badge: '辅路径',
    tone: 'success' as Tone,
    status: 'active',
    estimatedHours: '24 小时',
    milestones: '0 / 4 节点',
    deadline: '无硬截止',
    updatedAt: '最近更新：3 天前',
    summary: '把冲突从“沟通失败”翻译成可观察、可拆解、可练习的协作问题。',
    nextStep: '下一步：完成一次案例分析，提炼冲突触发点'
  },
  {
    title: '数据看板自动汇总',
    badge: '待重试',
    tone: 'danger' as Tone,
    status: 'failed',
    estimatedHours: '待确认',
    milestones: '--',
    deadline: '缺少样例文件',
    updatedAt: '最近更新：5 天前',
    summary: '路径生成失败并不意味着它应该消失，它只是说明条件还不够。',
    nextStep: '下一步：补一份真实文件后重新生成'
  }
];

export const dashboardSessionFeed = [
  {
    topic: '反思练习：盘点你的“冲突经历地图”',
    taskType: 'practice',
    status: 'timeout',
    duration: '未完整结束',
    time: '今天 13:52',
    note: '你已经开始进入学习了，下一步更重要的是把它顺利收住。'
  },
  {
    topic: '案例分析：解码一次真实的跨部门会议冲突',
    taskType: 'reading',
    status: 'completed',
    duration: '18 分钟',
    time: '今天 11:35',
    note: '这是最近一次完整学完的一节，节奏刚刚好。'
  },
  {
    topic: '阅读：理解跨部门冲突的必然性与价值',
    taskType: 'reading',
    status: 'timeout',
    duration: '中途退出',
    time: '今天 09:50',
    note: '如果最近总在中途停下，先把一次学习完整走完就会轻松很多。'
  }
];

export const dashboardStatePulse = [
  { label: '11:49', lsb: '+4.47', ktl: '7.57', lf: '3.10', lss: '2.96' },
  { label: '11:51', lsb: '+4.22', ktl: '7.35', lf: '3.14', lss: '3.21' },
  { label: '11:53', lsb: '+3.66', ktl: '6.98', lf: '3.32', lss: '3.26' },
  { label: '11:55', lsb: '+3.61', ktl: '6.77', lf: '3.17', lss: '2.81' }
];

export const dashboardStateSummary = {
  headline: '状态还在正区间，但知识增量开始变慢。',
  body: '这更像一次适合轻量推进的学习窗口。先做一个能收住的小步骤，会比一下子塞进太多内容更舒服。'
};

export const dashboardFrictionSignals = [
  {
    title: '最近经常学到一半停下',
    value: '8 / 10 次未完整结束',
    desc: '这不一定说明时间不够，更可能说明你现在需要更短、更容易收口的学习安排。',
    tone: 'warning' as Tone
  },
  {
    title: '路径已经有了，推进还没开始',
    value: '2 条路径待真正启动',
    desc: '你已经有了可以继续走的方向，接下来更重要的是把第一步真正做完。',
    tone: 'primary' as Tone
  },
  {
    title: '先把主路径走顺，比加新内容更重要',
    value: '先聚焦当前重点',
    desc: '现在最值得做的不是再开新坑，而是把手头这条主路径慢慢走稳。',
    tone: 'accent' as Tone
  }
];

export const dashboardMomentumTimeline = [
  { title: '最近回来过', desc: '上次登录：4 月 27 日 10:39。你已经在重新把学习接起来。', tone: 'success' as Tone },
  { title: '最近整理出一条新路径', desc: '今天 10:41 新生成了表达训练路径，说明方向已经开始变清楚。', tone: 'primary' as Tone },
  { title: '最近一次完整学完', desc: '最近一次完整学习用了 18 分钟，这可以作为你现在最舒服的学习长度。', tone: 'accent' as Tone }
];

export const dashboardCoachFeed = [
  { title: '先把一次学习完整做完', desc: '如果最近总是在中途停下，先缩短任务长度，把一次学习稳稳收住。' },
  { title: '主路径先别换', desc: '现在最值得做的不是再找新方向，而是先把眼前这条主路径推进起来。' },
  { title: '今天适合轻量推进', desc: '你现在还有余力，但更适合做一个能完成的小步骤，而不是一口气塞进太多内容。' }
];

export const dashboardActionItems = [
  { title: '继续当前主路径', desc: '把“冲突经历地图”这一步完整做完，先形成一次完整收口。', to: '/ui-lab/learn/task-1', badge: '优先', tone: 'primary' as Tone },
  { title: '回看最近一次中断点', desc: '找到上次停下的位置，只补一个最小步骤，不额外开新内容。', to: '/ui-lab/state', badge: '轻任务', tone: 'warning' as Tone },
  { title: '记录一次小复盘', desc: '用一句话写下今天学到了什么，帮助下一次更容易接上。', to: '/ui-lab/feedback', badge: '收口', tone: 'accent' as Tone }
];

export const dashboardAchievementSnapshot = {
  recent: {
    title: '连续学习回归',
    desc: '重新回到学习节奏，并完成最近一次完整学习。',
    xp: '+120 XP'
  },
  next: {
    title: '稳定推进者',
    desc: '再完成 2 次完整学习，就能解锁下一个稳定推进成就。',
    progress: '2 / 4'
  },
  summary: {
    xp: '2610 XP',
    rate: '28%',
    unlocked: '7 个已解锁'
  }
};

export const stateDetailMetrics = [
  { label: 'LSB', value: '+3.61', note: '整体状态仍在正区间，适合继续推进。', tone: 'primary' as Tone },
  { label: 'LSS', value: '2.81', note: '当前压力不高，适合做轻量任务。', tone: 'warning' as Tone },
  { label: 'KTL', value: '6.77', note: '理解还在增长，但增速开始放缓。', tone: 'success' as Tone },
  { label: 'LF', value: '3.17', note: '疲劳可控，但不建议继续加太多内容。', tone: 'accent' as Tone }
];

export const stateTrendSeries = [
  { time: '周一', lsb: '+2.8', lss: '3.4', ktl: '6.2', lf: '3.4' },
  { time: '周二', lsb: '+3.1', lss: '3.1', ktl: '6.4', lf: '3.3' },
  { time: '周三', lsb: '+3.5', lss: '2.9', ktl: '6.6', lf: '3.1' },
  { time: '周四', lsb: '+3.7', lss: '2.8', ktl: '6.9', lf: '3.2' },
  { time: '今天', lsb: '+3.6', lss: '2.8', ktl: '6.8', lf: '3.2' }
];

export const stateInsightCards = [
  { title: '当前建议', desc: '今天更适合做一件能完成的小步骤，而不是继续扩展新内容。', tone: 'primary' as Tone },
  { title: '风险提醒', desc: '最近学习容易中途停下，建议把单次学习控制在 20 分钟左右。', tone: 'warning' as Tone },
  { title: '指标说明', desc: 'LSB 代表状态平衡，LSS 代表压力，KTL 代表理解增长，LF 代表疲劳累积。', tone: 'accent' as Tone }
];

export const achievementOverviewCards = [
  { label: '已解锁成就', value: '7', note: '已经有一批长期努力被记录下来。', tone: 'success' as Tone },
  { label: '待解锁成就', value: '18', note: '还有不少里程碑等你慢慢接近。', tone: 'primary' as Tone },
  { label: '累计 XP', value: '2610', note: '长期投入正在慢慢积累成结果。', tone: 'warning' as Tone },
  { label: '完成率', value: '28%', note: '成就是长期反馈，不需要着急。', tone: 'accent' as Tone }
];

export const achievementCategories = ['全部', '学习习惯', '路径推进', '状态稳定', '表达成长'];

export const achievementSpotlight = {
  recent: {
    title: '最近解锁',
    name: '连续学习回归',
    desc: '重新回到学习节奏，并完成最近一次完整学习。',
    xp: '+120 XP',
    earnedAt: '4 月 28 日'
  },
  next: {
    title: '下一步最值得追',
    name: '主路径启动者',
    desc: '再完成 2 次主路径任务推进，就能解锁这条里程碑成就。',
    progress: '2 / 4',
    actionLabel: '继续主路径',
    actionTo: '/ui-lab/paths/1'
  }
};

export const achievementCards = [
  {
    title: '连续学习回归',
    desc: '重新回到学习节奏，并完成最近一次完整学习。',
    status: 'unlocked',
    xp: '+120 XP',
    category: '学习习惯',
    progress: '已完成',
    icon: '🔥',
    unlocked: true,
    earnedAt: '4 月 28 日',
    actionLabel: '查看学习台',
    actionTo: '/ui-lab/dashboard'
  },
  {
    title: '主路径启动者',
    desc: '让当前主路径第一次真正推进，而不只是停留在已生成状态。',
    status: 'next',
    xp: '+180 XP',
    category: '路径推进',
    progress: '2 / 4',
    icon: '🚀',
    unlocked: false,
    progressDetail: { current: 2, total: 4, percentage: 50 },
    actionLabel: '继续主路径',
    actionTo: '/ui-lab/paths/1'
  },
  {
    title: '轻量稳定推进',
    desc: '连续 4 次保持可收口的小步学习，不在中途放弃。',
    status: 'locked',
    xp: '+240 XP',
    category: '状态稳定',
    progress: '1 / 4',
    icon: '🧭',
    unlocked: false,
    progressDetail: { current: 1, total: 4, percentage: 25 },
    actionLabel: '继续当前任务',
    actionTo: '/ui-lab/learn/task-1'
  },
  {
    title: '表达复盘者',
    desc: '完成一次表达训练后，写下自己的反思与修正。',
    status: 'locked',
    xp: '+90 XP',
    category: '表达成长',
    progress: '0 / 1',
    icon: '📝',
    unlocked: false,
    progressDetail: { current: 0, total: 1, percentage: 0 },
    actionLabel: '进入表达训练',
    actionTo: '/ui-lab/planning'
  }
];

// Legacy preview exports kept for DesignLabPreview compatibility.
export const dashboardSnapshotCards = [
  { label: '当前主路径', value: dashboardPathRadar[0].badge, note: dashboardPathRadar[0].title },
  { label: '最近会话', value: dashboardSessionFeed[0].status, note: dashboardSessionFeed[0].topic },
  { label: '状态摘要', value: dashboardStatePulse[dashboardStatePulse.length - 1].lsb, note: dashboardStateSummary.headline }
];

export const dashboardRhythmNotes = dashboardFrictionSignals.map((item) => `${item.title}：${item.desc}`);

export const dashboardTasks = dashboardSessionFeed.map((item, index) => ({
  title: item.topic,
  desc: item.note,
  badge: index === 0 ? '最近发生' : item.status,
  tone: (index === 0 ? 'primary' : index === 1 ? 'success' : 'accent') as Tone
}));

export const dashboardTracks = dashboardPathRadar.map((item, index) => ({
  title: item.title,
  desc: item.summary,
  nextStep: item.nextStep,
  badge: item.badge,
  tone: (item.tone ?? (index === 0 ? 'primary' : index === 1 ? 'success' : 'accent')) as Tone,
  progress: index === 0 ? 24 : index === 1 ? 12 : 0
}));

export const dashboardCalendar = [
  { label: '一', tone: 'warning' as Tone },
  { label: '二', tone: 'accent' as Tone },
  { label: '三', tone: 'primary' as Tone },
  { label: '四', tone: 'warning' as Tone },
  { label: '五', tone: 'success' as Tone },
  { label: '六', tone: 'warning' as Tone },
  { label: '日', tone: 'primary' as Tone }
];

export const plannerSummaryChips = ['真实问题：周报自动化', '当前水平：零散入门', '希望：3 周见效', '当前阻碍：时间碎片化'];

export const pathFilters = ['全部路径', '推进中', '生成中', '待重试', '轻任务'];

export const pathDetailProgress = 62;

export const dashboardStats = [
  { label: '今日任务', value: '3 项', hint: '按优先级排序', tone: 'primary' as Tone },
  { label: '连续学习', value: '6 天', hint: '建议保持轻节奏', tone: 'success' as Tone },
  { label: '当前路径', value: '2 条', hint: '一主一辅更合理', tone: 'accent' as Tone },
  { label: '学习状态', value: 'LSB +2.1', hint: '尚可继续推进', tone: 'warning' as Tone }
];

export const plannerMessages = [
  { role: 'ai' as const, avatar: 'AI', author: 'AI 规划师', time: '刚刚', content: '你不是单纯想学 Python，而是想解决每周手工整理报表的重复劳动，对吗？' },
  { role: 'user' as const, avatar: '你', author: '你', time: '刚刚', content: '对，我真正想解决的是这件事，不是泛泛地学编程。' },
  { role: 'ai' as const, avatar: 'AI', author: 'AI 规划师', time: '现在', content: '那我会围绕输入文件、清洗逻辑、异常场景和输出格式来拆目标。' }
];

export const plannerReplies = ['对，这就是核心问题', '我还有时间限制', '我担心自己坚持不下去'];

export const plannerSignals = [
  { label: '真实问题', value: '周报自动化' },
  { label: '当前水平', value: '零散入门' },
  { label: '期望周期', value: '3 周见效' },
  { label: '主要阻碍', value: '时间碎片化' }
];

export const plannerConstraints = ['每周只有 3 次学习窗口', '希望围绕真实 Excel 文件', '不想先学太多抽象语法'];

export const plannerDraftPath = [
  { title: '阶段 1：看懂输入与输出', desc: '确认报表结构、关键字段和目标结果。' },
  { title: '阶段 2：让脚本稳定运行', desc: '加入异常处理和日志，让它不是只能跑一次。' },
  { title: '阶段 3：嵌入真实工作流', desc: '把脚本接回每周流程，形成可持续使用的闭环。' }
];

export const pathCards = [
  { title: 'Python 自动化提效', summary: '从 Excel 清洗到日志与异常处理，围绕每周真实报表场景推进。', badge: '主路径', tone: 'primary' as Tone, state: 'active', meta: ['3 周', '9 个任务', '主路径'], progress: 62, nextStep: '下一步：异常处理与日志记录', action: '查看详情', estimatedHours: 6.5, totalStages: 3 },
  { title: '概率论错题修复', summary: '用错题回推知识漏洞，让概念和做题重新对齐。', badge: '本周重点', tone: 'success' as Tone, state: 'active', meta: ['2 周', '6 个任务', '主路径'], progress: 48, nextStep: '下一步：条件概率与贝叶斯直觉', action: '查看详情', estimatedHours: 4, totalStages: 2 },
  { title: '英语复述表达训练', summary: '通过句式拆解、复述和反馈循环提升口头表达的连续性。', badge: '生成中', tone: 'warning' as Tone, state: 'generating', meta: ['轻任务', '每日 20 分钟', '生成中'], progress: 24, nextStep: 'AI 正在补充练习任务与反馈节点', action: '等它整理好', estimatedHours: 0, totalStages: 0 },
  { title: '数据看板自动汇总', summary: '这条路径上次没有顺利生成，需要补充条件后再来一次。', badge: '生成失败', tone: 'danger' as Tone, state: 'failed', meta: ['失败', '需要重试', '条件不足'], progress: 0, nextStep: '建议补充真实文件样例后重新生成', action: '重试生成', estimatedHours: 0, totalStages: 0 }
];

export const pathGenerationStates = [
  { title: '问题理解', desc: '已经稳定收敛到真实业务问题', badge: '完成', tone: 'success' as Tone },
  { title: '路径生成', desc: '阶段拆解与依赖关系已经建立', badge: '完成', tone: 'success' as Tone },
  { title: '风险标注', desc: '识别到时间碎片化和复盘缺失，需要一起照顾到', badge: '提醒', tone: 'warning' as Tone }
];

export const pathListNotes = [
  '生成中的路径会继续留在这里，整理完成后就能直接进入。',
  '失败的路径可以补充条件后重试，不需要重新从头开始。',
  '主路径优先，其余路径保持轻量推进，节奏会更稳。'
];

export const pathDetailMeta = [
  { label: '总阶段', value: '3 阶段' },
  { label: '预计投入', value: '6.5 小时' },
  { label: '方向', value: '自动化提效' },
  { label: '任务完成', value: '5 / 9' }
];

export const pathStages = [
  {
    label: '阶段 1',
    title: '看懂输入与输出',
    summary: '先把真实文件结构、目标结果和最小处理路径对齐。',
    badge: '已完成',
    tone: 'success' as Tone,
    objectives: ['读取 Excel/CSV', '识别关键字段', '定义输出格式'],
    tasks: [
      { title: '读取一份真实报表', note: '从你自己的输入文件开始，而不是示例数据。', badge: '已完成', tone: 'success' as Tone, taskType: '观察任务', estimatedMinutes: 20, ability: '问题定义', statusLabel: '已完成', actionLabel: '复习', actionTo: '/ui-lab/learn/task-1' },
      { title: '识别关键字段', note: '区分必须字段和可选字段，避免脚本依赖过强。', badge: '已完成', tone: 'success' as Tone, taskType: '分析任务', estimatedMinutes: 15, ability: '结构分析', statusLabel: '已完成', actionLabel: '复习', actionTo: '/ui-lab/learn/task-1' },
      { title: '确定输出结构', note: '先定义最终结果，后面任务才不会跑偏。', badge: '已完成', tone: 'success' as Tone, taskType: '整理任务', estimatedMinutes: 15, ability: '结果定义', statusLabel: '已完成', actionLabel: '复习', actionTo: '/ui-lab/learn/task-1' }
    ]
  },
  {
    label: '阶段 2',
    title: '让脚本稳定运行',
    summary: '开始加入异常处理和日志，让脚本具备持续运行的能力。',
    badge: '进行中',
    tone: 'primary' as Tone,
    objectives: ['异常处理', '日志记录', '失败回溯'],
    tasks: [
      { title: '理解 try / except', note: '知道错误被捕获后应该记录什么。', badge: '学习中', tone: 'primary' as Tone, taskType: '授课任务', estimatedMinutes: 25, ability: '异常处理', statusLabel: '进行中', actionLabel: '继续学习', actionTo: '/ui-lab/learn/task-1' },
      { title: '为关键分支补日志', note: '记录失败位置、原因和输入上下文。', badge: '待开始', tone: 'warning' as Tone, taskType: '练习任务', estimatedMinutes: 20, ability: '日志记录', statusLabel: '未开始', actionLabel: '开始学习', actionTo: '/ui-lab/learn/task-1' },
      { title: '做一次失败回溯', note: '通过日志定位问题，不只看报错提示。', badge: '待开始', tone: 'warning' as Tone, taskType: '复盘任务', estimatedMinutes: 15, ability: '问题回溯', statusLabel: '未开始', actionLabel: '开始学习', actionTo: '/ui-lab/learn/task-1' }
    ]
  },
  {
    label: '阶段 3',
    title: '嵌入真实工作流',
    summary: '把脚本放回你的每周流程，验证它是否真的能用。',
    badge: '待解锁',
    tone: 'accent' as Tone,
    objectives: ['批量处理', '输出归档', '流程复盘'],
    tasks: [
      { title: '对接完整输入目录', note: '让脚本从固定目录批量读取本周文件。', badge: '锁定', tone: 'accent' as Tone, taskType: '实践任务', estimatedMinutes: 30, ability: '流程接入', statusLabel: '前置阻塞', actionLabel: '去补前置' },
      { title: '输出结果归档', note: '形成可回查的结果命名规范。', badge: '锁定', tone: 'accent' as Tone, taskType: '整理任务', estimatedMinutes: 20, ability: '结果归档', statusLabel: '前置阻塞', actionLabel: '去补前置' },
      { title: '写一次流程复盘', note: '确认脚本是否真正省掉了重复劳动。', badge: '锁定', tone: 'accent' as Tone, taskType: '复盘任务', estimatedMinutes: 15, ability: '流程复盘', statusLabel: '前置阻塞', actionLabel: '去补前置' }
    ]
  }
];

export const pathDetailNotes = [
  '这一阶段先只推进“异常处理与日志”，别急着同时扩太多新功能。',
  '每完成一个任务，就把真实场景里的失败案例顺手补进笔记。',
  '如果本周精力不足，先把日志记录做稳，不强求完整自动化闭环。'
];

export const pathDetailPlan = [
  { title: '周二 20:00', desc: '补上日志输出，并把错误信息写入独立文件。' },
  { title: '周四 20:00', desc: '拿一份新的真实报表跑通一次，检查异常分支是否可用。' },
  { title: '周六 10:00', desc: '做 15 分钟复盘，记录还有哪些失败情况没有覆盖。' }
];

export const learningKnowledgePoints = [
  {
    id: 'kp-1',
    order: '01',
    title: '异常处理',
    name: 'try / except',
    desc: '知道错误被捕获后该如何处理。',
    badge: '已完成',
    tone: 'success' as Tone,
    status: 'mastered',
    progress: 100,
    current: false,
    children: [
      { id: 'kp-1-1', title: '为什么不能直接报错退出', status: 'completed' },
      { id: 'kp-1-2', title: '异常捕获的最小结构', status: 'completed' }
    ]
  },
  {
    id: 'kp-2',
    order: '02',
    title: '日志记录',
    name: '日志输出',
    desc: '让失败具备可解释性和可回看性。',
    badge: '进行中',
    tone: 'primary' as Tone,
    status: 'learning',
    progress: 38,
    current: true,
    children: [
      { id: 'kp-2-1', title: '为什么要记录错误', status: 'completed' },
      { id: 'kp-2-2', title: '应该记录哪些字段', status: 'current' },
      { id: 'kp-2-3', title: '做一次小检核', status: 'pending' }
    ]
  },
  {
    id: 'kp-3',
    order: '03',
    title: '场景迁移',
    name: '场景迁移',
    desc: '把课堂知识放回真实报表流程。',
    badge: '未开始',
    tone: 'warning' as Tone,
    status: 'pending',
    progress: 0,
    current: false,
    children: [
      { id: 'kp-3-1', title: '将日志接回报表流程', status: 'pending' },
      { id: 'kp-3-2', title: '验证失败回溯是否可用', status: 'pending' }
    ]
  }
];

export const learningSessionStats = [
  { label: '知识点进度', value: '2 / 5' },
  { label: '课堂用时', value: '18 分钟' },
  { label: '当前状态', value: '授课中' },
  { label: '消息数', value: '14 条' }
];

export const learningMessages = [
  { role: 'ai' as const, avatar: '教', author: 'AI 讲解助手', time: '授课中', content: '如果脚本遇到空值直接报错，你希望它停止，还是继续处理并记录问题？', tags: ['概念澄清', '真实场景'] },
  { role: 'user' as const, avatar: '你', author: '你', time: '刚刚', content: '我更希望它继续，但要把出错行记下来。', tags: ['需求表达'] },
  { role: 'ai' as const, avatar: '教', author: 'AI 讲解助手', time: '现在', content: '这就是为什么日志和异常处理要一起讲，因为你要的是可继续执行的流程。最小模式是先捕获异常，再记录文件名、行号、错误信息，最后决定是否继续处理。', tags: ['核心解释', '可迁移'], knowledgePoint: '日志记录' }
];

export const learningQuizOptions = [
  { label: 'A', text: '遇到异常时让程序静默跳过，不做记录', selected: false },
  { label: 'B', text: '遇到异常时记录日志，并继续处理后续数据', selected: true },
  { label: 'C', text: '删除异常数据，避免影响脚本运行', selected: false }
];

export const evaluationSummaryCards = [
  { label: '主题', value: '异常处理与日志记录' },
  { label: '知识点', value: '3 / 5 已掌握' },
  { label: '用时', value: '18 分钟' },
  { label: '消息数', value: '14 条' }
];

export const evaluationSessionMetrics = [
  { label: '本节掌握增量', value: '+6.8', desc: '理解提升很明显，你已经能说清为什么要记录错误。', tone: 'success' as Tone },
  { label: '本节学习压力', value: '3.2', desc: '还在可接受范围内，可以继续轻量推进。', tone: 'warning' as Tone },
  { label: '本节疲劳变化', value: '2.1', desc: '有一点累了，下一次还是保持小任务节奏更合适。', tone: 'accent' as Tone }
];

export const evaluationLongTermMetrics = [
  { label: 'KTL 知识掌握', value: '61.0', desc: '长期累计学习收益正在稳稳往上走。', tone: 'success' as Tone },
  { label: 'LSB 状态平衡', value: '+2.1', desc: '掌握和疲劳之间的平衡还不错，可以继续。', tone: 'primary' as Tone },
  { label: 'LF 学习疲劳', value: '21.0', desc: '短期疲劳不高，但也不适合一下塞进太多新内容。', tone: 'warning' as Tone },
  { label: 'LSS 学习压力', value: '32.0', desc: '整体压力可控，继续保持轻量推进就好。', tone: 'accent' as Tone }
];

export const evaluationKnowledge = [
  { title: '异常处理', evidence: '能够说明为什么不能只让程序报错退出。', badge: '已掌握', tone: 'success' as Tone },
  { title: '日志记录', evidence: '知道日志是为了回溯失败，而不是装饰输出。', badge: '学习中', tone: 'primary' as Tone },
  { title: '迁移意识', evidence: '主动把课堂内容映射回每周真实报表流程。', badge: '已连接', tone: 'success' as Tone }
];

export const evaluationTakeaways = [
  '你已经能把“想学技术”收敛成一个具体工作任务。',
  '你对异常处理的理解不再停留在语法，而是能说出它为什么必要。',
  '你愿意围绕真实数据继续练，这会大幅提高迁移成功率。'
];

export const evaluationActions = [
  '下一节直接围绕真实 Excel 文件做一次完整演练。',
  '继续保持小任务节奏，不要一下扩到太多自动化功能。',
  '把失败原因继续记下来，慢慢形成自己的日志模板。'
];

export const evaluationNotes = [
  { title: '你已经做到的', desc: '你已经能从“语法学习”切换到“流程改造”视角，这是学习迁移里非常关键的一步。' },
  { title: '下次再补一点', desc: '日志记录还需要一次真实演练，确认你写下来的内容以后真的看得懂。' },
  { title: '节奏建议', desc: '下节课仍建议保持 20-30 分钟，不要把多个新概念挤进同一节课。' }
];

export const evaluationWrapup = {
  status: 'summary-only',
  sources: {
    summary: 'generated',
    evaluation: 'generated',
  },
  summary: {
    topicSummary: '这节课已经把异常处理和日志记录放回到真实报表流程里，不再只是语法记忆。',
    knowledgeSummary: '你已经能解释为什么异常不能只让程序退出，也知道日志记录的核心价值。',
    practiceAdvice: '下次直接拿真实 Excel 文件跑一次完整流程，把出错位置和日志模板真正写下来。',
    learningEvaluation: '这节课的理解已经形成迁移雏形，适合继续用轻量练习巩固。',
    knowledgeItems: [
      { name: '异常处理', status: 'mastered', evidence: '能够说明为什么不能只让程序报错退出。' },
      { name: '日志记录', status: 'learning', evidence: '已经知道日志要记录什么，但还需要一次真实演练。' },
      { name: '场景迁移', status: 'mastered', evidence: '能够把课堂内容映射回每周报表处理流程。' },
    ],
    keyTakeaways: [
      '你已经能把“学 Python”收敛成“解决周报自动化”的真实问题。',
      '你对异常处理的理解已经从语法层走向流程层。',
      '轻量但持续的练习，比一次学很多更适合当前阶段。',
    ],
    actionPlan: [
      '下一节围绕真实 Excel 文件做一次完整演练。',
      '把失败原因记录成固定日志模板。',
      '继续保持 20-30 分钟的小任务节奏。',
    ],
    evaluationHighlights: {
      strengths: ['能说清为什么要记录错误', '愿意围绕真实场景继续练习'],
      improvements: ['日志记录还需要一次真实演练', '下次补一轮失败回溯'],
    },
    metricInterpretation: {
      session: '本节表现反映本次课堂的即时投入和产出。',
      longTerm: '长期状态来自历史累计，不等于单节课程成绩。',
    },
    summaryVersion: 'v2',
  },
  evaluation: {
    sessionKtl: 6.8,
    sessionLss: 3.2,
    sessionLf: 2.1,
  },
  progress: {
    newlyMastered: ['异常处理'],
    movedToReview: [],
    stillLearning: ['日志记录'],
    unchangedMastered: ['场景迁移'],
  },
  stateUpdate: {
    ktl: 61.0,
    lsb: 2.1,
    lf: 2.1,
    lss: 3.2,
  },
  evidence: {
    turnCount: 14,
    avgUnderstanding: 0.82,
    avgEngagement: 0.79,
    dominantCognitiveLevel: '应用',
    lastCognitiveLevel: '迁移',
    topConfusionPoints: ['日志应该记录哪些字段'],
    emotionalSignals: {
      positive: 4,
      neutral: 8,
      frustrated: 1,
      confused: 1,
    },
    completionCandidateSeen: true,
  },
};
