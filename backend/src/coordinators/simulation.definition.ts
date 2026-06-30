export const simulationAgentRuntimeDefinition = {
  id: 'agent:virtual-learner-simulation',
  displayName: 'Virtual Learner Simulation Agent',
  description: 'Virtual Learner -> Goal Conversation -> Path Generation -> Path Review -> AI Teaching 的虚拟学习者实验主链。',
  category: 'agent',
  steps: [
    { step: 1, agentId: 'skill:virtual-learner-goal-dialogue-simulator', role: 'goal-stage-learner-turn-simulation', loopOver: 'goal-rounds' },
    { step: 2, agentId: 'skill:goal-conversation', role: 'goal-clarification-and-convergence', loopOver: 'goal-rounds' },
    { step: 3, agentId: 'agent:path-generation', role: 'learning-path-generation', condition: 'when goal stage converges' },
    { step: 4, agentId: 'skill:virtual-learner-path-evaluator', role: 'path-review-reaction', condition: 'when a learning path is available' },
    { step: 5, agentId: 'skill:virtual-learner-learn-turn-simulator', role: 'learn-stage-learner-turn-simulation', condition: 'when learning phase starts', loopOver: 'learning-turns' },
    { step: 6, agentId: 'agent:ai-teaching', role: 'learning-session-execution', condition: 'when learning phase starts', loopOver: 'learning-turns' },
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
