import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const virtualLearnerScenarioDesignerRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-scenario-designer',
  displayName: 'Virtual Learner Scenario Designer',
  description: '为虚拟学习者实验生成目标切片、任务场景与匹配画像。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      preferredDomains: { type: 'array' },
      preferredGoalTypes: { type: 'array' },
      preferredLevels: { type: 'array' },
      preferredMotivations: { type: 'array' },
      avoidDomains: { type: 'array' },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      goalSeed: { type: 'object' },
      personaSeed: { type: 'object' },
      consistencyNotes: { type: 'array' },
    },
  },
  variableBindings: {
    consumes: [
      'preferredDomains[]',
      'preferredGoalTypes[]',
      'preferredLevels[]',
      'preferredMotivations[]',
      'avoidDomains[]',
    ],
    produces: [
      'goalSeed.domain',
      'goalSeed.goalType',
      'goalSeed.surfaceGoal',
      'personaSeed.occupation',
      'personaSeed.knowledgeLevel',
      'personaSeed.personalityTraits.questionStyle',
    ],
  },
  capabilities: ['virtual-learner-scenario-design', 'persona-goal-matching'],
  defaultMaxTokens: 4000,
  defaultTemperature: 0.9,
  source: 'code',
  managedByCode: true,
};
