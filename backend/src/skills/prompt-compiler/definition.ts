import { RuntimeDefinitionRecord } from '../../composers/definitions/types';

export const promptCompilerRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:prompt-compiler',
  name: 'prompt-compiler',
  displayName: 'Prompt 编译器',
  description: '将简化的 YAML 配置编译为完整的 Skill Prompt（Markdown 格式）',
  category: 'skill',
  inputSchema: {
    type: 'object',
    properties: {
      config: { 
        type: 'string',
        description: '简化的 YAML 配置' 
      },
      compilerPrompt: {
        type: 'string',
        description: 'Compiler Skill 的 Prompt（可选，默认加载标准版本）'
      }
    },
    required: ['config'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      prompt: { 
        type: 'string',
        description: '生成的完整 Prompt（Markdown 格式）'
      },
      stats: { 
        type: 'object',
        description: '统计信息'
      },
    },
  },
  variableBindings: {
    consumes: [
      'config',
      'compilerPrompt',
    ],
    produces: [
      'prompt',
      'stats',
    ],
  },
  version: '1.0.0',
  capabilities: ['prompt-compilation', 'config-validation', 'template-generation'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
  defaultMaxTokens: 8000,
  defaultTemperature: 0.2,
  source: 'code',
  managedByCode: true,
};
