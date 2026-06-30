/**
 * Prompt Lab API Routes
 * 提供蓝图编译、Compiler Skill 等功能
 */

import { Router } from 'express';
import { executeSkill } from '../skills';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import systemPrisma from '../config/system-database';
import { getAPIGateway, CallerInfo, ChatMessage } from '../gateway/api-gateway';

const router = Router();

/**
 * POST /api/prompt-lab/compile-skill
 * 使用 Compiler Skill (LLM) 编译简化配置为完整 Prompt
 */
router.post('/compile-skill', async (req, res) => {
  try {
    const { config } = req.body;

    if (!config) {
      return res.status(400).json({ error: '缺少配置参数' });
    }

    // 1. 验证配置格式
    let parsedConfig;
    try {
      parsedConfig = yaml.load(config);
    } catch (error) {
      return res.status(400).json({ error: 'YAML 格式错误', details: (error as Error).message });
    }

    // 2. 加载 Compiler Skill 的 Prompt
    const compilerPromptPath = path.join(
      process.cwd(),
      '../prompt-lab/compiler-skill/compile-spec.md'
    );
    const compilerPrompt = await fs.readFile(compilerPromptPath, 'utf-8');

    // 3. 构造完整的输入
    const fullPrompt = `${compilerPrompt}

---

## 现在请编译以下配置

\`\`\`yaml
${config}
\`\`\`

请生成完整的 Skill Prompt（Markdown 格式）。严格按照上面定义的格式和规则生成。`;

    // 4. 构造消息并调用 Gateway
    const messages: ChatMessage[] = [
      { role: 'user', content: fullPrompt }
    ];

    const gateway = getAPIGateway();
    const caller: CallerInfo = { skillId: 'prompt-compiler' };

    const response = await gateway.execute({
      messages,
      max_tokens: 8000,
      temperature: 0.2,
      model: 'deepseek-v4-pro'
    }, caller, {});

    let compiledPrompt = response.choices[0]?.message?.content || '';

    if (!compiledPrompt) {
      return res.status(500).json({ error: 'LLM 返回空结果' });
    }

    // 清理 markdown 代码块包裹
    compiledPrompt = compiledPrompt.replace(/^```markdown\s*\n?/, '').replace(/\n?```\s*$/, '')

    // 5. 统计信息
    const lines = compiledPrompt.split('\n').length;
    const rules = (compiledPrompt.match(/\*?\*?(RULE|OUT|CON|STATE)-\d{2}\*?\*?:/gm) || []).length;
    const chars = compiledPrompt.length;

    // 6. 返回结果
    res.json({
      success: true,
      prompt: compiledPrompt,
      stats: {
        lines,
        rules,
        chars
      },
      config: parsedConfig
    });

  } catch (error) {
    console.error('Compiler Skill error:', error);
    res.status(500).json({ 
      error: '编译失败', 
      details: (error as Error).message 
    });
  }
});

/**
 * GET /api/prompt-lab/sources
 * 获取所有可用源文件列表
 */
router.get('/sources', async (req, res) => {
  try {
    const sourcesDir = path.join(process.cwd(), '../prompt-lab/sources');
    const files = await fs.readdir(sourcesDir);
    const list = files
      .filter((f: string) => f.endsWith('.md'))
      .map((f: string) => ({
        id: f.replace('.md', ''),
        name: f.replace('.md', ''),
        file: f
      }));
    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ error: '读取失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/source/:skillId
 * 获取源文件内容
 */
router.get('/source/:skillId', async (req, res) => {
  try {
    const { skillId } = req.params;
    const sourcesDir = path.join(process.cwd(), '../prompt-lab/sources');
    const filePath = path.join(sourcesDir, `${skillId}.md`);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      res.json({ success: true, data: content });
    } catch {
      res.status(404).json({ error: `源文件不存在: ${skillId}` });
    }
  } catch (error) {
    res.status(500).json({ error: '读取失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/source/:skillId/create
 * 创建源文件模板
 */
router.post('/source/:skillId/create', async (req, res) => {
  try {
    const { skillId } = req.params;
    const sourcesDir = path.join(process.cwd(), '../prompt-lab/sources');
    const filePath = path.join(sourcesDir, `${skillId}.md`);
    
    // 检查文件是否已存在
    try {
      await fs.access(filePath);
      return res.status(400).json({ error: '源文件已存在' });
    } catch {
      // 文件不存在，继续创建
    }
    
    // 创建源文件模板
    const template = `# DEFINITIONS

## Identity
[角色与任务定义]

## Input
| field | type | required | description |
|-------|------|----------|-------------|
| userInput | string | yes | 用户输入 |

## Output Schema
只输出一个合法 JSON 对象。

### reply · string
回复文本。

### state · object
当前状态。

## Stages
| stage | description |
|-------|-------------|
| processing | 处理中 |
| completed | 已完成 |

---

# EXECUTION

## Format
只输出一个合法 JSON 对象。JSON 前后不得有任何前言、解释、总结、markdown 包装。

## Context Handling
根据输入上下文处理请求。

## Stage Logic
根据当前阶段执行相应逻辑。

## Output Guidance
填充所有必需字段。

## Constraints
- 不编造信息
- 保持一致性
`;
    
    await fs.writeFile(filePath, template, 'utf-8');
    res.json({ success: true, message: '源文件模板已创建', skillId });
  } catch (error) {
    res.status(500).json({ error: '创建失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/params/:skillId
 * 从生产文件 frontmatter 读取 skill 运行参数
 */
router.get('/params/:skillId', async (req, res) => {
  try {
    const { skillId } = req.params;
    const prodPath = path.join(process.cwd(), '../prompts', `skill.${skillId}.md`);
    let fm: any = {};

    try {
      const raw = await fs.readFile(prodPath, 'utf-8');
      const match = raw.match(/^---\n([\s\S]*?)\n---/);
      if (match) fm = yaml.load(match[1]) || {};
    } catch {
      // 文件不存在，返回默认值
    }

    res.json({
      success: true,
      data: {
        temperature: fm.temperature ?? 0.7,
        maxTokens: fm.maxTokens ?? 8000,
        model: fm.model || null,
        thinkingMode: fm.thinkingMode || 'default',
        reasoningEffort: fm.reasoningEffort || 'default'
      }
    });
  } catch (error) {
    res.status(500).json({ error: '读取参数失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/compile-spec
 * 获取编译约定文档
 */
router.get('/compile-spec', async (req, res) => {
  try {
    const specPath = path.join(process.cwd(), '../prompt-lab/compiler-skill/compile-spec.md');
    const content = await fs.readFile(specPath, 'utf-8');
    res.json({ success: true, data: content });
  } catch (error) {
    res.status(500).json({ error: '读取失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/compile-source
 * 基于 Lab 源文件编译为完整 Prompt
 */
router.post('/compile-source', async (req, res) => {
  try {
    const { skillId } = req.body;

    if (!skillId) {
      return res.status(400).json({ error: '缺少 skillId 参数' });
    }

    // 1. 加载源文件
    const sourcesDir = path.join(process.cwd(), '../prompt-lab/sources');
    const sourceFilePath = path.join(sourcesDir, `${skillId}.md`);
    
    let sourceContent: string;
    try {
      sourceContent = await fs.readFile(sourceFilePath, 'utf-8');
    } catch {
      return res.status(404).json({ 
        error: `源文件不存在: ${skillId}` 
      });
    }

    // 2. 加载编译规则 (compile-spec)
    const compileSpecPath = path.join(
      process.cwd(),
      '../prompt-lab/compiler-skill/compile-spec.md'
    );
    const compileSpec = await fs.readFile(compileSpecPath, 'utf-8');

    // 3. 构造 LLM 输入
    const fullPrompt = `${compileSpec}

---

## 现在请编译以下 Skill 源文件

\`\`\`markdown
${sourceContent}
\`\`\`

请严格按照编译映射规则，生成完整的 Skill Prompt（Markdown 格式）。

注意：源文件中以 ## 开头的章节和其下的结构化内容（表格、列表、JSON），
应被编译为标准 Prompt 的对应章节。措辞可润色，但结构和关键约束必须忠实保留。`;

    // 4. 调用 Gateway
    const messages: ChatMessage[] = [
      { role: 'user', content: fullPrompt }
    ];

    const gateway = getAPIGateway();
    const caller: CallerInfo = { skillId: 'prompt-compiler' };

    const response = await gateway.execute({
      messages,
      max_tokens: 8000,
      temperature: 0.2,
      model: 'deepseek-v4-pro'
    }, caller, {});

    let compiledPrompt = response.choices[0]?.message?.content || '';

    if (!compiledPrompt) {
      return res.status(500).json({ error: 'LLM 返回空结果' });
    }

    // 清理 markdown 代码块包裹
    compiledPrompt = compiledPrompt
      .replace(/^```markdown\s*\n?/, '')
      .replace(/\n?```\s*$/, '');

    // 5. 可写回 compiled/（暂不覆盖 prompts/）
    const compiledDir = path.join(process.cwd(), '../prompt-lab/compiled');
    try {
      await fs.mkdir(compiledDir, { recursive: true });
      await fs.writeFile(
        path.join(compiledDir, `${skillId}.md`),
        compiledPrompt,
        'utf-8'
      );
    } catch (saveErr) {
      console.warn('Failed to save compiled prompt:', saveErr);
    }

    // 6. 统计
    const lines = compiledPrompt.split('\n').length;
    const rules = (compiledPrompt.match(/\*?\*?(RULE|OUT|CON|STATE)-\d{2}\*?\*?:/gm) || []).length;
    const chars = compiledPrompt.length;

    res.json({
      success: true,
      skillId,
      prompt: compiledPrompt,
      stats: { lines, rules, chars }
    });

  } catch (error) {
    console.error('Source compile error:', error);
    res.status(500).json({ 
      error: '编译失败', 
      details: (error as Error).message 
    });
  }
});

/**
 * POST /api/prompt-lab/publish
 * 将编译产物发布：备份当前 → 写回 prompts/ → 创建 DB ACTIVE 版本
 */
router.post('/publish', async (req, res) => {
  try {
    const { skillId, prompt, params } = req.body;

    if (!skillId || !prompt) {
      return res.status(400).json({ error: '缺少 skillId 或 prompt 参数' });
    }

    // 1. 读当前 prompts/ 文件提取 frontmatter
    const prodPath = path.join(process.cwd(), '../prompts', `skill.${skillId}.md`);
    let frontmatter: any = {};
    try {
      const raw = await fs.readFile(prodPath, 'utf-8');
      const match = raw.match(/^---\n([\s\S]*?)\n---/);
      if (match) {
        frontmatter = yaml.load(match[1]) || {};
      }
    } catch {
      frontmatter = {
        agentId: `skill:${skillId}`,
        name: `default-skill-${skillId}`,
        temperature: 0.7,
        maxTokens: 8000
      };
    }

    const agentId = frontmatter.agentId || `skill:${skillId}`;
    const name = frontmatter.name || `default-skill-${skillId}`;
    // 允许前端覆盖参数
    const temperature = params?.temperature ?? frontmatter.temperature ?? 0.7;
    const maxTokens = params?.maxTokens ?? frontmatter.maxTokens ?? 8000;
    const model = params?.model || frontmatter.model || process.env.AI_MODEL || 'deepseek-v4-flash';
    const thinkingMode = params?.thinkingMode || frontmatter.thinkingMode || 'default';
    const reasoningEffort = params?.reasoningEffort || frontmatter.reasoningEffort || 'default';
    const description = frontmatter.description || `${name} Skill`;

    // 2. 查最新 version
    const latest = await systemPrisma.agent_prompts.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: { version: true }
    });
    const newVersion = (latest?.version ?? 0) + 1;

    // 3. 备份当前生产文件
    const now = new Date().toISOString();
    const backupsDir = path.join(process.cwd(), '../prompt-lab/backups', skillId);
    try {
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = now.replace(/[:.]/g, '-');
      await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
    } catch {
      // 备份失败不阻塞
    }

    // 4. 写回 prompts/
    const yamlLines = [
      '---',
      `agentId: ${agentId}`,
      `name: ${name}`,
      `archetype: ${frontmatter.archetype || 'conversational'}`,
      `description: ${frontmatter.description || ''}`,
      `temperature: ${temperature}`,
      `maxTokens: ${maxTokens}`,
    ];
    if (frontmatter.acceptableAgentIds?.length) {
      yamlLines.push('acceptableAgentIds:');
      frontmatter.acceptableAgentIds.forEach((a: string) => yamlLines.push(`  - ${a}`));
    }
    yamlLines.push('---', '', prompt.trim());

    await fs.writeFile(prodPath, yamlLines.join('\n') + '\n', 'utf-8');

    // 5. 创建 DB ACTIVE 版本
    const promptId = uuidv4();
    await systemPrisma.agent_prompts.create({
      data: {
        id: promptId,
        agentId,
        name: `${name} v${newVersion}`,
        systemPrompt: prompt.trim(),
        status: 'ACTIVE',
        version: newVersion,
        temperature,
        maxTokens,
        model,
        description,
        publishedAt: new Date(),
        createdBy: 'prompt-lab'
      }
    });

    // 旧 ACTIVE → ARCHIVED
    await systemPrisma.agent_prompts.updateMany({
      where: { agentId, status: 'ACTIVE', id: { not: promptId } },
      data: { status: 'ARCHIVED' }
    });

    // 6. 同步到 skill_model_configs（agent-registry 看到的参数）
    const existingCfg = await systemPrisma.skill_model_configs.findFirst({
      where: { skillId }
    });
    if (existingCfg) {
      await systemPrisma.skill_model_configs.update({
        where: { id: existingCfg.id },
        data: {
          temperature,
          maxTokens,
          model: model || null,
          thinkingMode,
          reasoningEffort,
          updatedAt: new Date().toISOString()
        }
      });
    } else {
      const now = new Date().toISOString();
      await systemPrisma.skill_model_configs.create({
        data: {
          id: uuidv4(),
          skillId,
          temperature,
          maxTokens,
          model,
          thinkingMode,
          reasoningEffort,
          enabled: true,
          updatedAt: now
        }
      });
    }

    res.json({
      success: true,
      version: newVersion,
      agentId,
      promptId
    });

  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({
      error: '发布失败',
      details: (error as Error).message
    });
  }
});

/**
 * GET /api/prompt-lab/examples
 * 获取示例配置列表
 */
router.get('/examples', async (req, res) => {
  try {
    const examplesDir = path.join(
      process.cwd(),
      '../prompt-lab/compiler-skill/examples'
    );

    // 如果目录不存在，返回内置示例
    const builtInExamples = [
      {
        id: 'simple-qa',
        name: '简单问答助手',
        archetype: 'conversational',
        description: '最简单的问答 Skill'
      },
      {
        id: 'content-generator',
        name: '内容生成器',
        archetype: 'generator',
        description: '生成结构化内容'
      },
      {
        id: 'goal-conversation',
        name: '目标对话',
        archetype: 'conversational',
        description: '学习目标澄清助手'
      }
    ];

    res.json({
      success: true,
      examples: builtInExamples
    });

  } catch (error) {
    console.error('Get examples error:', error);
    res.status(500).json({ 
      error: '获取示例失败', 
      details: (error as Error).message 
    });
  }
});

/**
 * POST /api/prompt-lab/validate-config
 * 验证简化配置格式
 */
router.post('/validate-config', async (req, res) => {
  try {
    const { config } = req.body;

    if (!config) {
      return res.status(400).json({ error: '缺少配置参数' });
    }

    // 1. 解析 YAML
    let parsedConfig;
    try {
      parsedConfig = yaml.load(config);
    } catch (error) {
      return res.json({
        valid: false,
        errors: [
          {
            field: 'yaml',
            message: 'YAML 格式错误: ' + (error as Error).message
          }
        ]
      });
    }

    // 2. 验证必需字段
    const errors = [];

    if (!parsedConfig.meta) {
      errors.push({ field: 'meta', message: '缺少 meta 字段' });
    } else {
      if (!parsedConfig.meta.id) {
        errors.push({ field: 'meta.id', message: '缺少 id' });
      }
      if (!parsedConfig.meta.name) {
        errors.push({ field: 'meta.name', message: '缺少 name' });
      }
      if (!parsedConfig.meta.archetype) {
        errors.push({ field: 'meta.archetype', message: '缺少 archetype' });
      }
    }

    if (!parsedConfig.structure) {
      errors.push({ field: 'structure', message: '缺少 structure 字段' });
    } else {
      if (!parsedConfig.structure.variables || !Array.isArray(parsedConfig.structure.variables)) {
        errors.push({ field: 'structure.variables', message: 'variables 必须是数组' });
      }
      if (!parsedConfig.structure.output) {
        errors.push({ field: 'structure.output', message: '缺少 output 定义' });
      }
    }

    if (!parsedConfig.behavior) {
      errors.push({ field: 'behavior', message: '缺少 behavior 字段' });
    } else {
      if (!parsedConfig.behavior.key_behaviors || !Array.isArray(parsedConfig.behavior.key_behaviors)) {
        errors.push({ field: 'behavior.key_behaviors', message: 'key_behaviors 必须是数组' });
      }
    }

    // 3. 返回验证结果
    res.json({
      valid: errors.length === 0,
      errors,
      config: parsedConfig
    });

  } catch (error) {
    console.error('Validate config error:', error);
    res.status(500).json({ 
      error: '验证失败', 
      details: (error as Error).message 
    });
  }
});

export default router;
