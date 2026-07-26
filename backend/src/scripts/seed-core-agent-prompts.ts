/**
 * Prompt 同步服务（File-as-Truth 架构）
 * 
 * 设计原则：
 * - prompts/*.md 文件是 prompt 的唯一权威源（进 git）
 * - 启动时/手动调用时，从文件 sync 到 DB
 * - DB 仅作运行时镜像与统计载体，可随时重建
 * - 不再从代码常量读取，改为扫描 prompts/ 目录
 */

import type { PrismaClient } from '../generated/system-client';
import { loadAllPromptFiles, type PromptFile } from '../composers/prompt-files/loader';
import {
  normalizeRuntimeContract,
  type RuntimeContract,
} from '../services/prompt-lab/runtime-contract';
import {
  lintDeclaredSkillPromptContract,
  type SkillPromptContract,
} from '../services/skill-prompt-contract';

export interface CoreAgentPromptSeed {
  agentId: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  acceptableAgentIds?: string[];
  /** 来自 prompt 文件 frontmatter 的运行时契约快照 */
  metadata?: string;
}

export interface CoreAgentPromptSeedResult {
  created: string[];
  skipped: string[];
}

export type CoreAgentPromptEnsureMode = 'bootstrap' | 'backfill' | 'sync';

export interface CoreAgentPromptEnsureResult {
  mode: CoreAgentPromptEnsureMode;
  totalPromptCountBefore: number;
  performed: boolean;
  created: string[];
  skipped: string[];
  missingBefore: string[];
  updated?: string[];
  reason: 'seeded-empty-table' | 'table-not-empty' | 'backfilled-missing' | 'no-missing-prompts' | 'synced-from-code' | 'already-in-sync';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runtimeContractError(agentId: string, field: string, detail: string): Error {
  const fieldPath = field ? `.${field}` : '';
  return new Error(`Prompt ${agentId} has an invalid runtimeContract${fieldPath}: ${detail}`);
}

function requireNonBlankString(value: unknown, agentId: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw runtimeContractError(agentId, field, 'expected a non-empty string');
  }
  return value.trim();
}

function requireStringArray(value: unknown, agentId: string, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw runtimeContractError(agentId, field, 'expected a non-empty string array');
  }
  return value.map((item, index) => requireNonBlankString(item, agentId, `${field}[${index}]`));
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  agentId: string,
  field: string
): T {
  const normalized = requireNonBlankString(value, agentId, field);
  if (!allowed.includes(normalized as T)) {
    throw runtimeContractError(agentId, field, `expected one of: ${allowed.join(', ')}`);
  }
  return normalized as T;
}

/**
 * 明确声明的契约必须完整有效。normalizeRuntimeContract 会为缺失字段推断默认值，
 * 因此前置校验以避免错误的文件声明在同步时被悄悄改写为默认契约。
 */
function validateDeclaredRuntimeContract(value: unknown, agentId: string): void {
  if (!isRecord(value)) {
    throw runtimeContractError(agentId, '', 'expected an object');
  }

  requireOneOf(value.version, ['prompt-runtime-contract/v1'] as const, agentId, 'version');
  requireOneOf(
    value.contextMode,
    ['state-refresh', 'thread-context', 'snapshot-context', 'simulation-refresh'] as const,
    agentId,
    'contextMode'
  );

  if (!isRecord(value.businessState)) {
    throw runtimeContractError(agentId, 'businessState', 'expected an object');
  }
  const businessState = value.businessState;
  requireNonBlankString(businessState.domain, agentId, 'businessState.domain');
  const phases = requireStringArray(businessState.phases, agentId, 'businessState.phases');
  const defaultPhase = requireNonBlankString(businessState.defaultPhase, agentId, 'businessState.defaultPhase');
  if (!phases.includes(defaultPhase)) {
    throw runtimeContractError(agentId, 'businessState.defaultPhase', 'must be included in businessState.phases');
  }
  const terminalPhases = requireStringArray(
    businessState.terminalPhases,
    agentId,
    'businessState.terminalPhases'
  );
  if (terminalPhases.some((phase) => !phases.includes(phase))) {
    throw runtimeContractError(agentId, 'businessState.terminalPhases', 'must only contain businessState.phases values');
  }
  const statusValues = requireStringArray(businessState.statusValues, agentId, 'businessState.statusValues');
  const allowedStatusValues = ['succeeded', 'partial', 'blocked', 'failed'];
  if (statusValues.some((status) => !allowedStatusValues.includes(status))) {
    throw runtimeContractError(
      agentId,
      'businessState.statusValues',
      `must only contain: ${allowedStatusValues.join(', ')}`
    );
  }

  if (!isRecord(value.contextUpdate)) {
    throw runtimeContractError(agentId, 'contextUpdate', 'expected an object');
  }
  const contextUpdate = value.contextUpdate;
  requireOneOf(
    contextUpdate.mode,
    ['none', 'state-refresh', 'thread-state', 'simulation-refresh'] as const,
    agentId,
    'contextUpdate.mode'
  );
  requireOneOf(
    contextUpdate.stateOwner,
    ['runtime', 'model', 'orchestrator', 'none'] as const,
    agentId,
    'contextUpdate.stateOwner'
  );
  if (contextUpdate.description !== undefined) {
    requireNonBlankString(contextUpdate.description, agentId, 'contextUpdate.description');
  }

  requireOneOf(value.outputEnvelope, ['adapter', 'model'] as const, agentId, 'outputEnvelope');
}

export interface DeclaredPromptRuntimeContractIdentity {
  agentId: string;
  archetype?: string;
}

function normalizeDeclaredPromptContract(
  file: Pick<PromptFile, 'agentId' | 'archetype' | 'promptContract'>,
  runtimeContract?: RuntimeContract
): SkillPromptContract | undefined {
  if (file.promptContract === undefined) return undefined;
  const result = lintDeclaredSkillPromptContract(file.promptContract, {
    skillId: file.agentId,
    archetype: file.archetype,
    runtimeContract,
  });
  const errors = result.issues.filter((issue) => issue.level === 'error');
  if (errors.length > 0) {
    throw new Error(`Prompt ${file.agentId} has an invalid promptContract: ${errors.map((issue) => `${issue.field}: ${issue.message}`).join('; ')}`);
  }
  return result.contract;
}

/**
 * 仅供已经显式声明的 runtimeContract 使用。先拒绝不完整或错误的声明，
 * 再复用运行时标准化逻辑生成稳定快照，不能让默认推断掩盖声明错误。
 */
export function normalizeDeclaredPromptRuntimeContract(
  value: unknown,
  identity: DeclaredPromptRuntimeContractIdentity
): RuntimeContract {
  validateDeclaredRuntimeContract(value, identity.agentId);
  return normalizeRuntimeContract(value, {
    skillId: identity.agentId.replace(/^skill:/, ''),
    archetype: identity.archetype || '',
  });
}

/** 由 prompt frontmatter 生成新版本使用的 metadata 快照；没有声明时保持 metadata 缺失。 */
export function buildPromptFileRuntimeContractMetadata(
  file: Pick<PromptFile, 'agentId' | 'archetype' | 'promptContract' | 'runtimeContract'>
): string | undefined {
  if (file.runtimeContract === undefined && file.promptContract === undefined) return undefined;

  const runtimeContract = file.runtimeContract === undefined
    ? undefined
    : normalizeDeclaredPromptRuntimeContract(file.runtimeContract, file);
  const promptContract = normalizeDeclaredPromptContract(file, runtimeContract);
  return JSON.stringify({
    promptLab: {
      source: 'prompt-file',
      ...(runtimeContract
        ? {
            runtimeContractSource: 'prompt-frontmatter',
            runtimeContract,
          }
        : {}),
      ...(promptContract
        ? {
            promptContractSource: 'prompt-frontmatter',
            promptContract,
          }
        : {}),
    },
  });
}

/** 将 File-as-Truth prompt 文件映射为可写入数据库的种子定义。 */
export function mapPromptFileToCoreAgentPromptSeed(file: PromptFile): CoreAgentPromptSeed {
  const metadata = buildPromptFileRuntimeContractMetadata(file);
  return {
    agentId: file.agentId,
    name: file.name,
    description: file.description || `从文件 ${file.agentId}.md 加载`,
    systemPrompt: file.systemPrompt,
    temperature: file.temperature ?? 0.7,
    maxTokens: file.maxTokens ?? 4000,
    acceptableAgentIds: file.acceptableAgentIds,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/**
 * 从 prompts/ 目录动态加载 prompt 文件
 * 替代原先硬编码的 CORE_AGENT_PROMPT_SEEDS 数组
 */
export function loadCoreAgentPromptSeeds(): CoreAgentPromptSeed[] {
  return loadAllPromptFiles()
    .filter((file) => file.archetype !== 'code-only')
    .map(mapPromptFileToCoreAgentPromptSeed);
}

/**
 * 兼容旧代码：CORE_AGENT_PROMPT_SEEDS 现在动态生成
 * @deprecated 直接调用 loadCoreAgentPromptSeeds() 更明确
 */
export const CORE_AGENT_PROMPT_SEEDS: CoreAgentPromptSeed[] = [
  // 旧的硬编码数组已废弃，现在由文件驱动
  // 为保持向后兼容，保留空数组占位，但实际逻辑已改为动态加载
  // 请使用 loadCoreAgentPromptSeeds() 或直接调用 ensureCoreAgentPrompts()
];


function getAcceptableAgentIds(seed: CoreAgentPromptSeed): string[] {
  const rawIds = Array.isArray(seed.acceptableAgentIds) && seed.acceptableAgentIds.length > 0
    ? seed.acceptableAgentIds
    : [seed.agentId];
  return Array.from(new Set(rawIds.map((value) => value.trim()).filter(Boolean)));
}

function buildPromptName(name: string, version: number): string {
  if (/^v\d+-/.test(name)) {
    return name.replace(/^v\d+-/, `v${version}-`);
  }
  return `v${version}-${name}`;
}

async function createPromptSeedRecord(
  prisma: PrismaClient,
  seed: CoreAgentPromptSeed,
  version: number,
  createdBy: string,
  defaultModel: string
) {
  await prisma.agent_prompts.create({
    data: {
      id: `ap_seed_${seed.agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentId: seed.agentId,
      version,
      name: buildPromptName(seed.name, version),
      description: seed.description,
      systemPrompt: seed.systemPrompt,
      temperature: seed.temperature,
      maxTokens: seed.maxTokens,
      model: defaultModel || null,
      status: 'ACTIVE',
      createdBy,
      publishedAt: new Date(),
      ...(seed.metadata === undefined ? {} : { metadata: seed.metadata }),
    },
  });
}

function normalizePromptText(value: string | null | undefined): string {
  return (value || '').replace(/\r\n/g, '\n').trim();
}

function matchesSeedConfig(activePrompt: {
  systemPrompt: string | null;
  temperature: number | null;
  maxTokens: number | null;
  model: string | null;
}, seed: CoreAgentPromptSeed, defaultModel: string): boolean {
  return normalizePromptText(activePrompt.systemPrompt) === normalizePromptText(seed.systemPrompt)
    && Number(activePrompt.temperature ?? seed.temperature) === Number(seed.temperature)
    && Number(activePrompt.maxTokens ?? seed.maxTokens) === Number(seed.maxTokens)
    && (!defaultModel || String(activePrompt.model || '') === defaultModel);
}

async function resolveDefaultModel(prisma: PrismaClient): Promise<string> {
  const config = await prisma.platform_api_configs.findUnique({
    where: { id: 'platform' },
    select: { defaultModel: true }
  });
  return String(config?.defaultModel || process.env.AI_MODEL || '').trim();
}

async function syncCoreAgentPrompts(prisma: PrismaClient): Promise<{
  created: string[];
  updated: string[];
  skipped: string[];
}> {
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const defaultModel = await resolveDefaultModel(prisma);

  const seeds = loadCoreAgentPromptSeeds();
  for (const seed of seeds) {
    const acceptableIds = getAcceptableAgentIds(seed);
    const activePrompt = await prisma.agent_prompts.findFirst({
      where: {
        agentId: { in: acceptableIds },
        status: 'ACTIVE',
      },
      orderBy: [
        { publishedAt: 'desc' },
        { updatedAt: 'desc' },
        { version: 'desc' },
      ],
      select: {
        id: true,
        agentId: true,
        version: true,
        systemPrompt: true,
        temperature: true,
        maxTokens: true,
        model: true,
      }
    });

    if (!activePrompt) {
      const latest = await prisma.agent_prompts.findFirst({
        where: { agentId: seed.agentId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version || 0) + 1;
      await createPromptSeedRecord(prisma, seed, nextVersion, 'system-sync', defaultModel);
      created.push(seed.agentId);
      continue;
    }

    if (matchesSeedConfig(activePrompt, seed, defaultModel)) {
      skipped.push(seed.agentId);
      continue;
    }

    const latest = await prisma.agent_prompts.findFirst({
      where: { agentId: seed.agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = Math.max((latest?.version || 0) + 1, (activePrompt.version || 0) + 1);

    await prisma.$transaction(async (tx) => {
      await tx.agent_prompts.updateMany({
        where: {
          agentId: { in: acceptableIds },
          status: 'ACTIVE',
        },
        data: {
          status: 'ARCHIVED',
          updatedAt: new Date(),
        },
      });

      await tx.agent_prompts.create({
        data: {
          id: `ap_seed_${seed.agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          agentId: seed.agentId,
          version: nextVersion,
          name: buildPromptName(seed.name, nextVersion),
          description: seed.description,
          systemPrompt: seed.systemPrompt,
          temperature: seed.temperature,
          maxTokens: seed.maxTokens,
          model: defaultModel || null,
          status: 'ACTIVE',
          createdBy: 'system-sync',
          publishedAt: new Date(),
          ...(seed.metadata === undefined ? {} : { metadata: seed.metadata }),
        },
      });
    });

    updated.push(seed.agentId);
  }

  return { created, updated, skipped };
}

export async function findMissingCorePromptSeeds(prisma: PrismaClient): Promise<CoreAgentPromptSeed[]> {
  const seeds = loadCoreAgentPromptSeeds();
  const acceptableIds = Array.from(new Set(
    seeds.flatMap((seed) => getAcceptableAgentIds(seed))
  ));

  const activePrompts = await prisma.agent_prompts.findMany({
    where: {
      agentId: { in: acceptableIds },
      status: 'ACTIVE',
    },
    select: { agentId: true },
  });

  const activeIdSet = new Set(activePrompts.map((prompt) => prompt.agentId));

  return seeds.filter((seed) => {
    const candidates = getAcceptableAgentIds(seed);
    return !candidates.some((agentId) => activeIdSet.has(agentId));
  });
}

export async function seedCoreAgentPrompts(prisma: PrismaClient): Promise<CoreAgentPromptSeedResult> {
  const defaultModel = await resolveDefaultModel(prisma);
  const result: CoreAgentPromptSeedResult = {
    created: [],
    skipped: [],
  };

  const seeds = loadCoreAgentPromptSeeds();
  for (const seed of seeds) {
    const existingVersionOne = await prisma.agent_prompts.findUnique({
      where: {
        agentId_version: {
          agentId: seed.agentId,
          version: 1,
        },
      },
      select: { id: true },
    });

    if (existingVersionOne) {
      result.skipped.push(seed.agentId);
      continue;
    }

    await createPromptSeedRecord(prisma, seed, 1, 'system-seed', defaultModel);

    result.created.push(seed.agentId);
  }

  return result;
}

export async function ensureCoreAgentPrompts(
  prisma: PrismaClient,
  mode: CoreAgentPromptEnsureMode
): Promise<CoreAgentPromptEnsureResult> {
  const totalPromptCountBefore = await prisma.agent_prompts.count();
  const missingBefore = (await findMissingCorePromptSeeds(prisma)).map((seed) => seed.agentId);

  const seeds = loadCoreAgentPromptSeeds();
  
  if (mode === 'bootstrap') {
    if (totalPromptCountBefore > 0) {
      return {
        mode,
        totalPromptCountBefore,
      performed: false,
      created: [],
      skipped: seeds.map((seed) => seed.agentId),
      missingBefore,
      updated: [],
      reason: 'table-not-empty',
    };
  }

    const seeded = await seedCoreAgentPrompts(prisma);
    return {
      mode,
      totalPromptCountBefore,
      performed: true,
      created: seeded.created,
      skipped: seeded.skipped,
      missingBefore,
      updated: [],
      reason: 'seeded-empty-table',
    };
  }

  if (mode === 'sync') {
    const synced = await syncCoreAgentPrompts(prisma);
    const performed = synced.created.length > 0 || synced.updated.length > 0;
    return {
      mode,
      totalPromptCountBefore,
      performed,
      created: synced.created,
      skipped: synced.skipped,
      missingBefore,
      updated: synced.updated,
      reason: performed ? 'synced-from-code' : 'already-in-sync',
    };
  }

  const missingSeeds = await findMissingCorePromptSeeds(prisma);
  if (missingSeeds.length === 0) {
    return {
      mode,
      totalPromptCountBefore,
      performed: false,
      created: [],
      skipped: seeds.map((seed) => seed.agentId),
      missingBefore,
      updated: [],
      reason: 'no-missing-prompts',
    };
  }

  const created: string[] = [];
  const defaultModel = await resolveDefaultModel(prisma);
  const skipped = seeds
    .map((seed) => seed.agentId)
    .filter((agentId) => !missingSeeds.some((seed) => seed.agentId === agentId));

  for (const seed of missingSeeds) {
    const latest = await prisma.agent_prompts.findFirst({
      where: { agentId: seed.agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version || 0) + 1;
    await createPromptSeedRecord(prisma, seed, nextVersion, 'system-backfill', defaultModel);
    created.push(seed.agentId);
  }

  return {
    mode,
    totalPromptCountBefore,
    performed: true,
    created,
    skipped,
    missingBefore,
    updated: [],
    reason: 'backfilled-missing',
  };
}
