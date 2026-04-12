/**
 * Content Strategy Selector - 内容生成策略选择器
 * 
 * 根据任务的认知负荷（cognitiveLoad）决定使用哪个内容生成 Agent
 * 
 * 策略类型：
 * - interactive: 互动式（分段讲解+思考停顿）
 * - light-interactive: 轻度互动（关键节点提问）
 * - traditional: 传统式（直接传递信息）
 */

// ==================== 类型定义 ====================

/**
 * 策略类型
 */
export type ContentStrategy = 'interactive' | 'light-interactive' | 'traditional';

/**
 * 任务类型
 */
export type TaskType = 'reading' | 'practice' | 'case-study' | 'project';

/**
 * 认知负荷等级
 */
export type CognitiveLoad = 'low' | 'medium' | 'high';

/**
 * 任务元数据
 */
export interface TaskMetadata {
  taskType: TaskType;
  cognitiveLoad?: CognitiveLoad;
  estimatedMinutes?: number;
  topic?: string;
  difficulty?: number;
}

/**
 * 策略选择结果
 */
export interface StrategySelection {
  strategy: ContentStrategy;
  agentId: string;
  reason: string;
  confidence: number;
}

/**
 * 策略配置
 */
export interface StrategyConfig {
  strategy: ContentStrategy;
  agentId: string;
  description: string;
  conditions: {
    cognitiveLoad: CognitiveLoad[];
    taskType: TaskType[];
  };
}

// ==================== 策略配置表 ====================

const STRATEGY_CONFIGS: StrategyConfig[] = [
  {
    strategy: 'interactive',
    agentId: 'content-agent-interactive',
    description: '高认知负荷的概念学习，需要分段讲解+思考停顿',
    conditions: {
      cognitiveLoad: ['high'],
      taskType: ['reading']
    }
  },
  {
    strategy: 'light-interactive',
    agentId: 'content-agent-v3',
    description: '中等难度内容，在关键节点提问即可',
    conditions: {
      cognitiveLoad: ['medium'],
      taskType: ['reading']
    }
  },
  {
    strategy: 'light-interactive',
    agentId: 'content-agent-v3',
    description: '案例本身有吸引力，只需关键节点互动',
    conditions: {
      cognitiveLoad: ['high', 'medium'],
      taskType: ['case-study']
    }
  },
  {
    strategy: 'traditional',
    agentId: 'content-agent-v3',
    description: '用户已经在输出，不需要额外对话',
    conditions: {
      cognitiveLoad: ['low', 'medium', 'high'],
      taskType: ['practice', 'project']
    }
  }
];

// ==================== 策略选择器类 ====================

/**
 * 内容策略选择器
 * 
 * 根据任务的认知负荷和任务类型选择最合适的内容生成策略
 */
export class ContentStrategySelector {
  private defaultStrategy: StrategyConfig = {
    strategy: 'traditional',
    agentId: 'content-agent-v3',
    description: '低认知负荷或知识型内容，快速传递信息',
    conditions: {
      cognitiveLoad: ['low'],
      taskType: ['reading', 'practice', 'case-study', 'project']
    }
  };

  /**
   * 选择内容生成策略
   * 
   * @param task - 任务元数据
   * @returns 策略选择结果
   */
  selectStrategy(task: TaskMetadata): StrategySelection {
    const { cognitiveLoad, taskType } = task;
    
    const inferredCognitiveLoad = cognitiveLoad ?? this.inferCognitiveLoad(task);

    const matchedConfig = this.findMatchingStrategy(inferredCognitiveLoad, taskType);

    if (matchedConfig) {
      return {
        strategy: matchedConfig.strategy,
        agentId: matchedConfig.agentId,
        reason: matchedConfig.description,
        confidence: cognitiveLoad ? 1.0 : 0.8
      };
    }

    return {
      strategy: this.defaultStrategy.strategy,
      agentId: this.defaultStrategy.agentId,
      reason: this.defaultStrategy.description,
      confidence: 0.5
    };
  }

  /**
   * 从任务推断认知负荷（如果没有 cognitiveLoad 字段）
   * 
   * 推断规则：
   * - 阅读 >= 45 分钟 → 高认知负荷
   * - 实操/项目 → 中等认知负荷
   * - 其他 → 低认知负荷
   * 
   * @param task - 任务元数据（部分）
   * @returns 推断的认知负荷等级
   */
  inferCognitiveLoad(task: Partial<TaskMetadata>): CognitiveLoad {
    const { taskType, estimatedMinutes, difficulty } = task;

    if (difficulty !== undefined) {
      if (difficulty >= 7) return 'high';
      if (difficulty >= 4) return 'medium';
      return 'low';
    }

    if (taskType === 'reading' && (estimatedMinutes ?? 0) >= 45) {
      return 'high';
    }

    if (taskType === 'practice' || taskType === 'project') {
      if ((estimatedMinutes ?? 0) >= 60) {
        return 'high';
      }
      return 'medium';
    }

    if (taskType === 'case-study') {
      return 'medium';
    }

    if ((estimatedMinutes ?? 0) <= 15) {
      return 'low';
    }

    return 'low';
  }

  /**
   * 查找匹配的策略配置
   */
  private findMatchingStrategy(
    cognitiveLoad: CognitiveLoad,
    taskType: TaskType
  ): StrategyConfig | null {
    for (const config of STRATEGY_CONFIGS) {
      const loadMatch = config.conditions.cognitiveLoad.includes(cognitiveLoad);
      const typeMatch = config.conditions.taskType.includes(taskType);
      
      if (loadMatch && typeMatch) {
        return config;
      }
    }
    return null;
  }

  /**
   * 获取所有可用策略
   */
  getAllStrategies(): StrategyConfig[] {
    return [...STRATEGY_CONFIGS];
  }

  /**
   * 获取策略配置
   */
  getStrategyConfig(strategy: ContentStrategy): StrategyConfig | undefined {
    return STRATEGY_CONFIGS.find(c => c.strategy === strategy);
  }

  /**
   * 批量选择策略
   */
  selectStrategies(tasks: TaskMetadata[]): StrategySelection[] {
    return tasks.map(task => this.selectStrategy(task));
  }

  /**
   * 验证策略选择
   */
  validateSelection(selection: StrategySelection): {
    valid: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];

    if (selection.confidence < 0.7) {
      warnings.push(`低置信度选择 (${selection.confidence})，建议提供更多任务信息`);
    }

    if (selection.strategy === 'interactive' && !selection.agentId.includes('interactive')) {
      warnings.push('策略为 interactive 但 agentId 不匹配');
    }

    return {
      valid: warnings.length === 0,
      warnings
    };
  }
}

// ==================== 导出单例 ====================

export const contentStrategySelector = new ContentStrategySelector();

// ==================== 便捷函数 ====================

/**
 * 选择内容生成策略（便捷函数）
 */
export function selectContentStrategy(task: TaskMetadata): StrategySelection {
  return contentStrategySelector.selectStrategy(task);
}

/**
 * 推断认知负荷（便捷函数）
 */
export function inferCognitiveLoad(task: Partial<TaskMetadata>): CognitiveLoad {
  return contentStrategySelector.inferCognitiveLoad(task);
}