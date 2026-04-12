/**
 * Strategy 注册表 - EduClaw Gateway
 * 
 * 注册各种学习路径调整策略
 */

import { LearningSignal } from '../../agents/protocol';

// 策略类型
export type StrategyType =
  | 'compress'          // 压缩时间，合并章节
  | 'extend'            // 延长时间，增加复习
  | 'focus-mode'        // 调整重点主题
  | 'deviation-response'// 处理变道
  | 'difficulty-adjust' // 降低内容难度
  | 'challenge-boost';  // 提高内容难度

// 策略触发条件
export interface StrategyTrigger {
  signals: LearningSignal['type'][]; // 触发的信号类型
  minIntensity?: number; // 最小信号强度
  conditions?: (context: StrategyContext) => boolean;
}

// 策略上下文
export interface StrategyContext {
  userId: string;
  pathId: string;
  currentWeek: number;
  currentTask?: string;
  
  // 当前路径状态
  pathStats: {
    totalWeeks: number;
    completedWeeks: number;
    totalTasks: number;
    completedTasks: number;
    skippedTasks: number;
  };
  
  // 用户状态
  userState: {
    level: number;
    xp: number;
    ktl: number;
    lf: number;
    lss: number;
  };
  
  // 最近信号
  recentSignals: LearningSignal[];
}

// 策略动作
export interface StrategyAction {
  type: StrategyType;
  parameters: Record<string, any>;
  priority: number; // 优先级，高的优先执行
}

// 策略定义
export interface StrategyDefinition {
  name: string;
  type: StrategyType;
  description: string;
  triggers: StrategyTrigger[];
  
  // 策略执行函数
  execute: (context: StrategyContext) => Promise<StrategyAction>;
}

// 策略执行结果
export interface StrategyResult {
  success: boolean;
  action?: StrategyAction;
  adjustments?: {
    weeksToAdd?: number;
    weeksToRemove?: number;
    tasksToMerge?: string[];
    tasksToSplit?: string[];
    focusTopics?: string[];
    difficultyLevel?: 'easier' | 'harder';
    additionalReview?: string[];
  };
  message?: string;
  error?: string;
}

/**
 * Strategy 注册表实现
 */
export class StrategyRegistry {
  private strategies: Map<StrategyType, StrategyDefinition[]> = new Map();
  private executionHistory: Array<{
    strategyName: string;
    context: StrategyContext;
    result: StrategyResult;
    executedAt: Date;
  }> = [];

  constructor() {
    this.initializeStrategyMap();
  }

  private initializeStrategyMap(): void {
    const types: StrategyType[] = [
      'compress', 'extend', 'focus-mode',
      'deviation-response', 'difficulty-adjust', 'challenge-boost'
    ];
    types.forEach(type => this.strategies.set(type, []));
  }

  /**
   * 注册策略
   */
  register(strategy: StrategyDefinition): void {
    const strategies = this.strategies.get(strategy.type);
    if (strategies) {
      strategies.push(strategy);
    }
  }

  /**
   * 注销策略
   */
  unregister(strategyName: string): boolean {
    for (const [type, strategies] of this.strategies) {
      const index = strategies.findIndex(s => s.name === strategyName);
      if (index !== -1) {
        strategies.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * 匹配策略
   */
  match(signals: LearningSignal[], context: StrategyContext): StrategyDefinition[] {
    const matchedStrategies: StrategyDefinition[] = [];
    const signalTypes = new Set(signals.map(s => s.type));

    for (const [type, strategies] of this.strategies) {
      for (const strategy of strategies) {
        // 检查信号类型匹配
        const hasMatchingSignal = strategy.triggers.some(trigger =>
          trigger.signals.some(signalType => signalTypes.has(signalType))
        );

        if (!hasMatchingSignal) continue;

        // 检查信号强度
        const meetsMinIntensity = strategy.triggers.every(trigger => {
          if (!trigger.minIntensity) return true;
          return signals.some(s =>
            trigger.signals.includes(s.type) && s.intensity >= trigger.minIntensity
          );
        });

        if (!meetsMinIntensity) continue;

        // 检查自定义条件
        const meetsConditions = strategy.triggers.every(trigger => {
          if (!trigger.conditions) return true;
          return trigger.conditions(context);
        });

        if (meetsConditions) {
          matchedStrategies.push(strategy);
        }
      }
    }

    // 按优先级排序（通过执行函数确定）
    return matchedStrategies;
  }

  /**
   * 执行策略
   */
  async execute(
    strategy: StrategyDefinition,
    context: StrategyContext
  ): Promise<StrategyResult> {
    try {
      const action = await strategy.execute(context);
      
      const result: StrategyResult = {
        success: true,
        action,
        adjustments: this.computeAdjustments(action),
      };

      // 记录执行历史
      this.executionHistory.push({
        strategyName: strategy.name,
        context,
        result,
        executedAt: new Date()
      });

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 根据动作计算调整
   */
  private computeAdjustments(action: StrategyAction): StrategyResult['adjustments'] {
    const adjustments: StrategyResult['adjustments'] = {};

    switch (action.type) {
      case 'compress':
        adjustments.weeksToRemove = action.parameters.weeksToRemove || 1;
        adjustments.tasksToMerge = action.parameters.tasksToMerge;
        break;
      
      case 'extend':
        adjustments.weeksToAdd = action.parameters.weeksToAdd || 1;
        adjustments.additionalReview = action.parameters.reviewTopics;
        break;
      
      case 'focus-mode':
        adjustments.focusTopics = action.parameters.focusTopics;
        break;
      
      case 'difficulty-adjust':
        adjustments.difficultyLevel = 'easier';
        break;
      
      case 'challenge-boost':
        adjustments.difficultyLevel = 'harder';
        break;
      
      case 'deviation-response':
        adjustments.focusTopics = action.parameters.newFocusTopics;
        break;
    }

    return adjustments;
  }

  /**
   * 获取特定类型的策略
   */
  getStrategies(type: StrategyType): StrategyDefinition[] {
    return this.strategies.get(type) || [];
  }

  /**
   * 获取所有策略
   */
  getAllStrategies(): Map<StrategyType, StrategyDefinition[]> {
    return new Map(this.strategies);
  }

  /**
   * 获取执行历史
   */
  getExecutionHistory(limit: number = 100): typeof this.executionHistory {
    return this.executionHistory.slice(-limit);
  }
}

// ============ 内置策略 ============

/**
 * 压缩策略 - 学习加速时
 */
export const compressStrategy: StrategyDefinition = {
  name: 'compress-path',
  type: 'compress',
  description: '当学习加速时，压缩路径时间',
  triggers: [
    {
      signals: ['accelerating'],
      minIntensity: 0.6
    }
  ],
  execute: async (context: StrategyContext) => {
    // 计算压缩程度
    const acceleration = context.recentSignals.find(s => s.type === 'accelerating');
    const intensity = acceleration?.intensity || 0.5;
    
    return {
      type: 'compress',
      parameters: {
        weeksToRemove: Math.ceil(intensity * 2),
        tasksToMerge: context.pathStats.skippedTasks > 2 ? ['adjacent-tasks'] : []
      },
      priority: 1
    };
  }
};

/**
 * 延伸策略 - 学习减速时
 */
export const extendStrategy: StrategyDefinition = {
  name: 'extend-path',
  type: 'extend',
  description: '当学习减速时，延长路径时间',
  triggers: [
    {
      signals: ['decelerating'],
      minIntensity: 0.5
    }
  ],
  execute: async (context: StrategyContext) => {
    const deceleration = context.recentSignals.find(s => s.type === 'decelerating');
    const intensity = deceleration?.intensity || 0.5;
    
    return {
      type: 'extend',
      parameters: {
        weeksToAdd: Math.ceil(intensity * 2),
        reviewTopics: context.userState.lf > 50 ? ['difficult-topics'] : []
      },
      priority: 1
    };
  }
};

/**
 * 疲劳调整策略
 */
export const fatigueAdjustStrategy: StrategyDefinition = {
  name: 'reduce-difficulty',
  type: 'difficulty-adjust',
  description: '当疲劳度高时，降低内容难度',
  triggers: [
    {
      signals: ['fatigue-high'],
      minIntensity: 0.7
    }
  ],
  execute: async (context: StrategyContext) => {
    return {
      type: 'difficulty-adjust',
      parameters: {
        reduceBy: context.userState.lf > 80 ? 2 : 1
      },
      priority: 2 // 高优先级
    };
  }
};

/**
 * 挑战提升策略
 */
export const challengeBoostStrategy: StrategyDefinition = {
  name: 'increase-challenge',
  type: 'challenge-boost',
  description: '当挫败感出现但能力足够时，提高挑战',
  triggers: [
    {
      signals: ['mastery'],
      minIntensity: 0.8,
      conditions: (context) => context.userState.ktl > 50
    }
  ],
  execute: async (context: StrategyContext) => {
    return {
      type: 'challenge-boost',
      parameters: {
        increaseBy: 1
      },
      priority: 1
    };
  }
};

/**
 * 变道响应策略
 */
export const deviationResponseStrategy: StrategyDefinition = {
  name: 'handle-lane-change',
  type: 'deviation-response',
  description: '当学习重点转移时，调整路径',
  triggers: [
    {
      signals: ['lane-change'],
      minIntensity: 0.5
    }
  ],
  execute: async (context: StrategyContext) => {
    return {
      type: 'deviation-response',
      parameters: {
        newFocusTopics: [], // 需要从上下文推断
        pauseOldTopics: true
      },
      priority: 2
    };
  }
};
