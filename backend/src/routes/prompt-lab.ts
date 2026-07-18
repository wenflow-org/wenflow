/**
 * Prompt Lab API Routes
 * 提供蓝图编译、Compiler Skill 等功能
 */

import { Router } from 'express';
import { rejectPromptLabFileMutation } from '../middleware/prompt-file-truth.middleware';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { randomUUID as uuidv4 } from 'crypto';
import systemPrisma from '../config/system-database';
import { getAPIGateway, CallerInfo, ChatMessage } from '../gateway/api-gateway';
import { compilePrompt } from '../services/prompt-compiler';
import { promptCache } from '../services/cache/prompt-cache.service';
import { getAgentRoutings } from '../services/field-dispatcher';
import { compilePromptLabSourceDeterministic } from '../services/prompt-lab/compiler';

const router = Router();
router.use(rejectPromptLabFileMutation);

const PROMPT_LAB_DIR = path.join(process.cwd(), '../prompt-lab');
const SOURCES_DIR = path.join(PROMPT_LAB_DIR, 'sources');
const COMPILED_DIR = path.join(PROMPT_LAB_DIR, 'compiled');
const MANIFESTS_DIR = path.join(PROMPT_LAB_DIR, 'manifests');
const BACKUPS_DIR = path.join(PROMPT_LAB_DIR, 'backups');
const PROMPTS_DIR = path.join(process.cwd(), '../prompts');

type PromptLabManifest = {
  version: string;
  skillId: string;
  agentId: string;
  name: string;
  archetype: string;
  description: string;
  acceptableAgentIds: string[];
  publish: {
    enabled: boolean;
    exportTargets: string[];
  };
  runtimeDefaults: {
    tier: string;
    temperature: number;
    maxTokens: number;
    model: string | null;
    thinkingMode: string;
    reasoningEffort: string;
  };
  ownership: {
    tier: string;
    visibility: string;
  };
  tags: string[];
  notes: string;
};

function sortSkillList(list: { id: string; name: string; file: string; existsInLab?: boolean; hasManifest?: boolean }[]) {
  return list.sort((a, b) => a.id.localeCompare(b.id, 'en'))
}

function looksLikeMojibake(value: unknown) {
  if (typeof value !== 'string') return false;
  return /[�鍔浣瀛韬唤璺緞]/.test(value);
}

function sanitizeString(value: unknown, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || looksLikeMojibake(trimmed)) return fallback;
  return trimmed;
}

function sanitizeStringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  const next = value
    .map((item) => sanitizeString(item, ''))
    .filter(Boolean);
  return Array.from(new Set(next));
}

function isSupportedExportTarget(value: string) {
  return value === 'platform-prompts';
}

function assertValidSkillId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('skillId 必须是字符串');
  }
  const skillId = value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(skillId)) {
    throw new Error(`非法 skillId: ${value}`);
  }
  return skillId;
}

function sanitizeNumber(value: unknown, fallback: number, min?: number, max?: number) {
  const next = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (min !== undefined && next < min) return fallback;
  if (max !== undefined && next > max) return fallback;
  return next;
}

function inferArchetype(skillId: string, sourceContent = '') {
  if (/^##\s+Stages$/m.test(sourceContent) || /^##\s+Stage Logic$/m.test(sourceContent)) {
    return 'conversational';
  }
  if (/extractor/i.test(skillId)) return 'extractor';
  if (/distiller|inference/i.test(skillId)) return 'distiller';
  if (/copy|label-generator/i.test(skillId)) return 'copywriter';
  return 'generator';
}

function buildDefaultManifest(skillId: string, sourceContent = ''): PromptLabManifest {
  return {
    version: 'prompt-lab-manifest/v1',
    skillId,
    agentId: `skill:${skillId}`,
    name: `default-skill-${skillId}`,
    archetype: inferArchetype(skillId, sourceContent),
    description: '',
    acceptableAgentIds: [],
    publish: {
      enabled: true,
      exportTargets: ['platform-prompts']
    },
    runtimeDefaults: {
      tier: 'chat',
      temperature: 0.7,
      maxTokens: 8000,
      model: null,
      thinkingMode: 'default',
      reasoningEffort: 'default'
    },
    ownership: {
      tier: 'production',
      visibility: 'internal'
    },
    tags: [],
    notes: ''
  };
}

function normalizeManifest(skillId: string, manifestInput: any, sourceContent = ''): PromptLabManifest {
  const base = buildDefaultManifest(skillId, sourceContent);
  const manifest = manifestInput && typeof manifestInput === 'object' ? manifestInput : {};
  const runtimeDefaults = manifest.runtimeDefaults && typeof manifest.runtimeDefaults === 'object'
    ? manifest.runtimeDefaults
    : {};
  const publish = manifest.publish && typeof manifest.publish === 'object'
    ? manifest.publish
    : {};
  const ownership = manifest.ownership && typeof manifest.ownership === 'object'
    ? manifest.ownership
    : {};

  return {
    version: sanitizeString(manifest.version, base.version),
    skillId,
    agentId: sanitizeString(manifest.agentId, `skill:${skillId}`),
    name: sanitizeString(manifest.name, base.name),
    archetype: sanitizeString(manifest.archetype, base.archetype),
    description: sanitizeString(manifest.description, ''),
    acceptableAgentIds: sanitizeStringArray(manifest.acceptableAgentIds, base.acceptableAgentIds),
    publish: {
      enabled: typeof publish.enabled === 'boolean' ? publish.enabled : true,
      exportTargets: sanitizeStringArray(publish.exportTargets, ['platform-prompts']).filter(isSupportedExportTarget)
    },
    runtimeDefaults: {
      tier: ['chat', 'reasoning', 'light'].includes(sanitizeString(runtimeDefaults.tier, base.runtimeDefaults.tier))
        ? sanitizeString(runtimeDefaults.tier, base.runtimeDefaults.tier)
        : base.runtimeDefaults.tier,
      temperature: sanitizeNumber(runtimeDefaults.temperature, base.runtimeDefaults.temperature, 0, 2),
      maxTokens: sanitizeNumber(runtimeDefaults.maxTokens, base.runtimeDefaults.maxTokens, 1000, 64000),
      model: sanitizeString(runtimeDefaults.model, '') || null,
      thinkingMode: sanitizeString(runtimeDefaults.thinkingMode, base.runtimeDefaults.thinkingMode),
      reasoningEffort: sanitizeString(runtimeDefaults.reasoningEffort, base.runtimeDefaults.reasoningEffort)
    },
    ownership: {
      tier: sanitizeString(ownership.tier, base.ownership.tier),
      visibility: sanitizeString(ownership.visibility, base.ownership.visibility)
    },
    tags: sanitizeStringArray(manifest.tags, []),
    notes: typeof manifest.notes === 'string' ? manifest.notes.trim() : ''
  };
}

function serializeManifest(manifest: PromptLabManifest) {
  const ordered = {
    version: manifest.version,
    skillId: manifest.skillId,
    agentId: manifest.agentId,
    name: manifest.name,
    archetype: manifest.archetype,
    description: manifest.description,
    acceptableAgentIds: manifest.acceptableAgentIds,
    publish: manifest.publish,
    runtimeDefaults: manifest.runtimeDefaults,
    ownership: manifest.ownership,
    tags: manifest.tags,
    notes: manifest.notes
  };
  return yaml.dump(ordered, { lineWidth: -1, noRefs: true }).trimEnd() + '\n';
}

async function loadSourceContent(skillId: string) {
  const filePath = path.join(SOURCES_DIR, `${skillId}.md`);
  return fs.readFile(filePath, 'utf-8');
}

async function loadPromptFrontmatter(skillId: string) {
  const filePath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const parsed = yaml.load(match[1]) || {};
    return parsed && typeof parsed === 'object' ? parsed as any : null;
  } catch {
    return null;
  }
}

function mergeManifestWithPromptFrontmatter(skillId: string, manifest: PromptLabManifest, frontmatter: any, sourceContent = '') {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return manifest;
  }
  return normalizeManifest(skillId, {
    ...manifest,
    agentId: sanitizeString(frontmatter.agentId, manifest.agentId),
    name: sanitizeString(frontmatter.name, manifest.name),
    archetype: sanitizeString(frontmatter.archetype, manifest.archetype),
    description: sanitizeString(frontmatter.description, manifest.description),
    acceptableAgentIds: Array.isArray(frontmatter.acceptableAgentIds)
      ? frontmatter.acceptableAgentIds
      : manifest.acceptableAgentIds,
    runtimeDefaults: {
      ...manifest.runtimeDefaults,
      tier: manifest.runtimeDefaults.tier,
      temperature: typeof frontmatter.temperature === 'number' ? frontmatter.temperature : manifest.runtimeDefaults.temperature,
      maxTokens: typeof frontmatter.maxTokens === 'number' ? frontmatter.maxTokens : manifest.runtimeDefaults.maxTokens,
      model: sanitizeString(frontmatter.model, '') || manifest.runtimeDefaults.model,
      thinkingMode: sanitizeString(frontmatter.thinkingMode, manifest.runtimeDefaults.thinkingMode),
      reasoningEffort: sanitizeString(frontmatter.reasoningEffort, manifest.runtimeDefaults.reasoningEffort)
    }
  }, sourceContent);
}

async function loadManifest(skillId: string, sourceContent = '') {
  const filePath = path.join(MANIFESTS_DIR, `${skillId}.yaml`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = yaml.load(raw) || {};
    return {
      exists: true,
      filePath,
      manifest: normalizeManifest(skillId, parsed, sourceContent)
    };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      const promptFrontmatter = await loadPromptFrontmatter(skillId);
      const migrated = mergeManifestWithPromptFrontmatter(
        skillId,
        buildDefaultManifest(skillId, sourceContent),
        promptFrontmatter,
        sourceContent
      );
      return {
        exists: false,
        filePath,
        manifest: migrated
      };
    }
    throw error;
  }
}

async function writeManifest(skillId: string, manifestInput: any, sourceContent = '') {
  const manifest = normalizeManifest(skillId, manifestInput, sourceContent);
  const filePath = path.join(MANIFESTS_DIR, `${skillId}.yaml`);
  await fs.mkdir(MANIFESTS_DIR, { recursive: true });
  await fs.writeFile(filePath, serializeManifest(manifest), 'utf-8');
  return manifest;
}

async function getPlatformReasoningDefaultModel() {
  try {
    const row = await systemPrisma.platform_api_configs.findFirst({
      select: { defaultReasoningModel: true }
    });
    return sanitizeString(row?.defaultReasoningModel, '') || null;
  } catch {
    return null;
  }
}

async function resolveCompileRoutingKey(agentId: string, skillId: string) {
  const candidates = Array.from(new Set([
    agentId,
    skillId,
    agentId.startsWith('skill:') ? agentId.slice(6) : ''
  ].filter(Boolean)));

  for (const candidate of candidates) {
    const routings = await getAgentRoutings(candidate);
    if (routings.length > 0) {
      return candidate;
    }
  }

  return agentId;
}

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
      temperature: 0.2
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
    const sourceFiles = await fs.readdir(SOURCES_DIR).catch(() => [] as string[]);
    const manifestFiles = await fs.readdir(MANIFESTS_DIR).catch(() => [] as string[]);

    const sourceIds = sourceFiles
      .filter((f: string) => f.endsWith('.md'))
      .map((f: string) => f.replace('.md', ''));

    const manifestIds = manifestFiles
      .filter((f: string) => f.endsWith('.yaml') && !f.startsWith('_'))
      .map((f: string) => f.replace(/\.yaml$/, ''));

    const mergedIds = Array.from(new Set([...sourceIds, ...manifestIds]));
    const list = sortSkillList(mergedIds.map((id) => ({
      id,
      name: id,
      file: `${id}.md`,
      existsInLab: sourceIds.includes(id),
      hasManifest: manifestIds.includes(id)
    })));

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
    const skillId = assertValidSkillId(req.params.skillId);
    const filePath = path.join(SOURCES_DIR, `${skillId}.md`);
    
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
 * PUT /api/prompt-lab/source/:skillId
 * 保存源文件内容
 */
router.put('/source/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const { content } = req.body || {};

    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: '缺少有效的源文件内容' });
    }

    const filePath = path.join(SOURCES_DIR, `${skillId}.md`);

    await fs.mkdir(SOURCES_DIR, { recursive: true });
    await fs.writeFile(filePath, content.trim() + '\n', 'utf-8');

    res.json({ success: true, data: content.trim() + '\n' });
  } catch (error) {
    res.status(500).json({ error: '保存失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/manifest/:skillId
 * 获取 Prompt Lab manifest
 */
router.get('/manifest/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    let sourceContent = '';
    try {
      sourceContent = await loadSourceContent(skillId);
    } catch {
      // ignore missing source, manifest 仍可独立存在
    }

    const { exists, manifest } = await loadManifest(skillId, sourceContent);
    res.json({ success: true, exists, data: manifest });
  } catch (error) {
    res.status(500).json({ error: '读取 manifest 失败', details: (error as Error).message });
  }
});

/**
 * PUT /api/prompt-lab/manifest/:skillId
 * 保存 Prompt Lab manifest
 */
router.put('/manifest/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const incoming = req.body?.manifest ?? req.body ?? {};
    let sourceContent = '';
    try {
      sourceContent = await loadSourceContent(skillId);
    } catch {
      // allow manifest-only save
    }

    const { manifest: currentManifest } = await loadManifest(skillId, sourceContent);
    const nextManifest = {
      ...currentManifest,
      ...incoming,
      publish: {
        ...currentManifest.publish,
        ...(incoming.publish || {})
      },
      runtimeDefaults: {
        ...currentManifest.runtimeDefaults,
        ...(incoming.runtimeDefaults || {})
      },
      ownership: {
        ...currentManifest.ownership,
        ...(incoming.ownership || {})
      },
      acceptableAgentIds: incoming.acceptableAgentIds ?? currentManifest.acceptableAgentIds,
      tags: incoming.tags ?? currentManifest.tags,
      notes: incoming.notes ?? currentManifest.notes
    };

    const savedManifest = await writeManifest(skillId, nextManifest, sourceContent);
    res.json({ success: true, data: savedManifest });
  } catch (error) {
    res.status(500).json({ error: '保存 manifest 失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/source/:skillId/create
 * 创建源文件模板
 */
router.post('/source/:skillId/create', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const filePath = path.join(SOURCES_DIR, `${skillId}.md`);
    
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
    
    await fs.mkdir(SOURCES_DIR, { recursive: true });
    await fs.writeFile(filePath, template, 'utf-8');

    const existingManifest = await loadManifest(skillId, template);
    if (!existingManifest.exists) {
      await writeManifest(skillId, existingManifest.manifest, template);
    }

    res.json({ success: true, message: '源文件模板已创建', skillId, manifestCreated: !existingManifest.exists });
  } catch (error) {
    res.status(500).json({ error: '创建失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/params/:skillId
 * 从 Prompt Lab manifest 读取 skill 运行参数
 */
router.get('/params/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    let sourceContent = '';
    try {
      sourceContent = await loadSourceContent(skillId);
    } catch {
      // allow params on manifest-only skill
    }

    const { exists, manifest } = await loadManifest(skillId, sourceContent);

    res.json({
      success: true,
      data: {
        tier: manifest.runtimeDefaults.tier,
        temperature: manifest.runtimeDefaults.temperature,
        maxTokens: manifest.runtimeDefaults.maxTokens,
        model: manifest.runtimeDefaults.model,
        thinkingMode: manifest.runtimeDefaults.thinkingMode,
        reasoningEffort: manifest.runtimeDefaults.reasoningEffort,
        manifestExists: exists
      },
      manifest: {
        skillId: manifest.skillId,
        agentId: manifest.agentId,
        archetype: manifest.archetype,
        name: manifest.name,
        description: manifest.description
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
    const skillId = assertValidSkillId(req.body?.skillId);

    let sourceContent: string;
    try {
      sourceContent = await loadSourceContent(skillId);
    } catch {
      return res.status(404).json({ 
        error: `源文件不存在: ${skillId}` 
      });
    }

    const { exists: manifestExists, manifest } = await loadManifest(skillId, sourceContent);

    const compileResult = compilePromptLabSourceDeterministic(sourceContent, {
      skillId: manifest.skillId,
      agentId: manifest.agentId,
      name: manifest.name,
      archetype: manifest.archetype,
      description: manifest.description
    });
    const compiledPrompt = compileResult.prompt;

    // 纯 Dry Run：只返回内存编译结果，不写服务器文件或 DB。
    res.json({
      success: true,
      skillId,
      prompt: compiledPrompt,
      stats: compileResult.stats,
      manifestExists,
      manifest,
      compiler: 'deterministic-skeleton',
      diagnostics: compileResult.diagnostics
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
 * 元数据优先来自 Prompt Lab manifests/
 */
router.post('/publish', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.body?.skillId);
    const { prompt, params } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: '缺少 skillId 或 prompt 参数' });
    }

    let sourceContent = '';
    try {
      sourceContent = await loadSourceContent(skillId);
    } catch {
      // allow publish from compiled prompt even if source is missing, using manifest/defaults
    }

    const loadedManifest = await loadManifest(skillId, sourceContent);
    const currentManifest = loadedManifest.manifest;

    const nextManifest = normalizeManifest(skillId, {
      ...currentManifest,
      runtimeDefaults: {
        ...currentManifest.runtimeDefaults,
        tier: params?.tier ?? currentManifest.runtimeDefaults.tier,
        temperature: params?.temperature ?? currentManifest.runtimeDefaults.temperature,
        maxTokens: params?.maxTokens ?? currentManifest.runtimeDefaults.maxTokens,
        model: params?.model ?? currentManifest.runtimeDefaults.model,
        thinkingMode: params?.thinkingMode ?? currentManifest.runtimeDefaults.thinkingMode,
        reasoningEffort: params?.reasoningEffort ?? currentManifest.runtimeDefaults.reasoningEffort
      }
    }, sourceContent);

    if (!nextManifest.publish.enabled) {
      return res.status(400).json({ error: `当前 manifest 禁止发布: ${skillId}` });
    }

    if (!nextManifest.publish.exportTargets.includes('platform-prompts')) {
      return res.status(400).json({ error: `当前 manifest 未声明 platform-prompts 导出目标: ${skillId}` });
    }

    await writeManifest(skillId, nextManifest, sourceContent);

    const prodPath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
    const agentId = nextManifest.agentId;
    const name = nextManifest.name;
    const archetype = nextManifest.archetype;
    const temperature = nextManifest.runtimeDefaults.temperature;
    const maxTokens = nextManifest.runtimeDefaults.maxTokens;
    const model = nextManifest.runtimeDefaults.model;
    const tier = nextManifest.runtimeDefaults.tier || 'chat';
    const thinkingMode = nextManifest.runtimeDefaults.thinkingMode;
    const reasoningEffort = nextManifest.runtimeDefaults.reasoningEffort;
    const description = nextManifest.description || `${name} Skill`;

    // 2. 查最新 version
    const latest = await systemPrisma.agent_prompts.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: { version: true }
    });
    const newVersion = (latest?.version ?? 0) + 1;

    // 3. 备份当前生产文件
    const now = new Date().toISOString();
    const backupsDir = path.join(BACKUPS_DIR, skillId);
    try {
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = now.replace(/[:.]/g, '-');
      await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
    } catch {
      // 备份失败不阻塞
    }

    // 4. 写回 prompts/
    const frontmatter: any = {
      agentId,
      name,
      archetype,
      description,
      temperature,
      maxTokens
    };
    if (nextManifest.acceptableAgentIds.length > 0) {
      frontmatter.acceptableAgentIds = nextManifest.acceptableAgentIds;
    }
    if (model) {
      frontmatter.model = model;
    }
    if (thinkingMode && thinkingMode !== 'default') {
      frontmatter.thinkingMode = thinkingMode;
    }
    if (reasoningEffort && reasoningEffort !== 'default') {
      frontmatter.reasoningEffort = reasoningEffort;
    }

    const frontmatterYaml = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trimEnd();
    await fs.writeFile(prodPath, `---\n${frontmatterYaml}\n---\n\n${prompt.trim()}\n`, 'utf-8');

    const compileRoutingKey = await resolveCompileRoutingKey(agentId, skillId);
    const effectiveModel = tier === 'reasoning' && !model
      ? (await getPlatformReasoningDefaultModel()) || null
      : model;
    const compileResult = await compilePrompt(prompt.trim(), compileRoutingKey);

    // 5. 创建 DB ACTIVE 版本
    const promptId = uuidv4();
    await systemPrisma.agent_prompts.create({
      data: {
        id: promptId,
        agentId,
        name: `${name} v${newVersion}`,
        systemPrompt: prompt.trim(),
        compiledSystemPrompt: compileResult.compiled,
        compileStatus: compileResult.status,
        compileError: compileResult.error || null,
        sourceHash: compileResult.sourceHash,
        compileContextHash: compileResult.compileContextHash,
        compiledAt: new Date(),
        status: 'ACTIVE',
        version: newVersion,
        temperature,
        maxTokens,
        model: effectiveModel,
        description,
        metadata: JSON.stringify({
          promptLab: {
            source: 'prompt-lab',
            manifestVersion: nextManifest.version,
            sourceSkillId: nextManifest.skillId,
            runtimeDefaults: nextManifest.runtimeDefaults,
            exportTargets: nextManifest.publish.exportTargets,
            tags: nextManifest.tags,
            notes: nextManifest.notes
          },
          compile: {
            status: compileResult.status,
            sourceHash: compileResult.sourceHash,
            compileContextHash: compileResult.compileContextHash,
            warnings: compileResult.warnings,
            error: compileResult.error || null,
            rewritten: compileResult.rewritten,
            fieldsApplied: compileResult.fieldsApplied,
            compiledAt: new Date().toISOString()
          }
        }),
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
          tier,
          temperature,
          maxTokens,
          model: effectiveModel || null,
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
          tier,
          temperature,
          maxTokens,
          model: effectiveModel || null,
          thinkingMode,
          reasoningEffort,
          enabled: true,
          updatedAt: now
        }
      });
    }

    try {
      promptCache.clearAgentCache(agentId);
      if (agentId !== skillId) {
        promptCache.clearAgentCache(skillId);
      }
      getAPIGateway().invalidateCache(undefined, undefined, skillId);
      getAPIGateway().invalidateCache(undefined, agentId);
    } catch (cacheErr: any) {
      console.warn('Failed to invalidate prompt/gateway cache:', cacheErr?.message || cacheErr);
    }

    res.json({
      success: true,
      version: newVersion,
      agentId,
      promptId,
      manifestUpdated: true,
      compileStatus: compileResult.status,
      compileWarnings: compileResult.warnings,
      compileError: compileResult.error || null
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
