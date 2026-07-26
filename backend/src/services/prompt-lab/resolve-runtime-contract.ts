import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import {
  buildDefaultRuntimeContract,
  normalizeRuntimeContract,
  type RuntimeContract,
} from './runtime-contract';

const MANIFESTS_DIR = path.join(process.cwd(), '../prompt-lab/manifests');

function toSkillId(agentId: string): string {
  return String(agentId || '').replace(/^skill:/, '').trim();
}

export type EffectiveRuntimeContractSource = 'active-metadata' | 'manifest' | 'default';

export interface EffectiveRuntimeContractResolution {
  skillId: string;
  source: EffectiveRuntimeContractSource;
  contract: RuntimeContract;
}

/**
 * 从 ACTIVE prompt metadata 提取 runtimeContract。
 * metadata 可能是对象或 JSON 字符串；解析失败或未声明时返回 null。
 */
export function extractRuntimeContractFromPromptMetadata(
  metadata: unknown,
  agentId: string,
  options: { archetype?: string } = {}
): RuntimeContract | null {
  if (metadata == null) return null;
  let parsed: any = metadata;
  if (typeof metadata === 'string') {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  const candidate = parsed?.promptLab?.runtimeContract;
  if (!candidate || typeof candidate !== 'object') return null;
  return normalizeRuntimeContract(candidate, {
    skillId: toSkillId(agentId),
    archetype: options.archetype || '',
  });
}

/**
 * 有效 runtimeContract 解析：
 * 1) ACTIVE prompt metadata.promptLab.runtimeContract
 * 2) prompt-lab manifest
 * 3) buildDefaultRuntimeContract
 *
 * 接受已加载的 promptConfig，不额外查询 DB。
 */
export async function resolveEffectiveRuntimeContract(
  agentId: string,
  promptConfig?: { metadata?: unknown } | null,
  options: { archetype?: string } = {}
): Promise<EffectiveRuntimeContractResolution> {
  const fromMeta = extractRuntimeContractFromPromptMetadata(
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
  const resolved = await resolveRuntimeContract(agentId, options);
  return {
    skillId: resolved.skillId,
    source: resolved.source,
    contract: resolved.contract,
  };
}

/**
 * 解析 skill 的 runtimeContract：
 * 1) 有 prompt-lab/manifests/<skillId>.yaml 则读其中 runtimeContract 并 normalize
 * 2) 否则用 buildDefaultRuntimeContract 推断
 */
export async function resolveRuntimeContract(
  agentId: string,
  options: { archetype?: string } = {}
): Promise<{ contract: RuntimeContract; source: 'manifest' | 'default'; skillId: string }> {
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
      contract: normalizeRuntimeContract(parsed.runtimeContract, {
        skillId,
        archetype: manifestArchetype,
      }),
    };
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      // 坏 yaml 时回退默认，避免 overview 整页挂掉
      console.warn(`[resolveRuntimeContract] failed for ${skillId}:`, error?.message || error);
    }
    return {
      skillId,
      source: 'default',
      contract: buildDefaultRuntimeContract(skillId, archetype),
    };
  }
}

export async function resolveRuntimeContractsForAgents(
  agentIds: string[],
  archetypeByAgent?: Map<string, string>
): Promise<Map<string, { contract: RuntimeContract; source: 'manifest' | 'default' }>> {
  const result = new Map<string, { contract: RuntimeContract; source: 'manifest' | 'default' }>();
  await Promise.all(
    agentIds.map(async (agentId) => {
      const resolved = await resolveRuntimeContract(agentId, {
        archetype: archetypeByAgent?.get(agentId) || '',
      });
      result.set(agentId, { contract: resolved.contract, source: resolved.source });
    })
  );
  return result;
}
