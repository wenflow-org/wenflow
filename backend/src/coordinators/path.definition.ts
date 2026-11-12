export const pathAgentRuntimeDefinition = {
  id: 'path-agent',
  displayName: 'Path Generation Agent',
  description: 'Goal 交付 -> 输入定帧 -> Path Agent -> Stage Designer 的主链编排（输入定帧为确定性 buildFramedNormalizedInput，无 LLM framing）。',
  category: 'agent',
  steps: [
    {
      step: 1,
      agentId: 'PathCoordinator.buildFramedNormalizedInput',
      kind: 'service',
      impl: 'coordinators/path.coordinator.ts buildNormalizedInputV1（handoffFields 配置优先 + visibleSummary 确定性回退，无 LLM）',
      role: 'input-framing',
      summary: '输入定帧：把 goal 的理解结果整理成 path-planning 的输入（枚举、时间维度、体量上界），不调模型',
      condition: 'when goal handoff received'
    },
    {
      step: 2,
      agentId: 'skill:path-planning',
      kind: 'skill',
      role: 'cognitive-core-and-milestones'
    },
    {
      step: 3,
      agentId: 'skill:stage-designer',
      kind: 'skill',
      role: 'stage-task-expansion',
      loopOver: 'milestones'
    },
  ],
  variableGraph: {
    goalConversation: ['goalFinalPayload'],
    pathAgent: ['cognitiveCore', 'milestones', 'normalizedInput', 'planningHints'],
    stageDesigner: ['subtasks'],
  },
  source: 'code',
  managedByCode: true,
};
