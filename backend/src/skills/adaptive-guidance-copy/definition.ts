import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

/**
 * adaptive-guidance-copy 运行期定义（P1 参数一致性：defaultTemperature/defaultMaxTokens
 * 镜像 prompts/core/adaptive-guidance-copy.yaml params —— core 为唯一写源）
 */
export const adaptiveGuidanceCopyRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:adaptive-guidance-copy',
  displayName: '自适应引导文案 Skill',
  description: '根据学习者状态与路径上下文生成 Dashboard / Path 页面引导文案',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      view: { type: 'string', description: '页面类型：dashboard|path-list|path-detail|learning-state' },
      learnerSnapshot: { type: 'object', description: '学习者快照' },
      learningState: { type: 'object', description: '学习状态' },
      path: { type: 'object', description: '路径上下文' },
      sessionWrapup: { type: 'object', description: '最近课程总结' },
      advisory: { type: 'object', description: '路径建议' },
    },
    required: ['view', 'learnerSnapshot', 'learningState'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: '页面主标题/主引导' },
      subtitle: { type: 'string', description: '页面副标题/说明' },
      todayActions: { type: 'array', description: '今日建议动作' },
      pathHint: { type: 'string', description: '当前路径提示' },
      nextStep: { type: 'string', description: '下一步建议' },
      paceHint: { type: 'string', description: '节奏提示' },
      emptyStateCopy: { type: 'string', description: '空状态文案' },
      warningCopy: { type: 'string', description: '风险/提醒文案' },
    },
  },
  capabilities: ['adaptive-copy', 'dashboard-copy', 'path-copy', 'learning-guidance'],
  defaultMaxTokens: 4000,
  defaultTemperature: 0.6,
  source: 'code',
  managedByCode: true,
};