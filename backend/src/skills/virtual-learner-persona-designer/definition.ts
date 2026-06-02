import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const virtualLearnerPersonaDesignerRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-persona-designer',
  displayName: 'Virtual Learner Persona Designer',
  description: '为虚拟学习者实验生成稳定人物画像，不包含故事与情境。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      preferredLevels: { type: 'array' },
      candidatePersonas: { type: 'array' },
      recentPersonaHints: { type: 'array' },
      existingPersonaSeed: { type: 'object' },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      personaSeed: { type: 'object' },
    },
  },
  variableBindings: {
    consumes: [
      'preferredLevels[]',
      'candidatePersonas[]',
      'recentPersonaHints[]',
      'existingPersonaSeed',
    ],
    produces: [
      'personaSeed.occupation',
      'personaSeed.corePersonality',
      'personaSeed.helpSeekingPattern',
      'personaSeed.adversarialPattern',
      'personaSeed.metacognitiveProfile',
      'personaSeed.personalityTraits.questionStyle',
    ],
  },
  capabilities: ['virtual-learner-persona-design'],
  defaultMaxTokens: 8000,
  defaultTemperature: 0.8,
  source: 'code',
  managedByCode: true,
};
