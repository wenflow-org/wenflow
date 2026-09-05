import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';

export interface PathAgentInputConfig {
  version: string;
  normalizedInput: {
    descriptionSources: string[];
    subjectSources: string[];
    skillLevelSources: string[];
    timePerDaySources: string[];
    deadlineTextSources: string[];
    includeStructuredData: boolean;
    includeConfirmedProposal: boolean;
    includeConfidenceScores: boolean;
    includeConversationHistory: boolean;
  };
}

export interface SimulationAgentConfig {
  version: string;
  maxRounds: number;
  autoAdvanceToPath: boolean;
  stepDelayMs: number;
  evaluationEnabled: boolean;
  goalReadyConfidenceThreshold: number;
}

const PATH_AGENT_CONFIG_KEY = 'path-agent';
const SIMULATION_AGENT_CONFIG_KEY = 'simulation-agent';

export const DEFAULT_PATH_AGENT_INPUT_CONFIG: PathAgentInputConfig = {
  version: '1.0.0',
  normalizedInput: {
    descriptionSources: ['visibleSummary.realProblem', 'understanding.real_problem', 'rawGoal'],
    subjectSources: ['structuredData.subject', 'collected.subject'],
    skillLevelSources: ['visibleSummary.currentBaseline.level', 'understanding.background.current_level', 'collected.level'],
    timePerDaySources: ['visibleSummary.resources.timeBudget', 'understanding.background.available_time', 'collected.timePerDay', 'understanding.available_resources.time_budget'],
    deadlineTextSources: ['visibleSummary.resources.deadlineText', 'visibleSummary.resources.timeHorizon', 'understanding.available_resources.time_horizon', 'understanding.deadline_text'],
    includeStructuredData: true,
    includeConfirmedProposal: true,
    includeConfidenceScores: true,
    includeConversationHistory: true,
  }
};

export const DEFAULT_SIMULATION_AGENT_CONFIG: SimulationAgentConfig = {
  version: '1.0.0',
  maxRounds: 20,
  autoAdvanceToPath: false,
  stepDelayMs: 0,
  evaluationEnabled: false,
  goalReadyConfidenceThreshold: 0.85
};

function parseJsonSafe(raw: string | null | undefined): any | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeStringArray(value: any, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const next = value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
  return next.length > 0 ? next : fallback;
}

function normalizeBoolean(value: any, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizePathAgentInputConfig(value: any): PathAgentInputConfig {
  const candidate = value && typeof value === 'object' ? value : {};
  const normalizedInput = candidate.normalizedInput && typeof candidate.normalizedInput === 'object'
    ? candidate.normalizedInput
    : {};

  return {
    version: typeof candidate.version === 'string' && candidate.version.trim()
      ? candidate.version.trim()
      : DEFAULT_PATH_AGENT_INPUT_CONFIG.version,
    normalizedInput: {
      descriptionSources: normalizeStringArray(normalizedInput.descriptionSources, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.descriptionSources),
      subjectSources: normalizeStringArray(normalizedInput.subjectSources, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.subjectSources),
      skillLevelSources: normalizeStringArray(normalizedInput.skillLevelSources, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.skillLevelSources),
      timePerDaySources: normalizeStringArray(normalizedInput.timePerDaySources, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.timePerDaySources),
      deadlineTextSources: normalizeStringArray(normalizedInput.deadlineTextSources, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.deadlineTextSources),
      includeStructuredData: normalizeBoolean(normalizedInput.includeStructuredData, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.includeStructuredData),
      includeConfirmedProposal: normalizeBoolean(normalizedInput.includeConfirmedProposal, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.includeConfirmedProposal),
      includeConfidenceScores: normalizeBoolean(normalizedInput.includeConfidenceScores, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.includeConfidenceScores),
      includeConversationHistory: normalizeBoolean(normalizedInput.includeConversationHistory, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.includeConversationHistory),
    }
  };
}

export async function getPathAgentInputConfig(): Promise<PathAgentInputConfig> {
  const row = await systemPrisma.agent_lab_configs.findUnique({
    where: { agentName: PATH_AGENT_CONFIG_KEY }
  });

  const parsed = parseJsonSafe(row?.extraConfig);
  return normalizePathAgentInputConfig(parsed?.pathAgentInputConfig);
}

export async function savePathAgentInputConfig(config: PathAgentInputConfig): Promise<PathAgentInputConfig> {
  const normalized = normalizePathAgentInputConfig(config);

  const existing = await systemPrisma.agent_lab_configs.findUnique({
    where: { agentName: PATH_AGENT_CONFIG_KEY }
  });

  const parsedExtra = parseJsonSafe(existing?.extraConfig) || {};
  const extraConfig = {
    ...parsedExtra,
    pathAgentInputConfig: normalized,
  };

  await systemPrisma.agent_lab_configs.upsert({
    where: { agentName: PATH_AGENT_CONFIG_KEY },
    create: {
      id: `alc_${PATH_AGENT_CONFIG_KEY}`,
      agentName: PATH_AGENT_CONFIG_KEY,
      extraConfig: JSON.stringify(extraConfig),
      updatedAt: new Date(),
    },
    update: {
      extraConfig: JSON.stringify(extraConfig),
      updatedAt: new Date(),
    }
  });

  return normalized;
}

function normalizeNumber(value: any, fallback: number, min?: number, max?: number): number {
  if (typeof value !== 'number' || isNaN(value)) return fallback;
  if (min !== undefined && value < min) return fallback;
  if (max !== undefined && value > max) return fallback;
  return value;
}

function normalizeSimulationAgentConfig(value: any): SimulationAgentConfig {
  const candidate = value && typeof value === 'object' ? value : {};

  return {
    version: typeof candidate.version === 'string' && candidate.version.trim()
      ? candidate.version.trim()
      : DEFAULT_SIMULATION_AGENT_CONFIG.version,
    maxRounds: normalizeNumber(candidate.maxRounds, DEFAULT_SIMULATION_AGENT_CONFIG.maxRounds, 1, 100),
    autoAdvanceToPath: normalizeBoolean(candidate.autoAdvanceToPath, DEFAULT_SIMULATION_AGENT_CONFIG.autoAdvanceToPath),
    stepDelayMs: normalizeNumber(candidate.stepDelayMs, DEFAULT_SIMULATION_AGENT_CONFIG.stepDelayMs, 0, 60000),
    evaluationEnabled: normalizeBoolean(candidate.evaluationEnabled, DEFAULT_SIMULATION_AGENT_CONFIG.evaluationEnabled),
    goalReadyConfidenceThreshold: normalizeNumber(candidate.goalReadyConfidenceThreshold, DEFAULT_SIMULATION_AGENT_CONFIG.goalReadyConfidenceThreshold, 0, 1)
  };
}

export async function getSimulationAgentConfig(): Promise<SimulationAgentConfig> {
  const row = await systemPrisma.agent_lab_configs.findUnique({
    where: { agentName: SIMULATION_AGENT_CONFIG_KEY }
  });

  const parsed = parseJsonSafe(row?.extraConfig);
  return normalizeSimulationAgentConfig(parsed?.simulationAgentConfig);
}

export async function saveSimulationAgentConfig(config: SimulationAgentConfig): Promise<SimulationAgentConfig> {
  const normalized = normalizeSimulationAgentConfig(config);

  const existing = await systemPrisma.agent_lab_configs.findUnique({
    where: { agentName: SIMULATION_AGENT_CONFIG_KEY }
  });

  const parsedExtra = parseJsonSafe(existing?.extraConfig) || {};
  const extraConfig = {
    ...parsedExtra,
    simulationAgentConfig: normalized,
  };

  await systemPrisma.agent_lab_configs.upsert({
    where: { agentName: SIMULATION_AGENT_CONFIG_KEY },
    create: {
      id: `alc_${SIMULATION_AGENT_CONFIG_KEY}`,
      agentName: SIMULATION_AGENT_CONFIG_KEY,
      extraConfig: JSON.stringify(extraConfig),
      updatedAt: new Date(),
    },
    update: {
      extraConfig: JSON.stringify(extraConfig),
      updatedAt: new Date(),
    }
  });

  return normalized;
}

export class AgentConfigService {
  // 运行时 ACTIVE prompt 短 TTL 缓存：每轮 goal 调用会读 2 次 agent_prompts（handler + callPrompt），
  // 该缓存将 DB 读降到每 30s 一次；admin 发布/回滚时经 clearCachedPrompt 立即失效，热更换语义不变。
  private readonly ACTIVE_PROMPT_CACHE_TTL_MS = 30_000;
  private activePromptCache = new Map<string, { loadedAt: number; value: any }>();

  /**
   * 获取一个 agent 的 ACTIVE prompt.
   *
   * 关键: 热更换支持 — systemPrompt 字段优先返回 compiledSystemPrompt (编译产物),
   * 当编译产物不可用 (未编译 / 失败 / null) 时降级到 systemPrompt (源).
   *
   * 所有运行时调用方读 `prompt.systemPrompt` 就自动拿到产物或源.
   * 同时暴露 _source / _compiled / _compileStatus / _sourceHash / _compileContextHash
   * 让消费方在需要时区分.
   */
  async getActivePrompt(agentId: string) {
    const now = Date.now();
    const cached = this.activePromptCache.get(agentId);
    if (cached && now - cached.loadedAt < this.ACTIVE_PROMPT_CACHE_TTL_MS) {
      return cached.value;
    }
    const prompt = await systemPrisma.agent_prompts.findFirst({
      where: { agentId, status: 'ACTIVE' },
      orderBy: { version: 'desc' }
    });
    if (!prompt) return null;

    // 编译产物优先 (热更换关键路径)
    const useCompiled =
      prompt.compileStatus === 'fresh' &&
      typeof prompt.compiledSystemPrompt === 'string' &&
      prompt.compiledSystemPrompt.length > 0;

    const result = useCompiled
      ? {
          ...prompt,
          systemPrompt: prompt.compiledSystemPrompt!,
          _source: prompt.systemPrompt,
          _compiled: prompt.compiledSystemPrompt!,
          _compileStatus: prompt.compileStatus,
          _sourceHash: prompt.sourceHash,
          _compileContextHash: prompt.compileContextHash,
          _usedCompiled: true,
        }
      : {
          ...prompt,
          _source: prompt.systemPrompt,
          _compiled: null,
          _compileStatus: prompt.compileStatus,
          _sourceHash: prompt.sourceHash,
          _compileContextHash: prompt.compileContextHash,
          _usedCompiled: false,
        };

    this.activePromptCache.set(agentId, { loadedAt: now, value: result });
    return result;
  }

  /** 清除单个 agent 的 ACTIVE prompt 缓存（admin 发布/回滚/删除时调用） */
  clearCachedPrompt(agentId: string): void {
    if (this.activePromptCache.delete(agentId)) {
      logger.debug(`[AgentConfigService] cleared cached prompt for ${agentId}`);
    }
  }
}

export const agentConfigService = new AgentConfigService();
