import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

/**
 * learning-predictor 运行期定义（P1 参数一致性：defaultTemperature/defaultMaxTokens
 * 镜像 prompts/core/learning-predictor.yaml params —— core 为唯一写源）
 */
export const learningPredictorRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:learning-predictor',
  displayName: '学习表现预测 Skill',
  description: '任务开始前：基于知识状态摘要与台账预测卡壳风险、学习基调与建议深度，供校准闭环验证',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      knowledgeStateSummary: { type: 'string', description: '最近一次知识状态摘要' },
      fatigueSignal: { type: 'string', description: '疲劳信号 low|medium|high' },
      taskContext: { type: 'object', description: '目标任务上下文' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      stallRisk: { type: 'number', description: '卡壳风险 0-1' },
      predictedTone: { type: 'string', description: 'smooth|struggle|fatigue' },
      suggestedDepth: { type: 'string', description: 'shallow|standard|deep' },
      focusConcepts: { type: 'array', description: '建议聚焦概念' },
      rationale: { type: 'string', description: '一句话预测依据' },
    },
  },
  capabilities: ['learning-prediction', 'calibration-feedback'],
  defaultMaxTokens: 1200,
  defaultTemperature: 0.2,
  source: 'code',
  managedByCode: true,
};
