export const AITeachingCoordinatorRuntimeDefinition = {
  id: 'teaching-agent',
  displayName: 'AI Teaching Agent',
  description: 'Task -> Context Build -> Opening -> Teaching Turn -> Peer/Checkpoint -> Wrapup/Advisory 的教学主链（真实执行体：services/ai-teaching/AITeachingCoordinator.ts LearnStage 状态机）。',
  category: 'agent',
  steps: [
    {
      step: 1,
      agentId: 'TeachingContextBuilder',
      kind: 'service',
      impl: 'services/ai-teaching/TeachingContextBuilder.ts buildTeachingScenarioContext',
      role: 'teaching-context-build'
    },
    {
      step: 2,
      agentId: 'skill:teaching-opening-generator',
      kind: 'skill',
      role: 'opening-generation',
      condition: 'on session start'
    },
    {
      step: 3,
      agentId: 'skill:teaching-turn',
      kind: 'skill',
      role: 'teaching-turn-generation',
      loopOver: 'messages'
    },
    {
      step: 4,
      agentId: 'skill:peer-reinforcement',
      kind: 'skill',
      role: 'peer-reinforcement',
      condition: 'when control.shouldTriggerPeer = true'
    },
    {
      step: 5,
      agentId: 'AITeachingCoordinator.submitCheckpoint',
      kind: 'service',
      impl: 'services/ai-teaching/AITeachingCoordinator.ts submitCheckpoint（teaching-turn 可选输出 control.checkpoint 产生 pendingCheckpoint）',
      role: 'checkpoint-decision',
      condition: 'when a pending checkpoint is returned'
    },
    {
      step: 6,
      agentId: 'skill:session-wrapup',
      kind: 'skill',
      role: 'session-wrapup',
      condition: 'when session ends'
    },
    {
      step: 7,
      agentId: 'ReplanAdvisoryService',
      kind: 'service',
      impl: 'services/ai-teaching/ReplanAdvisoryService.ts build（endSession 流内调用）',
      role: 'replan-advisory',
      condition: 'after wrapup and learner projection refresh'
    },
  ],
  variableGraph: {
    contextBuilder: ['scenario', 'scenario.cognitiveFrame', 'learner', 'knowledge', 'controls'],
    teachingTurn: ['reply', 'analysis', 'knowledge.points', 'pedagogy.strategies', 'control'],
    peerAgent: ['peer.message', 'peer.followUpQuestions'],
    checkpointEngine: ['pendingCheckpoint'],
    sessionWrapup: ['wrapup', 'evaluation'],
    replanAdvisory: ['advisory'],
  },
  source: 'code',
  managedByCode: true,
};
