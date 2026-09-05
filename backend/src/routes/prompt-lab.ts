/**
 * Prompt Lab API Routes
 * 提供蓝图编译、Compiler Skill 等功能
 */

import { Router, type Request } from 'express';
import { rejectPromptLabFileMutation } from '../middleware/prompt-file-truth.middleware';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { randomUUID as uuidv4 } from 'crypto';
import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';
import { getAPIGateway } from '../gateway/api-gateway';
import { promptCache } from '../services/cache/prompt-cache.service';
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
import { parsePromptFrontmatterMeta, PROMPTS_DIR } from '../composers/prompt-files/loader';
import {
  compileCoreFile,
  checkFiveBlockStructure,
  checkFieldFreeze,
  buildV4CompileSpecText,
} from '../services/prompt-lab/core-compiler';
import { loadCoreFile, scanCoreFiles, computeCoreHash, parseCoreFile, CORE_FILES_DIR, FORBIDDEN_PLATFORM_FIELDS } from '../services/prompt-lab/core-file-loader';
import { normalizeCoreFormInput, serializeCoreFile, extractHeaderComment } from '../services/prompt-lab/core-yaml-writer';
import { getFieldLineageWithDeclarations, classifyCoreEdit } from '../services/prompt-lab/field-lineage';
import {
  judgeSemanticFreeze,
  decideSemanticGate,
  type SemanticFreezeJudgement,
} from '../services/prompt-lab/semantic-freeze-judge';
import { buildV4CorePromptMetadata } from '../services/prompt-lab/core-prompt-metadata';
import { normalizeDeveloperApproval, resolveCoreSnapshot } from '../services/prompt-lab/core-version-snapshot';
import { checkInputHandoffs } from '../services/prompt-lab/input-handoff-check';
import { setAuditAction, setAuditBefore, setAuditAfter } from '../middleware/audit-context';
import {
  appendFieldToCore,
  appendFieldToOrchestration,
  updateFieldInCore,
  updateFieldInOrchestration,
  deleteFieldFromCore,
  deleteFieldFromOrchestration,
  type CoreFieldAppendSpec,
  type CoreFieldUpdateSpec,
  type OrchestrationFieldAppendSpec,
  type OrchestrationRoutingAppendSpec,
  type OrchestrationFieldUpdateSpec,
  type OrchestrationRoutingUpdateSpec,
} from '../services/skill-registry/skill-scaffold.service';
import { loadSkillsBookRaw, SKILL_STAGES, type SkillEntry } from '../services/skill-registry/skills-file';
import {
  ORCHESTRATION_DIR,
  parseOrchestrationFile,
  validateOrchestrationContent,
  type OrchestrationStage,
  type OrchestrationField,
  type OrchestrationRouting,
} from '../services/field-routing/orchestration-file';
import {
  ensureStageFieldRoutings,
  syncStageFieldRoutingsFromFile,
  deleteStageFieldRows,
} from '../services/field-routing-bootstrap.service';
import { clearRoutingCache } from '../services/field-dispatcher';
import { clearSupplementRenderCache } from '../services/prompt-composer';
import { analyzeCoreFieldsSync, type CoreFieldsSyncSkillReport } from '../scripts/check-core-fields-sync';
import {
  CORE_FIELD_TYPES,
  PROMPT_ROLES,
  RENDER_VALUES,
  VISIBILITY_PRESETS,
  coreTypeToValueType,
  stripOptionalSuffix,
  type PromptRole,
  type RenderValue,
} from '../services/yaml-vocabulary';import { getAgentManifest, getCanonicalAgentId } from '../services/agent-manifest.service';
import { writeNodeConfigChange } from '../services/node-config-change-audit';
import type { CoreFile } from '../services/prompt-lab/core-file-loader';

const router = Router();
router.use(rejectPromptLabFileMutation);

// M3：prompts 目录复用 loader 的 PROMPTS_DIR 解析（支持 PROMPTS_DIR 环境变量覆盖），
// prompts/manifests 与 prompts 同级存放于仓库根，避免 process.cwd() 双轨不一致。
const MANIFESTS_DIR = path.join(PROMPTS_DIR, 'manifests');
// 发布备份与 prompts 同级存放（prompts/backups/<skillId>/），不再跨目录到 prompt-lab
const BACKUPS_DIR = path.join(PROMPTS_DIR, 'backups');

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
  /**
   * 已废弃（P0-1 参数四写收敛）：运行参数唯一写源 = core.yaml params（编译进 ACTIVE prompt）。
   * 此处仅兼容读取历史 manifest；serialize 不再写出该段。
   */
  runtimeDefaults?: {
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
  return /[\uFFFD鍔浣瀛韬唤璺緞]/.test(value);
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
  // runtimeDefaults 已废弃（P0-1：参数唯一写源 = core.yaml params）：仅容忍历史文件
  // 携带该段（缺省即 undefined），serialize 时不再写出。
  const runtimeDefaults = manifest.runtimeDefaults && typeof manifest.runtimeDefaults === 'object'
    ? manifest.runtimeDefaults
    : undefined;
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
    runtimeDefaults: runtimeDefaults
      ? {
          tier: ['chat', 'reasoning', 'light'].includes(sanitizeString(runtimeDefaults.tier, 'chat'))
            ? sanitizeString(runtimeDefaults.tier, 'chat')
            : 'chat',
          temperature: sanitizeNumber(runtimeDefaults.temperature, 0.7, 0, 2),
          maxTokens: sanitizeNumber(runtimeDefaults.maxTokens, 32000, 1000, 64000),
          model: sanitizeString(runtimeDefaults.model, '') || null,
          thinkingMode: sanitizeString(runtimeDefaults.thinkingMode, 'default'),
          reasoningEffort: sanitizeString(runtimeDefaults.reasoningEffort, 'default')
        }
      : undefined,
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
    // runtimeDefaults 已废弃（P0-1）：不再写出，参数唯一写源 = core.yaml params
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
    // runtimeDefaults 已废弃（P0-1）：不再从 frontmatter 重建该段；参数唯一写源 = core.yaml params
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
      // runtimeDefaults 已废弃（P0-1）：不再合并/写入；参数唯一写源 = core.yaml params
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

/**
 * H2：按 agentId 串行化同 skill 的发布（进程内互斥）。
 * 并发 publish-core 会算出相同的 coreVersion/version，撞 @@unique([agentId, version]) 返回 500；
 * 串行后后发请求能看到前一发布写入的 ACTIVE 版本，再算出递增的版本号。
 * 发布失败（reject）同样释放锁，不会死锁后续发布。
 */
const publishLocks = new Map<string, Promise<unknown>>();

function serializePublish<T>(agentId: string, task: () => Promise<T>): Promise<T> {
  const prev = publishLocks.get(agentId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(task);
  publishLocks.set(agentId, run);
  run.then(
    () => {
      if (publishLocks.get(agentId) === run) publishLocks.delete(agentId);
    },
    () => {
      if (publishLocks.get(agentId) === run) publishLocks.delete(agentId);
    }
  );
  return run;
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
      fieldFreeze: checkFieldFreeze(loaded.core, compiled.prompt),
      // inputs 声明 ↔ handoff 对账（advisory，不影响 gatePassed）
      inputHandoff: await checkInputHandoffs(loaded.core)
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
 * 顺序（H1 原子性）：① 全部校验（含 manifest/哈希预检）→ ② 同一事务内 DB create + 旧 ACTIVE 归档 → ③ 最后写文件（temp + rename 原子替换）
 * 说明：v4 产物为确定性渲染，不经 compilePrompt LLM 改写；不回写 skill_model_configs（路由配置不动）
 */
router.post('/publish-core', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.body?.skillId);
    const agentId = `skill:${skillId}`;
    // H2：同 skill 的发布按 agentId 串行化（进程内互斥），
    // 防止并发发布算出相同 coreVersion/version 撞 @@unique([agentId, version]) 返回 500。
    await serializePublish(agentId, async () => {
      const loaded = loadCoreFile(skillId);
      if (!loaded) {
        return res.status(404).json({ error: `核心文件不存在: prompts/core/${skillId}.yaml` });
      }
      if (!loaded.core) {
        return res.status(400).json({ error: '核心文件 schema 不合法', diagnostics: loaded.diagnostics });
      }
      const core = loaded.core;

      const coreVersion = await nextCoreVersion(agentId);
      const compiled = compileCoreFile(core, { coreVersion });
      const gates: Record<string, unknown> = {
        structure: checkFiveBlockStructure(compiled.prompt),
        fieldFreeze: checkFieldFreeze(core, compiled.prompt),
        // inputs 声明 ↔ handoff 对账（advisory，不参与阻断）
        inputHandoff: await checkInputHandoffs(core)
      };
      const structuralIssues = [
        ...(gates.structure as Array<unknown>),
        ...(gates.fieldFreeze as Array<unknown>)
      ];
      if (structuralIssues.length > 0) {
        return res.status(422).json({ error: '守门检查未通过，已阻断发布', gates, issues: structuralIssues });
      }

      // 字段结构变更以 ACTIVE 版本的 coreSnapshot 为基准，而不是磁盘当前 core。
      // 这样 staging 后的重复保存也不能把 blocked/restricted 变成安全修改。
      const activeForClassification = await systemPrisma.agent_prompts.findFirst({
        where: { agentId, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        select: { metadata: true },
      });
      let classification: ReturnType<typeof classifyCoreEdit> = {
        level: 'safe',
        messages: ['首次发布核心文件'],
      };
      if (activeForClassification) {
        const activeSnapshot = resolveCoreSnapshot(activeForClassification.metadata, skillId);
        if (!activeSnapshot.core) {
          return res.status(409).json({
            error: activeSnapshot.error,
            code: 'ACTIVE_CORE_SNAPSHOT_REQUIRED',
          });
        }
        classification = classifyCoreEdit(activeSnapshot.core, core);
      }
      const developerApproval = normalizeDeveloperApproval(req.body?.developerApproval);
      if (classification.level !== 'safe' && !developerApproval) {
        return res.status(422).json({
          error: classification.level === 'blocked'
            ? '字段删除或类型变更必须先同步消费者，并提供开发确认引用后才能发布'
            : '新增字段必须经开发确认消费者接入后才能发布',
          code: 'STRUCTURAL_CHANGE_REQUIRES_DEVELOPER_APPROVAL',
          classification,
        });
      }

      // 发布不可绕过含义冻结；结构审批未完成时不消耗 LLM judge 调用。
      const semantic = await runSemanticGate(skillId, compiled.prompt, false);
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

      // H1 ① 全部校验前置：manifest/核心文件哈希预检在写文件、写库之前完成，
      // 失败直接阻断，杜绝"文件已写盘、DB 未写"造成的文件与 DB ACTIVE 永久分叉。
      let metadata: string;
      let metadataWarning: string | null = null;
      try {
        metadata = buildV4CorePromptMetadata({
          skillId,
          coreHash: compiled.coreHash,
          coreVersion: compiled.coreVersion,
          deltaOutput: core.deltaOutput && core.outputMedia === 'json',
          ...(developerApproval ? { developerApprovalReference: developerApproval.reference } : {}),
        });
      } catch (error) {
        return res.status(422).json({
          error: '发布前校验未通过（manifest 或核心文件哈希校验失败），未写入任何数据',
          code: 'PUBLISH_PREFLIGHT_FAILED',
          details: (error as Error).message,
        });
      }
      // manifest 缺失不再抛错（降级为警告）：metadata 携带 manifest-missing 标记
      const metadataInfo = JSON.parse(metadata) as { promptLab?: { runtimeContractSource?: string } };
      if (metadataInfo.promptLab?.runtimeContractSource === 'manifest-missing') {
        metadataWarning = `v4 skill 缺少契约 manifest（prompts/manifests/${skillId}.yaml），metadata 未携带 runtime/prompt 契约`;
        logger.warn(metadataWarning);
      }

      // 备份当前生产文件（best-effort，不阻断）
      const prodPath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
      try {
        const backupsDir = path.join(BACKUPS_DIR, skillId);
        await fs.mkdir(backupsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
      } catch {
        // 备份失败不阻塞
      }

      // H1 ② 同一事务内完成 DB create + 旧 ACTIVE 归档：
      // 任一失败整体回滚，DB 内永远只有一个 ACTIVE 版本。
      const { promptId, newVersion } = await systemPrisma.$transaction(async (tx) => {
        const latest = await tx.agent_prompts.findFirst({
          where: { agentId },
          orderBy: { version: 'desc' },
          select: { version: true }
        });
        const nextVersion = (latest?.version ?? 0) + 1;
        const nextPromptId = uuidv4();
        await tx.agent_prompts.create({
          data: {
            id: nextPromptId,
            agentId,
            name: `${skillId} v${nextVersion}`,
            systemPrompt: compiled.body,
            status: 'ACTIVE',
            version: nextVersion,
            temperature: core.params.temperature,
            maxTokens: core.params.maxTokens,
            model: null,
            description: core.identity.split('\n')[0].slice(0, 100),
            coreHash: compiled.coreHash,
            coreVersion: compiled.coreVersion,
            metadata,
            publishedAt: new Date(),
            createdBy: 'prompt-lab-core'
          }
        });
        // 旧 ACTIVE → ARCHIVED
        await tx.agent_prompts.updateMany({
          where: { agentId, status: 'ACTIVE', id: { not: nextPromptId } },
          data: { status: 'ARCHIVED' }
        });
        return { promptId: nextPromptId, newVersion: nextVersion };
      });

      // H1 ③ 最后写盘：temp 文件 + rename 原子替换，避免写一半留下半截文件；
      // 与 PROMPTS_DIR 同目录保证 rename 不跨卷。
      const tmpPath = path.join(PROMPTS_DIR, `.skill.${skillId}.md.${process.pid}.tmp`);
      try {
        await fs.writeFile(tmpPath, compiled.prompt, 'utf-8');
        await fs.rename(tmpPath, prodPath);
      } catch (fileError) {
        await fs.unlink(tmpPath).catch(() => {});
        throw fileError;
      }

      try {
        promptCache.clearAgentCache(agentId);
        promptCache.clearAgentCache(skillId);
        getAPIGateway().invalidateCache(undefined, undefined, skillId);
        getAPIGateway().invalidateCache(undefined, agentId);
      } catch (cacheErr: any) {
        logger.warn('Failed to invalidate prompt/gateway cache:', { error: cacheErr?.message || String(cacheErr) });
      }

      // 操作审计：发布成功快照版本信息（不含 systemPrompt 全文）
      setAuditAction(res, 'prompt-lab-publish-core', { targetType: 'skill', targetId: skillId });
      setAuditAfter(res, {
        agentId,
        promptId,
        version: newVersion,
        coreHash: compiled.coreHash,
        coreVersion: compiled.coreVersion,
      });

      res.json({
        success: true,
        version: newVersion,
        agentId,
        promptId,
        coreHash: compiled.coreHash,
        coreVersion: compiled.coreVersion,
        gates,
        classification,
        ...(developerApproval ? { developerApproval } : {}),
        ...(metadataWarning ? { metadataWarning } : {}),
      });
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
 * 两种模式：
 * - 默认（raw）：{ content } 直接提交 YAML 文本
 * - 表单（form）：{ mode: 'form', core } 提交结构化 JSON，服务端确定性序列化为 YAML，
 *   与 raw 模式共用同一条 parseCoreFile 校验/分级/备份路径
 */
router.put('/core/:skillId', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    const { content, mode, core: formCore } = req.body || {};
    const filePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);

    let yamlText: string;
    if (mode === 'form') {
      const normalized = normalizeCoreFormInput(formCore, skillId);
      if (!normalized.ok) {
        return res.status(400).json({ error: '表单数据无法矫正为核心文件形状', diagnostics: normalized.diagnostics });
      }
      // 保留原文件头部注释块（M1 基准血缘等人工信息）
      const existingRaw = await fs.readFile(filePath, 'utf-8').catch(() => '');
      yamlText = serializeCoreFile(normalized.core, extractHeaderComment(existingRaw));
    } else {
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: '缺少 content（核心文件 YAML 文本）' });
      }
      yamlText = content;
    }

    const parsed = parseCoreFile(filePath, yamlText);
    if (!parsed.core) {
      return res.status(400).json({ error: '核心文件 schema 不合法', diagnostics: parsed.diagnostics });
    }

    const agentId = `skill:${skillId}`;
    const active = await systemPrisma.agent_prompts.findFirst({
      where: { agentId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      select: { metadata: true },
    });
    let classification: ReturnType<typeof classifyCoreEdit> = {
      level: 'safe',
      messages: ['首次创建核心文件'],
    };
    if (active) {
      const activeSnapshot = resolveCoreSnapshot(active.metadata, skillId);
      if (!activeSnapshot.core) {
        return res.status(409).json({
          error: activeSnapshot.error,
          code: 'ACTIVE_CORE_SNAPSHOT_REQUIRED',
        });
      }
      classification = classifyCoreEdit(activeSnapshot.core, parsed.core);
    }

    // 先对账再写盘：inputs 声明 ↔ handoff 路由表（advisory；基于待保存内容而非旧文件）
    const inputWarnings = await checkInputHandoffs(parsed.core);

    // 备份后写入
    try {
      const backupsDir = path.join(BACKUPS_DIR, skillId, 'core');
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(filePath, path.join(backupsDir, `${ts}.yaml`));
    } catch {
      // 首次创建无备份可不做
    }
    await fs.writeFile(filePath, yamlText, 'utf-8');

    res.json({
      success: true,
      skillId,
      coreHash: computeCoreHash(parsed.core),
      classification,
      // inputs 声明 ↔ handoff 对账（advisory 告警，写盘前计算）
      inputWarnings,
      status: 'pending-compile',
    });
  } catch (error) {
    res.status(500).json({ error: '保存核心文件失败', details: (error as Error).message });
  }
});

/**
 * POST /api/admin/prompt-lab/core/:skillId/field
 * M1 统一编辑（UNIFIED_EDITING_DESIGN §4.3）：加字段向导的原子追加 API。
 *
 * 契约（payload = 向导表单后端子集）：
 *   name: string（必填，每段小写字母开头仅含字母/数字/下划线，可点分嵌套）
 *   type: string（必填，core 受控词表 string/number/boolean/object/object[]/string[]/enum，可带 ?）
 *   role?: 7 类 promptRole（缺省 soft-info）
 *   render?: visible|hidden（缺省 visible）
 *   handoff?: string[]（阶段名/agent/skill: 目标；镜像 seed 语义校验）
 *   internal?: boolean；accumulate?: boolean；turn?: boolean（仅顶层直配）
 *   visibilityPreset?: user-clarification|agent-internal
 *   locked?: system|structure（→ 编排字段 systemLocked/structureLocked）
 *   desc: string（必填，功能描述即生成指令）
 *   persistKey?: string；pathInRawOutput?: string
 *
 * 原子性：双文件要么都写要么都不写。全部内存校验（parseCoreFile/
 * validateOrchestrationContent）通过后才写盘；编排写盘失败 → core 恢复原内容；
 * fields-sync 复检违规 → 双文件回滚。写盘前备份到 prompts/backups/unified-edit/<ts>/。
 * 幂等：同名 fieldId 已存在（core fields ∪ 编排 fieldId）→ 409（提示去编辑）。
 */
export class SkillFieldAddError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SkillFieldAddError';
  }
}

export interface SkillFieldAddRequest {
  name?: unknown;
  type?: unknown;
  role?: unknown;
  render?: unknown;
  handoff?: unknown;
  internal?: unknown;
  accumulate?: unknown;
  visibilityPreset?: unknown;
  locked?: unknown;
  desc?: unknown;
  persistKey?: unknown;
  pathInRawOutput?: unknown;
  turn?: unknown;
}

export interface SkillFieldAddResult {
  skillId: string;
  stage: string;
  field: { name: string; fieldId: string };
  coreWritten: boolean;
  orchestrationWritten: boolean;
  synced: boolean;
  syncHint: string;
  syncCheck: CoreFieldsSyncSkillReport | null;
  auditId: string;
}

const FIELD_ADD_BACKUPS_DIR = path.join(BACKUPS_DIR, 'unified-edit');

/** H3：同 skill 的字段追加按 skillId 串行化（进程内互斥，防并发读改写丢行） */
const fieldAddLocks = new Map<string, Promise<unknown>>();

function serializeFieldAdd<T>(skillId: string, task: () => Promise<T>): Promise<T> {
  const prev = fieldAddLocks.get(skillId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(task);
  fieldAddLocks.set(skillId, run);
  run.then(
    () => {
      if (fieldAddLocks.get(skillId) === run) fieldAddLocks.delete(skillId);
    },
    () => {
      if (fieldAddLocks.get(skillId) === run) fieldAddLocks.delete(skillId);
    }
  );
  return run;
}

function fieldAddTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function fieldAddBooleanFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const CORE_FIELD_NAME_SEGMENT = /^[a-z][A-Za-z0-9_]*$/;

/** 原子加字段主流程（导出于单测直接调用；路由侧薄封装） */
export async function addSkillFieldToCoreAndOrchestration(
  skillId: string,
  payload: SkillFieldAddRequest,
  opts: { actorId?: string } = {},
): Promise<SkillFieldAddResult> {
  // ---- 1. 输入校验（400/422） ----
  const name = fieldAddTrimmedString(payload.name);
  if (!name) throw new SkillFieldAddError(400, 'FIELD_NAME_REQUIRED', 'name（字段名）必填');
  const nameSegments = name.split('.');
  if (!nameSegments.every((seg) => CORE_FIELD_NAME_SEGMENT.test(seg))) {
    throw new SkillFieldAddError(
      400,
      'FIELD_NAME_INVALID',
      `name "${name}" 非法（每段须小写字母开头，仅含字母/数字/下划线，可点分嵌套，如 understanding.surface_goal）`,
    );
  }
  const isNested = nameSegments.length > 1;
  const root = nameSegments[0];
  if (!isNested && (FORBIDDEN_PLATFORM_FIELDS as readonly string[]).includes(name)) {
    throw new SkillFieldAddError(
      422,
      'FIELD_NAME_PLATFORM',
      `字段名 "${name}" 是平台包装字段（success/quality/stage/raw），禁止出现在字段表（§2.4.3）`,
    );
  }

  const rawType = fieldAddTrimmedString(payload.type);
  if (!rawType) throw new SkillFieldAddError(400, 'FIELD_TYPE_REQUIRED', 'type（core 类型）必填');
  const baseType = stripOptionalSuffix(rawType);
  if (!(CORE_FIELD_TYPES as readonly string[]).includes(baseType)) {
    throw new SkillFieldAddError(
      400,
      'FIELD_TYPE_UNKNOWN',
      `type "${rawType}" 不在受控词表（${CORE_FIELD_TYPES.join(' | ')}，可带 ? 后缀）`,
    );
  }
  if (!rawType.endsWith('?') && rawType !== baseType) {
    throw new SkillFieldAddError(400, 'FIELD_TYPE_INVALID', `type "${rawType}" 非法（? 只能作后缀）`);
  }
  const valueType = coreTypeToValueType(rawType);
  if (valueType === undefined) {
    throw new SkillFieldAddError(
      422,
      'VALUE_TYPE_UNMAPPABLE',
      `type "${rawType}"（enum）为 core-only，编排侧无对应 valueType（coreTypeToValueType 返回 undefined），请人工登记编排侧或选用其它类型`,
    );
  }

  const role = (fieldAddTrimmedString(payload.role) ?? 'soft-info') as string;
  if (!(PROMPT_ROLES as readonly string[]).includes(role)) {
    throw new SkillFieldAddError(400, 'ROLE_UNKNOWN', `role "${role}" 非法（须在 ${PROMPT_ROLES.join(',')} 中）`);
  }
  const render = (fieldAddTrimmedString(payload.render) ?? 'visible') as string;
  if (!(RENDER_VALUES as readonly string[]).includes(render)) {
    throw new SkillFieldAddError(400, 'RENDER_UNKNOWN', `render "${render}" 非法（须在 ${RENDER_VALUES.join(',')} 中）`);
  }
  const handoff = Array.isArray(payload.handoff)
    ? payload.handoff.map((item) => fieldAddTrimmedString(item)).filter((item): item is string => item !== null)
    : [];
  const internal = fieldAddBooleanFlag(payload.internal, false);
  const accumulate = fieldAddBooleanFlag(payload.accumulate, false);
  const visibilityPreset = fieldAddTrimmedString(payload.visibilityPreset) ?? undefined;
  if (visibilityPreset !== undefined && !(VISIBILITY_PRESETS as readonly string[]).includes(visibilityPreset)) {
    throw new SkillFieldAddError(
      400,
      'VISIBILITY_PRESET_UNKNOWN',
      `visibilityPreset "${visibilityPreset}" 非法（须在 ${VISIBILITY_PRESETS.join(',')} 中）`,
    );
  }
  const locked = fieldAddTrimmedString(payload.locked) ?? undefined;
  if (locked !== undefined && locked !== 'system' && locked !== 'structure') {
    throw new SkillFieldAddError(400, 'LOCKED_UNKNOWN', 'locked 非法（可选 system | structure）');
  }
  const desc = fieldAddTrimmedString(payload.desc);
  if (!desc) throw new SkillFieldAddError(400, 'FIELD_DESC_REQUIRED', 'desc（功能描述/生成指令）必填');
  const persistKey = fieldAddTrimmedString(payload.persistKey) ?? undefined;
  const pathInRawOutput = fieldAddTrimmedString(payload.pathInRawOutput) ?? undefined;
  const turn = fieldAddBooleanFlag(payload.turn, false);

  // ---- 2. skill 归属（skills.yaml 户口簿 → stage）与文件定位 ----
  const book = loadSkillsBookRaw();
  const entry = book.skills.find((item) => item.skillId === skillId);
  if (!entry) throw new SkillFieldAddError(404, 'SKILL_NOT_FOUND', `skills.yaml 无该 skill 登记：${skillId}`);
  if (!entry.stage) throw new SkillFieldAddError(422, 'SKILL_NO_STAGE', `skill ${skillId} 无编排阶段归属（kind=${entry.kind}）`);
  const stageName = entry.stage;
  const corePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
  const orchestrationPath = path.join(ORCHESTRATION_DIR, `${stageName}.yaml`);

  // ---- 3. 读与校验（任一失败 → 不落任何文件） ----
  let coreText: string;
  try {
    coreText = await fs.readFile(corePath, 'utf-8');
  } catch {
    throw new SkillFieldAddError(404, 'CORE_FILE_MISSING', `核心文件不存在: prompts/core/${skillId}.yaml`);
  }
  const parsedCore = parseCoreFile(corePath, coreText);
  if (!parsedCore.core) {
    throw new SkillFieldAddError(
      422,
      'CORE_FILE_INVALID',
      `核心文件 schema 不合法：${parsedCore.diagnostics.map((d) => d.message).join('；')}`,
    );
  }

  let orchestrationText: string;
  try {
    orchestrationText = await fs.readFile(orchestrationPath, 'utf-8');
  } catch {
    throw new SkillFieldAddError(404, 'ORCHESTRATION_FILE_MISSING', `编排文件不存在: prompts/orchestration/${stageName}.yaml`);
  }
  let stage: OrchestrationStage;
  try {
    stage = parseOrchestrationFile(orchestrationPath);
  } catch (error) {
    throw new SkillFieldAddError(422, 'ORCHESTRATION_FILE_INVALID', `编排文件解析失败：${(error as Error).message}`);
  }

  // ---- 4. 唯一性（core fields ∪ 编排 fieldId）→ 409（提示去编辑） ----
  const coreFieldNames = new Set(parsedCore.core.fields.map((f) => f.name));
  if (!isNested && coreFieldNames.has(name)) {
    throw new SkillFieldAddError(409, 'FIELD_EXISTS', `core fields 已存在同名字段：${name}（如需调整请走既有编辑面）`);
  }
  if (stage.fields.some((f) => f.fieldId === name)) {
    throw new SkillFieldAddError(409, 'FIELD_EXISTS', `编排文件 fields 已存在同 fieldId：${name}（如需调整请走既有编辑面）`);
  }
  if (isNested) {
    const rootField = parsedCore.core.fields.find((f) => f.name === root);
    if (rootField && stripOptionalSuffix(rootField.type) !== 'object') {
      throw new SkillFieldAddError(
        422,
        'NESTED_ROOT_NOT_OBJECT',
        `嵌套字段 "${name}" 的顶层 "${root}" 已存在但类型为 ${rootField.type}（嵌套字段顶层必须是 object）`,
      );
    }
  }

  // ---- 5. 路由语义校验（镜像 field-routing-bootstrap seed 语义，防启动 fail-fast 误伤） ----
  const agentId = `skill:${skillId}`;
  if (handoff.includes(agentId)) {
    throw new SkillFieldAddError(422, 'HANDOFF_SELF_LOOP', `handoff 自环（指向自身 ${agentId}）`);
  }
  for (const target of handoff) {
    const canonical = getCanonicalAgentId(target);
    if (target === canonical && (SKILL_STAGES as readonly string[]).includes(canonical as never)) continue;
    if (getAgentManifest(canonical)) continue;
    throw new SkillFieldAddError(
      422,
      'HANDOFF_TARGET_UNKNOWN',
      `handoff 目标 "${target}" 不在 manifest（也不是阶段名 ${SKILL_STAGES.join('/')}）`,
    );
  }
  if (render === 'visible' && internal && role !== 'control-signal') {
    throw new SkillFieldAddError(422, 'RENDER_INTERNAL_CONFLICT', 'render=visible 与 internal=true 组合仅允许 control-signal 字段');
  }
  if (handoff.length === 0 && !internal && !accumulate && render === 'visible' && role !== 'public-reply') {
    throw new SkillFieldAddError(
      422,
      'ROUTING_NO_FLOW',
      'handoff 为空且非 public-reply/画像终点（internal+accumulate），缺少流转去向',
    );
  }

  // ---- 6. 双文件文本级追加（保留原文件注释/排版）+ 写盘前内存校验 ----
  const coreSpec: CoreFieldAppendSpec = isNested
    ? {
        name,
        type: baseType,
        desc: '',
        children: [{ path: nameSegments.slice(1).join('.'), type: baseType, desc }],
      }
    : { name, type: rawType, desc, turn };
  const newCoreText = appendFieldToCore(coreText, coreSpec);
  const coreChecked = parseCoreFile(corePath, newCoreText);
  if (!coreChecked.core) {
    throw new SkillFieldAddError(
      422,
      'CORE_VALIDATION_FAILED',
      `追加后核心文件未通过 parseCoreFile：${coreChecked.diagnostics.map((d) => d.message).join('；')}`,
    );
  }
  const newCore = coreChecked.core;

  const fieldSpec: OrchestrationFieldAppendSpec = {
    fieldId: name,
    promptRole: role,
    valueType,
    ...(pathInRawOutput ? { pathInRawOutput } : {}),
    ...(persistKey ? { persistKey } : {}),
    description: desc,
    ...(locked === 'system' ? { systemLocked: true } : {}),
    ...(locked === 'structure' ? { structureLocked: true } : {}),
  };
  const routingSpec: OrchestrationRoutingAppendSpec = {
    agentId,
    fieldId: name,
    render,
    handoff,
    internal,
    accumulate,
    ...(visibilityPreset ? { visibilityPreset } : {}),
  };
  const newOrchestrationText = appendFieldToOrchestration(orchestrationText, fieldSpec, routingSpec);
  let newStage: OrchestrationStage;
  try {
    newStage = validateOrchestrationContent(newOrchestrationText);
  } catch (error) {
    throw new SkillFieldAddError(
      422,
      'ORCHESTRATION_VALIDATION_FAILED',
      `追加后编排文件未通过 validateOrchestrationContent：${(error as Error).message}`,
    );
  }

  // ---- 7. 备份（prompts/backups/unified-edit/<ts>/）+ 写盘 ----
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(FIELD_ADD_BACKUPS_DIR, ts);
  try {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(corePath, path.join(backupDir, `core-${skillId}.yaml`));
    await fs.copyFile(orchestrationPath, path.join(backupDir, `orchestration-${stageName}.yaml`));
  } catch {
    // 备份失败不阻断（与既有备份模式一致）
  }

  await fs.writeFile(corePath, newCoreText, 'utf-8');
  try {
    await fs.writeFile(orchestrationPath, newOrchestrationText, 'utf-8');
  } catch (error) {
    // 原子性：编排写失败 → 恢复 core 原内容（双文件保持一致）
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    throw new SkillFieldAddError(
      500,
      'ORCHESTRATION_WRITE_FAILED',
      `编排文件写盘失败（core 已回滚原内容）：${(error as Error).message}；恢复备份参考：${backupDir}`,
    );
  }

  // ---- 8. fields-sync 复检（analyzeCoreFieldsSync 单 skill 投影；违规 → 双文件回滚） ----
  const syncCheck = analyzeCoreFieldsSync([newStage], [entry], () => ({ core: newCore }));
  const projection = syncCheck.find((report) => report.skillId === skillId) ?? null;
  const recheckFailed =
    (projection !== null &&
      (projection.missing.some((item) => item.fieldId === name) ||
        projection.typeMismatch.some((item) => item.fieldId === name) ||
        (projection.orphan.some((item) => item.coreField === root) && !coreFieldNames.has(root)))) ||
    (projection === null && !newStage.routings.some((r) => r.agentId === agentId && r.fieldId.split('.')[0] === root));
  if (recheckFailed) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    await fs.writeFile(orchestrationPath, orchestrationText, 'utf-8').catch(() => undefined);
    throw new SkillFieldAddError(
      422,
      'FIELDS_SYNC_RECHECK_FAILED',
      'fields-sync 复检未通过（缺项/孤儿/类型不一致），已回滚双文件（恢复原内容）',
      { syncCheck: projection },
    );
  }

  // ---- 9. 落库（ensureStageFieldRoutings 只建不更新；失败不阻断写盘结果） ----
  let synced = true;
  let syncHint = '新字段 core+编排双写完成；新建字段/路由已入库生效';
  try {
    await ensureStageFieldRoutings(systemPrisma, newStage);
  } catch (error) {
    synced = false;
    syncHint = `DB 同步失败：${(error as Error).message}（新建行未入库，可走「强制同步 DB」补录）`;
  }

  // ---- 10. 审计（node_config_changes；失败不阻断） ----
  let auditId = '';
  try {
    auditId = await writeNodeConfigChange(systemPrisma, {
      changeType: 'skill-field-add',
      targetTable: 'core.yaml+orchestration',
      targetId: skillId,
      agentId,
      fieldId: name,
      before: null,
      after: {
        fieldId: name,
        stage: stageName,
        coreType: rawType,
        valueType,
        promptRole: role,
        render,
        handoff,
        internal,
        accumulate,
        ...(visibilityPreset ? { visibilityPreset } : {}),
        ...(locked ? { locked } : {}),
        ...(persistKey ? { persistKey } : {}),
      },
      actorId: opts.actorId ?? 'admin',
      reason: '加字段向导原子追加（core.yaml + 编排文件双写）',
    });
  } catch (auditError) {
    logger.warn('[prompt-lab] skill-field-add audit write failed（不阻断）', {
      skillId,
      error: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }

  try {
    clearRoutingCache();
    clearSupplementRenderCache();
  } catch {
    // 缓存清理失败不阻断
  }

  return {
    skillId,
    stage: stageName,
    field: { name, fieldId: name },
    coreWritten: true,
    orchestrationWritten: true,
    synced,
    syncHint,
    syncCheck: projection,
    auditId,
  };
}

/**
 * POST /api/admin/prompt-lab/core/:skillId/field
 * 原子加字段（M1）：双文件联动 + 落库 + 复检 + 审计，见 addSkillFieldToCoreAndOrchestration。
 */
router.post('/core/:skillId/field', async (req, res) => {
  const skillId = assertValidSkillId(req.params.skillId);
  await serializeFieldAdd(skillId, async () => {
    try {
      const result = await addSkillFieldToCoreAndOrchestration(skillId, req.body ?? {}, {
        actorId: (req as Request & { user?: { userId?: string } }).user?.userId || 'admin',
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof SkillFieldAddError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          error: { message: error.message },
          ...(error.extra ?? {}),
        });
      }
      console.error('Skill field add error:', error);
      res.status(500).json({ success: false, error: { message: '加字段失败', details: (error as Error).message } });
    }
  });
});

/**
 * PATCH /api/admin/prompt-lab/core/:skillId/field/:name
 * 改字段原子 API（M3，与 M1 加字段同模式）：双文件联动 + 回滚 + 落库 update 语义 + 审计 + 复检。
 *
 * 契约（payload 全部可选；undefined = 保持现状，''/null = 清除可选声明）：
 *   type/desc/turn（core 侧）；role/render/handoff/internal/accumulate/visibilityPreset/
 *   locked/persistKey/pathInRawOutput（编排侧；type 映射 valueType）
 *
 * 原子性：内存修改 + parse 双校验 → 备份 → 写 core → 写编排（失败回滚 core）→
 * fields-sync 复检（违规双文件回滚）→ 落库（复用 sync 全量对账：managedByCode=true
 * 行更新、false 行跳过并报告 protected）→ 审计（changeType='skill-field-update'）。
 * 幂等：与现状无差异 → 200 changed=false（不写盘不落库不审计）。
 */
export class SkillFieldEditError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SkillFieldEditError';
  }
}

export interface SkillFieldUpdateRequest {
  type?: unknown;
  role?: unknown;
  render?: unknown;
  handoff?: unknown;
  internal?: unknown;
  accumulate?: unknown;
  visibilityPreset?: unknown;
  locked?: unknown;
  desc?: unknown;
  persistKey?: unknown;
  pathInRawOutput?: unknown;
  turn?: unknown;
}

export interface SkillFieldSnapshot {
  name: string;
  root: string;
  isNested: boolean;
  coreType: string;
  turn: boolean;
  promptRole: string;
  valueType: string;
  persistKey: string | null;
  pathInRawOutput: string | null;
  render: string;
  handoff: string[];
  internal: boolean;
  accumulate: boolean;
  visibilityPreset: string | null;
  locked: 'system' | 'structure' | null;
  desc: string;
}

export interface SkillFieldUpdateResult {
  skillId: string;
  stage: string;
  name: string;
  changed: boolean;
  coreWritten: boolean;
  orchestrationWritten: boolean;
  /** 落库全量对账报告（syncStageFieldRoutingsFromFile；managedByCode=false 行跳过） */
  dbSync: {
    fieldsUpdated: number;
    routingsUpdated: number;
    contractsUpdated: number;
    createdCount: number;
    skippedAdminRows: Array<{ table: string; key: string }>;
  };
  syncCheck: CoreFieldsSyncSkillReport | null;
  auditId: string;
}

/** 解析 core 顶层字段 desc 中的子字段说明（`· path（type）desc`），供嵌套字段定位/摘要 */
function parseCoreChildNote(desc: string, childPath: string): { type: string; desc: string } | null {
  const escaped = childPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)\\s*·\\s*${escaped}\\s*（([^）]*)）\\s*([^\\n]*)`);
  const match = desc.match(re);
  if (!match) return null;
  const typeToken = match[1].trim().split(/[，,（]/)[0].trim();
  return { type: typeToken, desc: match[2].trim() };
}

/** 读取双文件并定位字段（改/删共用）；任一缺失 → 404 */
async function loadSkillFieldContext(skillId: string, name: string): Promise<{
  entry: SkillEntry;
  stageName: string;
  agentId: string;
  isNested: boolean;
  root: string;
  corePath: string;
  orchestrationPath: string;
  coreText: string;
  core: CoreFile;
  coreField: CoreFile['fields'][number];
  orchestrationText: string;
  stage: OrchestrationStage;
  orchField: OrchestrationField;
  orchRouting: OrchestrationRouting;
  childNote: { type: string; desc: string } | null;
}> {
  const nameSegments = name.split('.');
  if (!nameSegments.every((seg) => CORE_FIELD_NAME_SEGMENT.test(seg))) {
    throw new SkillFieldEditError(
      400,
      'FIELD_NAME_INVALID',
      `字段名 "${name}" 非法（每段须小写字母开头，仅含字母/数字/下划线，可点分嵌套）`,
    );
  }
  const isNested = nameSegments.length > 1;
  const root = nameSegments[0];

  const book = loadSkillsBookRaw();
  const entry = book.skills.find((item) => item.skillId === skillId);
  if (!entry) throw new SkillFieldEditError(404, 'SKILL_NOT_FOUND', `skills.yaml 无该 skill 登记：${skillId}`);
  if (!entry.stage) throw new SkillFieldEditError(422, 'SKILL_NO_STAGE', `skill ${skillId} 无编排阶段归属（kind=${entry.kind}）`);
  const stageName = entry.stage;
  const agentId = `skill:${skillId}`;
  const corePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
  const orchestrationPath = path.join(ORCHESTRATION_DIR, `${stageName}.yaml`);

  let coreText: string;
  try {
    coreText = await fs.readFile(corePath, 'utf-8');
  } catch {
    throw new SkillFieldEditError(404, 'CORE_FILE_MISSING', `核心文件不存在: prompts/core/${skillId}.yaml`);
  }
  const parsedCore = parseCoreFile(corePath, coreText);
  if (!parsedCore.core) {
    throw new SkillFieldEditError(
      422,
      'CORE_FILE_INVALID',
      `核心文件 schema 不合法：${parsedCore.diagnostics.map((d) => d.message).join('；')}`,
    );
  }
  const core = parsedCore.core;

  let orchestrationText: string;
  try {
    orchestrationText = await fs.readFile(orchestrationPath, 'utf-8');
  } catch {
    throw new SkillFieldEditError(404, 'ORCHESTRATION_FILE_MISSING', `编排文件不存在: prompts/orchestration/${stageName}.yaml`);
  }
  let stage: OrchestrationStage;
  try {
    stage = parseOrchestrationFile(orchestrationPath);
  } catch (error) {
    throw new SkillFieldEditError(422, 'ORCHESTRATION_FILE_INVALID', `编排文件解析失败：${(error as Error).message}`);
  }

  const coreField = core.fields.find((f) => f.name === root);
  const orchField = stage.fields.find((f) => f.fieldId === name);
  const orchRouting = stage.routings.find((r) => r.agentId === agentId && r.fieldId === name);

  let childNote: { type: string; desc: string } | null = null;
  if (isNested) {
    childNote = coreField ? parseCoreChildNote(coreField.desc, nameSegments.slice(1).join('.')) : null;
  }
  const corePresent = coreField !== undefined && (!isNested || childNote !== null);
  if (!corePresent || !orchField || !orchRouting) {
    throw new SkillFieldEditError(
      404,
      'FIELD_NOT_FOUND',
      `字段 ${name} 不存在（core fields / 编排 fields / 编排 routings 三处需同名登记）`,
    );
  }
  return {
    entry,
    stageName,
    agentId,
    isNested,
    root,
    corePath,
    orchestrationPath,
    coreText,
    core,
    coreField,
    orchestrationText,
    stage,
    orchField,
    orchRouting,
    childNote,
  };
}

/** 字段现状摘要（before 审计 / 幂等比对 / 编辑预填共用的归一视图） */
function buildSkillFieldSnapshot(
  ctx: {
    isNested: boolean;
    coreField: CoreFile['fields'][number];
    orchField: OrchestrationField;
    orchRouting: OrchestrationRouting;
    childNote: { type: string; desc: string } | null;
  },
  name: string,
): SkillFieldSnapshot {
  const { isNested, coreField, orchField, orchRouting, childNote } = ctx;
  let coreType = coreField.type;
  let turn = Boolean(coreField.turn);
  let desc = coreField.desc;
  if (isNested && childNote) {
    coreType = childNote.type;
    turn = false;
    desc = childNote.desc;
  }
  const locked = orchField.systemLocked ? 'system' : orchField.structureLocked ? 'structure' : null;
  return {
    name,
    root: name.split('.')[0],
    isNested,
    coreType,
    turn,
    promptRole: orchField.promptRole,
    valueType: orchField.valueType,
    persistKey: orchField.persistKey ?? null,
    pathInRawOutput: orchField.pathInRawOutput ?? null,
    render: orchRouting.render,
    handoff: [...orchRouting.handoff],
    internal: orchRouting.internal,
    accumulate: orchRouting.accumulate,
    visibilityPreset: orchRouting.visibilityPreset ?? null,
    locked,
    desc,
  };
}

/** PATCH 载荷校验 → 完整"目标快照"（undefined 保持现状；''/null 清除可选声明） */
function resolveFieldUpdateTarget(
  before: SkillFieldSnapshot,
  payload: SkillFieldUpdateRequest,
): SkillFieldSnapshot {
  const isNested = before.isNested;

  let rawType = before.coreType;
  if (payload.type !== undefined) {
    const t = fieldAddTrimmedString(payload.type);
    if (!t) throw new SkillFieldEditError(400, 'FIELD_TYPE_REQUIRED', 'type（core 类型）不能为空');
    const baseType = stripOptionalSuffix(t);
    if (!(CORE_FIELD_TYPES as readonly string[]).includes(baseType)) {
      throw new SkillFieldEditError(
        400,
        'FIELD_TYPE_UNKNOWN',
        `type "${t}" 不在受控词表（${CORE_FIELD_TYPES.join(' | ')}，可带 ? 后缀）`,
      );
    }
    if (!t.endsWith('?') && t !== baseType) {
      throw new SkillFieldEditError(400, 'FIELD_TYPE_INVALID', `type "${t}" 非法（? 只能作后缀）`);
    }
    rawType = isNested ? baseType : t;
  }
  const valueType = coreTypeToValueType(rawType);
  if (valueType === undefined) {
    throw new SkillFieldEditError(
      422,
      'VALUE_TYPE_UNMAPPABLE',
      `type "${rawType}"（enum）为 core-only，编排侧无对应 valueType，请人工登记编排侧或选用其它类型`,
    );
  }

  const role = payload.role !== undefined ? (fieldAddTrimmedString(payload.role) ?? '') : before.promptRole;
  if (!role) throw new SkillFieldEditError(400, 'FIELD_DESC_REQUIRED', 'role 不能为空');
  if (!(PROMPT_ROLES as readonly string[]).includes(role)) {
    throw new SkillFieldEditError(400, 'ROLE_UNKNOWN', `role "${role}" 非法（须在 ${PROMPT_ROLES.join(',')} 中）`);
  }

  const render = payload.render !== undefined ? (fieldAddTrimmedString(payload.render) ?? '') : before.render;
  if (!render) throw new SkillFieldEditError(400, 'RENDER_UNKNOWN', 'render 不能为空');
  if (!(RENDER_VALUES as readonly string[]).includes(render)) {
    throw new SkillFieldEditError(400, 'RENDER_UNKNOWN', `render "${render}" 非法（须在 ${RENDER_VALUES.join(',')} 中）`);
  }

  const handoff = payload.handoff !== undefined
    ? Array.isArray(payload.handoff)
      ? payload.handoff.map((item) => fieldAddTrimmedString(item)).filter((item): item is string => item !== null)
      : before.handoff
    : [...before.handoff];

  const internal = payload.internal !== undefined ? fieldAddBooleanFlag(payload.internal, before.internal) : before.internal;
  const accumulate = payload.accumulate !== undefined
    ? fieldAddBooleanFlag(payload.accumulate, before.accumulate)
    : before.accumulate;

  const visibilityPreset = payload.visibilityPreset !== undefined
    ? (fieldAddTrimmedString(payload.visibilityPreset) ?? null)
    : before.visibilityPreset;
  if (visibilityPreset !== null && !(VISIBILITY_PRESETS as readonly string[]).includes(visibilityPreset)) {
    throw new SkillFieldEditError(
      400,
      'VISIBILITY_PRESET_UNKNOWN',
      `visibilityPreset "${visibilityPreset}" 非法（须在 ${VISIBILITY_PRESETS.join(',')} 中）`,
    );
  }

  let locked = before.locked;
  if (payload.locked !== undefined) {
    const raw = payload.locked === null ? null : fieldAddTrimmedString(payload.locked);
    if (raw === null || raw === '') locked = null;
    else if (raw === 'system' || raw === 'structure') locked = raw;
    else throw new SkillFieldEditError(400, 'LOCKED_UNKNOWN', 'locked 非法（可选 system | structure，空串清除）');
  }
  if (locked === 'system') {
    throw new SkillFieldEditError(409, 'FIELD_SYSTEM_LOCKED', 'systemLocked 字段为平台派生/代码消费，禁止通过字段编辑 API 修改（需走编排文件）');
  }

  const desc = payload.desc !== undefined ? (fieldAddTrimmedString(payload.desc) ?? '') : before.desc;
  if (!desc) throw new SkillFieldEditError(400, 'FIELD_DESC_REQUIRED', 'desc（功能描述/生成指令）必填');

  const persistKey = payload.persistKey !== undefined
    ? (fieldAddTrimmedString(payload.persistKey) ?? null)
    : before.persistKey;
  const pathInRawOutput = payload.pathInRawOutput !== undefined
    ? (fieldAddTrimmedString(payload.pathInRawOutput) ?? null)
    : before.pathInRawOutput;

  const turn = isNested ? false : payload.turn !== undefined ? fieldAddBooleanFlag(payload.turn, before.turn) : before.turn;

  return {
    ...before,
    coreType: rawType,
    turn,
    promptRole: role,
    valueType,
    persistKey,
    pathInRawOutput,
    render,
    handoff,
    internal,
    accumulate,
    visibilityPreset,
    locked,
    desc,
  };
}

/** 路由语义校验（镜像 POST/seed：自环 / 目标存在性 / render+internal / 无流转去向） */
function validateRoutingSemantics(agentId: string, target: SkillFieldSnapshot): void {
  if (target.handoff.includes(agentId)) {
    throw new SkillFieldEditError(422, 'HANDOFF_SELF_LOOP', `handoff 自环（指向自身 ${agentId}）`);
  }
  for (const handoffTarget of target.handoff) {
    const canonical = getCanonicalAgentId(handoffTarget);
    if (handoffTarget === canonical && (SKILL_STAGES as readonly string[]).includes(canonical as never)) continue;
    if (getAgentManifest(canonical)) continue;
    throw new SkillFieldEditError(
      422,
      'HANDOFF_TARGET_UNKNOWN',
      `handoff 目标 "${handoffTarget}" 不在 manifest（也不是阶段名 ${SKILL_STAGES.join('/')}）`,
    );
  }
  if (target.render === 'visible' && target.internal && target.promptRole !== 'control-signal') {
    throw new SkillFieldEditError(422, 'RENDER_INTERNAL_CONFLICT', 'render=visible 与 internal=true 组合仅允许 control-signal 字段');
  }
  if (target.handoff.length === 0 && !target.internal && !target.accumulate && target.render === 'visible' && target.promptRole !== 'public-reply') {
    throw new SkillFieldEditError(
      422,
      'ROUTING_NO_FLOW',
      'handoff 为空且非 public-reply/画像终点（internal+accumulate），缺少流转去向',
    );
  }
}

/** 幂等比对：目标快照与现状快照逐属性一致 → true */
function snapshotsEqual(a: SkillFieldSnapshot, b: SkillFieldSnapshot): boolean {
  const keys: Array<keyof SkillFieldSnapshot> = [
    'coreType', 'turn', 'promptRole', 'valueType', 'persistKey', 'pathInRawOutput',
    'render', 'handoff', 'internal', 'accumulate', 'visibilityPreset', 'locked', 'desc',
  ];
  return keys.every((key) => {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(va) || Array.isArray(vb)) return JSON.stringify(va) === JSON.stringify(vb);
    return va === vb;
  });
}

/**
 * 原子改字段主流程（导出于单测直接调用；路由侧薄封装）。
 * 落库采用 sync 全量对账（update 语义）：managedByCode=true 行更新、false 行跳过并报告。
 */
export async function updateSkillFieldInCoreAndOrchestration(
  skillId: string,
  name: string,
  payload: SkillFieldUpdateRequest,
  opts: { actorId?: string } = {},
): Promise<SkillFieldUpdateResult> {
  const ctx = await loadSkillFieldContext(skillId, name);
  const { entry, stageName, agentId, isNested, corePath, orchestrationPath, coreText, core, coreField, orchestrationText, stage, orchField, orchRouting } = ctx;

  // 系统锁保护（409）：platform 派生/代码消费字段只读
  if (orchField.systemLocked) {
    throw new SkillFieldEditError(
      409,
      'FIELD_SYSTEM_LOCKED',
      `字段 ${name} 为 systemLocked（平台派生/代码消费），禁止通过字段编辑 API 修改（只读，需走编排文件）`,
      { lockReason: 'systemLocked' },
    );
  }

  const before = buildSkillFieldSnapshot(ctx, name);
  const after = resolveFieldUpdateTarget(before, payload);
  validateRoutingSemantics(agentId, after);

  // 幂等：无变化 → 不写盘 / 不落库 / 不审计
  const changed = !snapshotsEqual(before, after);
  const syncCheck = analyzeCoreFieldsSync([stage], [entry], () => ({ core })).find((r) => r.skillId === skillId) ?? null;
  if (!changed) {
    return {
      skillId,
      stage: stageName,
      name,
      changed: false,
      coreWritten: false,
      orchestrationWritten: false,
      dbSync: { fieldsUpdated: 0, routingsUpdated: 0, contractsUpdated: 0, createdCount: 0, skippedAdminRows: [] },
      syncCheck,
      auditId: '',
    };
  }

  // 内存修改 + parse 双校验（任一失败 → 不落任何文件）
  const coreSpec: CoreFieldUpdateSpec = isNested
    ? { name, child: { path: name.split('.').slice(1).join('.'), type: after.coreType, desc: after.desc } }
    : { name, type: after.coreType, desc: after.desc, turn: after.turn };
  const newCoreText = updateFieldInCore(coreText, coreSpec);
  const coreChecked = parseCoreFile(corePath, newCoreText);
  if (!coreChecked.core) {
    throw new SkillFieldEditError(
      422,
      'CORE_VALIDATION_FAILED',
      `修改后核心文件未通过 parseCoreFile：${coreChecked.diagnostics.map((d) => d.message).join('；')}`,
    );
  }
  const newCore = coreChecked.core;

  const fieldSpec: OrchestrationFieldUpdateSpec = {
    fieldId: name,
    promptRole: after.promptRole,
    valueType: after.valueType,
    pathInRawOutput: after.pathInRawOutput,
    persistKey: after.persistKey,
    description: after.desc,
    systemLocked: after.locked === 'system' ? true : null,
    structureLocked: after.locked === 'structure' ? true : null,
  };
  const routingSpec: OrchestrationRoutingUpdateSpec = {
    agentId,
    fieldId: name,
    render: after.render,
    handoff: after.handoff,
    internal: after.internal,
    accumulate: after.accumulate,
    visibilityPreset: after.visibilityPreset,
  };
  const newOrchestrationText = updateFieldInOrchestration(orchestrationText, fieldSpec, routingSpec);
  let newStage: OrchestrationStage;
  try {
    newStage = validateOrchestrationContent(newOrchestrationText);
  } catch (error) {
    throw new SkillFieldEditError(
      422,
      'ORCHESTRATION_VALIDATION_FAILED',
      `修改后编排文件未通过 validateOrchestrationContent：${(error as Error).message}`,
    );
  }

  // 备份 + 写盘（编排写失败 → 回滚 core）
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(FIELD_ADD_BACKUPS_DIR, ts);
  try {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(corePath, path.join(backupDir, `core-${skillId}.yaml`));
    await fs.copyFile(orchestrationPath, path.join(backupDir, `orchestration-${stageName}.yaml`));
  } catch {
    // 备份失败不阻断（与既有备份模式一致）
  }
  await fs.writeFile(corePath, newCoreText, 'utf-8');
  try {
    await fs.writeFile(orchestrationPath, newOrchestrationText, 'utf-8');
  } catch (error) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    throw new SkillFieldEditError(
      500,
      'ORCHESTRATION_WRITE_FAILED',
      `编排文件写盘失败（core 已回滚原内容）：${(error as Error).message}；恢复备份参考：${backupDir}`,
    );
  }

  // fields-sync 复检（违规 → 双文件回滚）
  const recheckReport = analyzeCoreFieldsSync([newStage], [entry], () => ({ core: newCore })).find((r) => r.skillId === skillId) ?? null;
  const recheckFailed = recheckReport !== null
    && (recheckReport.missing.some((item) => item.fieldId === name || item.root === ctx.root)
      || recheckReport.typeMismatch.some((item) => item.fieldId === name));
  if (recheckFailed) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    await fs.writeFile(orchestrationPath, orchestrationText, 'utf-8').catch(() => undefined);
    throw new SkillFieldEditError(
      422,
      'FIELDS_SYNC_RECHECK_FAILED',
      'fields-sync 复检未通过（缺项/类型不一致），已回滚双文件（恢复原内容）',
      { syncCheck: recheckReport },
    );
  }

  // 落库：sync 全量对账（update 语义；managedByCode=false 行跳过并报告）
  let dbSync: SkillFieldUpdateResult['dbSync'] = {
    fieldsUpdated: 0, routingsUpdated: 0, contractsUpdated: 0, createdCount: 0, skippedAdminRows: [],
  };
  try {
    const report = await syncStageFieldRoutingsFromFile(systemPrisma, newStage);
    dbSync = {
      fieldsUpdated: report.fieldsUpdated,
      routingsUpdated: report.routingsUpdated,
      contractsUpdated: report.contractsUpdated,
      createdCount: report.createdCount,
      skippedAdminRows: report.skippedAdminRows,
    };
  } catch (error) {
    logger.warn('[prompt-lab] skill-field-update db sync failed（不阻断写盘结果）', {
      skillId,
      name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 审计（changeType='skill-field-update'；before=原摘要，after=新摘要）
  let auditId = '';
  try {
    auditId = await writeNodeConfigChange(systemPrisma, {
      changeType: 'skill-field-update',
      targetTable: 'core.yaml+orchestration',
      targetId: skillId,
      agentId,
      fieldId: name,
      before,
      after,
      actorId: opts.actorId ?? 'admin',
      reason: '改字段原子编辑（core.yaml + 编排文件双写 + sync 全量对账落库）',
    });
  } catch (auditError) {
    logger.warn('[prompt-lab] skill-field-update audit write failed（不阻断）', {
      skillId,
      error: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }

  try {
    clearRoutingCache();
    clearSupplementRenderCache();
  } catch {
    // 缓存清理失败不阻断
  }

  return {
    skillId,
    stage: stageName,
    name,
    changed: true,
    coreWritten: true,
    orchestrationWritten: true,
    dbSync,
    syncCheck: recheckReport,
    auditId,
  };
}

/**
 * PATCH /api/admin/prompt-lab/core/:skillId/field/:name
 * 原子改字段：双文件联动 + 回滚 + 落库 update 语义 + 审计 + 复检。
 */
router.patch('/core/:skillId/field/:name', async (req, res) => {
  const skillId = assertValidSkillId(req.params.skillId);
  await serializeFieldAdd(skillId, async () => {
    try {
      const result = await updateSkillFieldInCoreAndOrchestration(skillId, String(req.params.name), req.body ?? {}, {
        actorId: (req as Request & { user?: { userId?: string } }).user?.userId || 'admin',
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof SkillFieldEditError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          error: { message: error.message },
          ...(error.extra ?? {}),
        });
      }
      console.error('Skill field update error:', error);
      res.status(500).json({ success: false, error: { message: '改字段失败', details: (error as Error).message } });
    }
  });
});

/**
 * DELETE /api/admin/prompt-lab/core/:skillId/field/:name
 * 删字段原子 API（M3）：双文件联动删除 + 回滚 + 落库删除 + 审计 + 复检。
 *
 * 保护检查（任一不满足 → 409）：
 *   - systemLocked 字段禁删；
 *   - 消费检查：编排文件内其他 agent 的 routings 仍引用该 fieldId、或
 *     其他 skill 的 core inputs（ref: skill:<skillId>.<field>）消费该字段 → 409
 *     FIELD_CONSUMED（列出消费方；无消费时提示"删除前确认无下游消费"）。
 *
 * 删除范围：core fields 条目 + 编排 fields 条目 + 编排 routings 中该 skill 名下的行
 * （其他 agent 行不删，消费检查已 409 说明）。落库删除 field_definitions 行 +
 * 该 skill 名下 routings 行（managedByCode=false 行跳过并报告 protected）。
 */
export interface SkillFieldDeleteResult {
  skillId: string;
  stage: string;
  name: string;
  coreWritten: boolean;
  orchestrationWritten: boolean;
  /** 文件侧删除清单（core fields / 编排 fields / 编排 routings / core 级联条目） */
  deleted: Array<{ table: string; key: string }>;
  /** 文件侧无新孤儿断言 */
  syncCheck: CoreFieldsSyncSkillReport | null;
  /** DB 侧删除清单（field_definitions / agent_field_routings） */
  dbDeleted: Array<{ table: string; key: string }>;
  /** managedByCode=false 覆盖行（跳过，仅报告） */
  protectedRows: Array<{ table: string; key: string }>;
  auditId: string;
}

/** 扫描全部 core 文件 inputs：其他 skill 的 `ref: skill:<skillId>.<field>` 消费引用 */
async function findCoreInputConsumers(skillId: string, fieldName: string): Promise<Array<{ skillId: string; refs: string[] }>> {
  const refPrefix = `skill:${skillId}.`;
  const root = fieldName.split('.')[0];
  const consumers: Array<{ skillId: string; refs: string[] }> = [];
  let files: string[];
  try {
    files = await fs.readdir(CORE_FILES_DIR);
  } catch {
    return consumers;
  }
  for (const file of files.filter((f) => f.endsWith('.yaml'))) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(CORE_FILES_DIR, file), 'utf-8');
    } catch {
      continue;
    }
    let parsed: Record<string, unknown> | null;
    try {
      parsed = (yaml.load(raw) as Record<string, unknown>) ?? null;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.skillId !== 'string') continue;
    const consumerSkillId = parsed.skillId;
    if (consumerSkillId === skillId) continue; // 自身 inputs 不算下游消费
    const inputs = Array.isArray(parsed.inputs) ? (parsed.inputs as Array<Record<string, unknown>>) : [];
    const refs: string[] = [];
    for (const input of inputs) {
      const ref = typeof input?.ref === 'string' ? input.ref : '';
      if (!ref.startsWith(refPrefix)) continue;
      const rest = ref.slice(refPrefix.length);
      if (rest === root || rest === fieldName || rest.startsWith(`${root}.`) || rest.startsWith(`${fieldName}.`)) {
        refs.push(ref);
      }
    }
    if (refs.length > 0) consumers.push({ skillId: consumerSkillId, refs });
  }
  return consumers;
}

/**
 * 原子删字段主流程（导出于单测直接调用；路由侧薄封装）。
 */
export async function deleteSkillFieldFromCoreAndOrchestration(
  skillId: string,
  name: string,
  opts: { actorId?: string } = {},
): Promise<SkillFieldDeleteResult> {
  const ctx = await loadSkillFieldContext(skillId, name);
  const { entry, stageName, agentId, isNested, root, corePath, orchestrationPath, coreText, core, orchestrationText, stage, orchField, orchRouting } = ctx;

  // ---- 保护检查 1：systemLocked 禁删 ----
  if (orchField.systemLocked) {
    throw new SkillFieldEditError(
      409,
      'FIELD_SYSTEM_LOCKED',
      `字段 ${name} 为 systemLocked（平台派生/代码消费），禁止删除；锁原因见编排文件 systemLocked 声明`,
      { lockReason: 'systemLocked' },
    );
  }

  // ---- 保护检查 2：消费检查（编排内其他 agent 引用 + 其他 skill core inputs 消费） ----
  const otherAgents = stage.routings
    .filter((r) => r.fieldId === name && r.agentId !== agentId)
    .map((r) => r.agentId);
  const inputConsumers = await findCoreInputConsumers(skillId, name);
  if (otherAgents.length > 0 || inputConsumers.length > 0) {
    const consumers: Record<string, unknown> = {
      agents: otherAgents,
      skills: inputConsumers,
    };
    const parts: string[] = [];
    if (otherAgents.length > 0) parts.push(`编排文件内其他 agent 的 routings 仍引用：${otherAgents.join(', ')}`);
    if (inputConsumers.length > 0) {
      parts.push(`其他 skill 的 core inputs 消费：${inputConsumers.map((c) => `${c.skillId}（${c.refs.join('，')}）`).join('；')}`);
    }
    throw new SkillFieldEditError(
      409,
      'FIELD_CONSUMED',
      `字段 ${name} 仍被下游引用，禁止删除：${parts.join('；')}（如需删除请先解除下游消费）`,
      { consumers },
    );
  }

  // ---- 删除前快照（审计 before = 被删字段全量摘要） ----
  const before = buildSkillFieldSnapshot(ctx, name);

  // ---- 内存删除 + parse 双校验 ----
  const deleted: Array<{ table: string; key: string }> = [];
  let newCoreText = deleteFieldFromCore(coreText, name).text;
  deleted.push({ table: 'core-fields', key: name });
  if (isNested) {
    // 级联：该 skill 名下 root 已无任何路由行 → 移除 core root 顶层条目（防新孤儿）
    const remainingRootRows = stage.routings.filter((r) => r.agentId === agentId && r.fieldId.split('.')[0] === root && r.fieldId !== name);
    if (remainingRootRows.length === 0) {
      newCoreText = deleteFieldFromCore(newCoreText, root).text;
      deleted.push({ table: 'core-fields', key: root });
    }
  }
  const coreChecked = parseCoreFile(corePath, newCoreText);
  if (!coreChecked.core) {
    throw new SkillFieldEditError(
      422,
      'CORE_VALIDATION_FAILED',
      `删除后核心文件未通过 parseCoreFile：${coreChecked.diagnostics.map((d) => d.message).join('；')}`,
    );
  }
  const newCore = coreChecked.core;

  const orchResult = deleteFieldFromOrchestration(orchestrationText, name, agentId, { removeFieldEntry: true });
  deleted.push({ table: 'orchestration-routings', key: `${agentId}/${name}` });
  if (orchResult.fieldRemoved) deleted.push({ table: 'orchestration-fields', key: name });
  let newStage: OrchestrationStage;
  try {
    newStage = validateOrchestrationContent(orchResult.text);
  } catch (error) {
    throw new SkillFieldEditError(
      422,
      'ORCHESTRATION_VALIDATION_FAILED',
      `删除后编排文件未通过 validateOrchestrationContent：${(error as Error).message}`,
    );
  }

  // ---- 备份 + 双文件写（编排写失败 → 回滚 core） ----
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(FIELD_ADD_BACKUPS_DIR, ts);
  try {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(corePath, path.join(backupDir, `core-${skillId}.yaml`));
    await fs.copyFile(orchestrationPath, path.join(backupDir, `orchestration-${stageName}.yaml`));
  } catch {
    // 备份失败不阻断（与既有备份模式一致）
  }
  await fs.writeFile(corePath, newCoreText, 'utf-8');
  try {
    await fs.writeFile(orchestrationPath, orchResult.text, 'utf-8');
  } catch (error) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    throw new SkillFieldEditError(
      500,
      'ORCHESTRATION_WRITE_FAILED',
      `编排文件写盘失败（core 已回滚原内容）：${(error as Error).message}；恢复备份参考：${backupDir}`,
    );
  }

  // ---- fields-sync 复检（删后 core 与编排同时少 → 应无新缺项/新孤儿） ----
  const recheckReport = analyzeCoreFieldsSync([newStage], [entry], () => ({ core: newCore })).find((r) => r.skillId === skillId) ?? null;
  const recheckFailed = recheckReport !== null
    && (recheckReport.missing.some((item) => item.fieldId === name || item.root === root)
      || recheckReport.typeMismatch.some((item) => item.fieldId === name)
      || recheckReport.orphan.some((item) => deleted.some((d) => d.key === item.coreField)));
  if (recheckFailed) {
    await fs.writeFile(corePath, coreText, 'utf-8').catch(() => undefined);
    await fs.writeFile(orchestrationPath, orchestrationText, 'utf-8').catch(() => undefined);
    throw new SkillFieldEditError(
      422,
      'FIELDS_SYNC_RECHECK_FAILED',
      'fields-sync 复检未通过（删除产生新缺项/孤儿/类型不一致），已回滚双文件（恢复原内容）',
      { syncCheck: recheckReport },
    );
  }

  // ---- 落库：删除 field_definitions 行 + 该 skill 名下 routings 行（跳过 managedByCode=false 并报告） ----
  const dbDeleted: Array<{ table: string; key: string }> = [];
  const protectedRows: Array<{ table: string; key: string }> = [];
  try {
    const report = await deleteStageFieldRows(systemPrisma, { stage: stageName, fieldId: name, agentId });
    for (const row of report.deletedRows) dbDeleted.push({ table: row.table, key: row.key });
    for (const row of report.protectedRows) protectedRows.push(row);
  } catch (error) {
    logger.warn('[prompt-lab] skill-field-delete db delete failed（不阻断写盘结果）', {
      skillId,
      name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ---- 审计（changeType='skill-field-delete'；before=被删字段全量摘要） ----
  let auditId = '';
  try {
    auditId = await writeNodeConfigChange(systemPrisma, {
      changeType: 'skill-field-delete',
      targetTable: 'core.yaml+orchestration',
      targetId: skillId,
      agentId,
      fieldId: name,
      before: { ...before, routing: { render: orchRouting.render, handoff: orchRouting.handoff, internal: orchRouting.internal, accumulate: orchRouting.accumulate } },
      after: null,
      actorId: opts.actorId ?? 'admin',
      reason: '删字段原子删除（core.yaml + 编排文件双写 + DB 行清理）',
    });
  } catch (auditError) {
    logger.warn('[prompt-lab] skill-field-delete audit write failed（不阻断）', {
      skillId,
      error: auditError instanceof Error ? auditError.message : String(auditError),
    });
  }

  try {
    clearRoutingCache();
    clearSupplementRenderCache();
  } catch {
    // 缓存清理失败不阻断
  }

  return {
    skillId,
    stage: stageName,
    name,
    coreWritten: true,
    orchestrationWritten: true,
    deleted,
    syncCheck: recheckReport,
    dbDeleted,
    protectedRows,
    auditId,
  };
}

/**
 * DELETE /api/admin/prompt-lab/core/:skillId/field/:name
 * 原子删字段：双文件联动删除 + 回滚 + 落库删除 + 审计 + 复检。
 */
router.delete('/core/:skillId/field/:name', async (req, res) => {
  const skillId = assertValidSkillId(req.params.skillId);
  await serializeFieldAdd(skillId, async () => {
    try {
      const result = await deleteSkillFieldFromCoreAndOrchestration(skillId, String(req.params.name), {
        actorId: (req as Request & { user?: { userId?: string } }).user?.userId || 'admin',
      });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof SkillFieldEditError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          error: { message: error.message },
          ...(error.extra ?? {}),
        });
      }
      console.error('Skill field delete error:', error);
      res.status(500).json({ success: false, error: { message: '删字段失败', details: (error as Error).message } });
    }
  });
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
        metadata: true,
      },
      take: 30,
    });
    const versions = rows.map((row) => ({
      ...row,
      // 旧版本没有 coreSnapshot 时只可审计，不能安全回滚到 core SSOT。
      rollbackable: Boolean(resolveCoreSnapshot(row.metadata, skillId).core),
      metadata: undefined,
    }));
    res.json({ success: true, skillId, versions });
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

    const snapshot = resolveCoreSnapshot(target.metadata, skillId);
    if (!snapshot.core || !snapshot.raw) {
      return res.status(409).json({
        error: snapshot.error,
        code: 'HISTORICAL_CORE_SNAPSHOT_REQUIRED',
      });
    }
    const compiled = compileCoreFile(snapshot.core, { coreVersion: target.coreVersion ?? 1 });
    if (target.coreHash && target.coreHash !== compiled.coreHash) {
      return res.status(409).json({
        error: '历史版本 coreHash 与 coreSnapshot 不一致，拒绝回滚',
        code: 'HISTORICAL_CORE_HASH_MISMATCH',
      });
    }
    if (target.systemPrompt.trim() !== compiled.body.trim()) {
      return res.status(409).json({
        error: '历史版本 Prompt 不可由 coreSnapshot 确定性重建，拒绝回滚',
        code: 'HISTORICAL_PROMPT_MISMATCH',
      });
    }

    // 操作审计：回滚前快照当前 ACTIVE 版本（旧版本），回滚后快照目标版本（新版本）
    const activeBefore = await systemPrisma.agent_prompts.findFirst({
      where: { agentId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, coreHash: true, coreVersion: true },
    });
    setAuditAction(res, 'prompt-lab-rollback', { targetType: 'skill', targetId: skillId });
    setAuditBefore(res, activeBefore ?? null);

    // 1) 文件回写：先恢复 core SSOT，再由其确定性重建 Runtime Prompt。
    const prodPath = path.join(PROMPTS_DIR, `skill.${skillId}.md`);
    const corePath = path.join(CORE_FILES_DIR, `${skillId}.yaml`);
    try {
      const backupsDir = path.join(BACKUPS_DIR, skillId);
      await fs.mkdir(backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.copyFile(prodPath, path.join(backupsDir, `${ts}.md`));
      await fs.copyFile(corePath, path.join(backupsDir, `core-${ts}.yaml`));
    } catch { /* 备份失败不阻塞 */ }
    await fs.writeFile(corePath, snapshot.raw, 'utf-8');
    await fs.writeFile(prodPath, compiled.prompt, 'utf-8');

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
      logger.warn('Failed to invalidate prompt/gateway cache:', { error: cacheErr?.message || String(cacheErr) });
    }

    setAuditAfter(res, {
      id: target.id,
      version: target.version,
      status: 'ACTIVE',
      coreHash: target.coreHash,
      coreVersion: target.coreVersion,
    });

    res.json({ success: true, skillId, agentId, version, rolledBack: true });
  } catch (error) {
    console.error('Rollback error:', error);
    res.status(500).json({ error: '回滚失败', details: (error as Error).message });
  }
});

/**
 * GET /api/prompt-lab/core/:skillId/lineage
 * v4 工作台：字段血缘（静态注册表 ∪ 全仓 core inputs 声明推导）
 */
router.get('/core/:skillId/lineage', async (req, res) => {
  try {
    const skillId = assertValidSkillId(req.params.skillId);
    res.json({ success: true, skillId, lineage: getFieldLineageWithDeclarations(skillId) });
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

export default router;
