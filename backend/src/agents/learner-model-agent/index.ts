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
import { profileAggregator } from './profile-aggregator';
import { personalizationEngine } from './personalization';
import {
  LearnerSnapshot,
  LearnerModelProfile,
  LearnerPersonalizationConfig,
  ProfileUpdateSource
} from './types';
import { learnerSnapshotService } from '../../services/learner/LearnerSnapshotService';
import { learnerExitService } from '../../services/learner/LearnerExitService';
import { learnerProfileService } from '../../services/learner/LearnerProfileService';
import { logger } from '../../utils/logger';

export const learnerModelAgentDefinition: AgentDefinition = {
  id: 'skill:learner-model',
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
  
  // 文档性元数据，不参与运行时分发（语义见 agents/protocol.ts 的 AgentDefinition.subscribes）。
  // 本 Agent 的真实执行体是 bootstrap/schedulers.ts 里注册的 handleLearnerEvent(LEARNER_EVENT_TYPES)
  // （见 events/learner-event-consumer.ts），其消费集合即下列 7 类；此处按真实集合对齐，
  // 不再声明全仓查无的 learning:completed / content:generated。
  subscribes: [
    'goal:understanding:updated',
    'task:completed',
    'lesson:completed',
    'path:created',
    'path:generated',
    'path:adjusted',
    'path:completed'
  ],
  
  // 文档性元数据，不参与运行时发布：以下两个事件在全仓没有任何 emit 点，Agent 执行体也不会发出，
  // 保留仅为描述性说明，请勿据此排查真实事件的发出方。
  publishes: [
    'profile:updated',
    'personalization:ready'
  ],
  
  inputSchema: {
    type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'update', 'get-personalization', 'get-snapshot', 'get-exit'] },
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
  async handler(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    const startTime = Date.now();
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

        case 'get-exit':
          // learn agent 统一出口（LearnerExitService）：snapshot + dueReview + accountView
          result = await learnerExitService.getLearnerContext({
            userId: context.userId,
            learningPathId: input.metadata?.learningPathId,
            milestoneId: input.metadata?.milestoneId,
            taskId: input.metadata?.taskId,
            mode: input.metadata?.mode,
          });
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
          agentId: 'skill:learner-model',
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
          agentId: 'skill:learner-model',
          agentName: '学习者画像与状态中心',
          agentType: 'custom',
          confidence: 0,
          generatedAt: new Date().toISOString()
        }
      };
    }
  }
  
  async getProfile(userId: string): Promise<{ profile: LearnerModelProfile; confidence: number }> {
    return learnerProfileService.getProfile(userId);
  }
  
  async updateProfile(
    userId: string,
    source: ProfileUpdateSource
  ): Promise<{ profile: LearnerModelProfile; changes: string[] }> {
    const updateResult = await profileAggregator.applyUpdate(userId, source);
    if (!updateResult.success) throw new Error('LEARNER_PROFILE_UPDATE_FAILED');
    learnerProfileService.clear(userId);
    const result = await learnerProfileService.getProfile(userId);
    
    return { profile: result.profile, changes: updateResult.changes };
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
    learnerProfileService.clear(userId);
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
