import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const sessionWrapupRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'session-wrapup-agent',
  displayName: '课后产出 Agent',
  description: '根据整节课的消息、知识点变化与状态证据，生成总结、评估与后续建议。',
  category: 'agent',
  inputSchema: {
    type: 'object',
    properties: {
      messages: { type: 'array' },
      knowledgePoints: { type: 'array' },
      sessionInfo: { type: 'object' },
      learningState: { type: 'object' },
      knowledgeContext: { type: 'object' },
      sessionEvidence: { type: 'object' },
    },
    required: ['messages', 'knowledgePoints', 'sessionInfo'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'object' },
      evaluation: { type: ['object', 'null'] },
      summarySource: { type: 'string' },
      evaluationSource: { type: 'string' },
    },
    required: ['summary', 'summarySource', 'evaluationSource'],
  },
  variableBindings: {
    consumes: [
      'messages[]',
      'knowledgePoints[]',
      'sessionInfo.topic',
      'sessionInfo.taskType',
      'sessionInfo.taskTitle',
      'sessionInfo.pathTitle',
      'learningState',
      'knowledgeContext.delta',
      'sessionEvidence',
    ],
    produces: [
      'summary.topicSummary',
      'summary.knowledgeSummary',
      'summary.practiceAdvice',
      'summary.learningEvaluation',
      'summary.knowledgeItems[]',
      'evaluation.sessionLss',
      'evaluation.sessionKtl',
      'evaluation.sessionLf',
      'evaluation.confidence',
    ],
  },
  capabilities: [
    'session-wrapup',
    'session-summary',
    'session-evaluation',
  ],
  defaultMaxTokens: 4000,
  defaultTemperature: 0.7,
  source: 'code',
  managedByCode: true,
};
