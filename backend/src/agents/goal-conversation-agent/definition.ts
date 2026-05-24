import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const goalConversationRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'goal-conversation-agent',
  displayName: '目标对话Agent',
  description: '负责目标澄清、问题诊断、初版方向收敛。',
  category: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      metadata: { type: 'object' },
      conversationHistory: { type: 'array' },
    },
    required: ['goal'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      state: { type: 'object' },
      goalConversation: { type: 'object' },
    },
  },
  variableBindings: {
    consumes: [
      'userInput',
      'state.understanding.surface_goal',
      'state.understanding.real_problem',
      'conversationContext[]',
    ],
    produces: [
      'goalConversation.understanding.surface_goal',
      'goalConversation.understanding.real_problem',
      'goalConversation.confirmedProposal.key_stages',
      'state.stage',
    ],
  },
  capabilities: ['goal-clarification', 'problem-discovery', 'stage-transition'],
  defaultMaxTokens: 8000,
  defaultTemperature: 0.7,
  source: 'code',
  managedByCode: true,
};
