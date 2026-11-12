export const learnerAgentRuntimeDefinition = {
  id: 'profile-agent',
  displayName: 'Learner State Agent',
  description: 'Goal/lesson 事件 -> 证据投影 -> 清画像缓存（含快照缓存失效） -> 快照重算 ->（仅 lesson:completed）登记课后知识增强事件 的学习者主链编排（真实执行体：outbox 消费者在 bootstrap/schedulers.ts:108 注册，序列见 events/learner-event-consumer.ts:48-82；课后增强不在本链上 await，由独立泳道 bootstrap/schedulers.ts:110-111 消费）。',
  category: 'agent',
  steps: [
    {
      step: 1,
      agentId: 'LearnerEvidenceProjector',
      kind: 'service',
      impl: 'services/learner/LearnerEvidenceProjector.ts handle（事件 → 学习者证据投影；events/learner-event-consumer.ts:49）',
      role: 'learner-evidence-projection',
      summary: '把领域事件投影成学习者证据，重复事件按收件箱去重',
      condition: 'when learner profile related events arrive'
    },
    {
      step: 2,
      agentId: 'LearnerProfileService',
      kind: 'service',
      impl: 'services/learner/LearnerProfileService.ts clear + services/learner/LearnerSnapshotRefreshService.ts invalidate（清画像缓存并同源失效快照缓存，读路径超 TTL 自愈重建；events/learner-event-consumer.ts:52-54）',
      role: 'learner-profile-cache-clear',
      summary: '清画像缓存，并让快照缓存同时失效',
      condition: 'after learner evidence is projected'
    },
    {
      step: 3,
      agentId: 'LearnerSnapshotRefreshService',
      kind: 'service',
      impl: 'services/learner/LearnerSnapshotRefreshService.ts refresh（events/learner-event-consumer.ts:67-75；教学 task:completed 与 goal:understanding:updated 不刷新）',
      role: 'learner-snapshot-refresh',
      summary: '重算学习者快照：掌握度、动态状态与教学提示',
      condition: 'after profile cache is invalidated (skipped for teaching task:completed / goal:understanding:updated)'
    },
    {
      step: 4,
      agentId: 'skill:lesson-knowledge-enricher',
      kind: 'skill',
      impl: 'events/lesson-enrichment-event.ts enqueueLessonEnrichmentEvent（events/learner-event-consumer.ts:81；仅 lesson:completed，登记独立事件后由泳道 services/learner/LessonKnowledgeEnrichmentConsumer.ts 消费，快路径不 await LLM）',
      role: 'lesson-knowledge-enrichment',
      condition: 'when lesson ends (enqueued asynchronously; the fast path does not await the LLM)'
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
