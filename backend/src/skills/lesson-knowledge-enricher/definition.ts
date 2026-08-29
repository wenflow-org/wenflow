import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

/**
 * lesson-knowledge-enricher 运行期定义（P1 参数一致性：defaultTemperature/defaultMaxTokens
 * 镜像 prompts/core/lesson-knowledge-enricher.yaml params —— core 为唯一写源）
 */
export const lessonKnowledgeEnricherRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:lesson-knowledge-enricher',
  displayName: '课后知识增强 Skill',
  description: '课后单次调用：从知识状态、wrapup、课堂证据与可见对话切片中提炼知识台账增量与隐性概念线索',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      knowledgeState: { type: 'array', description: '当前课堂知识状态' },
      knowledgeDelta: { type: 'object', description: '课堂知识变化' },
      wrapup: { type: 'object', description: '课堂总结与评估' },
      taskContext: { type: 'object', description: '任务与路径上下文' },
      sessionEvidence: { type: 'object', description: '课堂证据摘要' },
      visibleDialogueContext: { type: 'array', description: '可见课堂对话切片' },
      classroomEventHistory: { type: 'array', description: '课堂事件历史' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      conceptLedger: { type: 'array', description: '知识背景账本增量' },
      reusableFoundations: { type: 'array', description: '可复用基础' },
      blockedFoundations: { type: 'array', description: '不稳定前提' },
      transferSignals: { type: 'array', description: '迁移信号' },
      recurringConfusions: { type: 'array', description: '反复混淆模式' },
      knowledgeStateSummary: { type: 'string', description: '知识状态自然语言摘要（LBM 式，供预测器/教学决策读取）' },
    },
  },
  capabilities: ['lesson-knowledge-enrichment', 'learner-background-update'],
  defaultMaxTokens: 4000,
  defaultTemperature: 0.4,
  source: 'code',
  managedByCode: true,
};