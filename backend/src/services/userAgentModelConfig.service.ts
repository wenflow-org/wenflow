import prisma from '../config/database';
import { logger } from '../utils/logger';
import { randomUUID as uuidv4 } from 'crypto';
import { getAPIGateway } from '../gateway/api-gateway';
import { decryptSecret, encryptSecret } from '../utils/secret-crypto';

const SECRET_CONTEXT = 'main.user_agent_model_configs.apiKey';

export interface UserAgentModelConfig {
  userId: string;
  agentId: string;
  model?: string;
  endpoint?: string;
  apiKey?: string | null;
  temperature?: number;
  maxTokens?: number;
  enabled: boolean;
}

class UserAgentModelConfigService {
  async getAllByUser(userId: string): Promise<UserAgentModelConfig[]> {
    try {
      const configs = await prisma.user_agent_model_configs.findMany({ where: { userId } });
      return configs.map(config => ({ ...config, apiKey: decryptSecret(config.apiKey, SECRET_CONTEXT) }));
    } catch (error) {
      logger.error(`Failed to get user configs: ${userId}`, error);
      throw error;
    }
  }

  async get(userId: string, agentId: string): Promise<UserAgentModelConfig | null> {
    try {
      const config = await prisma.user_agent_model_configs.findUnique({
        where: { userId_agentId: { userId, agentId } }
      });
      return config ? { ...config, apiKey: decryptSecret(config.apiKey, SECRET_CONTEXT) } : null;
    } catch (error) {
      logger.error(`Failed to get user config: ${userId}/${agentId}`, error);
      throw error;
    }
  }

  async upsert(userId: string, agentId: string, config: Partial<UserAgentModelConfig>): Promise<UserAgentModelConfig> {
    try {
      const data = config.apiKey === undefined
        ? config
        : { ...config, apiKey: encryptSecret(config.apiKey, SECRET_CONTEXT) };
      const result = await prisma.user_agent_model_configs.upsert({
        where: { userId_agentId: { userId, agentId } },
        update: { ...data, updatedAt: new Date() },
        create: { id: uuidv4(), userId, agentId, ...data, updatedAt: new Date() }
      });
      getAPIGateway().invalidateCache(userId, agentId);
      return { ...result, apiKey: decryptSecret(result.apiKey, SECRET_CONTEXT) };
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
    } catch (error: any) {
      // 幂等删除（2026-10-10 权限批实弹）：无自定义行时 Prisma 抛 P2025——「恢复使用系统
      // 默认配置」的目标态已达成，按成功返回（此前落 500「恢复默认配置失败」）。userId 恒取
      // 会话主体，跨用户删除结构上不可能（复合键 userId_agentId）。
      if (error?.code === 'P2025') {
        getAPIGateway().invalidateCache(userId, agentId);
        return;
      }
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
