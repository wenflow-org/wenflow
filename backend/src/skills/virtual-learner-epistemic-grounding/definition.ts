import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

/**
 * virtual-learner-epistemic-grounding 运行期定义（P1 参数一致性：defaultTemperature/defaultMaxTokens
 * 镜像 prompts/core/virtual-learner-epistemic-grounding.yaml params —— core 为唯一写源）
 */
export const virtualLearnerEpistemicGroundingRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-epistemic-grounding',
  displayName: '虚拟学习者认知判决器',
  description: '基于学习者画像掌握度，对本轮能否做对当前步骤做离散认知判决（BEAGLE Strategist 段，物理两阶段第一段）。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object', description: '学习者画像（含掌握度描述）' },
      currentTask: { type: 'object', description: '当前 task 信息' },
      knowledgeSnapshot: { type: 'array', description: '当前任务知识看板' },
      previousLearnerState: { type: 'object', description: '上一轮学习者主观状态' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      epistemicGrounding: { type: 'object', description: '本轮认知判决（sampledCorrectness/blockedConcept/errorPattern/masteryProb）' },
    },
  },
  capabilities: ['learner-epistemic-grounding', 'competency-bias-mitigation'],
  defaultMaxTokens: 800,
  defaultTemperature: 0.3,
  source: 'code',
  managedByCode: true,
};
