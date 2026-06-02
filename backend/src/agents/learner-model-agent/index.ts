/**
 * Learner Model Agent
 * 
 * 学习者画像与状态中心 - 从多个数据源整合学习者画像、状态与知识记忆，向其他Agent提供个性化参数
 */

import {
  AgentDefinition,
  AgentInput,
  AgentOutput,
  AgentContext
} from '../protocol';
import { getEventBus } from '../../gateway/event-bus';
import { profileAggregator } from './profile-aggregator';
import { personalizationEngine } from './personalization';
import {
  LearnerSnapshot,
  LearnerModelProfile,
  LearnerPersonalizationConfig,
  ProfileUpdateSource
} from './types';
import { learnerSnapshotService } from '../../services/learner/LearnerSnapshotService';
import { logger } from '../../utils/logger';

export const learnerModelAgentDefinition: AgentDefinition = {
  id: 'learner-model-agent',
  name: '学习者画像与状态中心',
  version: '1.0.0',
  type: 'custom',
  category: 'standard',
  description: '整合多源学习数据，提供统一学习者快照和个性化参数',
  
  capabilities: [
    'profile-aggregation',
    'personalization',
    'behavioral-analysis',
    'risk-detection'
  ],
  
  subscribes: [
    'learning:completed',
    'content:generated',
    'task:completed',
    'goal:understanding:updated'
  ],
  
  publishes: [
    'profile:updated',
    'personalization:ready'
  ],
  
  inputSchema: {
    type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'update', 'get-personalization', 'get-snapshot'] },
        userId: { type: 'string' },
        dataType: { type: 'string' },
        data: { type: 'object' }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      learner: { type: 'object' }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

class LearnerModelAgent {
  private profileCache: Map<string, { profile: LearnerModelProfile; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
  
  async handler(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    const startTime = Date.now();
    const eventBus = getEventBus();
    const action = input.metadata?.action || 'get';
    
    try {
      let result: any;
      
      switch (action) {
        case 'get':
          result = await this.getSnapshot({ userId: context.userId, mode: 'global' });
          break;

        case 'get-snapshot':
          result = await this.getSnapshot({
            userId: context.userId,
            learningPathId: input.metadata?.learningPathId,
            milestoneId: input.metadata?.milestoneId,
            taskId: input.metadata?.taskId,
            mode: input.metadata?.mode,
          });
          break;
          
        case 'update':
          result = await this.updateProfile(context.userId, input.metadata?.source as ProfileUpdateSource);
          break;
          
        case 'get-personalization':
          result = await this.getPersonalization(context.userId);
          break;
          
        default:
          result = await this.getProfile(context.userId);
      }
      
      const duration = Date.now() - startTime;
      learnerModelAgentDefinition.stats.callCount++;
      learnerModelAgentDefinition.stats.avgLatency = 
        (learnerModelAgentDefinition.stats.avgLatency * (learnerModelAgentDefinition.stats.callCount - 1) + duration) 
        / learnerModelAgentDefinition.stats.callCount;
      
      return {
        success: true,
        userVisible: action === 'get-personalization'
          ? '已生成个性化学习建议'
          : (action === 'update' ? '学习者模型已更新' : '学习者快照已获取'),
        internal: {
          core: {
            stage: 'snapshot-ready',
            confidence: result.confidence || 0.8,
            isCompleted: true,
          },
          ext: {
            learner: {
              action,
              ...result,
            }
          }
        },
        schemaVersion: 'agent-output-v1',
        metadata: {
          agentId: 'learner-model-agent',
          agentName: '学习者画像与状态中心',
          agentType: 'custom',
          confidence: result.confidence || 0.8,
          generatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('[learner-model-agent] execution failed', {
        userId: context.userId,
        action,
        error,
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        userVisible: '学习者模型生成失败',
        schemaVersion: 'agent-output-v1',
        metadata: {
          agentId: 'learner-model-agent',
          agentName: '学习者画像与状态中心',
          agentType: 'custom',
          confidence: 0,
          generatedAt: new Date().toISOString()
        }
      };
    }
  }
  
  async getProfile(userId: string): Promise<{ profile: LearnerModelProfile; confidence: number }> {
    const cached = this.profileCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { profile: cached.profile, confidence: 0.9 };
    }
    
    const result = await profileAggregator.aggregateProfile(userId);
    
    this.profileCache.set(userId, {
      profile: result.profile,
      timestamp: Date.now()
    });
    
    return { profile: result.profile, confidence: result.confidence };
  }
  
  async updateProfile(
    userId: string,
    source: ProfileUpdateSource
  ): Promise<{ profile: LearnerModelProfile; changes: string[] }> {
    await profileAggregator.applyUpdate(userId, source);
    
    this.profileCache.delete(userId);
    
    const result = await profileAggregator.aggregateProfile(userId);
    
    const eventBus = getEventBus();
    await eventBus.emit({
      type: 'profile:updated',
      source: 'learner-model-agent',
      userId,
      data: {
        changes: result.changes,
        confidence: result.confidence
      }
    });
    
    this.profileCache.set(userId, {
      profile: result.profile,
      timestamp: Date.now()
    });
    
    return { profile: result.profile, changes: result.changes };
  }
  
  async getPersonalization(userId: string): Promise<{
    profile: LearnerModelProfile;
    config: LearnerPersonalizationConfig;
    promptEnhancement: string;
    contentHints: {
      preferredFormats: string[];
      avoidFormats: string[];
      emphasisAreas: string[];
    };
  }> {
    const { profile } = await this.getProfile(userId);
    
    const config = personalizationEngine.generateConfig(profile);
    const promptEnhancement = personalizationEngine.generatePromptEnhancement(profile);
    const contentHints = personalizationEngine.generateContentHints(profile);
    
    return { profile, config, promptEnhancement, contentHints };
  }

  async getSnapshot(input: {
    userId: string;
    learningPathId?: string;
    milestoneId?: string;
    taskId?: string;
    mode?: 'global' | 'path' | 'teaching';
  }): Promise<{ snapshot: LearnerSnapshot; confidence: number }> {
    const snapshot = await learnerSnapshotService.getSnapshot(input);
    return {
      snapshot,
      confidence: snapshot.freshness.confidence,
    };
  }
  
  clearCache(userId?: string): void {
    if (userId) {
      this.profileCache.delete(userId);
    } else {
      this.profileCache.clear();
    }
  }
}

const learnerModelAgent = new LearnerModelAgent();

export async function learnerModelAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  return learnerModelAgent.handler(input, context);
}

export { LearnerModelAgent, learnerModelAgent };
export default learnerModelAgentHandler;
