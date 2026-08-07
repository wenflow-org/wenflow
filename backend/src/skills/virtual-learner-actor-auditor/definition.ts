import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const virtualLearnerActorAuditorRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-actor-auditor',
  displayName: '虚拟学习者角色一致性审计器',
  description: '基于画像、故事、摩擦预算、私有状态和公开行为轨迹评估学习者的角色保真度。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      actorProfile: { type: 'object', description: '合成学习者画像' },
      story: { type: 'object', description: '本次运行的故事设定' },
      frictionBudget: { type: 'string', description: '行为摩擦预算' },
      learnerPrivateState: { type: 'object', description: '模拟器私有状态轨迹' },
      publicTrace: { type: 'array', description: '学习者实际公开行为轨迹' },
      experimentSummary: { type: 'object', description: '实验覆盖与终态摘要' },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', description: 'credible|credible_with_concerns|invalid|inconclusive' },
      scores: { type: 'object', description: '角色保真度各维度 0-100 分' },
      findings: { type: 'array', description: '带证据引用的保真度问题' },
      recommendations: { type: 'array', description: '面向模拟器维护者的改进建议' },
      evidence: { type: 'array', description: '可定位到角色设定和行为轨迹的证据' },
    },
  },
  variableBindings: {
    consumes: ['actorProfile', 'story', 'frictionBudget', 'learnerPrivateState', 'publicTrace', 'experimentSummary'],
    produces: ['verdict', 'scores', 'findings', 'recommendations', 'evidence'],
  },
  capabilities: ['virtual-learner-actor-audit', 'persona-fidelity-evaluation', 'synthetic-user-validity-check'],
  defaultMaxTokens: 2400,
  defaultTemperature: 0.2,
  source: 'code',
  managedByCode: true,
};
