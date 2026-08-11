/**
 * 运营术语表内容（GET /api/admin/glossary 数据源）
 *
 * 单源约定：
 * - promptRole 人话：派生自 yaml-vocabulary.PROMPT_ROLE_META（禁止本文件再写一份）
 * - 完成度五档 / 基准三分语义 / 概念词条 / 健康术语 / 文档链接：本文件为后端唯一维护处，
 *   前端 demo 兜底副本见 frontend/src/views/admin-redesign/glossaryMeta.ts（标注"仅 demo 兜底"）
 * - 词条人话与文档的互引：DRIFT_EXPLAINED.md §5（漂移通俗解释）、orchestration/_README.md（运营阅读指南）
 */

import { PROMPT_ROLE_META, PROMPT_ROLES } from './yaml-vocabulary';

// ============================================================
// 完成度五档（status 枚举源自 skill-completion.service.ts COMPLETION_STATES）
// ============================================================

export interface CompletionMeta {
  status: string;
  label: string;
  /** 徽章/紧凑场景用的短标签 */
  short: string;
  hint: string;
}

export const COMPLETION_STATES_META: CompletionMeta[] = [
  { status: 'draft', label: '草稿', short: '草稿', hint: '仅在户口簿登记，还没开始搭建' },
  { status: 'handler-ready', label: 'handler 就绪', short: 'handler', hint: '入口处理（handler）已注册，可被调用' },
  { status: 'core-ready', label: 'core 就绪', short: 'core', hint: '核心 prompt 文件已就绪' },
  { status: 'fields-synced', label: '字段已同步', short: '同步', hint: '字段路由声明已对账，数据流已打通' },
  { status: 'live', label: '已上线', short: 'live', hint: 'ACTIVE prompt 生效，运行时正在使用' },
];

// ============================================================
// 基准三分语义（health-center.service.ts semantics 枚举人话）
// ============================================================

export interface SemanticsMeta {
  id: string;
  label: string;
  hint: string;
}

export const SEMANTICS_META: SemanticsMeta[] = [
  { id: 'baseline-drift', label: '基准漂移', hint: '有一份唯一"真源"文件，其他位置偏离了它；方向确定，可一键修复' },
  { id: 'consistency', label: '一致性偏差', hint: '两边对等、没有单方基准，需要人工决策以哪边为准' },
  { id: 'override-record', label: '覆盖记录', hint: 'admin 手工改过的行，覆盖权高于文件基准，只读展示' },
  { id: 'runtime-info', label: '运行时观测', hint: '运行时遥测信息，只读观察，不涉及修复' },
];

// ============================================================
// 阶段（stage）人话
// ============================================================

export interface StageMeta {
  id: string;
  label: string;
  hint: string;
}

export const STAGES_META: StageMeta[] = [
  { id: 'goal', label: '目标澄清', hint: '多轮对话，把"想学什么"问清楚' },
  { id: 'path', label: '路径规划', hint: '把目标拆成可执行的学习路径与子任务' },
  { id: 'teaching', label: '教学执行', hint: '按路径逐课教学、批改与讲解' },
  { id: 'profile', label: '画像沉淀', hint: '把学习表现沉淀为长期画像（知识记忆/概念账本）' },
  { id: 'simulation', label: '虚拟仿真', hint: '虚拟学习者试跑，验证路径与教学效果' },
];

// ============================================================
// 概念词条（分类：概念 / 角色流转 / 状态 / 健康）
// ============================================================

export interface GlossaryTerm {
  term: string;
  /** 一句话人话定义 */
  def: string;
  category: 'concept' | 'flow' | 'status' | 'health';
  /** 关联页面/文档（可选） */
  where?: string;
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  // ---- 概念 ----
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
  { term: '抽取路径（pathInRawOutput）', category: 'concept', def: '字段在产出方原始输出里的物理位置（点分路径），系统按它把值抽出来', where: '字段路由表的字段名悬浮提示' },
  { term: '落库键（persistKey）', category: 'concept', def: '字段值最终写入主库时的键路径；与字段名不一致的字段会单独标注' },
  { term: '基准（真源）', category: 'concept', def: '一条信息的"唯一权威来源"，其他位置都是它的镜像/副本；对账以它为准' },
  { term: '派生', category: 'concept', def: '由别的文件/字段自动生成（如契约 displayName 从 manifest 派生），不手写第二份' },
  { term: '覆盖行', category: 'concept', def: 'admin 在管理后台手工改过的配置行，覆盖权高于文件声明，对账时跳过' },

  // ---- 角色与流转（flow） ----
  { term: 'promptRole（字段角色）', category: 'flow', def: '字段的用途分类：必填/可选补充/隐式推断/公开回复/方案产出/派生展示/控制信号，见字段路由图例' },
  { term: 'render', category: 'flow', def: '字段是否对外可见：visible=会出现在对外交付，hidden=仅内部流转' },
  { term: 'handoff（移交）', category: 'flow', def: '字段产完后交给谁：可交给下一阶段（如 path）或指定 agent/skill；空=不转交', where: '字段路由表 handoff 列' },
  { term: 'internal（内部信令）', category: 'flow', def: '仅供平台内部/UI 控制使用，不进业务状态的字段标记' },
  { term: 'accumulate（累积）', category: 'flow', def: '值会累积进学习者状态（画像/上下文），供后续阶段持续使用' },
  { term: '系统锁 / 结构锁', category: 'flow', def: '系统锁=平台派生/代码消费，admin 不可直接改；结构锁=结构约束锁定，修改需谨慎；其余可编辑' },
  { term: '完成度', category: 'flow', def: 'Skill 从登记到上线的五档进度：草稿 → handler 就绪 → core 就绪 → 字段已同步 → 已上线' },

  // ---- 状态（status） ----
  { term: '干净', category: 'status', def: '健康检查通过：声明与库一致，无问题' },
  { term: '漂移', category: 'status', def: '声明文件与数据库台账对不上：改了文件但没同步（详见 DRIFT_EXPLAINED.md §5 通俗解释）' },
  { term: '孤儿', category: 'status', def: '一边有、另一边没有：如 core 声明的字段在编排里没有对应路由' },
  { term: '缺项', category: 'status', def: '该有而没有：如编排缺了 core 声明的字段' },
  { term: '未注册', category: 'status', def: '户口簿（skills.yaml）里有，但系统注册表/ACTIVE 里没有' },
  { term: '幽灵注册', category: 'status', def: '系统里有注册行，但户口簿（skills.yaml）里已经没有这个技能' },
  { term: '缺 ACTIVE', category: 'status', def: '技能有文件/注册，但数据库里没有"当前生效"的 prompt 版本，运行时无法执行' },
  { term: '未接线', category: 'status', def: '编排定义里引用了，但运行时定义没有对应落位节点' },
  { term: '未解析节点', category: 'status', def: '编排定义引用了尚未落位的节点，需要人工补接线' },
  { term: '类型不一致', category: 'status', def: '同一个字段在 core 与编排两边的类型声明不一致（如 string vs number）' },

  // ---- 健康中心（health） ----
  { term: '健康中心', category: 'health', def: '13 项系统健康检查的聚合清单，位于编排结构页顶部"健康区"；每项带严重度与修复动作', where: '编排结构页顶部' },
  { term: 'W1 注册对账', category: 'health', def: '户口簿活跃技能 ↔ ACTIVE prompt 的双向核对：谁缺 ACTIVE、谁是多出来的残留' },
  { term: 'W2 注册表对账', category: 'health', def: '户口簿 ↔ 系统注册表（skill_registrations）的双向核对：谁没注册、谁是多出来的幽灵' },
  { term: 'W3 接线对账', category: 'health', def: '运行时定义的执行步骤 ↔ 户口簿 coordinator 声明是否一致' },
  { term: 'W4 coreHash', category: 'health', def: '核心文件 ↔ 编译产物 ↔ DB 三方哈希对账：文件改了但没"编译+同步"，线上就跑旧版', where: '编排结构页顶部"W4 漂移 N"' },
  { term: 'coreHash', category: 'health', def: '核心文件的指纹（哈希），用来快速判断"文件是否变了"；三处对不上=有一步没跑' },
  { term: 'fields-sync', category: 'health', def: 'core 声明的字段 ↔ 编排产出路由的字段 双向核对（缺项/孤儿/类型）' },
  { term: 'contract-parity', category: 'health', def: 'manifest 契约 ↔ DB 里登记的契约元数据是否一致' },
  { term: 'yaml-crosscheck', category: 'health', def: 'core 与 manifest 双写的参数（温度/token/失败策略）是否一致' },
  { term: 'params-consistency', category: 'health', def: '模型参数（temperature/maxTokens）在代码声明里多处是否一致' },
  { term: 'override-record', category: 'health', def: 'admin 手工覆盖行的清单（覆盖权高于文件基准，只读展示）' },
  { term: 'runtime-prompt', category: 'health', def: '运行时遥测：每次 LLM 调用时比对代码侧 prompt 与 DB ACTIVE 是否一致' },
  { term: 'snapshots', category: 'health', def: '自动生成的沙盘说明书（agent-snapshots.md）与声明是否逐字节一致' },
];

// ============================================================
// 文档链接（术语表与文档互引）
// ============================================================

export interface GlossaryDoc {
  title: string;
  path: string;
  desc: string;
}

export const GLOSSARY_DOCS: GlossaryDoc[] = [
  { title: '编排文件运营阅读指南', path: 'prompts/orchestration/_README.md', desc: '字段路由表怎么看、角色人话表、流转怎么读（运营向）' },
  { title: '漂移完全解释（§5 通俗版给运营看）', path: 'doc/DRIFT_EXPLAINED.md', desc: '说明书 vs 台账 vs 现场三层模型，7 类漂移一句话表' },
  { title: '健康中心设计（开发向）', path: 'doc/HEALTH_CENTER_DESIGN.md', desc: '13 项检查的设计背景与实现' },
  { title: '字段路由 UX 设计', path: 'doc/FIELD_ROUTING_UX_REDESIGN.md', desc: '字段路由表的交互设计落盘' },
  { title: 'Skill 协议 V4', path: 'doc/SKILL_PROTOCOL_V4.md', desc: 'Skill/契约/字段的完整协议定义' },
];

// ============================================================
// 聚合响应（GET /api/admin/glossary）
// ============================================================

export interface GlossaryPayload {
  promptRoles: typeof PROMPT_ROLE_META;
  completionStates: CompletionMeta[];
  semantics: SemanticsMeta[];
  stages: StageMeta[];
  terms: GlossaryTerm[];
  docs: GlossaryDoc[];
  /** 词表版本锚点（前端可据此判断是否需要刷新缓存） */
  vocabularyVersion: string;
}

export function buildGlossaryPayload(): GlossaryPayload {
  return {
    promptRoles: PROMPT_ROLE_META,
    completionStates: COMPLETION_STATES_META,
    semantics: SEMANTICS_META,
    stages: STAGES_META,
    terms: GLOSSARY_TERMS,
    docs: GLOSSARY_DOCS,
    vocabularyVersion: `promptRoles=${PROMPT_ROLES.length};completion=${COMPLETION_STATES_META.length};semantics=${SEMANTICS_META.length};terms=${GLOSSARY_TERMS.length}`,
  };
}
