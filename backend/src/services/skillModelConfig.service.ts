import prisma from '../config/database';
import { logger } from '../utils/logger';
import { getGateway } from '../gateway';

export interface SkillModelConfig {
  skillId: string;
  tier: string;
  model?: string;
  thinkingMode?: string;
  reasoningEffort?: string;
  endpoint?: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs?: number | null;
  enabled: boolean;
}

class SkillModelConfigService {
  async getAll(): Promise<SkillModelConfig[]> {
    try {
      const persistedConfigs = await prisma.skill_model_configs.findMany();
      const persistedMap = new Map(persistedConfigs.map((config) => [config.skillId, config]));
      const gateway = getGateway();
      const skills = gateway.matchSkills({});

      const mergedConfigs = skills.map((skill: any) => {
        const skillId = skill.definition.name;
        const persisted = persistedMap.get(skillId);

        if (!persisted) {
          return {
            skillId,
            tier: 'chat',
            thinkingMode: 'default',
            reasoningEffort: 'default',
            temperature: 0.7,
            maxTokens: 2000,
            requestTimeoutMs: null,
            enabled: false,
          } satisfies SkillModelConfig;
        }

        return {
          ...persisted,
          thinkingMode: persisted.thinkingMode || 'default',
          reasoningEffort: persisted.reasoningEffort || 'default',
        };
      });

      const missingConfigs = persistedConfigs.filter(
        (config) => !mergedConfigs.some((merged) => merged.skillId === config.skillId)
      );

      return [
        ...mergedConfigs,
        ...missingConfigs.map((config) => ({
          ...config,
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
      const config = await prisma.skill_model_configs.findUnique({ where: { skillId } });
      if (!config) return null;
      return {
        ...config,
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
      return await prisma.skill_model_configs.upsert({
        where: { skillId },
        update: { ...config, updatedAt: new Date() },
        create: { skillId, ...config },
      });
    } catch (error) {
      logger.error(`Failed to upsert skill config: ${skillId}`, error);
      throw error;
    }
  }

  async delete(skillId: string): Promise<void> {
    try {
      await prisma.skill_model_configs.delete({ where: { skillId } });
    } catch (error) {
      logger.error(`Failed to delete skill config: ${skillId}`, error);
      throw error;
    }
  }
}

export default new SkillModelConfigService();
