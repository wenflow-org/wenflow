export const pathOrchestratorRuntimeDefinition = {
  id: 'orchestrator:path-generation',
  displayName: 'Path Generation Orchestrator',
  description: 'Goal -> Framing -> Path Agent -> Stage Designer 的主链编排。',
  category: 'orchestrator',
  steps: [
    { step: 1, agentId: 'goal-conversation-agent', role: 'goal-clarification' },
    { step: 2, agentId: 'skill:path-scene-framing', role: 'input-normalization' },
    { step: 3, agentId: 'path-agent', role: 'cognitive-core-and-milestones' },
    { step: 4, agentId: 'skill:stage-designer', role: 'stage-task-expansion', loopOver: 'milestones' },
  ],
  variableGraph: {
    goalConversation: ['goalFinalPayload'],
    pathSceneFraming: ['normalizedInput', 'planningHints'],
    pathAgent: ['cognitiveCore', 'milestones'],
    stageDesigner: ['subtasks'],
  },
  source: 'code',
  managedByCode: true,
};
