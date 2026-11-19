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
      role: 'teaching-context-build',
      summary: '装配教学上下文：学习者快照、当前任务、画像信号与控制项'
    },
    {
      step: 2,
      agentId: 'skill:teaching-opening',
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
      agentId: 'skill:teaching-peer-reinforcement',
      kind: 'skill',
      role: 'teaching-peer-reinforcement',
      condition: 'when control.shouldTriggerPeer = true'
    },
    {
      step: 5,
      agentId: 'AITeachingCoordinator.submitCheckpoint',
      kind: 'service',
      impl: 'services/ai-teaching/AITeachingCoordinator.ts submitCheckpoint（teaching-turn 可选输出 control.checkpoint 产生 pendingCheckpoint）',
      role: 'checkpoint-decision',
      summary: '提交并裁决检查点作答，推进教学会话状态机',
      condition: 'when a pending checkpoint is returned'
    },
    {
      step: 6,
      agentId: 'skill:teaching-wrapup',
      kind: 'skill',
      role: 'teaching-wrapup',
      condition: 'when session ends'
    },
    {
      step: 7,
      agentId: 'ReplanAdvisoryService',
      kind: 'service',
      impl: 'services/ai-teaching/ReplanAdvisoryService.ts build（endSession 流内调用）',
      role: 'replan-advisory',
      summary: '课后生成重规划建议（保持、补强、放慢、重排、加速），只记录不执行',
      condition: 'after wrapup and learner projection refresh'
    },
    {
      step: 8,
      agentId: 'skill:teaching-exit-ticket',
      kind: 'skill',
      role: 'exit-ticket-generation',
      condition: 'when completion is ready and the end-of-lesson exit ticket has not passed'
    },
  ],
  variableGraph: {
    contextBuilder: ['scenario', 'scenario.cognitiveFrame', 'learner', 'knowledge', 'controls'],
    teachingTurn: ['reply', 'analysis', 'knowledge.points', 'pedagogy.strategies', 'control'],
    peerAgent: ['peer.message', 'peer.followUpQuestions'],
    checkpointEngine: ['pendingCheckpoint'],
    exitTicket: ['exitTicket'],
    sessionWrapup: ['wrapup', 'evaluation'],
    replanAdvisory: ['advisory'],
  },
  source: 'code',
  managedByCode: true,
};
