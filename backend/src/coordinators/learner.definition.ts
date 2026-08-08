export const learnerAgentRuntimeDefinition = {
  id: 'profile-agent',
  displayName: 'Learner State Agent',
  description: 'Goal/lesson 事件 -> learner profile enrich -> background consolidation -> snapshot refresh 的学习者主链编排。',
  category: 'agent',
  steps: [
    { step: 1, agentId: 'skill:learner-model', role: 'goal-and-learning-signal-ingestion', condition: 'when learner profile related events arrive' },
    { step: 2, agentId: 'skill:lesson-knowledge-enricher', role: 'lesson-knowledge-enrichment', condition: 'when lesson ends' },
    { step: 3, agentId: 'snapshot-refresh-service', role: 'learner-snapshot-refresh', condition: 'after learner updates are applied' },
  ],
  variableGraph: {
    learnerProfile: ['narrativeInsights', 'curriculumControls', 'learning'],
    learnerBackground: ['globalBackground.conceptLedger', 'globalBackground.recurringConfusions', 'globalBackground.transferSignals'],
    learnerProjection: ['dynamicState', 'learningControlState', 'replanSignal'],
  },
  source: 'code',
  managedByCode: true,
}
