/**
 * Prompt Compiler Skill Handler
 * 将简化的 YAML 配置编译为完整的 Skill Prompt
 *
 * 链路与其他 LLM Skill 统一：ACTIVE prompt 为 system，external spec + 配置为 user payload，
 * 经 callPrompt 获得契约解析、重试预算、telemetry 与 media 感知解析。
 */

import yaml from 'js-yaml';
import { callPrompt } from '../../composers/prompt-composer';
import { buildV4CompileSpecText } from '../../services/prompt-lab/core-compiler';

interface CompilerInput {
  config: string; // YAML 格式的简化配置
  compilerPrompt?: string; // 可选的自定义 Compiler Prompt
}

interface CompilerOutput {
  prompt: string; // 生成的完整 Prompt（Markdown）
  stats: {
    lines: number;
    rules: number;
    chars: number;
  };
  config: any; // 解析后的配置对象
}

/** 输出编译契约（external-spec）：v4 五块约定，由平台常量生成（唯一来源）。 */
function loadCompileSpec(): string {
  return buildV4CompileSpecText();
}

function buildCompileUserPayload(compileSpec: string, config: string): string {
  return `${compileSpec}

---

## 现在请编译以下配置

\`\`\`yaml
${config}
\`\`\`

请生成完整的 Skill Prompt（Markdown 格式）。严格按照上面定义的格式和规则生成。`;
}

function stripMarkdownFence(compiled: string): string {
  return compiled.replace(/^```markdown\s*\n?/, '').replace(/\n?```\s*$/, '');
}

export async function promptCompilerHandler(input: CompilerInput): Promise<CompilerOutput> {
  // 1. 验证配置格式
  let parsedConfig;
  try {
    parsedConfig = yaml.load(input.config);
  } catch (error) {
    throw new Error('YAML 格式错误: ' + (error as Error).message);
  }

  // 2. 加载输出编译契约（external-spec，v4 五块约定）
  const compileSpec = input.compilerPrompt || loadCompileSpec();

  // 3. 统一 callPrompt 链路（output.media=markdown，契约驱动解析）
  const result = await callPrompt<{ config: string }, string>({
    agentId: 'skill:prompt-compiler',
    defaultSystemPrompt: '',
    requireActivePrompt: true,
    caller: { skillId: 'prompt-compiler' },
    buildUserPayload: () => buildCompileUserPayload(compileSpec, input.config),
    validateParsedOutput: (parsed) => (
      typeof parsed === 'string' && parsed.trim().length > 0
        ? { valid: true as const }
        : { valid: false, failureReason: 'LLM 返回空结果' }
    ),
    normalizeOutput: (parsed) => stripMarkdownFence(String(parsed).trim()),
    modelDefaults: { maxTokens: 8000, temperature: 0.2 },
    retryStrategy: {
      maxAttempts: 2,
      onValidationFail: () => '上次输出为空或无效。请严格按编译约定生成完整的 Markdown Skill Prompt。',
    },
  }, { config: input.config });

  if (!result.success || !result.output) {
    throw new Error(result.error?.message || 'LLM 返回空结果');
  }
  const compiledPrompt = result.output;

  // 4. 统计信息
  const lines = compiledPrompt.split('\n').length;
  const rules = (compiledPrompt.match(/^(RULE|OUT|CON)-\d{2}:/gm) || []).length;
  const chars = compiledPrompt.length;

  // 5. 返回结果
  return {
    prompt: compiledPrompt,
    stats: {
      lines,
      rules,
      chars
    },
    config: parsedConfig
  };
}
