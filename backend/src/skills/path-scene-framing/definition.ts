import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const pathSceneFramingRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:path-scene-framing',
  displayName: 'Path Scene Framing',
  description: '将 Goal 层松散信息清洗为稳定的 normalizedInput，并补节奏建议 planningHints。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      currentLevel: { type: 'string' },
      timePerDay: { type: 'string' },
      structuredData: { type: 'object' },
      confirmedProposal: { type: 'object' },
      metadata: { type: 'object' },
    },
    required: ['goal'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      normalizedInput: { type: 'object' },
    },
  },
  variableBindings: {
    consumes: [
      'goal',
      'structuredData',
      'confirmedProposal',
      'metadata',
    ],
    produces: [
      'normalizedInput.problemSpace.realProblem',
      'normalizedInput.confirmedProposal.keyStages',
      'normalizedInput.planningHints.paceSignal',
      'normalizedInput.planningHints.milestoneRange',
      'normalizedInput.planningHints.subtasksPerStageRange',
    ],
  },
  capabilities: ['path-input-normalization', 'path-input-cleaning'],
  defaultMaxTokens: 32000,
  defaultTemperature: 0.2,
  source: 'code',
  managedByCode: true,
};
