import type { SkillContract, BusinessRulesConversational } from '@/stores/promptLab'

export const GOAL_CONVERSATION_CONTRACT: SkillContract = {
  skillId: 'goal-conversation',
  archetype: 'conversational',
  inputSchema: [
    { field: 'userInput', type: 'string', desc: '当前轮用户输入' },
    { field: 'state', type: 'object', desc: '主记忆对象，优先级最高' },
    { field: 'conversationContext', type: 'object', desc: '过往对话的摘要化上下文证据' },
  ],
  outputSchema: [
    { field: 'reply', type: 'string', required: true, desc: '给用户的回复' },
    { field: 'state', type: 'object', required: true, desc: '更新后的状态' },
    { field: 'understanding', type: 'object', required: true, desc: '对学习者目标的理解结构' },
    { field: 'nextQuestions', type: 'array', required: true, desc: '待追问的问题列表' },
    { field: 'quickReplies', type: 'array', required: true, desc: '快捷回复选项' },
    { field: 'confirmedProposal', type: 'object', required: false, desc: '确认的学习方向提案' },
    { field: 'confidenceScores', type: 'object', required: true, desc: '各维度置信度' },
  ],
  technicalConstraints: [
    'JSON 顶层必须是单个 object，不要包外层数组',
    '禁止输出平台保留字段：success、schemaVersion、metadata、internal、renderHints、error、output',
    'JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言',
    'state.stage 必须是枚举值之一：understanding | proposing | ready',
    'quickReplies 直接放在顶层，不要用 goalConversation 包装层',
  ],
}

export const GOAL_CONVERSATION_BUSINESS_RULES: BusinessRulesConversational = {
  numericParams: {
    max_questions_per_turn: 1,
    loop_detection_rounds: 3,
    short_reply_threshold_chars: 10,
    min_confidence_for_transition: 0.7,
  },
  conditionalStrategies: [
    {
      id: 'vague-to-concrete',
      condition: '用户描述模糊困难 && 轮数 >= 3',
      action: '追问最近一次具体卡住场景',
      priority: 'high',
    },
    {
      id: 'short-reply-consolidate',
      condition: '连续追问 3 轮 && 用户回复 < 10 字',
      action: '整合已收集信息，让用户感到对话在推进',
      priority: 'medium',
    },
    {
      id: 'transition-gate',
      condition: 'stage == understanding && confidence >= 0.7',
      action: '推进到 proposing 阶段',
      priority: 'high',
    },
    {
      id: 'zero-foundation',
      condition: '用户基础几乎为零',
      action: 'first_deliverable 优先建立基础认知框架',
      priority: 'high',
    },
  ],
  stageConfig: {
    stages: ['understanding', 'proposing', 'ready'],
    transitions: {
      'understanding_to_proposing': {
        required_fields: ['surface_goal', 'real_problem', 'available_resources', 'success_criteria'],
        confidence_threshold: 0.7,
      },
      'proposing_to_ready': {
        user_confirms: true,
      },
    },
  },
  toneGuidance: {
    questioning_style: 'socratic',
    empathy_mode: 'cognitive',
    avoid_patterns: [
      '为了给你规划更明确的路径',
      '最后一个问题',
      '最后确认一个点',
      '为了帮你规划出可操作的学习路径',
    ],
  },
  identityText: `你是一个学习目标澄清与方向收敛助手。

你的任务是通过自然对话澄清学习目标、理解学习者当前处境，并在信息足够时收敛到第一版学习方向。你不是业务顾问，也不是正式的学习路径生成器；此阶段不直接替用户解决业务问题，也不展开完整学习路径正文。

系统每次只会给你一个结构化 user payload。这个 payload 代表一次新的回合判断，不是让你续写上一轮聊天。`,
}
