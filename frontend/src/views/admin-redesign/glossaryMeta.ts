/**
 * Admin 运营术语表：前端词条数据源（demo 兜底 + 完成度/语义单源）
 *
 * 单源约定（与 backend/src/services/glossary-content.ts 对齐）：
 * - live 模式：AdminGlossaryDrawer 优先拉取 GET /api/admin/glossary（后端真源），本文件仅作渲染兜底
 * - promptRole 人话：live 模式由字段路由 API 下发（yaml-vocabulary.PROMPT_ROLE_META），
 *   本文件不维护 promptRole 人话（前端不再各写一份）
 * - 完成度五档 / 基准三分语义：本文件是前端唯一维护处（Skills.vue / Orchestrator.vue / 抽屉共用），
 *   文案与后端 glossary-content.ts 保持一致
 */

// ============================================================
// 完成度五档（前端唯一来源：Skills.vue / Orchestrator.vue / 抽屉共用）
// ============================================================

export interface CompletionMeta {
  status: string
  label: string
  short: string
  hint: string
}

export const COMPLETION_META: CompletionMeta[] = [
  { status: 'draft', label: '草稿', short: '草稿', hint: '仅在户口簿登记，还没开始搭建' },
  { status: 'handler-ready', label: 'handler 就绪', short: 'handler', hint: '入口处理（handler）已注册，可被调用' },
  { status: 'core-ready', label: 'core 就绪', short: 'core', hint: '核心 prompt 文件已就绪' },
  { status: 'fields-synced', label: '字段已同步', short: '同步', hint: '字段路由声明已对账，数据流已打通' },
  { status: 'live', label: '已上线', short: 'live', hint: 'ACTIVE prompt 生效，运行时正在使用' },
]

export const completionMetaOf = (status: string): CompletionMeta | undefined =>
  COMPLETION_META.find((m) => m.status === status)

// ============================================================
// 基准三分语义（HealthCenter 徽章人话，前端唯一来源）
// ============================================================

export const SEMANTICS_META: Array<{ id: string; label: string; hint: string }> = [
  { id: 'baseline-drift', label: '基准漂移', hint: '有一份唯一"真源"文件，其他位置偏离了它；方向确定，可一键修复' },
  { id: 'consistency', label: '一致性偏差', hint: '两边对等、没有单方基准，需要人工决策以哪边为准' },
  { id: 'override-record', label: '覆盖记录', hint: 'admin 手工改过的行，覆盖权高于文件基准，只读展示' },
  { id: 'runtime-info', label: '运行时观测', hint: '运行时遥测信息，只读观察，不涉及修复' },
]

// ============================================================
// demo 兜底词条（仅 demo 模式无后端时展示；live 模式以 API 为准）
// ============================================================

export interface GlossaryTerm {
  term: string
  def: string
  category: 'concept' | 'flow' | 'status' | 'health'
  where?: string
}

export const DEMO_GLOSSARY_TERMS: GlossaryTerm[] = [
  { term: 'Agent', category: 'concept', def: '编排里的角色节点（如 goal-agent），负责一个阶段的产出', where: 'Agent 拓扑页' },
  { term: 'Skill', category: 'concept', def: '一个可被编排调用的能力单元：有核心 prompt 文件与入口处理，挂在某个 Agent 下', where: 'Skill 目录页' },
  { term: '编排文件', category: 'concept', def: 'prompts/orchestration/<阶段>.yaml：字段路由的唯一声明源，描述"谁产出什么、往哪路由"', where: '编排结构 → 字段路由 tab →「编排文件」按钮' },
  { term: '户口簿', category: 'concept', def: 'prompts/skills.yaml：全部 Skill 的登记册（注册表），Skill 目录对账面板以此为准' },
  { term: '契约', category: 'concept', def: 'Agent/Skill 与平台之间的"服务约定"：展示名、职责、输入输出结构；manifest 是 v4 契约的唯一声明处' },
  { term: 'manifest', category: 'concept', def: 'prompt-lab/manifests/<skill>.yaml：Skill 的运行时契约文件（prompt 契约、模型参数、失败策略）' },
  { term: 'gateway 注册', category: 'concept', def: 'Skill 在运行时接线（gateway）里的注册状态，决定它能否被编排调用' },
  { term: 'ACTIVE prompt', category: 'concept', def: '数据库里标记为"当前生效"的 prompt 版本；运行时只执行 ACTIVE 版，改文件必须同步它才生效' },
  { term: '字段', category: 'concept', def: '一条数据的命名（如 understanding.surface_goal），点分路径=层级；含义列有中文解释' },
  { term: '字段路由', category: 'concept', def: '字段值从产出方流向消费方的配置（谁产出、交给谁、是否累积）', where: '编排结构 → 字段路由 tab' },
  { term: '抽取路径（pathInRawOutput）', category: 'concept', def: '字段在产出方原始输出里的物理位置（点分路径），系统按它把值抽出来' },
  { term: '落库键（persistKey）', category: 'concept', def: '字段值最终写入主库时的键路径；与字段名不一致的字段会单独标注' },
  { term: '基准（真源）', category: 'concept', def: '一条信息的"唯一权威来源"，其他位置都是它的镜像/副本；对账以它为准' },
  { term: '覆盖行', category: 'concept', def: 'admin 在管理后台手工改过的配置行，覆盖权高于文件声明，对账时跳过' },
  { term: 'promptRole（字段角色）', category: 'flow', def: '字段的用途分类：必填/可选补充/隐式推断/公开回复/方案产出/派生展示/控制信号，见字段路由图例' },
  { term: 'render', category: 'flow', def: '字段是否对外可见：visible=会出现在对外交付，hidden=仅内部流转' },
  { term: 'handoff（移交）', category: 'flow', def: '字段产完后交给谁：可交给下一阶段（如 path）或指定 agent/skill；空=不转交' },
  { term: 'internal（内部信令）', category: 'flow', def: '仅供平台内部/UI 控制使用，不进业务状态的字段标记' },
  { term: 'accumulate（累积）', category: 'flow', def: '值会累积进学习者状态（画像/上下文），供后续阶段持续使用' },
  { term: '完成度', category: 'flow', def: 'Skill 从登记到上线的五档进度：草稿 → handler 就绪 → core 就绪 → 字段已同步 → 已上线' },
  { term: '漂移', category: 'status', def: '声明文件与数据库台账对不上：改了文件但没同步（详见 DRIFT_EXPLAINED.md §5 通俗解释）' },
  { term: '孤儿', category: 'status', def: '一边有、另一边没有：如 core 声明的字段在编排里没有对应路由' },
  { term: '未注册', category: 'status', def: '户口簿（skills.yaml）里有，但系统注册表/ACTIVE 里没有' },
  { term: '幽灵注册', category: 'status', def: '系统里有注册行，但户口簿（skills.yaml）里已经没有这个技能' },
  { term: '缺 ACTIVE', category: 'status', def: '技能有文件/注册，但数据库里没有"当前生效"的 prompt 版本，运行时无法执行' },
  { term: '未解析节点', category: 'status', def: '编排定义引用了尚未落位的节点，需要人工补接线' },
  { term: '健康中心', category: 'health', def: '13 项系统健康检查的聚合清单，位于编排结构页顶部"健康区"；每项带严重度与修复动作' },
  { term: 'W4 coreHash', category: 'health', def: '核心文件 ↔ 编译产物 ↔ DB 三方哈希对账：文件改了但没"编译+同步"，线上就跑旧版' },
  { term: 'fields-sync', category: 'health', def: 'core 声明的字段 ↔ 编排产出路由的字段 双向核对（缺项/孤儿/类型）' },
  { term: 'contract-parity', category: 'health', def: 'manifest 契约 ↔ DB 里登记的契约元数据是否一致' },
  { term: 'yaml-crosscheck', category: 'health', def: 'core 与 manifest 双写的参数（温度/token/失败策略）是否一致' },
  { term: 'override-record', category: 'health', def: 'admin 手工覆盖行的清单（覆盖权高于文件基准，只读展示）' },
]

export const DEMO_GLOSSARY_DOCS: Array<{ title: string; path: string; desc: string }> = [
  { title: '编排文件运营阅读指南', path: 'prompts/orchestration/_README.md', desc: '字段路由表怎么看、角色人话表、流转怎么读（运营向）' },
  { title: '漂移完全解释（§5 通俗版给运营看）', path: 'doc/DRIFT_EXPLAINED.md', desc: '说明书 vs 台账 vs 现场三层模型，7 类漂移一句话表' },
  { title: '健康中心设计（开发向）', path: 'doc/HEALTH_CENTER_DESIGN.md', desc: '13 项检查的设计背景与实现' },
]
