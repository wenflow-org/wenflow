import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const virtualLearnerGoalDialogueSimulatorRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-goal-dialogue-simulator',
  displayName: '虚拟学习者 Goal 对话模拟器',
  description: '基于学习者画像、故事与 Goal Agent 可见上下文的模拟器，模拟虚拟学习者在 Goal 阶段的自然回应与方案取向。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像' },
      story: { type: 'object', description: '故事触发器' },
      visibleContext: { type: 'object', description: '完整可见对话上下文' },
      currentPhase: { type: 'string', description: 'opening|understanding|proposal_evaluation' },
      previousLearnerState: { type: 'object', description: '上一轮学习者主观状态' },
      task: { type: 'object', description: '结构化任务说明' },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: '学习者自然回应' },
      emotion: { type: 'string', description: '当前情绪' },
      learnerState: { type: 'object', description: 'Goal 阶段学习者主观状态' },
      debug: { type: 'object', description: '调试信息' },
    },
  },
  variableBindings: {
    consumes: ['learner', 'story', 'visibleContext', 'currentPhase', 'previousLearnerState', 'task'],
    produces: ['reply', 'emotion', 'learnerState', 'debug'],
  },
  capabilities: ['goal-stage-learner-simulation', 'proposal-fit-evaluation', 'visible-context-roleplay'],
  defaultMaxTokens: 2400,
  defaultTemperature: 0.8,
  source: 'code',
  managedByCode: true,
};
