/**
 * Admin 运营术语表：前端词条数据源（完成度/语义单源）
 *
 * 单源约定（与 backend/src/services/glossary-content.ts 对齐）：
 * - 词条：AdminGlossaryDrawer 优先拉取 GET /api/admin/glossary（后端真源）
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
// 词条类型（AdminGlossaryDrawer 使用；词条数据以 GET /api/admin/glossary 为准）
// ============================================================

export interface GlossaryTerm {
  term: string
  def: string
  category: 'concept' | 'flow' | 'status' | 'health'
  where?: string
}
