import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';
import { getGateway } from '../gateway';
import { getAPIGateway } from '../gateway/api-gateway';
import { randomUUID as uuidv4 } from 'crypto';
import { isExtraCapabilitySkill } from './skill-component-catalog';
import { decryptSecret, encryptSecret } from '../utils/secret-crypto';

const SECRET_CONTEXT = 'system.skill_model_configs.apiKey';
const MAX_SKILL_REQUEST_TIMEOUT_MS = 300_000;

function normalizeRequestTimeoutMs(value: number | null | undefined): number | null | undefined {
  if (value == null) return value;
  return Math.min(MAX_SKILL_REQUEST_TIMEOUT_MS, Math.max(10_000, Math.round(value)));
}

export interface SkillModelConfig {
  skillId: string;
  displayName?: string;
  status?: 'working' | 'placeholder' | 'simplified' | 'mock';
  lastCalledAt?: Date | null;
  tier: string;
  model?: string;
  thinkingMode?: string;
  reasoningEffort?: string;
  endpoint?: string | null;
  apiKey?: string | null;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs?: number | null;
  maxLogicalRetries?: number | null;
  enabled: boolean;
}

class SkillModelConfigService {
  private buildDefaultConfig(skill: any): SkillModelConfig {
    const skillId = skill.definition.name;
    const displayName = skill.definition.displayName;
    const status = skill.definition.status;
    const isExternal = isExtraCapabilitySkill(skillId);

    return {
      skillId,
      displayName,
      status,
      lastCalledAt: skill.lastCalledAt || null,
      tier: 'chat',
      thinkingMode: 'default',
      reasoningEffort: 'default',
      temperature: 0.7,
      maxTokens: 2000,
      requestTimeoutMs: null,
      maxLogicalRetries: null,
      // 外挂能力组件默认就作为独立能力对象管理，不再落回继承态。
      enabled: isExternal,
    } satisfies SkillModelConfig;
  }

  private async ensurePersistedDefaultConfig(skill: any): Promise<SkillModelConfig> {
    const skillId = skill.definition.name;
    const defaultConfig = this.buildDefaultConfig(skill);

    if (!isExtraCapabilitySkill(skillId)) {
      return defaultConfig;
    }

    const persisted = await systemPrisma.skill_model_configs.upsert({
      where: { skillId },
      update: { updatedAt: new Date() },
      create: {
        id: uuidv4(),
        skillId,
        tier: defaultConfig.tier,
        model: defaultConfig.model,
        thinkingMode: defaultConfig.thinkingMode,
        reasoningEffort: defaultConfig.reasoningEffort,
        endpoint: defaultConfig.endpoint,
        apiKey: defaultConfig.apiKey,
        temperature: defaultConfig.temperature,
        maxTokens: defaultConfig.maxTokens,
        requestTimeoutMs: defaultConfig.requestTimeoutMs,
        maxLogicalRetries: defaultConfig.maxLogicalRetries,
        enabled: defaultConfig.enabled,
        updatedAt: new Date(),
      },
    });

    return {
      ...persisted,
      requestTimeoutMs: normalizeRequestTimeoutMs(persisted.requestTimeoutMs),
      apiKey: decryptSecret(persisted.apiKey, SECRET_CONTEXT),
      displayName: defaultConfig.displayName,
      status: defaultConfig.status,
      lastCalledAt: defaultConfig.lastCalledAt,
      thinkingMode: persisted.thinkingMode || 'default',
      reasoningEffort: persisted.reasoningEffort || 'default',
    };
  }

  async getAll(): Promise<SkillModelConfig[]> {
    try {
      const persistedConfigs = await systemPrisma.skill_model_configs.findMany();
      const persistedMap = new Map(persistedConfigs.map((config) => [config.skillId, config]));
      const gateway = getGateway();
      const skills = gateway.matchSkills({});

      const mergedConfigs = await Promise.all(skills.map(async (skill: any) => {
        const skillId = skill.definition.name;
        const displayName = skill.definition.displayName;
        const status = skill.definition.status;
        const persisted = persistedMap.get(skillId);

        if (!persisted) {
          return this.ensurePersistedDefaultConfig(skill);
        }

        return {
          ...persisted,
          requestTimeoutMs: normalizeRequestTimeoutMs(persisted.requestTimeoutMs),
          apiKey: decryptSecret(persisted.apiKey, SECRET_CONTEXT),
          displayName,
          status,
          lastCalledAt: skill.lastCalledAt || null,
          thinkingMode: persisted.thinkingMode || 'default',
          reasoningEffort: persisted.reasoningEffort || 'default',
        };
      }));

      const missingConfigs = persistedConfigs.filter(
        (config) => !mergedConfigs.some((merged) => merged.skillId === config.skillId)
      );

      return [
        ...mergedConfigs,
        ...missingConfigs.map((config) => ({
          ...config,
          requestTimeoutMs: normalizeRequestTimeoutMs(config.requestTimeoutMs),
          apiKey: decryptSecret(config.apiKey, SECRET_CONTEXT),
          lastCalledAt: null,
          thinkingMode: config.thinkingMode || 'default',
          reasoningEffort: config.reasoningEffort || 'default',
        })),
      ];
    } catch (error) {
      logger.error('Failed to get all skill configs:', error);
      throw error;
    }
  }

  async get(skillId: string): Promise<SkillModelConfig | null> {
    try {
      const config = await systemPrisma.skill_model_configs.findUnique({ where: { skillId } });
      if (!config) {
        const gateway = getGateway();
        const skill = gateway.getSkill(skillId);
        if (!skill) return null;
        return this.ensurePersistedDefaultConfig(skill);
      }
      return {
        ...config,
        requestTimeoutMs: normalizeRequestTimeoutMs(config.requestTimeoutMs),
        apiKey: decryptSecret(config.apiKey, SECRET_CONTEXT),
        thinkingMode: config.thinkingMode || 'default',
        reasoningEffort: config.reasoningEffort || 'default',
      };
    } catch (error) {
      logger.error(`Failed to get skill config: ${skillId}`, error);
      throw error;
    }
  }

  async upsert(skillId: string, config: Partial<SkillModelConfig>): Promise<SkillModelConfig> {
    try {
      const normalizedConfig = config.requestTimeoutMs === undefined
        ? config
        : { ...config, requestTimeoutMs: normalizeRequestTimeoutMs(config.requestTimeoutMs) };
      const data = normalizedConfig.apiKey === undefined
        ? normalizedConfig
        : { ...normalizedConfig, apiKey: encryptSecret(normalizedConfig.apiKey, SECRET_CONTEXT) };
      const result = await systemPrisma.skill_model_configs.upsert({
        where: { skillId },
        update: { ...data, updatedAt: new Date() },
        create: { id: uuidv4(), skillId, ...data, updatedAt: new Date() },
      });
      getAPIGateway().invalidateCache(undefined, undefined, skillId);
      return {
        ...result,
        requestTimeoutMs: normalizeRequestTimeoutMs(result.requestTimeoutMs),
        apiKey: decryptSecret(result.apiKey, SECRET_CONTEXT)
      };
    } catch (error) {
      logger.error(`Failed to upsert skill config: ${skillId}`, error);
      throw error;
    }
  }

  async delete(skillId: string): Promise<void> {
    try {
      await systemPrisma.skill_model_configs.delete({ where: { skillId } });
      getAPIGateway().invalidateCache(undefined, undefined, skillId);
    } catch (error) {
      logger.error(`Failed to delete skill config: ${skillId}`, error);
      throw error;
    }
  }
}

export default new SkillModelConfigService();
