import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const peerRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:peer-reinforcement',
  displayName: '伴学强化',
  description: '在教学主链需要强化理解时，以同伴式风格发起讨论。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      strategy: { type: 'string' },
      studentMessage: { type: 'string' },
      tutorContext: { type: 'array' },
      cognitiveLevel: { type: 'string' },
      understanding: { type: 'number' },
    },
    required: ['topic', 'strategy', 'tutorContext'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      strategy: { type: 'string' },
      followUpQuestions: { type: 'array' },
    },
    required: ['message', 'strategy'],
  },
  variableBindings: {
    consumes: [
      'topic',
      'strategy',
      'studentMessage',
      'tutorContext[]',
      'cognitiveLevel',
      'understanding',
    ],
    produces: [
      'message',
      'strategy',
      'followUpQuestions[]',
    ],
  },
  capabilities: [
    'feynman-technique',
    'debate-facilitation',
    'counterexample-challenge',
    'analogy-migration',
    'error-analysis',
  ],
  defaultMaxTokens: 8000,
  defaultTemperature: 0.7,
  source: 'code',
  managedByCode: true,
};
