import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

/**
 * kc-mapper 运行期定义（P1 参数一致性：defaultTemperature/defaultMaxTokens
 * 镜像 prompts/core/kc-mapper.yaml params —— core 为唯一写源）
 */
export const kcMapperRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:kc-mapper',
  displayName: '知识组件映射器',
  description: '将认知概念和子任务分解为细粒度 KC，标注前置依赖',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      cognitiveCore: { type: 'object', description: '认知核心概念集' },
      milestones: { type: 'array', description: '学习里程碑' },
      subtasks: { type: 'array', description: '子任务列表' },
      prerequisiteTree: { type: 'object', description: '前置知识依赖树' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      conceptKcs: { type: 'array', description: '概念级 KC' },
      taskKcLinks: { type: 'array', description: '任务-KC 关联' },
      kcGraph: { type: 'object', description: 'KC 前置依赖图' },
      gapCoverage: { type: 'object', description: '覆盖缺口分析' },
    },
  },
  capabilities: ['kc-mapping', 'knowledge-graph'],
  defaultMaxTokens: 8000,
  defaultTemperature: 0.3,
  source: 'code',
  managedByCode: true,
};
