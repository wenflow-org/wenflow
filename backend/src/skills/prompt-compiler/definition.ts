import { RuntimeDefinitionRecord } from '../../composers/definitions/types';
import { SkillDefinition } from '../protocol';

const promptCompilerInputSchema = {
  type: 'object' as const,
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
  required: ['config']
};

const promptCompilerOutputSchema = {
  type: 'object' as const,
  properties: {
    prompt: {
      type: 'string',
      description: '生成的完整 Prompt（Markdown 格式）'
    },
    stats: {
      type: 'object',
      description: '统计信息'
    }
  }
};

export const promptCompilerDefinition: SkillDefinition = {
  name: 'prompt-compiler',
  displayName: 'Prompt 编译器',
  version: '1.0.0',
  category: 'generation',
  description: '将简化的 YAML 配置编译为完整的 Skill Prompt（Markdown 格式）',
  status: 'working',
  inputSchema: promptCompilerInputSchema,
  outputSchema: promptCompilerOutputSchema,
  capabilities: ['prompt-compilation', 'config-validation', 'template-generation'],
  stats: {
    callCount: 0,
    successRate: 1,
    avgLatency: 0,
  },
};

export const promptCompilerRuntimeDefinition: RuntimeDefinitionRecord = {
  id: 'skill:prompt-compiler',
  displayName: 'Prompt 编译器',
  description: '将简化的 YAML 配置编译为完整的 Skill Prompt（Markdown 格式）',
  category: 'skill',
  inputSchema: promptCompilerInputSchema,
  outputSchema: promptCompilerOutputSchema,
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
  capabilities: ['prompt-compilation', 'config-validation', 'template-generation'],
  defaultMaxTokens: 8000,
  defaultTemperature: 0.2,
  source: 'code',
  managedByCode: true,
};
