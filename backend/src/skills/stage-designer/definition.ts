import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const stageDesignerRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:stage-designer',
  displayName: 'Stage Designer',
  description: '为单个 milestone 生成 subtasks，并补轻量任务标签。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      milestone: { type: 'object' },
      // 前一里程碑（consolidate 回捞的输入真相源）：yaml inputs 与 buildUserPayload 都有它，
      // 此前 inputSchema 漏声明 ⇒ 契约视图与真实载荷不一致（审计 P2 声明漂移）。
      previousMilestone: { type: 'object' },
      cognitiveCore: { type: 'object' },
      normalizedInput: { type: 'object' },
      materials: { type: 'array' },
      repairHints: { type: 'object' },
    },
    required: ['milestone', 'cognitiveCore'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      subtasks: { type: 'array' },
    },
  },
  variableBindings: {
    consumes: [
      'milestone.title',
      'milestone.coreConcept',
      'milestone.goal',
      // 规则 41（每阶段至少一个 consolidate 回捞前一阶段）依赖这两个键
      'previousMilestone.title',
      'previousMilestone.coreConcept',
      'cognitiveCore.coreConcepts',
      'materials[].title',
      'materials[].sections[].id',
      'materials[].sections[].title',
      'materials[].keyPoints[].cite',
      'normalizedInput.confirmedProposal.firstDeliverable',
      'normalizedInput.planningHints.subtasksPerStageRange',
      'normalizedInput.planningHints.subtaskMinutesRange',
      'repairHints',
    ],
    produces: [
      'subtasks[].title',
      'subtasks[].type',
      'subtasks[].estimatedMinutes',
      'subtasks[].description',
      'subtasks[].linkedConcept',
      'subtasks[].knowledgeType',
      'subtasks[].cognitiveLevel',
      'subtasks[].icapLevel',
      'subtasks[].transferable',
      // 资料引用（逐字核对后保留的才落库；无资料时不出该键）
      'subtasks[].materialRefs',
    ],
  },
  capabilities: ['stage-task-design', 'task-light-tagging'],
  defaultMaxTokens: 32000,
  defaultTemperature: 0.3,
  source: 'code',
  managedByCode: true,
};
