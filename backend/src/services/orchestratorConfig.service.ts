import prisma from '../config/database';

export interface PathOrchestratorInputConfig {
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

export interface SimulationOrchestratorConfig {
  version: string;
  maxRounds: number;
  autoAdvanceToPath: boolean;
  stepDelayMs: number;
  evaluationEnabled: boolean;
  goalReadyConfidenceThreshold: number;
}

const PATH_ORCHESTRATOR_CONFIG_KEY = 'path-orchestrator';
const SIMULATION_ORCHESTRATOR_CONFIG_KEY = 'simulation-orchestrator';

export const DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG: PathOrchestratorInputConfig = {
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

export const DEFAULT_SIMULATION_ORCHESTRATOR_CONFIG: SimulationOrchestratorConfig = {
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

function normalizePathOrchestratorInputConfig(value: any): PathOrchestratorInputConfig {
  const candidate = value && typeof value === 'object' ? value : {};
  const normalizedInput = candidate.normalizedInput && typeof candidate.normalizedInput === 'object'
    ? candidate.normalizedInput
    : {};

  return {
    version: typeof candidate.version === 'string' && candidate.version.trim()
      ? candidate.version.trim()
      : DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.version,
    normalizedInput: {
      descriptionSources: normalizeStringArray(normalizedInput.descriptionSources, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.descriptionSources),
      subjectSources: normalizeStringArray(normalizedInput.subjectSources, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.subjectSources),
      skillLevelSources: normalizeStringArray(normalizedInput.skillLevelSources, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.skillLevelSources),
      timePerDaySources: normalizeStringArray(normalizedInput.timePerDaySources, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.timePerDaySources),
      deadlineTextSources: normalizeStringArray(normalizedInput.deadlineTextSources, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.deadlineTextSources),
      includeStructuredData: normalizeBoolean(normalizedInput.includeStructuredData, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.includeStructuredData),
      includeConfirmedProposal: normalizeBoolean(normalizedInput.includeConfirmedProposal, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.includeConfirmedProposal),
      includeConfidenceScores: normalizeBoolean(normalizedInput.includeConfidenceScores, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.includeConfidenceScores),
      includeConversationHistory: normalizeBoolean(normalizedInput.includeConversationHistory, DEFAULT_PATH_ORCHESTRATOR_INPUT_CONFIG.normalizedInput.includeConversationHistory),
    }
  };
}

export async function getPathOrchestratorInputConfig(): Promise<PathOrchestratorInputConfig> {
  const row = await prisma.agent_lab_configs.findUnique({
    where: { agentName: PATH_ORCHESTRATOR_CONFIG_KEY }
  });

  const parsed = parseJsonSafe(row?.extraConfig);
  return normalizePathOrchestratorInputConfig(parsed?.pathOrchestratorInputConfig);
}

export async function savePathOrchestratorInputConfig(config: PathOrchestratorInputConfig): Promise<PathOrchestratorInputConfig> {
  const normalized = normalizePathOrchestratorInputConfig(config);

  const existing = await prisma.agent_lab_configs.findUnique({
    where: { agentName: PATH_ORCHESTRATOR_CONFIG_KEY }
  });

  const parsedExtra = parseJsonSafe(existing?.extraConfig) || {};
  const extraConfig = {
    ...parsedExtra,
    pathOrchestratorInputConfig: normalized,
  };

  await prisma.agent_lab_configs.upsert({
    where: { agentName: PATH_ORCHESTRATOR_CONFIG_KEY },
    create: {
      id: `alc_${PATH_ORCHESTRATOR_CONFIG_KEY}`,
      agentName: PATH_ORCHESTRATOR_CONFIG_KEY,
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

function normalizeSimulationOrchestratorConfig(value: any): SimulationOrchestratorConfig {
  const candidate = value && typeof value === 'object' ? value : {};

  return {
    version: typeof candidate.version === 'string' && candidate.version.trim()
      ? candidate.version.trim()
      : DEFAULT_SIMULATION_ORCHESTRATOR_CONFIG.version,
    maxRounds: normalizeNumber(candidate.maxRounds, DEFAULT_SIMULATION_ORCHESTRATOR_CONFIG.maxRounds, 1, 100),
    autoAdvanceToPath: normalizeBoolean(candidate.autoAdvanceToPath, DEFAULT_SIMULATION_ORCHESTRATOR_CONFIG.autoAdvanceToPath),
    stepDelayMs: normalizeNumber(candidate.stepDelayMs, DEFAULT_SIMULATION_ORCHESTRATOR_CONFIG.stepDelayMs, 0, 60000),
    evaluationEnabled: normalizeBoolean(candidate.evaluationEnabled, DEFAULT_SIMULATION_ORCHESTRATOR_CONFIG.evaluationEnabled),
    goalReadyConfidenceThreshold: normalizeNumber(candidate.goalReadyConfidenceThreshold, DEFAULT_SIMULATION_ORCHESTRATOR_CONFIG.goalReadyConfidenceThreshold, 0, 1)
  };
}

export async function getSimulationOrchestratorConfig(): Promise<SimulationOrchestratorConfig> {
  const row = await prisma.agent_lab_configs.findUnique({
    where: { agentName: SIMULATION_ORCHESTRATOR_CONFIG_KEY }
  });

  const parsed = parseJsonSafe(row?.extraConfig);
  return normalizeSimulationOrchestratorConfig(parsed?.simulationOrchestratorConfig);
}

export async function saveSimulationOrchestratorConfig(config: SimulationOrchestratorConfig): Promise<SimulationOrchestratorConfig> {
  const normalized = normalizeSimulationOrchestratorConfig(config);

  const existing = await prisma.agent_lab_configs.findUnique({
    where: { agentName: SIMULATION_ORCHESTRATOR_CONFIG_KEY }
  });

  const parsedExtra = parseJsonSafe(existing?.extraConfig) || {};
  const extraConfig = {
    ...parsedExtra,
    simulationOrchestratorConfig: normalized,
  };

  await prisma.agent_lab_configs.upsert({
    where: { agentName: SIMULATION_ORCHESTRATOR_CONFIG_KEY },
    create: {
      id: `alc_${SIMULATION_ORCHESTRATOR_CONFIG_KEY}`,
      agentName: SIMULATION_ORCHESTRATOR_CONFIG_KEY,
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
