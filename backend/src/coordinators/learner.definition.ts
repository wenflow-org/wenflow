export const learnerAgentRuntimeDefinition = {
  id: 'profile-agent',
  displayName: 'Learner State Agent',
  description: 'Goal/lesson 事件 -> learner profile enrich -> background consolidation -> snapshot refresh 的学习者主链编排（真实执行体：outbox 消费者序列 index.ts:662-677）。',
  category: 'agent',
  steps: [
    {
      step: 1,
      agentId: 'skill:learner-model',
      kind: 'skill',
      role: 'goal-and-learning-signal-ingestion',
      condition: 'when learner profile related events arrive'
    },
    {
      step: 2,
      agentId: 'skill:lesson-knowledge-enricher',
      kind: 'skill',
      role: 'lesson-knowledge-enrichment',
      condition: 'when lesson ends'
    },
    {
      step: 3,
      agentId: 'LearnerSnapshotRefreshService',
      kind: 'service',
      impl: 'services/learner/LearnerSnapshotRefreshService.ts refresh（outbox 消费者接线 index.ts:662-677）',
      role: 'learner-snapshot-refresh',
      condition: 'after learner updates are applied'
    },
  ],
  variableGraph: {
    learnerProfile: ['narrativeInsights', 'curriculumControls', 'learning'],
    learnerBackground: ['globalBackground.conceptLedger', 'globalBackground.recurringConfusions', 'globalBackground.transferSignals'],
    learnerProjection: ['dynamicState', 'learningControlState', 'replanSignal'],
  },
  source: 'code',
  managedByCode: true,
}
