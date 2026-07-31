/**
 * Goal 阶段字段路由真相源 (V3 §3 / §7)
 * ============================================================
 * 本文件是 PoC 阶段的「前端真相」，会通过启动时 bootstrap 同步到 DB
 * 的 field_definitions / orchestrator_contracts / orchestrator_field_routings
 * 三张表（V3 §10 P1.7）。
 *
 * 数据来源：基于 backend 实际代码事实整理（参见
 * doc/AGENT_IO_DESIGN_V3.md §7）：
 *   - backend/src/agents/goal-conversation/index.ts (system prompt + parse)
 *   - backend/src/routes/goal-conversation.ts (envelopeGoalConversation)
 *   - backend/src/services/learning/goal-path-visible-summary.ts
 *   - backend/src/orchestrators/path.orchestrator.ts (buildNormalizedGoalInput)
 *
 * 注意：snake_case 是 LLM/understanding 层的命名，
 *      camelCase 是 visibleSummary/NormalizedPathInputV1 层的命名，
 *      bindings.handoffMap 描述两者间的映射。
 */

export type PromptRole =
  | 'hard-required'
  | 'soft-info'
  | 'hidden-inference'
  | 'public-reply'
  | 'proposal-output'
  | 'derived-presentation'
  | 'control-signal';

export type RenderValue = 'visible' | 'hidden';

export interface FieldDefinition {
  fieldId: string;
  stage: 'goal' | 'path' | 'learning';
  promptRole: PromptRole;
  valueType: 'string' | 'string[]' | 'number' | 'boolean' | 'object' | 'enum';
  snakeName?: string;
  camelName?: string;
  description: string;
  enumValues?: string[];
  /** 系统锁：必须先改代码才能动 */
  systemLocked?: boolean;
  /** 结构锁：仅允许 prompt 级精调，不允许调路由 */
  structureLocked?: boolean;
  bindings?: {
    /** 在哪些后端文件 / 行被消费/产出 */
    sources?: string[];
    consumers?: string[];
    /** snake → camel 映射 */
    handoffMap?: Record<string, string>;
  };
}

export interface AgentContract {
  agentId: string;
  stage: 'goal' | 'path' | 'learning';
  displayName: string;
  description: string;
}

export interface FieldRouting {
  agentId: string;
  fieldId: string;
  /** 默认 visible，render: hidden 表示对前端不暴露 */
  render: RenderValue;
  /** 该字段从此 Agent 流转到下游 Agent 的列表 */
  handoff: string[];
  /** 是否仅供 Agent 内部使用（不进 envelope、不交付下游） */
  internal: boolean;
  /** 是否累积进 learnerModel（across paths） */
  accumulate: boolean;
  /** V3 §4 visibilityPreset 模板（可选） */
  visibilityPreset?: 'user-clarification' | 'agent-internal' | 'system-derived';
  notes?: string;
}

// ============================================================
// Goal 阶段 Agent 契约
// ============================================================
export const GOAL_AGENTS: AgentContract[] = [
  {
    agentId: 'goal-conversation',
    stage: 'goal',
    displayName: '目标对话 Agent',
    description: '与用户多轮对话，澄清目标、收集背景信号、收敛到方向方案',
  },
  {
    agentId: 'requirement',
    stage: 'goal',
    displayName: '需求转交 Agent',
    description: 'Goal 完成后构建 visibleSummary 桥接结构，转交给 path skill',
  },
];

// ============================================================
// Goal 阶段字段定义（按代码事实，覆盖 understanding / proposal / reply / control）
// ============================================================
export const GOAL_FIELD_DEFINITIONS: FieldDefinition[] = [
  // ---------- understanding.* / hard-required ----------
  {
    fieldId: 'understanding.surface_goal',
    stage: 'goal',
    promptRole: 'hard-required',
    valueType: 'string',
    snakeName: 'surface_goal',
    camelName: 'surfaceGoal',
    description: '用户最初表述的"想学什么"原话（保留原始表述）',
    systemLocked: true,
    bindings: {
      sources: ['skill:goal-conversation/index.ts:152'],
      consumers: ['goal-path-visible-summary.ts:75', 'path.orchestrator.ts:learnerProfile.surfaceGoal'],
    },
  },
  {
    fieldId: 'understanding.real_problem',
    stage: 'goal',
    promptRole: 'hard-required',
    valueType: 'string',
    snakeName: 'real_problem',
    camelName: 'realProblem',
    description: '诊断后的真实问题（不能是 surface_goal 的同义改写）。是 path description 的最终兜底',
    systemLocked: true,
    bindings: {
      sources: ['skill:goal-conversation/index.ts:150'],
      consumers: ['goal-path-visible-summary.ts:76', 'path.orchestrator.ts:233 (description fallback)'],
    },
  },
  {
    fieldId: 'understanding.available_resources.time_budget',
    stage: 'goal',
    promptRole: 'hard-required',
    valueType: 'string',
    snakeName: 'time_budget',
    camelName: 'timeBudget',
    description: '可用时间预算（与 time_horizon 二选一硬必需）',
    systemLocked: true,
    bindings: {
      consumers: ['goal-path-visible-summary.ts:115', 'path.orchestrator.ts:resources.timeBudget'],
    },
  },
  {
    fieldId: 'understanding.available_resources.time_horizon',
    stage: 'goal',
    promptRole: 'hard-required',
    valueType: 'string',
    snakeName: 'time_horizon',
    camelName: 'timeHorizon',
    description: '时间跨度（与 time_budget 二选一硬必需）',
    systemLocked: true,
    bindings: {
      consumers: ['goal-path-visible-summary.ts:130'],
    },
  },
  {
    fieldId: 'understanding.success_criteria.observable_result',
    stage: 'goal',
    promptRole: 'hard-required',
    valueType: 'string',
    snakeName: 'observable_result',
    camelName: 'observableResult',
    description: '可观察的成功标准（必须有，证据驱动）',
    systemLocked: true,
    bindings: {
      consumers: ['goal-path-visible-summary.ts:165', 'path.orchestrator.ts:successCriteria.observableResult'],
    },
  },

  // ---------- understanding.* / soft-info ----------
  {
    fieldId: 'understanding.current_baseline.level',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string',
    snakeName: 'level',
    camelName: 'level',
    description: '当前水平（不阻止 proposing；path 用于 skillLevel 兜底）',
    structureLocked: true,
    bindings: {
      consumers: ['goal-path-visible-summary.ts:78', 'path.orchestrator.ts:238 (skillLevel fallback)'],
    },
  },
  {
    fieldId: 'understanding.current_baseline.evidence',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string',
    snakeName: 'evidence',
    camelName: 'evidence',
    description: '行为证据（佐证 level）',
    structureLocked: true,
    bindings: {
      consumers: ['goal-path-visible-summary.ts:79'],
    },
  },
  {
    fieldId: 'understanding.success_criteria.acceptance_check',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string',
    snakeName: 'acceptance_check',
    camelName: 'acceptanceCheck',
    description: '验收方式（如何证明完成）',
    structureLocked: true,
  },
  {
    fieldId: 'understanding.available_resources.time_per_session',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string',
    snakeName: 'time_per_session',
    camelName: 'timePerSession',
    description: '单次时长偏好',
    structureLocked: true,
  },
  {
    fieldId: 'understanding.constraints_and_boundaries',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string[]',
    snakeName: 'constraints_and_boundaries',
    camelName: 'constraintsAndBoundaries',
    description: '约束与边界（不能做什么 / 不愿做什么）',
    structureLocked: true,
  },
  {
    fieldId: 'understanding.pain_points',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string[]',
    snakeName: 'pain_points',
    camelName: 'painPoints',
    description: '痛点列表（首项作为 currentPainPoint 兜底）',
    structureLocked: true,
  },
  {
    fieldId: 'understanding.motivation',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string',
    snakeName: 'motivation',
    camelName: 'motivation',
    description: '动机（为什么要学）',
    structureLocked: true,
  },
  {
    fieldId: 'understanding.urgency',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string',
    snakeName: 'urgency',
    camelName: 'urgency',
    description: '紧迫程度',
    structureLocked: true,
  },
  {
    fieldId: 'understanding.scenario',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string',
    snakeName: 'scenario',
    camelName: 'scenario',
    description: '使用场景',
    structureLocked: true,
  },
  {
    fieldId: 'understanding.deadline_text',
    stage: 'goal',
    promptRole: 'soft-info',
    valueType: 'string',
    snakeName: 'deadline_text',
    camelName: 'deadlineText',
    description: '截止时间文本（path 阶段会解析为 Date）',
    structureLocked: true,
  },

  // ---------- understanding.* / hidden-inference ----------
  {
    fieldId: 'understanding.background_experience',
    stage: 'goal',
    promptRole: 'hidden-inference',
    valueType: 'string',
    snakeName: 'background_experience',
    camelName: 'backgroundExperience',
    description: '背景经验（hidden — prompt 第 152 行明确"不需要面向前端展示"，LLM 静默累积）',
    structureLocked: true,
    bindings: {
      sources: ['skill:goal-conversation/index.ts:152 (prompt hidden marker)'],
      consumers: ['goal-path-visible-summary.ts:90 (scenario fallback)'],
    },
  },
  {
    fieldId: 'understanding.learning_signal',
    stage: 'goal',
    promptRole: 'hidden-inference',
    valueType: 'string',
    snakeName: 'learning_signal',
    camelName: 'learningSignal',
    description: '学习信号（hidden — prompt 第 153 行明确"不需要面向前端展示"）',
    structureLocked: true,
    bindings: {
      sources: ['skill:goal-conversation/index.ts:153 (prompt hidden marker)'],
      consumers: ['goal-path-visible-summary.ts:149'],
    },
  },

  // ---------- proposal-output ----------
  {
    fieldId: 'confirmedProposal.learning_direction',
    stage: 'goal',
    promptRole: 'proposal-output',
    valueType: 'string',
    snakeName: 'learning_direction',
    camelName: 'learningDirection',
    description: '学习方向（proposing 阶段产物）',
    structureLocked: true,
  },
  {
    fieldId: 'confirmedProposal.first_deliverable',
    stage: 'goal',
    promptRole: 'proposal-output',
    valueType: 'string',
    snakeName: 'first_deliverable',
    camelName: 'firstDeliverable',
    description: '第一交付物',
    structureLocked: true,
  },
  {
    fieldId: 'confirmedProposal.key_stages',
    stage: 'goal',
    promptRole: 'proposal-output',
    valueType: 'string[]',
    snakeName: 'key_stages',
    camelName: 'keyStages',
    description: '关键阶段（≥2 才能进入 proposing，否则 hasThinProposalPayload 强制回退）',
    structureLocked: true,
    bindings: {
      consumers: ['skill:goal-conversation/index.ts:668-669 (thin proposal check)'],
    },
  },
  {
    fieldId: 'confirmedProposal.out_of_scope',
    stage: 'goal',
    promptRole: 'proposal-output',
    valueType: 'string[]',
    snakeName: 'out_of_scope',
    camelName: 'outOfScope',
    description: '不做的范围',
    structureLocked: true,
  },

  // ---------- public-reply ----------
  {
    fieldId: 'userVisible',
    stage: 'goal',
    promptRole: 'public-reply',
    valueType: 'string',
    snakeName: 'userVisible',
    camelName: 'userVisible',
    description: 'AI 对用户的可见回复（envelope 顶层）',
    systemLocked: true,
  },
  {
    fieldId: 'goalConversation.nextQuestions',
    stage: 'goal',
    promptRole: 'public-reply',
    valueType: 'string[]',
    snakeName: 'next_questions',
    camelName: 'nextQuestions',
    description: '下一步要问的问题（understanding 阶段强制截到 1）',
    structureLocked: true,
  },
  {
    fieldId: 'goalConversation.quickReplies',
    stage: 'goal',
    promptRole: 'public-reply',
    valueType: 'object',
    snakeName: 'quick_replies',
    camelName: 'quickReplies',
    description: '快捷回复按钮（同时镜像到 renderHints.quickReplies）',
    structureLocked: true,
  },

  // ---------- control-signal ----------
  {
    fieldId: 'core.conversationId',
    stage: 'goal',
    promptRole: 'control-signal',
    valueType: 'string',
    description: '会话 ID（后端生成）',
    systemLocked: true,
  },
  {
    fieldId: 'core.stage',
    stage: 'goal',
    promptRole: 'control-signal',
    valueType: 'enum',
    enumValues: ['understanding', 'proposing', 'ready', 'completed'],
    description: '对话阶段（驱动 UI 阶段切换）',
    systemLocked: true,
  },
  {
    fieldId: 'core.confidence',
    stage: 'goal',
    promptRole: 'control-signal',
    valueType: 'number',
    description: '置信度 (0-0.99，受 stage 上下限约束)',
    systemLocked: true,
  },
  {
    fieldId: 'core.isCompleted',
    stage: 'goal',
    promptRole: 'control-signal',
    valueType: 'boolean',
    description: '是否完成（决定能否触发 path）',
    systemLocked: true,
  },
];

// ============================================================
// Goal 阶段字段路由表（Agent × 字段）
// ============================================================
export const GOAL_FIELD_ROUTINGS: FieldRouting[] = [
  // ---------- goal-conversation Agent ----------
  // 硬必需：visible，handoff 给 requirement
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.surface_goal',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
    visibilityPreset: 'user-clarification',
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.real_problem',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
    visibilityPreset: 'user-clarification',
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.available_resources.time_budget',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
    visibilityPreset: 'user-clarification',
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.available_resources.time_horizon',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
    visibilityPreset: 'user-clarification',
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.success_criteria.observable_result',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
    visibilityPreset: 'user-clarification',
  },

  // 软信息：visible，handoff 给 requirement，accumulate 到 learnerModel
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.current_baseline.level',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.current_baseline.evidence',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.success_criteria.acceptance_check',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.available_resources.time_per_session',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.constraints_and_boundaries',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.pain_points',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.motivation',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.urgency',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.scenario',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.deadline_text',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },

  // 隐藏字段：hidden，但 handoff 给 requirement（path 会消费）；accumulate 到 learnerModel
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.background_experience',
    render: 'hidden',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
    visibilityPreset: 'agent-internal',
    notes: 'prompt 明确不展示给前端；path 用作 scenario 兜底',
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'understanding.learning_signal',
    render: 'hidden',
    handoff: ['requirement'],
    internal: false,
    accumulate: true,
    visibilityPreset: 'agent-internal',
  },

  // proposal-output：visible，handoff 给 requirement
  {
    agentId: 'goal-conversation',
    fieldId: 'confirmedProposal.learning_direction',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'confirmedProposal.first_deliverable',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'confirmedProposal.key_stages',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'confirmedProposal.out_of_scope',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },

  // public-reply：visible，不 handoff（仅展示给前端）
  {
    agentId: 'goal-conversation',
    fieldId: 'userVisible',
    render: 'visible',
    handoff: [],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'goalConversation.nextQuestions',
    render: 'visible',
    handoff: [],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'goalConversation.quickReplies',
    render: 'visible',
    handoff: [],
    internal: false,
    accumulate: false,
  },

  // control-signal：visible（前端要读 stage 和 isCompleted），handoff 给 requirement
  {
    agentId: 'goal-conversation',
    fieldId: 'core.conversationId',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'core.stage',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'core.confidence',
    render: 'visible',
    handoff: [],
    internal: true,
    accumulate: false,
    notes: 'internal — 仅作 UI 进度条，不进 path',
  },
  {
    agentId: 'goal-conversation',
    fieldId: 'core.isCompleted',
    render: 'visible',
    handoff: ['requirement'],
    internal: false,
    accumulate: false,
  },

  // ---------- requirement Agent ----------
  // requirement 阶段做 visibleSummary 桥接，所有字段从 goal-conversation 接进来
  // 这里只列出 requirement 视角下"路由有变化"的字段
  {
    agentId: 'requirement',
    fieldId: 'understanding.background_experience',
    render: 'hidden',
    handoff: ['path'],
    internal: false,
    accumulate: false,
    visibilityPreset: 'agent-internal',
    notes: 'requirement 视角依然 hidden；但作为 visibleSummary.scenario 兜底交给 path',
  },
  {
    agentId: 'requirement',
    fieldId: 'understanding.learning_signal',
    render: 'hidden',
    handoff: ['path'],
    internal: false,
    accumulate: false,
    visibilityPreset: 'agent-internal',
  },
  {
    agentId: 'requirement',
    fieldId: 'understanding.real_problem',
    render: 'visible',
    handoff: ['path'],
    internal: false,
    accumulate: false,
    notes: 'path description 的最终兜底',
  },
  {
    agentId: 'requirement',
    fieldId: 'confirmedProposal.key_stages',
    render: 'visible',
    handoff: ['path'],
    internal: false,
    accumulate: false,
  },
];
