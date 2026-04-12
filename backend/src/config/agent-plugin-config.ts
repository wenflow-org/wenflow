/**
 * Agent 插件配置系统
 * 
 * 管理 Agent 插件的启用配置
 */

// 插件类型
type AgentType = 
  | 'requirement-extractor' 
  | 'path-planner' 
  | 'content-generator' 
  | 'quality-evaluator' 
  | 'tutor';

// 插件配置接口
export interface AgentPluginConfig {
  // 需求提取插件
  requirementExtractor: string;
  
  // 路径规划插件
  pathPlanner: string;
  
  // 内容生成插件
  contentGenerator: string;
  
  // 质量评估插件
  qualityEvaluator: string;
  
  // AI 辅导插件
  tutor: string;
}

// 默认配置
export const defaultAgentPluginConfig: AgentPluginConfig = {
  requirementExtractor: 'basic-extractor',
  pathPlanner: 'generic-planner',
  contentGenerator: 'basic-generator',
  qualityEvaluator: 'basic-evaluator',
  tutor: 'zpd-tutor'
};

// 可用插件列表（用于前端展示和验证）
export const availablePlugins: Record<AgentType, string[]> = {
  'requirement-extractor': ['basic-extractor', 'deep-extractor', 'quick-extractor'],
  'path-planner': ['generic-planner', 'tech-planner', 'language-planner'],
  'content-generator': ['basic-generator', 'interactive-generator', 'video-generator'],
  'quality-evaluator': ['basic-evaluator', 'strict-evaluator', 'custom-evaluator'],
  'tutor': ['gentle-tutor', 'strict-tutor', 'zpd-tutor']
};

// 配置管理类
class AgentPluginConfigManager {
  private config: AgentPluginConfig = { ...defaultAgentPluginConfig };
  
  /**
   * 获取当前配置
   */
  getConfig(): AgentPluginConfig {
    return { ...this.config };
  }
  
  /**
   * 更新配置
   */
  updateConfig(updates: Partial<AgentPluginConfig>): AgentPluginConfig {
    // 验证插件 ID 是否有效
    for (const [key, value] of Object.entries(updates)) {
      if (value && !this.isValidPlugin(key as keyof AgentPluginConfig, value)) {
        throw new Error(`Invalid plugin ${key}: ${value}`);
      }
    }
    
    this.config = { ...this.config, ...updates };
    return this.getConfig();
  }
  
  /**
   * 获取指定类型的插件 ID
   */
  getPluginId(type: keyof AgentPluginConfig): string {
    return this.config[type];
  }
  
  /**
   * 设置指定类型的插件
   */
  setPlugin(type: keyof AgentPluginConfig, pluginId: string): void {
    if (!this.isValidPlugin(type, pluginId)) {
      throw new Error(`Invalid plugin ${type}: ${pluginId}`);
    }
    
    this.config[type] = pluginId;
  }
  
  /**
   * 验证插件 ID 是否有效
   */
  isValidPlugin(type: keyof AgentPluginConfig, pluginId: string): boolean {
    const typeMap: Record<string, AgentType> = {
      'requirementExtractor': 'requirement-extractor',
      'pathPlanner': 'path-planner',
      'contentGenerator': 'content-generator',
      'qualityEvaluator': 'quality-evaluator',
      'tutor': 'tutor'
    };
    
    const agentType = typeMap[type];
    if (!agentType) return false;
    
    // 如果可用列表中有这个插件，返回 true
    return availablePlugins[agentType]?.includes(pluginId) || true; // 暂时允许未知插件
  }
  
  /**
   * 重置为默认配置
   */
  reset(): AgentPluginConfig {
    this.config = { ...defaultAgentPluginConfig };
    return this.getConfig();
  }
  
  /**
   * 获取某个类型的可用插件列表
   */
  getAvailablePlugins(type: keyof AgentPluginConfig): string[] {
    const typeMap: Record<string, AgentType> = {
      'requirementExtractor': 'requirement-extractor',
      'pathPlanner': 'path-planner',
      'contentGenerator': 'content-generator',
      'qualityEvaluator': 'quality-evaluator',
      'tutor': 'tutor'
    };
    
    return availablePlugins[typeMap[type]] || [];
  }
}

// 导出单例
export const agentPluginConfig = new AgentPluginConfigManager();
