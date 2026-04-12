/**
 * Agent 插件注册表
 * 
 * 管理所有 Agent 插件的注册、查询和执行
 */

import {
  AgentPlugin,
  AgentType,
  AgentRegistration,
  AgentContext,
  AgentOutput
} from './plugin-types';
import { logger } from '../utils/logger';

/**
 * Agent 插件注册表类
 */
export class AgentPluginRegistry {
  private plugins: Map<string, AgentRegistration> = new Map();
  
  /**
   * 注册插件
   */
  register(plugin: AgentPlugin): void {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`Plugin ${plugin.id} already registered, overwriting...`);
    }
    
    // 如果插件有初始化方法，调用它
    if (plugin.initialize) {
      plugin.initialize().catch(err => {
        logger.error(`Failed to initialize plugin ${plugin.id}:`, err);
      });
    }
    
    this.plugins.set(plugin.id, {
      plugin,
      registeredAt: new Date(),
      callCount: 0,
      successCount: 0,
      totalDuration: 0
    });
    
    logger.info(`✅ Plugin registered: ${plugin.id} (${plugin.name})`);
  }
  
  /**
   * 批量注册插件
   */
  registerMany(plugins: AgentPlugin[]): void {
    plugins.forEach(plugin => this.register(plugin));
  }
  
  /**
   * 获取插件
   */
  get(id: string): AgentPlugin {
    const registration = this.plugins.get(id);
    if (!registration) {
      throw new Error(`Plugin not found: ${id}`);
    }
    return registration.plugin;
  }
  
  /**
   * 检查插件是否存在
   */
  has(id: string): boolean {
    return this.plugins.has(id);
  }
  
  /**
   * 列出所有插件
   */
  list(): AgentPlugin[] {
    return Array.from(this.plugins.values()).map(r => r.plugin);
  }
  
  /**
   * 按类型列出插件
   */
  listByType(type: AgentType): AgentPlugin[] {
    return this.list().filter(p => p.type === type);
  }
  
  /**
   * 按能力列出插件
   */
  listByCapability(capability: string): AgentPlugin[] {
    return this.list().filter(p => p.capabilities.includes(capability));
  }
  
  /**
   * 执行插件
   */
  async execute(
    pluginId: string, 
    input: any, 
    context: AgentContext
  ): Promise<AgentOutput> {
    const registration = this.plugins.get(pluginId);
    if (!registration) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }
    
    const startTime = Date.now();
    registration.callCount++;
    
    try {
      const output = await registration.plugin.execute(input, context);
      
      // 更新统计
      if (output.success) {
        registration.successCount++;
      }
      registration.totalDuration += Date.now() - startTime;
      
      // 添加元数据
      if (!output.metadata) {
        output.metadata = {
          agentId: registration.plugin.id,
          agentName: registration.plugin.name,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        };
      }
      
      return output;
    } catch (error: any) {
      registration.totalDuration += Date.now() - startTime;

      return {
        success: false,
        userVisible: '执行过程中出现错误，请稍后重试。',
        error: error.message || 'Unknown error',
        metadata: {
          agentId: registration.plugin.id,
          agentName: registration.plugin.name,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };
    }
  }
  
  /**
   * 获取插件统计
   */
  getStats(pluginId: string): {
    callCount: number;
    successCount: number;
    successRate: number;
    avgDuration: number;
  } | null {
    const registration = this.plugins.get(pluginId);
    if (!registration) return null;
    
    return {
      callCount: registration.callCount,
      successCount: registration.successCount,
      successRate: registration.callCount > 0 
        ? registration.successCount / registration.callCount 
        : 0,
      avgDuration: registration.callCount > 0
        ? registration.totalDuration / registration.callCount
        : 0
    };
  }
  
  /**
   * 获取所有插件统计
   */
  getAllStats(): Record<string, {
    callCount: number;
    successRate: number;
    avgDuration: number;
  }> {
    const stats: Record<string, any> = {};
    
    for (const [id, registration] of this.plugins) {
      stats[id] = {
        callCount: registration.callCount,
        successRate: registration.callCount > 0 
          ? registration.successCount / registration.callCount 
          : 0,
        avgDuration: registration.callCount > 0
          ? registration.totalDuration / registration.callCount
          : 0
      };
    }
    
    return stats;
  }
  
  /**
   * 注销插件
   */
  async unregister(pluginId: string): Promise<void> {
    const registration = this.plugins.get(pluginId);
    if (!registration) return;
    
    // 如果插件有销毁方法，调用它
    if (registration.plugin.destroy) {
      await registration.plugin.destroy();
    }
    
    this.plugins.delete(pluginId);
    logger.info(`✅ Plugin unregistered: ${pluginId}`);
  }
  
  /**
   * 清空所有插件
   */
  async clear(): Promise<void> {
    for (const [id] of this.plugins) {
      await this.unregister(id);
    }
  }
}

// 导出单例
export const agentPluginRegistry = new AgentPluginRegistry();
