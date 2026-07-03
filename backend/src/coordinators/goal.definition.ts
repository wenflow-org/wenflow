export const goalAgentRuntimeDefinition = {
  id: 'goal-agent',
  displayName: 'Goal Agent',
  description: '目标收集与理解阶段：多轮对话收集学习目标与上下文，输出 Goal Understanding',
  category: 'agent',
  steps: [
    { 
      step: 1, 
      agentId: 'skill:goal-conversation', 
      role: 'goal-clarification',
      loopOver: 'conversation-rounds',
      condition: 'until goal confirmed'
    }
  ],
  variableGraph: {
    goalConversation: ['goalUnderstanding', 'confirmedProposal', 'learnerContext']
  },
  source: 'code',
  managedByCode: true
};
