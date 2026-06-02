export const simulationOrchestratorRuntimeDefinition = {
  id: 'orchestrator:virtual-learner-simulation',
  displayName: 'Virtual Learner Simulation Orchestrator',
  description: 'Virtual Learner -> Goal Conversation -> Path Generation -> Path Review -> AI Teaching 的虚拟学习者实验主链。',
  category: 'orchestrator',
  steps: [
    { step: 1, agentId: 'virtual-learner-goal-dialogue-simulator', role: 'goal-stage-learner-turn-simulation', loopOver: 'goal-rounds' },
    { step: 2, agentId: 'goal-conversation-agent', role: 'goal-clarification-and-convergence', loopOver: 'goal-rounds' },
    { step: 3, agentId: 'orchestrator:path-generation', role: 'learning-path-generation', condition: 'when goal stage converges' },
    { step: 4, agentId: 'virtual-learner-path-evaluator', role: 'path-review-reaction', condition: 'when a learning path is available' },
    { step: 5, agentId: 'virtual-learner-learn-turn-simulator', role: 'learn-stage-learner-turn-simulation', condition: 'when learning phase starts', loopOver: 'learning-turns' },
    { step: 6, agentId: 'orchestrator:ai-teaching', role: 'learning-session-execution', condition: 'when learning phase starts', loopOver: 'learning-turns' },
  ],
  variableGraph: {
    virtualLearnerSimulation: ['persona', 'story', 'learnerState', 'knowledgeState', 'reaction'],
    goalConversation: ['goalConversationId', 'goalStage', 'goalReady', 'collectedData'],
    pathGeneration: ['learningPathId', 'pathSummary', 'milestones'],
    pathReview: ['review.decision', 'review.reasons', 'review.biggestConcern'],
    aiTeaching: ['teachingSessionId', 'learningProgress', 'teachingLogs'],
  },
  source: 'code',
  managedByCode: true,
};
