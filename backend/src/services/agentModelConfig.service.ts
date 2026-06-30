import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';
import { getDefaultAgentModelConfigs } from './agent-manifest.service';
import { v4 as uuidv4 } from 'uuid';
import { getAPIGateway } from '../gateway/api-gateway';

export interface AgentModelConfig {
  agentId: string;
  tier: string;
  model?: string;
  thinkingMode?: string;
  reasoningEffort?: string;
  endpoint?: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

class AgentModelConfigService {
  async getAll(): Promise<AgentModelConfig[]> {
    try {
      const persistedConfigs = await systemPrisma.agent_model_configs.findMany();
      const persistedMap = new Map(persistedConfigs.map((config) => [config.agentId, config]));
      const mergedConfigs = getDefaultAgentModelConfigs().map((defaultConfig) => {
        const persisted = persistedMap.get(defaultConfig.agentId);
        if (!persisted) {
          return {
            agentId: defaultConfig.agentId,
            tier: defaultConfig.tier,
            thinkingMode: 'default',
            reasoningEffort: 'default',
            temperature: defaultConfig.temperature,
            maxTokens: defaultConfig.maxTokens,
            enabled: true,
          } satisfies AgentModelConfig;
        }

        return {
          ...persisted,
          thinkingMode: persisted.thinkingMode || 'default',
          reasoningEffort: persisted.reasoningEffort || 'default'
        };
      });

      const missingManifestConfigs = persistedConfigs.filter(
        (config) => !mergedConfigs.some((merged) => merged.agentId === config.agentId)
      );

      return [
        ...mergedConfigs,
        ...missingManifestConfigs.map((config) => ({
          ...config,
          thinkingMode: config.thinkingMode || 'default',
          reasoningEffort: config.reasoningEffort || 'default'
        }))
      ];
    } catch (error) {
      logger.error('Failed to get all agent configs:', error);
      throw error;
    }
  }

  async get(agentId: string): Promise<AgentModelConfig | null> {
    try {
      return await systemPrisma.agent_model_configs.findUnique({ where: { agentId } });
    } catch (error) {
      logger.error(`Failed to get agent config: ${agentId}`, error);
      throw error;
    }
  }

  async upsert(agentId: string, config: Partial<AgentModelConfig>): Promise<AgentModelConfig> {
    try {
      const result = await systemPrisma.agent_model_configs.upsert({
        where: { agentId },
        update: { ...config, updatedAt: new Date() },
        create: { id: uuidv4(), agentId, ...config, updatedAt: new Date() }
      });
      getAPIGateway().invalidateCache(undefined, agentId);
      return result;
    } catch (error) {
      logger.error(`Failed to upsert agent config: ${agentId}`, error);
      throw error;
    }
  }

  async delete(agentId: string): Promise<void> {
    try {
      await systemPrisma.agent_model_configs.delete({ where: { agentId } });
      getAPIGateway().invalidateCache(undefined, agentId);
    } catch (error) {
      logger.error(`Failed to delete agent config: ${agentId}`, error);
      throw error;
    }
  }

  async initializeDefaults(): Promise<void> {
    const defaultConfigs = getDefaultAgentModelConfigs();

    for (const config of defaultConfigs) {
      try {
        const existing = await this.get(config.agentId);
        if (!existing) {
          await this.upsert(config.agentId, {
            tier: (config as any).tier || 'chat',
            thinkingMode: 'default',
            reasoningEffort: 'default',
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            enabled: true
          });
          logger.info(`Initialized agent config: ${config.agentId}`);
        }
      } catch (error) {
        logger.error(`Failed to initialize config for ${config.agentId}:`, error);
      }
    }
  }
}

export default new AgentModelConfigService();
