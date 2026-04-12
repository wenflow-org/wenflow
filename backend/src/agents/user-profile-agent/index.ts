/**
 * User Profile Agent
 * 
 * 用户画像Agent - 从多个数据源整合用户画像，向其他Agent提供个性化参数
 */

import {
  AgentDefinition,
  AgentInput,
  AgentOutput,
  AgentContext
} from '../protocol';
import { EventBus, getEventBus } from '../../gateway/event-bus';
import { profileAggregator } from './profile-aggregator';
import { personalizationEngine } from './personalization';
import {
  UnifiedUserProfile,
  PersonalizationConfig,
  ProfileUpdateSource
} from './types';

export const userProfileAgentDefinition: AgentDefinition = {
  id: 'user-profile-agent',
  name: '用户画像Agent',
  version: '1.0.0',
  type: 'custom',
  category: 'standard',
  description: '整合多源用户数据，提供统一画像和个性化参数',
  
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
      action: { type: 'string', enum: ['get', 'update', 'get-personalization'] },
      userId: { type: 'string' },
      dataType: { type: 'string' },
      data: { type: 'object' }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      profile: { type: 'object' },
      personalization: { type: 'object' },
      changes: { type: 'array' }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

class UserProfileAgent {
  private profileCache: Map<string, { profile: UnifiedUserProfile; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
  
  async handler(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    const startTime = Date.now();
    const eventBus = getEventBus();
    const action = input.metadata?.action || 'get';
    
    try {
      let result: any;
      
      switch (action) {
        case 'get':
          result = await this.getProfile(context.userId);
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
      userProfileAgentDefinition.stats.callCount++;
      userProfileAgentDefinition.stats.avgLatency = 
        (userProfileAgentDefinition.stats.avgLatency * (userProfileAgentDefinition.stats.callCount - 1) + duration) 
        / userProfileAgentDefinition.stats.callCount;
      
      return {
        success: true,
        metadata: {
          agentId: 'user-profile-agent',
          agentName: '用户画像Agent',
          agentType: 'custom',
          confidence: result.confidence || 0.8,
          generatedAt: new Date().toISOString()
        },
        ...result
      };
    } catch (error) {
      console.error('[UserProfileAgent] Error:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          agentId: 'user-profile-agent',
          agentName: '用户画像Agent',
          agentType: 'custom',
          confidence: 0,
          generatedAt: new Date().toISOString()
        }
      };
    }
  }
  
  async getProfile(userId: string): Promise<{ profile: UnifiedUserProfile; confidence: number }> {
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
  ): Promise<{ profile: UnifiedUserProfile; changes: string[] }> {
    await profileAggregator.applyUpdate(userId, source);
    
    this.profileCache.delete(userId);
    
    const result = await profileAggregator.aggregateProfile(userId);
    
    const eventBus = getEventBus();
    await eventBus.emit({
      type: 'profile:updated',
      source: 'user-profile-agent',
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
    profile: UnifiedUserProfile;
    config: PersonalizationConfig;
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
  
  setupEventListeners(eventBus: EventBus): void {
    eventBus.on('learning:completed', async (event) => {
      if (!event.userId) return;
      
      await this.updateProfile(event.userId, {
        agentId: 'progress-agent',
        timestamp: new Date().toISOString(),
        dataType: 'learning',
        data: {
          ktl: event.data.ktl,
          lf: event.data.lf,
          lss: event.data.lss
        },
        confidence: 0.8
      });
    });
    
    eventBus.on('goal:understanding:updated', async (event) => {
      if (!event.userId) return;
      
      await this.updateProfile(event.userId, {
        agentId: 'goal-conversation',
        timestamp: new Date().toISOString(),
        dataType: 'cognitive',
        data: event.data.understanding || {},
        confidence: 0.7
      });
    });
  }
  
  clearCache(userId?: string): void {
    if (userId) {
      this.profileCache.delete(userId);
    } else {
      this.profileCache.clear();
    }
  }
}

const userProfileAgent = new UserProfileAgent();

export async function userProfileAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  return userProfileAgent.handler(input, context);
}

export { UserProfileAgent, userProfileAgent };
export default userProfileAgentHandler;