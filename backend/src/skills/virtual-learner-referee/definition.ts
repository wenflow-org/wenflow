import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const virtualLearnerRefereeRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:virtual-learner-referee',
  displayName: '虚拟学习者实验裁判',
  description: '基于 Blackbox 公开轨迹、旁路诊断和控制回执生成独立实验裁判报告。',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      publicTrace: { type: 'array', description: '学习者实际可见的公开轨迹' },
      refereeTrace: { type: 'array', description: '不回流学习者的旁路诊断轨迹' },
      control: { type: 'object', description: '实验最终控制回执' },
      experimentSummary: { type: 'object', description: '服务端生成的实验摘要' },
      storyMeta: { type: 'object', description: '平行通道：故事元数据与当次诉求，不进入主链' },
      metricCompleteness: { type: 'object', description: '数据完整性：教学指标与 wrapup 产出情况' },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', description: 'pass|pass_with_concerns|fail|inconclusive' },
      scores: { type: 'object', description: '各维度 0-100 分（含 goalUnderstanding）' },
      findings: { type: 'array', description: '带证据引用的问题发现' },
      recommendations: { type: 'array', description: '面向实验维护者的改进建议' },
      evidence: { type: 'array', description: '可定位到输入轨迹的证据' },
    },
  },
  variableBindings: {
    consumes: ['publicTrace', 'refereeTrace', 'control', 'experimentSummary', 'storyMeta', 'metricCompleteness'],
    produces: ['verdict', 'scores', 'findings', 'recommendations', 'evidence'],
  },
  capabilities: ['virtual-learner-experiment-referee', 'blackbox-trace-evaluation', 'side-channel-evidence-analysis'],
  defaultMaxTokens: 2400,
  defaultTemperature: 0.2,
  source: 'code',
  managedByCode: true,
};
