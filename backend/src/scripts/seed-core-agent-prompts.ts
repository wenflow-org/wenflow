import type { PrismaClient } from '@prisma/client';
import { DEFAULT_PATH_GENERATION_PROMPT } from '../agents/path-agent/index';
import { TEACHING_TURN_SYSTEM_PROMPT } from '../agents/teaching-turn-agent/index';
import { WRAPUP_PROMPT } from '../agents/session-wrapup-agent/index';
import { DEFAULT_PEER_AGENT_PROMPT } from '../agents/peer-agent/index';
import { DEFAULT_SIMULATION_PROMPT } from '../agents/virtual-learner-simulation-agent/prompt';
import { PATH_SCENE_FRAMING_PROMPT, PATH_SCENE_FRAMING_MAX_TOKENS, PATH_SCENE_FRAMING_TEMPERATURE } from '../skills/path-scene-framing';
import { STAGE_DESIGNER_PROMPT } from '../skills/stage-designer';

const DEFAULT_MODEL = (process.env.AI_MODEL || '').trim();

export interface CoreAgentPromptSeed {
  agentId: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface CoreAgentPromptSeedResult {
  created: string[];
  skipped: string[];
}

export const CORE_AGENT_PROMPT_SEEDS: CoreAgentPromptSeed[] = [
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
    agentId: 'virtual-learner-simulation-agent',
    name: 'v1-default-virtual-learner-simulation',
    description: '从 virtual-learner-simulation-agent 当前代码默认 Prompt 模板初始化',
    systemPrompt: DEFAULT_SIMULATION_PROMPT,
    temperature: 0.8,
    maxTokens: 500,
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
];

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

    await prisma.agent_prompts.create({
      data: {
        id: `ap_seed_${seed.agentId}_${Date.now()}`,
        agentId: seed.agentId,
        version: 1,
        name: seed.name,
        description: seed.description,
        systemPrompt: seed.systemPrompt,
        temperature: seed.temperature,
        maxTokens: seed.maxTokens,
        model: DEFAULT_MODEL,
        status: 'ACTIVE',
        createdBy: 'system-seed',
        publishedAt: new Date(),
      },
    });

    result.created.push(seed.agentId);
  }

  return result;
}
