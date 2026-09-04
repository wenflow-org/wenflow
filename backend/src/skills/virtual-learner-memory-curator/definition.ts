import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

/**
 * virtual-learner-memory-curator 运行期定义（P1 参数一致性：defaultTemperature/defaultMaxTokens
 * 镜像 prompts/core/virtual-learner-memory-curator.yaml params —— core 为唯一写源）
 */
export const virtualLearnerMemoryCuratorRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-memory-curator',
  displayName: '虚拟学习者课后记忆提炼 Skill',
  description: '以虚拟学习者本人视角，从课堂回合中提炼"自己觉得学会了什么、卡在哪"，产出可沉淀的记忆增量。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      persona: { type: 'object', description: '稳定画像（selfAssessmentAccuracy 等）' },
      turnSequence: { type: 'array', description: '本课回合序列（reply/emotion/learnerState/learnerFeedback 压缩视图）' },
      currentTask: { type: 'object', description: '当前任务（title/linkedConcept/acceptanceCriteria）' },
      existingKnown: { type: 'array', description: '画像已沉淀 knownConcepts' },
      existingStruggle: { type: 'array', description: '画像已沉淀 struggleConcepts' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      masteredConcepts: { type: 'array', description: '自己觉得学会的概念（name/evidence/confidence）' },
      struggleConcepts: { type: 'array', description: '自己觉得没学会的概念（name/blocker/severity）' },
      selfCalibration: { type: 'string', description: '自评可靠度说明' },
      memoryDelta: { type: 'string', description: '本课记忆增量一句话' },
    },
  },
  capabilities: ['virtual-learner-memory-curation', 'self-reported-mastery-extraction', 'persona-calibrated-self-assessment'],
  defaultMaxTokens: 2400,
  defaultTemperature: 0.3,
  source: 'code',
  managedByCode: true,
};
