import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const virtualLearnerLearnTurnSimulatorRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-learn-turn-simulator',
  displayName: '虚拟学习者 Learn 回合模拟器',
  description: '基于学习者画像、故事与教师可见上下文的模拟器，模拟虚拟学习者在 Learn 阶段的短回应、情绪与主观状态。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像' },
      story: { type: 'object', description: '故事触发器' },
      visibleContext: { type: 'object', description: '完整可见对话上下文' },
      currentPhase: { type: 'string', description: 'trying|blocked|verifying|ready_to_close' },
      previousLearnerState: { type: 'object', description: '上一轮学习者主观状态' },
      currentTask: { type: 'object', description: '当前 task 信息' },
      knowledgeSnapshot: { type: 'array', description: '当前任务知识看板' },
      learnerMemory: { type: 'object', description: '学习者长期记忆（已掌握/到期复习/最近完成）' },
      temporalContext: { type: 'object', description: '日期模拟时间上下文（可选）' },
      epistemicGrounding: { type: 'object', description: '本轮认知判决（硬约束）' },
      pendingCheckpoint: { type: 'object', description: '当前待作答的理解检查点（不含答案键）' },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: '学习者自然回应' },
      emotion: { type: 'string', description: '当前情绪' },
      learnerState: { type: 'object', description: 'Learn 阶段学习者主观状态' },
      learnerFeedback: { type: 'object', description: '学习者对当前 task 是否学完的自我反馈' },
      checkpointAnswer: { type: 'object', description: '对 pendingCheckpoint 的作答草案' },
      debug: { type: 'object', description: '调试信息' },
    },
  },
  variableBindings: {
    consumes: ['learner', 'story', 'visibleContext', 'currentPhase', 'previousLearnerState', 'currentTask', 'knowledgeSnapshot', 'learnerMemory', 'temporalContext', 'epistemicGrounding', 'pendingCheckpoint'],
    produces: ['reply', 'emotion', 'learnerState', 'learnerFeedback', 'checkpointAnswer', 'debug'],
  },
  capabilities: ['learn-stage-learner-simulation', 'visible-context-roleplay', 'short-teaching-reply'],
  defaultMaxTokens: 2000,
  defaultTemperature: 0.7,
  source: 'code',
  managedByCode: true,
};
