export const pathAgentRuntimeDefinition = {
  id: 'path-agent',
  displayName: 'Path Generation Agent',
  description: 'Goal -> Path Agent -> Stage Designer 的主链编排（输入定帧为确定性 buildFramedNormalizedInput，无 LLM framing）。',
  category: 'agent',
  steps: [
    { step: 1, agentId: 'skill:goal-conversation', role: 'goal-clarification' },
    { step: 2, agentId: 'skill:path-planning', role: 'cognitive-core-and-milestones' },
    { step: 3, agentId: 'skill:stage-designer', role: 'stage-task-expansion', loopOver: 'milestones' },
  ],
  variableGraph: {
    goalConversation: ['goalFinalPayload'],
    pathAgent: ['cognitiveCore', 'milestones', 'normalizedInput', 'planningHints'],
    stageDesigner: ['subtasks'],
  },
  source: 'code',
  managedByCode: true,
};
