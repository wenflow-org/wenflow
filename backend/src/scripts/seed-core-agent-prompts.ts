import type { PrismaClient } from '@prisma/client';
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
