import type { PrismaClient } from '@prisma/client';
import { DEFAULT_SYSTEM_PROMPT as GOAL_CONVERSATION_SYSTEM_PROMPT } from '../agents/goal-conversation-agent/index';
import { DEFAULT_PATH_GENERATION_PROMPT } from '../agents/path-agent/index';
import { TEACHING_TURN_SYSTEM_PROMPT } from '../agents/teaching-turn-agent/index';
import { WRAPUP_PROMPT } from '../agents/session-wrapup-agent/index';
import { DEFAULT_PEER_AGENT_PROMPT } from '../agents/peer-agent/index';
import { PATH_SCENE_FRAMING_PROMPT, PATH_SCENE_FRAMING_MAX_TOKENS, PATH_SCENE_FRAMING_TEMPERATURE } from '../skills/path-scene-framing';
import { STAGE_DESIGNER_PROMPT } from '../skills/stage-designer';
import { VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT, VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS, VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE } from '../skills/virtual-learner-persona-designer';
import { VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT, VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS, VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE } from '../skills/virtual-learner-scenario-designer';
import { VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE } from '../skills/virtual-learner-goal-dialogue-simulator';
import { VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT, VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS, VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE } from '../skills/virtual-learner-path-evaluator';
import { VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT, VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS, VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE } from '../skills/virtual-learner-learn-turn-simulator';
import { GOAL_PROFILE_INFERENCE_PROMPT } from '../skills/goal-profile-inference';
import { LEARNING_PATTERN_DISTILLER_PROMPT } from '../skills/learning-pattern-distiller';
import { SESSION_KNOWLEDGE_DISTILLER_PROMPT } from '../skills/session-knowledge-distiller';
import { DIALOGUE_CONCEPT_EXTRACTOR_PROMPT } from '../skills/dialogue-concept-extractor';
import { ADAPTIVE_GUIDANCE_COPY_PROMPT } from '../skills/adaptive-guidance-copy';
import { LABEL_GENERATOR_PROMPT, LABEL_GENERATOR_MAX_TOKENS } from '../skills/label-generator';

const DEFAULT_MODEL = (process.env.AI_MODEL || '').trim();

export interface CoreAgentPromptSeed {
  agentId: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  acceptableAgentIds?: string[];
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

export const CORE_AGENT_PROMPT_SEEDS: CoreAgentPromptSeed[] = [
  {
    agentId: 'goal-conversation-agent',
    name: 'v1-default-goal-conversation',
    description: '从 goal-conversation-agent 当前代码默认 Prompt 初始化',
    systemPrompt: GOAL_CONVERSATION_SYSTEM_PROMPT,
    temperature: 0.7,
    maxTokens: 4000,
    acceptableAgentIds: ['goal-conversation-agent', 'goal-conversation'],
  },
  {
    agentId: 'path-agent',
    name: 'v1-default-path-generation',
    description: '从 path-agent 当前代码默认 Prompt 初始化',
    systemPrompt: DEFAULT_PATH_GENERATION_PROMPT,
    temperature: 0.5,
    maxTokens: 32000,
  },
  {
    agentId: 'teaching-turn-agent',
    name: 'v1-default-teaching-turn',
    description: '从 teaching-turn-agent 当前代码默认 Prompt 初始化',
    systemPrompt: TEACHING_TURN_SYSTEM_PROMPT,
    temperature: 0.7,
    maxTokens: 4000,
  },
  {
    agentId: 'session-wrapup-agent',
    name: 'v1-default-session-wrapup',
    description: '从 session-wrapup-agent 当前代码默认 Prompt 初始化',
    systemPrompt: WRAPUP_PROMPT,
    temperature: 0.7,
    maxTokens: 4000,
  },
  {
    agentId: 'skill:peer-reinforcement',
    name: 'v1-default-peer-reinforcement',
    description: '从 skill:peer-reinforcement 当前代码默认 Prompt 初始化',
    systemPrompt: DEFAULT_PEER_AGENT_PROMPT,
    temperature: 0.7,
    maxTokens: 4000,
  },
  {
    agentId: 'skill:path-scene-framing',
    name: 'v1-default-path-scene-framing',
    description: '从 path-scene-framing 当前代码默认 Prompt 初始化',
    systemPrompt: PATH_SCENE_FRAMING_PROMPT,
    temperature: PATH_SCENE_FRAMING_TEMPERATURE,
    maxTokens: PATH_SCENE_FRAMING_MAX_TOKENS,
  },
  {
    agentId: 'skill:stage-designer',
    name: 'v1-default-stage-designer',
    description: '从 stage-designer 当前代码默认 Prompt 初始化',
    systemPrompt: STAGE_DESIGNER_PROMPT,
    temperature: 0.3,
    maxTokens: 32000,
  },
  {
    agentId: 'skill:virtual-learner-persona-designer',
    name: 'v1-default-virtual-learner-persona-designer',
    description: '从 virtual-learner-persona-designer 当前代码默认 Prompt 初始化',
    systemPrompt: VIRTUAL_LEARNER_PERSONA_DESIGNER_PROMPT,
    temperature: VIRTUAL_LEARNER_PERSONA_DESIGNER_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_PERSONA_DESIGNER_MAX_TOKENS,
  },
  {
    agentId: 'skill:virtual-learner-scenario-designer',
    name: 'v1-default-virtual-learner-scenario-designer',
    description: '从 virtual-learner-scenario-designer 当前代码默认 Prompt 初始化',
    systemPrompt: VIRTUAL_LEARNER_SCENARIO_DESIGNER_PROMPT,
    temperature: VIRTUAL_LEARNER_SCENARIO_DESIGNER_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_SCENARIO_DESIGNER_MAX_TOKENS,
  },
  {
    agentId: 'skill:virtual-learner-goal-dialogue-simulator',
    name: 'v1-default-virtual-learner-goal-dialogue-simulator',
    description: '从 virtual-learner-goal-dialogue-simulator 当前代码默认 Prompt 初始化',
    systemPrompt: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_PROMPT,
    temperature: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATOR_MAX_TOKENS,
  },
  {
    agentId: 'skill:virtual-learner-path-evaluator',
    name: 'v1-default-virtual-learner-path-evaluator',
    description: '从 virtual-learner-path-evaluator 当前代码默认 Prompt 初始化',
    systemPrompt: VIRTUAL_LEARNER_PATH_EVALUATOR_PROMPT,
    temperature: VIRTUAL_LEARNER_PATH_EVALUATOR_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_PATH_EVALUATOR_MAX_TOKENS,
  },
  {
    agentId: 'skill:virtual-learner-learn-turn-simulator',
    name: 'v1-default-virtual-learner-learn-turn-simulator',
    description: '从 virtual-learner-learn-turn-simulator 当前代码默认 Prompt 初始化',
    systemPrompt: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_PROMPT,
    temperature: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_TEMPERATURE,
    maxTokens: VIRTUAL_LEARNER_LEARN_TURN_SIMULATOR_MAX_TOKENS,
  },
  {
    agentId: 'skill:goal-profile-inference',
    name: 'v1-default-goal-profile-inference',
    description: '从 goal-profile-inference 当前代码默认 Prompt 初始化',
    systemPrompt: GOAL_PROFILE_INFERENCE_PROMPT,
    temperature: 0.2,
    maxTokens: 2200,
  },
  {
    agentId: 'skill:learning-pattern-distiller',
    name: 'v1-default-learning-pattern-distiller',
    description: '从 learning-pattern-distiller 当前代码默认 Prompt 初始化',
    systemPrompt: LEARNING_PATTERN_DISTILLER_PROMPT,
    temperature: 0.2,
    maxTokens: 2200,
  },
  {
    agentId: 'skill:session-knowledge-distiller',
    name: 'v1-default-session-knowledge-distiller',
    description: '从 session-knowledge-distiller 当前代码默认 Prompt 初始化',
    systemPrompt: SESSION_KNOWLEDGE_DISTILLER_PROMPT,
    temperature: 0.2,
    maxTokens: 2200,
  },
  {
    agentId: 'skill:dialogue-concept-extractor',
    name: 'v1-default-dialogue-concept-extractor',
    description: '从 dialogue-concept-extractor 当前代码默认 Prompt 初始化',
    systemPrompt: DIALOGUE_CONCEPT_EXTRACTOR_PROMPT,
    temperature: 0.2,
    maxTokens: 2200,
  },
  {
    agentId: 'skill:adaptive-guidance-copy',
    name: 'v1-default-adaptive-guidance-copy',
    description: '从 adaptive-guidance-copy 当前代码默认 Prompt 初始化',
    systemPrompt: ADAPTIVE_GUIDANCE_COPY_PROMPT,
    temperature: 0.4,
    maxTokens: 2600,
  },
  {
    agentId: 'skill:label-generator',
    name: 'v1-default-label-generator',
    description: '从 label-generator 当前代码默认 Prompt 初始化',
    systemPrompt: LABEL_GENERATOR_PROMPT,
    temperature: 0.2,
    maxTokens: LABEL_GENERATOR_MAX_TOKENS,
  },
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
  createdBy: string
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
      model: DEFAULT_MODEL,
      status: 'ACTIVE',
      createdBy,
      publishedAt: new Date(),
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
}, seed: CoreAgentPromptSeed): boolean {
  return normalizePromptText(activePrompt.systemPrompt) === normalizePromptText(seed.systemPrompt)
    && Number(activePrompt.temperature ?? seed.temperature) === Number(seed.temperature)
    && Number(activePrompt.maxTokens ?? seed.maxTokens) === Number(seed.maxTokens)
    && String(activePrompt.model || DEFAULT_MODEL) === String(DEFAULT_MODEL);
}

async function syncCoreAgentPrompts(prisma: PrismaClient): Promise<{
  created: string[];
  updated: string[];
  skipped: string[];
}> {
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const seed of CORE_AGENT_PROMPT_SEEDS) {
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
      await createPromptSeedRecord(prisma, seed, nextVersion, 'system-sync');
      created.push(seed.agentId);
      continue;
    }

    if (matchesSeedConfig(activePrompt, seed)) {
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
          model: DEFAULT_MODEL,
          status: 'ACTIVE',
          createdBy: 'system-sync',
          publishedAt: new Date(),
        },
      });
    });

    updated.push(seed.agentId);
  }

  return { created, updated, skipped };
}

export async function findMissingCorePromptSeeds(prisma: PrismaClient): Promise<CoreAgentPromptSeed[]> {
  const acceptableIds = Array.from(new Set(
    CORE_AGENT_PROMPT_SEEDS.flatMap((seed) => getAcceptableAgentIds(seed))
  ));

  const activePrompts = await prisma.agent_prompts.findMany({
    where: {
      agentId: { in: acceptableIds },
      status: 'ACTIVE',
    },
    select: { agentId: true },
  });

  const activeIdSet = new Set(activePrompts.map((prompt) => prompt.agentId));

  return CORE_AGENT_PROMPT_SEEDS.filter((seed) => {
    const candidates = getAcceptableAgentIds(seed);
    return !candidates.some((agentId) => activeIdSet.has(agentId));
  });
}

export async function seedCoreAgentPrompts(prisma: PrismaClient): Promise<CoreAgentPromptSeedResult> {
  if (!DEFAULT_MODEL) {
    throw new Error('AI_MODEL is required to seed core agent prompts');
  }

  const result: CoreAgentPromptSeedResult = {
    created: [],
    skipped: [],
  };

  for (const seed of CORE_AGENT_PROMPT_SEEDS) {
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

    await createPromptSeedRecord(prisma, seed, 1, 'system-seed');

    result.created.push(seed.agentId);
  }

  return result;
}

export async function ensureCoreAgentPrompts(
  prisma: PrismaClient,
  mode: CoreAgentPromptEnsureMode
): Promise<CoreAgentPromptEnsureResult> {
  if (!DEFAULT_MODEL) {
    throw new Error('AI_MODEL is required to ensure core agent prompts');
  }

  const totalPromptCountBefore = await prisma.agent_prompts.count();
  const missingBefore = (await findMissingCorePromptSeeds(prisma)).map((seed) => seed.agentId);

  if (mode === 'bootstrap') {
    if (totalPromptCountBefore > 0) {
      return {
        mode,
        totalPromptCountBefore,
      performed: false,
      created: [],
      skipped: CORE_AGENT_PROMPT_SEEDS.map((seed) => seed.agentId),
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
      skipped: CORE_AGENT_PROMPT_SEEDS.map((seed) => seed.agentId),
      missingBefore,
      updated: [],
      reason: 'no-missing-prompts',
    };
  }

  const created: string[] = [];
  const skipped = CORE_AGENT_PROMPT_SEEDS
    .map((seed) => seed.agentId)
    .filter((agentId) => !missingSeeds.some((seed) => seed.agentId === agentId));

  for (const seed of missingSeeds) {
    const latest = await prisma.agent_prompts.findFirst({
      where: { agentId: seed.agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version || 0) + 1;
    await createPromptSeedRecord(prisma, seed, nextVersion, 'system-backfill');
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
