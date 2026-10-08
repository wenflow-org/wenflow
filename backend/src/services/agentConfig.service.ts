import { createHash } from 'crypto';
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
    includeConfirmedProposal: boolean;
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
    includeConfirmedProposal: true,
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
      includeConfirmedProposal: normalizeBoolean(normalizedInput.includeConfirmedProposal, DEFAULT_PATH_AGENT_INPUT_CONFIG.normalizedInput.includeConfirmedProposal),
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

export interface ActivePromptSelection {
  /** 分流键（通常 userId；评测可用 conversationId/pathId）——同键稳定命中同一变体 */
  selectionKey?: string | null;
  /** 显式钉住某个变体（评测/试跑用；找不到该变体时回退基线） */
  variantOverride?: string | null;
}

export interface ActivePromptRow {
  id: string;
  version: number;
  variant?: string | null;
  trafficWeight?: number | null;
  [key: string]: any;
}

/** 稳定分桶：sha1(agentId + '\n' + key) 前 8 hex → 0-99（同键永远落同桶） */
export function variantBucket(agentId: string, selectionKey: string): number {
  const h = createHash('sha1').update(`${agentId}\n${selectionKey}`).digest('hex');
  return parseInt(h.slice(0, 8), 16) % 100;
}

/**
 * 从 ACTIVE 行集合挑选实际生效行（纯函数，供单测）。
 * 语义（2026-10-01 A/B 变体）：
 * - 基线 = variant 为空的最新版本；变体 = variant 非空的 ACTIVE 行（可多条并存）
 * - variantOverride 命中 → 该变体；找不到 → 基线（诚实回退，不静默换内容）
 * - 无 selectionKey 或无变体 → 基线（旧行为完全不变）
 * - 否则按权重区间分流：bucket < Σweights 命中对应变体，否则基线
 */
export function pickActivePromptRow<T extends ActivePromptRow>(
  rows: T[],
  agentId: string,
  selection: ActivePromptSelection = {},
): T | null {
  if (!rows.length) return null;
  const byVersionDesc = [...rows].sort((a, b) => b.version - a.version);
  const baseline = byVersionDesc.find((r) => !r.variant) ?? null;
  const variants = rows
    .filter((r) => !!r.variant)
    .sort((a, b) => String(a.variant).localeCompare(String(b.variant)));

  const override = (selection.variantOverride || '').trim();
  if (override) {
    return variants.find((v) => v.variant === override) ?? baseline ?? byVersionDesc[0];
  }
  if (!selection.selectionKey || !variants.length) return baseline ?? byVersionDesc[0];

  const bucket = variantBucket(agentId, selection.selectionKey);
  let cumulative = 0;
  for (const v of variants) {
    const w = Math.max(0, Math.min(100, Number(v.trafficWeight) || 0));
    cumulative += w;
    if (bucket < cumulative) return v;
  }
  return baseline ?? byVersionDesc[0];
}

export class AgentConfigService {
  // 运行时 ACTIVE prompt 短 TTL 缓存：每轮 goal 调用会读 2 次 agent_prompts（handler + callPrompt），
  // 该缓存将 DB 读降到每 30s 一次；admin 发布/回滚/变体变更时经 clearCachedPrompt 立即失效，热更换语义不变。
  // 缓存的是该 agent 的 ACTIVE 行集合（基线与实验臂），分流在内存内按 selectionKey 现算。
  private readonly ACTIVE_PROMPT_CACHE_TTL_MS = 30_000;
  private activePromptCache = new Map<string, { loadedAt: number; rows: any[] | null }>();

  /**
   * 获取一个 agent 的实际生效 prompt（基线或按分流命中的实验变体）。
   *
   * systemPrompt 即生效文本：prompt 调整统一走 v4 File-as-Truth 链
   * （core.yaml → 确定性编译 skill.*.md → DB 镜像）。二级编译（compiledSystemPrompt
   * 产物优先）已于 2026-09 退役删除，历史编译 6 列已随 20261008210000 迁移摘除。
   * A/B 变体（2026-10-01）：ACTIVE 行集合 = 唯一基线（variant=NULL）+ 若干实验臂；
   * 不传 selection 时行为与旧版完全一致（取最新基线）。
   */
  async getActivePrompt(agentId: string, selection: ActivePromptSelection = {}) {
    const now = Date.now();
    const cached = this.activePromptCache.get(agentId);
    let rows: any[] | null;
    if (cached && now - cached.loadedAt < this.ACTIVE_PROMPT_CACHE_TTL_MS) {
      rows = cached.rows;
    } else {
      const found = await systemPrisma.agent_prompts.findMany({
        where: { agentId, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      rows = found.length ? found : null;
      this.activePromptCache.set(agentId, { loadedAt: now, rows });
    }
    if (!rows) return null;
    return pickActivePromptRow(rows, agentId, selection);
  }

  /** 清除单个 agent 的 ACTIVE prompt 缓存（admin 发布/回滚/变体变更时调用） */
  clearCachedPrompt(agentId: string): void {
    if (this.activePromptCache.delete(agentId)) {
      logger.debug(`[AgentConfigService] cleared cached prompt for ${agentId}`);
    }
  }
}

export const agentConfigService = new AgentConfigService();
