/**
 * Prompt Compiler Skill Handler
 * 将简化的 YAML 配置编译为完整的 Skill Prompt
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';
import { logger } from '../../utils/logger';

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

export async function promptCompilerHandler(input: CompilerInput): Promise<CompilerOutput> {
  // 1. 验证配置格式
  let parsedConfig;
  try {
    parsedConfig = yaml.load(input.config);
  } catch (error) {
    throw new Error('YAML 格式错误: ' + (error as Error).message);
  }

  // 2. 加载 Compiler Skill 的 Prompt
  let compilerPrompt = input.compilerPrompt;
  
  if (!compilerPrompt) {
    const compilerPromptPath = path.join(
      process.cwd(),
      '../prompt-lab/compiler-skill/compile-spec.md'
    );
    compilerPrompt = await fs.readFile(compilerPromptPath, 'utf-8');
  }

  // 3. 构造完整的输入
  const fullPrompt = `${compilerPrompt}

---

## 现在请编译以下配置

\`\`\`yaml
${input.config}
\`\`\`

请生成完整的 Skill Prompt（Markdown 格式）。严格按照上面定义的格式和规则生成。`;

  // 4. 加载 Prompt 配置
  const promptConfigService = new AgentConfigService();
  const promptConfig = await promptConfigService.getActivePrompt('skill:prompt-compiler');
  
  if (!promptConfig?.systemPrompt?.trim()) {
    logger.warn('[prompt-compiler] No active prompt config found, using inline prompt');
  }

  // 5. 构造消息
  const messages: ChatMessage[] = [
    { role: 'user', content: fullPrompt }
  ];

  // 6. 调用 Gateway
  const gateway = getAPIGateway();
  const caller: CallerInfo = { skillId: 'prompt-compiler' };
  
  const response = await gateway.execute({
    messages,
    max_tokens: promptConfig?.maxTokens || 8000,
    temperature: promptConfig?.temperature || 0.2,
    model: promptConfig?.model
  }, caller, {});

  const compiledPrompt = response.choices[0]?.message?.content || '';

  if (!compiledPrompt) {
    throw new Error('LLM 返回空结果');
  }

  // 7. 统计信息
  const lines = compiledPrompt.split('\n').length;
  const rules = (compiledPrompt.match(/^(RULE|OUT|CON)-\d{2}:/gm) || []).length;
  const chars = compiledPrompt.length;

  // 8. 返回结果
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
