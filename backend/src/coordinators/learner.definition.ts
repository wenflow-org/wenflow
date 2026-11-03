export const learnerAgentRuntimeDefinition = {
  id: 'profile-agent',
  displayName: 'Learner State Agent',
  description: 'Goal/lesson 事件 -> 证据投影 -> 课后知识增强 -> 清画像缓存 -> 快照重算 的学习者主链编排（真实执行体：outbox 消费者在 bootstrap/schedulers.ts:75 注册，序列见 events/learner-event-consumer.ts:30-61）。',
  category: 'agent',
  steps: [
    {
      step: 1,
      agentId: 'LearnerEvidenceProjector',
      kind: 'service',
      impl: 'services/learner/LearnerEvidenceProjector.ts handle（事件 → 学习者证据投影）',
      role: 'learner-evidence-projection',
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
      agentId: 'LearnerProfileService',
      kind: 'service',
      impl: 'services/learner/LearnerProfileService.ts clear（清画像缓存，读路径超 TTL 自愈重建）',
      role: 'learner-profile-cache-clear',
      condition: 'after learner evidence is projected'
    },
    {
      step: 4,
      agentId: 'LearnerSnapshotRefreshService',
      kind: 'service',
      impl: 'services/learner/LearnerSnapshotRefreshService.ts refresh（outbox 消费者接线 bootstrap/schedulers.ts:75 + events/learner-event-consumer.ts:30-61）',
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
