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
import { getAPIGateway } from '../gateway/api-gateway';
import { executeSkill } from '../skills';
import { compilePrompt } from '../services/prompt-compiler';
import { promptCache } from '../services/cache/prompt-cache.service';
import { getAgentRoutings } from '../services/field-dispatcher';
import {
  buildDefaultRuntimeContract,
  normalizeRuntimeContract,
  type RuntimeContract,
} from '../services/prompt-lab/runtime-contract';
import {
  buildDefaultSkillPromptContract,
  normalizeSkillPromptContract,
  type SkillPromptContract,
} from '../services/skill-prompt-contract';
import { parsePromptFrontmatterMeta } from '../composers/prompt-files/loader';
import {
  compileCoreFile,
  checkFiveBlockStructure,
  checkFieldFreeze,
  buildV4CompileSpecText,
} from '../services/prompt-lab/core-compiler';
import { loadCoreFile, scanCoreFiles, computeCoreHash, parseCoreFile, CORE_FILES_DIR } from '../services/prompt-lab/core-file-loader';
import { getFieldLineage, classifyCoreEdit } from '../services/prompt-lab/field-lineage';
import {
  judgeSemanticFreeze,
  decideSemanticGate,
  type SemanticFreezeJudgement,
} from '../services/prompt-lab/semantic-freeze-judge';

const router = Router();
router.use(rejectPromptLabFileMutation);

const PROMPT_LAB_DIR = path.join(process.cwd(), '../prompt-lab');
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
  runtimeContract: RuntimeContract;
  promptContract: SkillPromptContract;
  ownership: {
    tier: string;
    visibility: string;
  };
  tags: string[];
  notes: string;
};

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
  const archetype = inferArchetype(skillId, sourceContent);
  return {
    version: 'prompt-lab-manifest/v1',
    skillId,
    agentId: `skill:${skillId}`,
    name: `default-skill-${skillId}`,
    archetype,
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
    runtimeContract: buildDefaultRuntimeContract(skillId, archetype),
    promptContract: buildDefaultSkillPromptContract({ skillId, archetype }),
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
  const runtimeContract = manifest.runtimeContract && typeof manifest.runtimeContract === 'object'
    ? manifest.runtimeContract
    : {};
  const promptContract = manifest.promptContract && typeof manifest.promptContract === 'object'
    ? manifest.promptContract
    : {};
  const publish = manifest.publish && typeof manifest.publish === 'object'
    ? manifest.publish
    : {};
  const ownership = manifest.ownership && typeof manifest.ownership === 'object'
    ? manifest.ownership
    : {};

  const normalizedRuntimeContract = normalizeRuntimeContract(runtimeContract, {
    skillId,
    archetype: sanitizeString(manifest.archetype, base.archetype),
  });
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
    runtimeContract: normalizedRuntimeContract,
    promptContract: normalizeSkillPromptContract(promptContract, {
      skillId,
      archetype: sanitizeString(manifest.archetype, base.archetype),
      runtimeContract: normalizedRuntimeContract,
    }),
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
    runtimeContract: manifest.runtimeContract,
    promptContract: manifest.promptContract,
    ownership: manifest.ownership,
    tags: manifest.tags,
    notes: manifest.notes
  };
  return yaml.dump(ordered, { lineWidth: -1, noRefs: true }).trimEnd() + '\n';
}

async function loadPromptFrontmatter(skillId: string) {
  const filePath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const meta = parsePromptFrontmatterMeta(raw);
    return Object.keys(meta).length > 0 ? meta as any : null;
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
    },
    runtimeContract: frontmatter.runtimeContract && typeof frontmatter.runtimeContract === 'object'
      ? frontmatter.runtimeContract
      : manifest.runtimeContract,
    promptContract: frontmatter.promptContract && typeof frontmatter.promptContract === 'object'
      ? frontmatter.promptContract
      : manifest.promptContract
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
 * 链路统一：委托 executeSkill -> prompt-compiler handler -> callPrompt
 */
router.post('/compile-skill', async (req, res) => {
  try {
    const { config } = req.body;

    if (!config) {
      return res.status(400).json({ error: '缺少配置参数' });
    }

    // 1. 验证配置格式（保持 400 语义；handler 内会再次解析）
    let parsedConfig;
    try {
      parsedConfig = yaml.load(config);
    } catch (error) {
      return res.status(400).json({ error: 'YAML 格式错误', details: (error as Error).message });
    }

    // 2. 统一 Skill 链路：ACTIVE prompt + external-spec + 契约解析 + 重试 + telemetry
    const output = await executeSkill({ id: 'skill:prompt-compiler' }, { config });
    let compiledPrompt = output?.prompt || '';

    if (!compiledPrompt) {
      return res.status(500).json({ error: 'LLM 返回空结果' });
    }

    // 清理 markdown 代码块包裹（handler 已剥离，此处幂等）
    compiledPrompt = compiledPrompt.replace(/^```markdown\s*\n?/, '').replace(/\n?```\s*$/, '')

    // 3. 统计信息
    const lines = compiledPrompt.split('\n').length;
    const rules = (compiledPrompt.match(/\*?\*?(RULE|OUT|CON|STATE)-\d{2}\*?\*?:/gm) || []).length;
    const chars = compiledPrompt.length;

    // 4. 返回结果
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
 * GET /api/prompt-lab/manifest/:skillId
 * 获取 Prompt Lab manifest
 */
router.get('/manifest/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const { exists, manifest } = await loadManifest(skillId, '');
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

    const { manifest: currentManifest } = await loadManifest(skillId, '');
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
      runtimeContract: {
        ...currentManifest.runtimeContract,
        ...(incoming.runtimeContract || {}),
        businessState: {
          ...currentManifest.runtimeContract.businessState,
          ...(incoming.runtimeContract?.businessState || {})
        },
        contextUpdate: {
          ...currentManifest.runtimeContract.contextUpdate,
          ...(incoming.runtimeContract?.contextUpdate || {})
        }
      },
      promptContract: {
        ...currentManifest.promptContract,
        ...(incoming.promptContract || {}),
        input: {
          ...currentManifest.promptContract.input,
          ...(incoming.promptContract?.input || {})
        },
        output: {
          ...currentManifest.promptContract.output,
          ...(incoming.promptContract?.output || {})
        },
        context: {
          ...currentManifest.promptContract.context,
          ...(incoming.promptContract?.context || {})
        }
      },
      ownership: {
        ...currentManifest.ownership,
        ...(incoming.ownership || {})
      },
      acceptableAgentIds: incoming.acceptableAgentIds ?? currentManifest.acceptableAgentIds,
      tags: incoming.tags ?? currentManifest.tags,
      notes: incoming.notes ?? currentManifest.notes
    };

    const savedManifest = await writeManifest(skillId, nextManifest, '');
    res.json({ success: true, data: savedManifest });
  } catch (error) {
    res.status(500).json({ error: '保存 manifest 失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/compile-spec
 * 获取编译约定文档（v4 五块约定，由平台常量生成）
 */
router.get('/compile-spec', async (req, res) => {
  try {
    res.json({ success: true, data: buildV4CompileSpecText() });
  } catch (error) {
    res.status(500).json({ error: '读取失败', details: (error as Error).message });
  }
});

/** v4：查询某 agentId 的下一个 coreVersion（无历史则从 1 起） */
async function nextCoreVersion(agentId: string): Promise<number> {
  const latest = await systemPrisma.agent_prompts.findFirst({
    where: { agentId, coreVersion: { not: null } },
    orderBy: { coreVersion: 'desc' },
    select: { coreVersion: true }
  });
  return (latest?.coreVersion ?? 0) + 1;
}

/** v4：读取核心文件原文（judge 对账用 SSOT 文本） */
async function readCoreText(skillId: string): Promise<string> {
  return fs.readFile(path.join(CORE_FILES_DIR, `${skillId}.yaml`), 'utf-8');
}

/** v4：守门第三查（含义冻结）。skip 时返回 null；判定失败按 uncertain 处理 */
async function runSemanticGate(
  skillId: string,
  candidateText: string,
  skip: boolean
): Promise<SemanticFreezeJudgement | null> {
  if (skip) return null;
  const coreText = await readCoreText(skillId);
  return judgeSemanticFreeze({ skillId, coreText, candidateText });
}

/**
 * POST /api/prompt-lab/compile-core
 * v4：核心文件（prompts/core/<skillId>.yaml）确定性编译预览（dry run，不写文件/DB）
 * 守门：结构合法 + 字段冻结 + 含义冻结（semanticJudge:false 可跳过第三查）
 */
router.post('/compile-core', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.body?.skillId);
    const loaded = loadCoreFile(skillId);
    if (!loaded) {
      return res.status(404).json({ error: `核心文件不存在: prompts/core/${skillId}.yaml` });
    }
    if (!loaded.core) {
      return res.status(400).json({ error: '核心文件 schema 不合法', diagnostics: loaded.diagnostics });
    }

    const coreVersion = await nextCoreVersion(`skill:${skillId}`);
    const compiled = compileCoreFile(loaded.core, { coreVersion });
    const gates: Record<string, unknown> = {
      structure: checkFiveBlockStructure(compiled.prompt),
      fieldFreeze: checkFieldFreeze(loaded.core, compiled.prompt)
    };
    const semantic = await runSemanticGate(skillId, compiled.prompt, req.body?.semanticJudge === false);
    if (semantic) {
      gates.semantic = semantic;
      gates.semanticDecision = decideSemanticGate(semantic, { confirmUncertain: req.body?.confirmUncertain === true });
    }

    res.json({
      success: true,
      skillId,
      compiler: 'core-deterministic-v4',
      prompt: compiled.prompt,
      coreHash: compiled.coreHash,
      coreVersion: compiled.coreVersion,
      gates,
      gatePassed:
        (gates.structure as unknown[]).length === 0 &&
        (gates.fieldFreeze as unknown[]).length === 0 &&
        (!semantic || decideSemanticGate(semantic, { confirmUncertain: req.body?.confirmUncertain === true }) === 'pass')
    });
  } catch (error) {
    console.error('Core compile error:', error);
    res.status(500).json({ error: '编译失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/publish-core
 * v4：核心文件 → 确定性编译 → 守门检查 → 发布
 * 备份当前 → 写回 prompts/skill.<id>.md → 创建 DB ACTIVE 版本（携带 coreHash/coreVersion）
 * 说明：v4 产物为确定性渲染，不经 compilePrompt LLM 改写；不回写 skill_model_configs（路由配置不动）
 */
router.post('/publish-core', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.body?.skillId);
    const loaded = loadCoreFile(skillId);
    if (!loaded) {
      return res.status(404).json({ error: `核心文件不存在: prompts/core/${skillId}.yaml` });
    }
    if (!loaded.core) {
      return res.status(400).json({ error: '核心文件 schema 不合法', diagnostics: loaded.diagnostics });
    }
    const core = loaded.core;
    const agentId = `skill:${skillId}`;

    const coreVersion = await nextCoreVersion(agentId);
    const compiled = compileCoreFile(core, { coreVersion });
    const gates: Record<string, unknown> = {
      structure: checkFiveBlockStructure(compiled.prompt),
      fieldFreeze: checkFieldFreeze(core, compiled.prompt)
    };
    const structuralIssues = [
      ...(gates.structure as Array<unknown>),
      ...(gates.fieldFreeze as Array<unknown>)
    ];
    if (structuralIssues.length > 0) {
      return res.status(422).json({ error: '守门检查未通过，已阻断发布', gates, issues: structuralIssues });
    }

    // 守门第三查（§4.2-3 含义冻结）：默认开启；semanticJudge:false 跳过（仅限调试）
    const semantic = await runSemanticGate(skillId, compiled.prompt, req.body?.semanticJudge === false);
    let semanticDecision: string | null = null;
    if (semantic) {
      gates.semantic = semantic;
      semanticDecision = decideSemanticGate(semantic, { confirmUncertain: req.body?.confirmUncertain === true });
      gates.semanticDecision = semanticDecision;
      if (semanticDecision === 'block-divergent') {
        return res.status(422).json({
          error: '含义冻结未通过：编译产物与核心文件语义不等价，已阻断发布',
          gates,
          issues: semantic.findings
        });
      }
      if (semanticDecision === 'needs-confirm') {
        return res.status(409).json({
          error: '含义冻结判定不确定，需人工确认（确认无误后以 confirmUncertain: true 重新发布）',
          code: 'SEMANTIC_UNCERTAIN',
          gates,
          judgement: semantic
        });
      }
    }

    // 备份当前生产文件
    const prodPath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
    try {
      const backupsDir = path.join(BACKUPS_DIR, skillId);
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
    } catch {
      // 备份失败不阻塞
    }

    // 写回 prompts/（编译产物自含完整 frontmatter：agentId/coreHash/coreVersion/执行参数）
    await fs.writeFile(prodPath, compiled.prompt, 'utf-8');

    // 创建 DB ACTIVE 版本
    const latest = await systemPrisma.agent_prompts.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: { version: true }
    });
    const newVersion = (latest?.version ?? 0) + 1;
    const promptId = uuidv4();
    await systemPrisma.agent_prompts.create({
      data: {
        id: promptId,
        agentId,
        name: `${skillId} v${newVersion}`,
        systemPrompt: compiled.body,
        status: 'ACTIVE',
        version: newVersion,
        temperature: core.params.temperature,
        maxTokens: core.params.maxTokens,
        model: null,
        description: core.identity.split('\n')[0].slice(0, 100),
        coreHash: compiled.coreHash,
        coreVersion: compiled.coreVersion,
        metadata: JSON.stringify({
          promptLab: {
            source: 'core-file',
            coreHash: compiled.coreHash,
            coreVersion: compiled.coreVersion
          }
        }),
        publishedAt: new Date(),
        createdBy: 'prompt-lab-core'
      }
    });

    // 旧 ACTIVE → ARCHIVED
    await systemPrisma.agent_prompts.updateMany({
      where: { agentId, status: 'ACTIVE', id: { not: promptId } },
      data: { status: 'ARCHIVED' }
    });

    try {
      promptCache.clearAgentCache(agentId);
      promptCache.clearAgentCache(skillId);
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
      coreHash: compiled.coreHash,
      coreVersion: compiled.coreVersion,
      gates
    });
  } catch (error) {
    console.error('Core publish error:', error);
    res.status(500).json({ error: '发布失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/core-list
 * v4 工作台：核心文件清单（含与现行 prompt 的哈希对账状态）
 */
router.get('/core-list', async (req, res) => {
  try {
    const scan = scanCoreFiles();
    const items = await Promise.all(scan.files.map(async (core) => {
      const coreHash = computeCoreHash(core);
      let publishedHash: string | null = null;
      try {
        const raw = await fs.readFile(path.join(PROMPTS_DIR, `skill.${core.skillId}.md`), 'utf-8');
        const meta = parsePromptFrontmatterMeta(raw);
        publishedHash = typeof meta.coreHash === 'string' ? meta.coreHash : null;
      } catch {
        publishedHash = null;
      }
      return {
        skillId: core.skillId,
        fields: core.fields.length,
        channels: core.channels,
        stateAdvance: core.stateAdvance,
        deltaOutput: core.deltaOutput,
        outputMedia: core.outputMedia,
        coreHash,
        publishedHash,
        status: publishedHash === null ? 'no-prompt' : (publishedHash === coreHash ? 'synced' : 'pending-compile'),
      };
    }));
    res.json({ success: true, items, diagnostics: scan.diagnostics });
  } catch (error) {
    res.status(500).json({ error: '读取核心文件清单失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/core/:skillId
 * v4 工作台：读取核心文件原文与解析结果
 */
router.get('/core/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const filePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch {
      return res.status(404).json({ error: `核心文件不存在: prompts/core/${skillId}.yaml` });
    }
    const loaded = loadCoreFile(skillId);
    res.json({
      success: true,
      skillId,
      raw,
      core: loaded?.core ?? null,
      diagnostics: loaded?.diagnostics ?? [],
      coreHash: loaded?.core ? computeCoreHash(loaded.core) : null,
    });
  } catch (error) {
    res.status(500).json({ error: '读取核心文件失败', details: (error as Error).message });
  }
});

/**
 * PUT /api/prompt-lab/core/:skillId
 * v4 工作台：保存核心文件（schema 校验 + 编辑分级 + 备份）
 */
router.put('/core/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const { content } = req.body || {};
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: '缺少 content（核心文件 YAML 文本）' });
    }

    const filePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
    const parsed = parseCoreFile(filePath, content);
    if (!parsed.core) {
      return res.status(400).json({ error: '核心文件 schema 不合法', diagnostics: parsed.diagnostics });
    }

    const oldCore = loadCoreFile(skillId)?.core ?? null;
    const classification = classifyCoreEdit(oldCore, parsed.core);

    // 备份后写入
    try {
      const backupsDir = path.join(BACKUPS_DIR, skillId, 'core');
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(filePath, path.join(backupsDir, `${ts}.yaml`));
    } catch {
      // 首次创建无备份可不做
    }
    await fs.writeFile(filePath, content, 'utf-8');

    res.json({
      success: true,
      skillId,
      coreHash: computeCoreHash(parsed.core),
      classification,
      status: 'pending-compile',
    });
  } catch (error) {
    res.status(500).json({ error: '保存核心文件失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/core/:skillId/versions
 * v4 工作台：发布版本历史
 */
router.get('/core/:skillId/versions', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const rows = await systemPrisma.agent_prompts.findMany({
      where: { agentId: `skill:${skillId}` },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        status: true,
        coreHash: true,
        coreVersion: true,
        createdBy: true,
        publishedAt: true,
        temperature: true,
        maxTokens: true,
      },
      take: 30,
    });
    res.json({ success: true, skillId, versions: rows });
  } catch (error) {
    res.status(500).json({ error: '读取版本历史失败', details: (error as Error).message });
  }
});

/**
 * POST /api/prompt-lab/core/:skillId/rollback
 * v4 工作台：回滚到历史版本（文件回写 + ACTIVE 翻转 + 缓存清理）
 */
router.post('/core/:skillId/rollback', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) {
      return res.status(400).json({ error: '缺少有效 version' });
    }
    const agentId = `skill:${skillId}`;
    const target = await systemPrisma.agent_prompts.findFirst({
      where: { agentId, version },
      select: {
        id: true, version: true, systemPrompt: true, temperature: true, maxTokens: true,
        coreHash: true, coreVersion: true, metadata: true,
      },
    });
    if (!target) {
      return res.status(404).json({ error: `版本不存在: ${agentId} v${version}` });
    }

    // 1) 文件回写（从目标版本重建 frontmatter + 正文）
    let metaCoreHash: string | undefined = target.coreHash || undefined;
    let metaCoreVersion: number | undefined = target.coreVersion || undefined;
    try {
      const meta = JSON.parse(target.metadata || '{}');
      metaCoreHash = metaCoreHash || meta?.promptLab?.coreHash;
      metaCoreVersion = metaCoreVersion ?? meta?.promptLab?.coreVersion;
    } catch { /* metadata 不可解析时仅按列值 */ }
    const frontmatter: Record<string, unknown> = { agentId };
    if (metaCoreHash) frontmatter.coreHash = metaCoreHash;
    if (metaCoreVersion !== undefined) frontmatter.coreVersion = metaCoreVersion;
    if (target.temperature !== null) frontmatter.temperature = target.temperature;
    if (target.maxTokens !== null) frontmatter.maxTokens = target.maxTokens;
    const fileText = `---\n${yaml.dump(frontmatter, { lineWidth: -1 }).trimEnd()}\n---\n\n${target.systemPrompt.trim()}\n`;

    const prodPath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
    try {
      const backupsDir = path.join(BACKUPS_DIR, skillId);
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
    } catch { /* 备份失败不阻塞 */ }
    await fs.writeFile(prodPath, fileText, 'utf-8');

    // 2) ACTIVE 翻转（其余置 ARCHIVED）
    await systemPrisma.agent_prompts.updateMany({
      where: { agentId, status: 'ACTIVE', id: { not: target.id } },
      data: { status: 'ARCHIVED', updatedAt: new Date() },
    });
    await systemPrisma.agent_prompts.update({
      where: { id: target.id },
      data: { status: 'ACTIVE', updatedAt: new Date() },
    });

    // 3) 缓存清理
    try {
      promptCache.clearAgentCache(agentId);
      promptCache.clearAgentCache(skillId);
      getAPIGateway().invalidateCache(undefined, undefined, skillId);
      getAPIGateway().invalidateCache(undefined, agentId);
    } catch (cacheErr: any) {
      console.warn('Failed to invalidate prompt/gateway cache:', cacheErr?.message || cacheErr);
    }

    res.json({ success: true, skillId, agentId, version, rolledBack: true });
  } catch (error) {
    console.error('Rollback error:', error);
    res.status(500).json({ error: '回滚失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/core/:skillId/lineage
 * v4 工作台：字段血缘（消费者注册表）
 */
router.get('/core/:skillId/lineage', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    res.json({ success: true, skillId, lineage: getFieldLineage(skillId) });
  } catch (error) {
    res.status(500).json({ error: '读取字段血缘失败', details: (error as Error).message });
  }
});


/**
 * GET /api/prompt-lab/examples
 * 获取示例配置列表
 */
router.get('/examples', async (req, res) => {
  try {
    // 内置示例（历史 compiler-skill/examples 目录引用已随 v4 退役移除）
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
