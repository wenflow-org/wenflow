/**
 * Prompt Lab manifest 读写（2026-10-24 架构优化批 1：routes/prompt-lab.ts 拆分迁出）。
 *
 * prompts/manifests/<skillId>.yaml 的 sanitize/normalize/序列化/读写，含 prompt frontmatter
 * 迁移合并与 skillId 防穿越复验。M3：manifests 目录与 prompts 同级（PROMPTS_DIR 解析，
 * 支持 PROMPTS_DIR 环境变量覆盖），避免 process.cwd() 双轨不一致。
 */
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { buildDefaultRuntimeContract, normalizeRuntimeContract, type RuntimeContract } from './runtime-contract';
import {
  buildDefaultSkillPromptContract,
  normalizeSkillPromptContract,
  type SkillPromptContract,
} from '../skill-prompt-contract';
import { parsePromptFrontmatterMeta, PROMPTS_DIR } from '../../composers/prompt-files/loader';
import { findPlatformReasoningDefaultModelRow } from './prompt-lab-versions.repo';

// M3：prompts 目录复用 loader 的 PROMPTS_DIR 解析（支持 PROMPTS_DIR 环境变量覆盖），
// prompts/manifests 与 prompts 同级存放于仓库根，避免 process.cwd() 双轨不一致。
const MANIFESTS_DIR = path.join(PROMPTS_DIR, 'manifests');

export type PromptLabManifest = {
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

export function assertValidSkillId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('skillId 必须是字符串');
  }
  const skillId = value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(skillId)) {
    throw new Error(`非法 skillId: ${value}`);
  }
  return skillId;
}

function looksLikeMojibake(value: unknown) {
  if (typeof value !== 'string') return false;
  return /[\uFFFD鍔浣瀛韬唤璺緞]/.test(value);
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
          maxTokens: sanitizeNumber(runtimeDefaults.maxTokens, 64000, 1000, 64000),
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
  assertValidSkillId(skillId); // 文件名由 skillId 拼接，进入路径前复验（防穿越，勿删）
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

export async function loadManifest(skillId: string, sourceContent = '') {
  assertValidSkillId(skillId); // manifest 文件名由 skillId 拼接，进入路径前复验（防穿越，勿删）
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

export async function writeManifest(skillId: string, manifestInput: any, sourceContent = '') {
  assertValidSkillId(skillId); // manifest 文件名由 skillId 拼接，写盘前复验（防穿越，勿删）
  const manifest = normalizeManifest(skillId, manifestInput, sourceContent);
  const filePath = path.join(MANIFESTS_DIR, `${skillId}.yaml`);
  await fs.mkdir(MANIFESTS_DIR, { recursive: true });
  await fs.writeFile(filePath, serializeManifest(manifest), 'utf-8');
  return manifest;
}

export async function getPlatformReasoningDefaultModel() {
  try {
    const row = await findPlatformReasoningDefaultModelRow();
    return sanitizeString(row?.defaultReasoningModel, '') || null;
  } catch {
    return null;
  }
}
