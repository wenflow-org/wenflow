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
      cognitiveCore: { type: 'object' },
      normalizedInput: { type: 'object' },
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
      'cognitiveCore.coreConcepts',
      'normalizedInput.confirmedProposal.firstDeliverable',
      'normalizedInput.planningHints.subtasksPerStageRange',
      'normalizedInput.planningHints.subtaskMinutesRange',
    ],
    produces: [
      'subtasks[].title',
      'subtasks[].type',
      'subtasks[].estimatedMinutes',
      'subtasks[].linkedConcept',
      'subtasks[].knowledgeType',
      'subtasks[].cognitiveLevel',
    ],
  },
  capabilities: ['stage-task-design', 'task-light-tagging'],
  defaultMaxTokens: 32000,
  defaultTemperature: 0.3,
  source: 'code',
  managedByCode: true,
};
