export const AITeachingCoordinatorRuntimeDefinition = {
  id: 'teaching-agent',
  displayName: 'AI Teaching Agent',
  description: 'Task -> Context Build -> Teaching Turn -> Peer/Checkpoint -> Wrapup/Advisory 的测试授课主链。',
  category: 'agent',
  steps: [
    { step: 1, agentId: 'context-builder', role: 'teaching-context-build' },
    { step: 2, agentId: 'skill:teaching-turn', role: 'teaching-turn-generation', loopOver: 'messages' },
    { step: 3, agentId: 'skill:peer-reinforcement', role: 'peer-reinforcement', condition: 'when control.shouldTriggerPeer = true' },
    { step: 4, agentId: 'checkpoint-engine', role: 'checkpoint-decision', condition: 'when a pending checkpoint is returned' },
    { step: 5, agentId: 'skill:session-wrapup', role: 'session-wrapup', condition: 'when session ends' },
    { step: 6, agentId: 'replan-advisory', role: 'replan-advisory', condition: 'after wrapup and learner projection refresh' },
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

