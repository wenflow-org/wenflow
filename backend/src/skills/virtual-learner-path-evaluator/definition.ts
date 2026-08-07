import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const virtualLearnerPathEvaluatorRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-path-evaluator',
  displayName: '虚拟学习者 Path 评估器',
  description: '从学习者视角评估当前学习路径与 replan 方案的契合度，输出 accept/modify/reject 反应与 assisted 协作型请求；blackbox 模式不适用，Path 评估器直接进入 Learn。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像' },
      story: { type: 'object', description: '故事情景' },
      pathProposal: { type: 'object', description: '当前路径方案' },
      goalState: { type: 'object', description: 'Goal 阶段状态' },
      previousReaction: { type: 'object', description: '上一次路径反应' },
      learnerState: { type: 'object', description: '当前学习者主观状态' },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      reaction: { type: 'string', description: '学习者对路径的自然反应' },
      visibleRequestedChanges: { type: 'array', description: '学习者明确提出的可见修改项' },
      debug: { type: 'object', description: '调试信息' },
    },
  },
  variableBindings: {
    consumes: ['learner', 'story', 'pathProposal', 'goalState', 'previousReaction', 'learnerState'],
    produces: ['reaction', 'visibleRequestedChanges', 'debug'],
  },
  capabilities: ['virtual-learner-path-evaluation', 'virtual-learner-replan-evaluation'],
  defaultMaxTokens: 8000,
  defaultTemperature: 0.8,
  source: 'code',
  managedByCode: true,
};
