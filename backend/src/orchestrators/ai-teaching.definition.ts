export const aiTeachingOrchestratorRuntimeDefinition = {
  id: 'orchestrator:ai-teaching',
  displayName: 'AI Teaching Orchestrator',
  description: 'Task -> Context Build -> Teaching Turn -> Peer/Checkpoint -> Wrapup/Advisory 的测试授课主链。',
  category: 'orchestrator',
  steps: [
    { step: 1, agentId: 'context-builder', role: 'teaching-context-build' },
    { step: 2, agentId: 'teaching-turn-agent', role: 'teaching-turn-generation', loopOver: 'messages' },
    { step: 3, agentId: 'skill:peer-reinforcement', role: 'peer-reinforcement', condition: 'when control.shouldTriggerPeer = true' },
    { step: 4, agentId: 'checkpoint-engine', role: 'checkpoint-decision', condition: 'when a pending checkpoint is returned' },
    { step: 5, agentId: 'session-wrapup-agent', role: 'session-wrapup', condition: 'when session ends' },
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
