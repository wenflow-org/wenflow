import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import {
  buildDefaultSkillPromptContract,
  normalizeSkillPromptContract,
  type SkillPromptContract,
} from '../skill-prompt-contract';
import type { RuntimeContract } from './runtime-contract';

const MANIFESTS_DIR = path.join(process.cwd(), '../prompts/manifests');

function toSkillId(agentId: string): string {
  return String(agentId || '').replace(/^skill:/, '').trim();
}

export type EffectivePromptContractSource = 'active-metadata' | 'manifest' | 'default';

export interface EffectivePromptContractResolution {
  skillId: string;
  source: EffectivePromptContractSource;
  contract: SkillPromptContract;
}

export interface ResolvePromptContractOptions {
  archetype?: string;
  /** 已解析的 runtimeContract，用于 output.envelope 默认值推断与一致性基准。 */
  runtimeContract?: RuntimeContract | null;
}

/**
 * 从 ACTIVE prompt metadata 提取 promptContract。
 * metadata 可能是对象或 JSON 字符串；解析失败或未声明时返回 null。
 */
export function extractPromptContractFromPromptMetadata(
  metadata: unknown,
  agentId: string,
  options: ResolvePromptContractOptions = {}
): SkillPromptContract | null {
  if (metadata == null) return null;
  let parsed: any = metadata;
  if (typeof metadata === 'string') {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  const candidate = parsed?.promptLab?.promptContract;
  if (!candidate || typeof candidate !== 'object') return null;
  return normalizeSkillPromptContract(candidate, {
    skillId: toSkillId(agentId),
    archetype: options.archetype || '',
    runtimeContract: options.runtimeContract ?? null,
  });
}

/**
 * 有效 promptContract 解析（与 runtimeContract 同一优先级链）：
 * 1) ACTIVE prompt metadata.promptLab.promptContract
 * 2) prompt-lab manifest
 * 3) buildDefaultSkillPromptContract
 *
 * 接受已加载的 promptConfig，不额外查询 DB。
 */
export async function resolveEffectivePromptContract(
  agentId: string,
  promptConfig?: { metadata?: unknown } | null,
  options: ResolvePromptContractOptions = {}
): Promise<EffectivePromptContractResolution> {
  const fromMeta = extractPromptContractFromPromptMetadata(
    promptConfig?.metadata,
    agentId,
    options
  );
  if (fromMeta) {
    return {
      skillId: toSkillId(agentId),
      source: 'active-metadata',
      contract: fromMeta,
    };
  }
  const resolved = await resolvePromptContract(agentId, options);
  return {
    skillId: resolved.skillId,
    source: resolved.source,
    contract: resolved.contract,
  };
}

/**
 * 解析 skill 的 promptContract：
 * 1) 有 prompts/manifests/<skillId>.yaml 则读其中 promptContract 并 normalize
 * 2) 否则用 buildDefaultSkillPromptContract 推断
 */
export async function resolvePromptContract(
  agentId: string,
  options: ResolvePromptContractOptions = {}
): Promise<{ contract: SkillPromptContract; source: 'manifest' | 'default'; skillId: string }> {
  const skillId = toSkillId(agentId);
  const archetype = options.archetype || '';
  const filePath = path.join(MANIFESTS_DIR, `${skillId}.yaml`);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = (yaml.load(raw) || {}) as Record<string, unknown>;
    const manifestArchetype =
      typeof parsed.archetype === 'string' && parsed.archetype.trim()
        ? parsed.archetype.trim()
        : archetype;
    return {
      skillId,
      source: 'manifest',
      contract: normalizeSkillPromptContract(parsed.promptContract, {
        skillId,
        archetype: manifestArchetype,
        runtimeContract: options.runtimeContract ?? null,
      }),
    };
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // 坏 yaml 时回退默认，避免调用链整页挂掉
      console.warn(`[resolvePromptContract] failed for ${skillId}:`, error?.message || error);
    }
    return {
      skillId,
      source: 'default',
      contract: buildDefaultSkillPromptContract({
        skillId,
        archetype,
        runtimeContract: options.runtimeContract ?? null,
      }),
    };
  }
}

export async function resolvePromptContractsForAgents(
  agentIds: string[],
  optionsByAgent?: Map<string, ResolvePromptContractOptions>
): Promise<Map<string, { contract: SkillPromptContract; source: 'manifest' | 'default' }>> {
  const result = new Map<string, { contract: SkillPromptContract; source: 'manifest' | 'default' }>();
  await Promise.all(
    agentIds.map(async (agentId) => {
      const resolved = await resolvePromptContract(agentId, optionsByAgent?.get(agentId) || {});
      result.set(agentId, { contract: resolved.contract, source: resolved.source });
    })
  );
  return result;
}
