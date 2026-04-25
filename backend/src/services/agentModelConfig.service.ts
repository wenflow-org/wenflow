import prisma from '../config/database';
import { logger } from '../utils/logger';
import { getDefaultAgentModelConfigs } from './agent-manifest.service';

export interface AgentModelConfig {
  agentId: string;
  tier: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

class AgentModelConfigService {
  async getAll(): Promise<AgentModelConfig[]> {
    try {
      return await prisma.agent_model_configs.findMany();
    } catch (error) {
      logger.error('Failed to get all agent configs:', error);
      throw error;
    }
  }

  async get(agentId: string): Promise<AgentModelConfig | null> {
    try {
      return await prisma.agent_model_configs.findUnique({ where: { agentId } });
    } catch (error) {
      logger.error(`Failed to get agent config: ${agentId}`, error);
      throw error;
    }
  }

  async upsert(agentId: string, config: Partial<AgentModelConfig>): Promise<AgentModelConfig> {
    try {
      return await prisma.agent_model_configs.upsert({
        where: { agentId },
        update: { ...config, updatedAt: new Date() },
        create: { agentId, ...config }
      });
    } catch (error) {
      logger.error(`Failed to upsert agent config: ${agentId}`, error);
      throw error;
    }
  }

  async delete(agentId: string): Promise<void> {
    try {
      await prisma.agent_model_configs.delete({ where: { agentId } });
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
