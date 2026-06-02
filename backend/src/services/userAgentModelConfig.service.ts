import prisma from '../config/database';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { getAPIGateway } from '../gateway/api-gateway';

export interface UserAgentModelConfig {
  userId: string;
  agentId: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  enabled: boolean;
}

class UserAgentModelConfigService {
  async getAllByUser(userId: string): Promise<UserAgentModelConfig[]> {
    try {
      return await prisma.user_agent_model_configs.findMany({ where: { userId } });
    } catch (error) {
      logger.error(`Failed to get user configs: ${userId}`, error);
      throw error;
    }
  }

  async get(userId: string, agentId: string): Promise<UserAgentModelConfig | null> {
    try {
      return await prisma.user_agent_model_configs.findUnique({
        where: { userId_agentId: { userId, agentId } }
      });
    } catch (error) {
      logger.error(`Failed to get user config: ${userId}/${agentId}`, error);
      throw error;
    }
  }

  async upsert(userId: string, agentId: string, config: Partial<UserAgentModelConfig>): Promise<UserAgentModelConfig> {
    try {
      const result = await prisma.user_agent_model_configs.upsert({
        where: { userId_agentId: { userId, agentId } },
        update: { ...config, updatedAt: new Date() },
        create: { id: uuidv4(), userId, agentId, ...config, updatedAt: new Date() }
      });
      getAPIGateway().invalidateCache(userId, agentId);
      return result;
    } catch (error) {
      logger.error(`Failed to upsert user config: ${userId}/${agentId}`, error);
      throw error;
    }
  }

  async delete(userId: string, agentId: string): Promise<void> {
    try {
      await prisma.user_agent_model_configs.delete({
        where: { userId_agentId: { userId, agentId } }
      });
      getAPIGateway().invalidateCache(userId, agentId);
    } catch (error) {
      logger.error(`Failed to delete user config: ${userId}/${agentId}`, error);
      throw error;
    }
  }

  async disable(userId: string, agentId: string): Promise<void> {
    try {
      await prisma.user_agent_model_configs.update({
        where: { userId_agentId: { userId, agentId } },
        data: { enabled: false, updatedAt: new Date() }
      });
      getAPIGateway().invalidateCache(userId, agentId);
    } catch (error) {
      logger.error(`Failed to disable user config: ${userId}/${agentId}`, error);
      throw error;
    }
  }

  async clearCache(userId: string): Promise<void> {
    try {
      getAPIGateway().invalidateCache(userId);
    } catch (error) {
      logger.error(`Failed to clear cache for user: ${userId}`, error);
    }
  }
}

export default new UserAgentModelConfigService();
