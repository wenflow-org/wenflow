import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

/**
 * path-reviewer 运行期定义（P1 参数一致性：defaultTemperature/defaultMaxTokens
 * 镜像 prompts/core/path-reviewer.yaml params —— core 为唯一写源）
 */
export const pathReviewerRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:path-reviewer',
  displayName: '路径质量评审器',
  description: '对 path-planning 生成的路径做 CIDDP 五维度评分，低于阈值输出重规划指令',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      pathPlan: { type: 'object', description: '待评审的学习路径计划' },
      goalContext: { type: 'object', description: '目标澄清上下文' },
      prerequisiteTree: { type: 'object', description: '前置知识依赖树' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      score: { type: 'number', description: 'CIDDP 综合评分' },
      dimensions: { type: 'object', description: '五维度分项评分' },
      issues: { type: 'array', description: '评审问题清单' },
      passed: { type: 'boolean', description: '是否通过评审' },
      replanInstructions: { type: 'string', description: '低于阈值时的重规划指令' },
    },
  },
  capabilities: ['path-quality-review', 'cidpp-evaluation'],
  defaultMaxTokens: 4000,
  defaultTemperature: 0.3,
  source: 'code',
  managedByCode: true,
};
