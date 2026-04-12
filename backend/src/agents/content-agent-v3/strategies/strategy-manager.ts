/**
 * ContentAgent v3.0 - 策略管理器
 * 
 * 核心职责：
 * 1. 根据学生状态动态选择最合适的教学策略
 * 2. 提供策略的内容指导、UI 推荐、难度调整
 * 3. 记录策略选择日志，支持调试和优化
 * 
 * 融合 v1.0 和 v5.0 的优点：
 * - v1.0 的简单规则匹配
 * - v5.0 的状态感知和优先级机制
 * - 新增：5 种策略动态切换、得分排序、日志追踪
 */

import { logger } from '../../../utils/logger';
import {
  ContentStrategy,
  StrategyConfig,
  TriggerCondition,
  StudentState,
  StrategyScore,
  StrategySelectionResult,
  UIType,
  ContentGuideline
} from './types';
import { STRATEGY_CONFIGS, STRATEGY_REASONS } from './strategy-configs';

export class StrategyManager {
  /** 策略配置映射表 */
  private strategies: Map<ContentStrategy, StrategyConfig>;

  constructor() {
    // 初始化策略配置
    this.strategies = new Map<ContentStrategy, StrategyConfig>(
      Object.entries(STRATEGY_CONFIGS).map(
        ([key, value]) => [key as ContentStrategy, value]
      )
    );

    logger.info('[StrategyManager] 初始化完成，加载策略数量:', this.strategies.size);
  }

  /**
   * 根据学生状态选择策略
   * 
   * @param studentState 学生状态
   * @returns 策略选择结果（包含策略配置、原因、得分等）
   */
  selectStrategy(studentState: StudentState): StrategySelectionResult {
    logger.debug('[StrategyManager] 开始选择策略', {
      problemClarity: studentState.problemClarity,
      confidence: studentState.confidence,
      frustration: studentState.frustration,
      cognitiveDepth: studentState.cognitiveDepth,
      currentKTL: studentState.currentKTL,
      currentLF: studentState.currentLF,
      currentLSB: studentState.currentLSB
    });

    // 1. 计算所有策略的触发得分
    const scores = this.calculateTriggerScores(studentState);

    // 2. 按优先级排序
    const sortedStrategies = this.sortByPriority(scores);

    // 3. 获取最高优先级的策略
    const selected = sortedStrategies[0];

    // 4. 生成选择结果
    const result: StrategySelectionResult = {
      strategy: selected.config,
      reason: STRATEGY_REASONS[selected.strategy],
      triggeredConditions: selected.triggeredConditions,
      score: selected.score
    };

    // 5. 记录日志
    this.logStrategySelection(studentState, result);

    return result;
  }

  /**
   * 计算所有策略的触发得分
   * 
   * @param studentState 学生状态
   * @returns 策略得分列表
   */
  private calculateTriggerScores(studentState: StudentState): StrategyScore[] {
    const scores: StrategyScore[] = [];

    for (const [strategy, config] of this.strategies.entries()) {
      const triggeredConditions: TriggerCondition[] = [];
      let score = 0;

      // 计算触发条件满足度
      for (const condition of config.triggerConditions) {
        const value = this.getStateFieldValue(studentState, condition.field);
        
        if (value !== undefined && this.evaluateCondition(value, condition)) {
          triggeredConditions.push(condition);
          score += 1;
        }
      }

      // 如果是默认策略且没有其他触发，给基础分
      if (strategy === ContentStrategy.STANDARD && score === 0) {
        score = 0.5;  // 默认策略的基础分
      }

      scores.push({
        strategy,
        score,
        triggeredConditions
      });

      logger.debug(`[StrategyManager] 策略"${strategy}"得分: ${score}, 触发条件数：${triggeredConditions.length}`);
    }

    return scores;
  }

  /**
   * 获取状态字段值
   * 
   * @param studentState 学生状态
   * @param field 字段名
   * @returns 字段值
   */
  private getStateFieldValue(
    studentState: StudentState,
    field: keyof StudentState
  ): number | undefined {
    const value = studentState[field];
    
    // 处理 undefined 和 null
    if (value === undefined || value === null) {
      return undefined;
    }

    // 确保返回数值类型
    return typeof value === 'number' ? value : undefined;
  }

  /**
   * 评估触发条件
   * 
   * @param value 实际值
   * @param condition 触发条件
   * @returns 是否满足条件
   */
  private evaluateCondition(value: number, condition: TriggerCondition): boolean {
    switch (condition.operator) {
      case '>':
        return value > condition.value;
      case '<':
        return value < condition.value;
      case '>=':
        return value >= condition.value;
      case '<=':
        return value <= condition.value;
      case '==':
        return value === condition.value;
      case '!=':
        return value !== condition.value;
      default:
        return false;
    }
  }

  /**
   * 按优先级排序策略
   * 
   * 排序规则：
   * 1. 优先按得分降序（得分越高越优先）
   * 2. 得分相同时按优先级升序（priority 数字越小越优先）
   * 
   * @param scores 策略得分列表
   * @returns 排序后的策略配置列表
   */
  private sortByPriority(scores: StrategyScore[]): Array<{
    strategy: ContentStrategy;
    config: StrategyConfig;
    score: number;
    triggeredConditions: TriggerCondition[];
  }> {
    const sorted = [...scores].sort((a, b) => {
      // 优先按得分排序
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      // 得分相同按优先级排序（数字越小优先级越高）
      const configA = this.strategies.get(a.strategy)!;
      const configB = this.strategies.get(b.strategy)!;
      return configA.priority - configB.priority;
    });

    // 转换为包含 config 的对象数组
    return sorted.map(item => ({
      strategy: item.strategy,
      config: this.strategies.get(item.strategy)!,
      score: item.score,
      triggeredConditions: item.triggeredConditions
    }));
  }

  /**
   * 记录策略选择日志
   * 
   * @param studentState 学生状态
   * @param selectedStrategy 选中的策略
   */
  private logStrategySelection(
    studentState: StudentState,
    selectedStrategy: StrategySelectionResult
  ): void {
    logger.info('[StrategyManager] 策略选择', {
      timestamp: new Date().toISOString(),
      studentState: {
        problemClarity: studentState.problemClarity.toFixed(2),
        confidence: studentState.confidence.toFixed(2),
        frustration: studentState.frustration.toFixed(2),
        cognitiveDepth: studentState.cognitiveDepth.toFixed(2),
        currentKTL: studentState.currentKTL.toFixed(2),
        currentLF: studentState.currentLF.toFixed(2),
        currentLSB: studentState.currentLSB.toFixed(2),
        consecutiveErrors: studentState.consecutiveErrors ?? 0
      },
      selectedStrategy: selectedStrategy.strategy.type,
      reason: selectedStrategy.reason,
      score: selectedStrategy.score.toFixed(1),
      triggeredConditionsCount: selectedStrategy.triggeredConditions.length
    });
  }

  /**
   * 获取策略的 UI 类型推荐
   * 
   * @param strategy 策略类型
   * @param taskType 任务类型（可选，用于微调）
   * @returns 推荐的 UI 类型
   */
  getUITypeRecommendation(strategy: ContentStrategy, taskType?: string): UIType {
    const config = this.strategies.get(strategy);
    
    if (!config) {
      logger.error('[StrategyManager] 未知策略:', strategy);
      throw new Error(`Unknown strategy: ${strategy}`);
    }

    // 可以根据任务类型微调
    if (taskType === 'code' && strategy !== ContentStrategy.SUPPORTIVE) {
      return 'code';
    }

    if (taskType === 'coding' && strategy !== ContentStrategy.SUPPORTIVE) {
      return 'code';
    }

    return config.uiTypeRecommendation;
  }

  /**
   * 获取策略的内容指导
   * 
   * @param strategy 策略类型
   * @returns 内容指导原则
   */
  getContentGuidelines(strategy: ContentStrategy): ContentGuideline {
    const config = this.strategies.get(strategy);
    
    if (!config) {
      logger.error('[StrategyManager] 未知策略:', strategy);
      throw new Error(`Unknown strategy: ${strategy}`);
    }

    return config.contentGuidelines;
  }

  /**
   * 获取策略的难度调整
   * 
   * @param strategy 策略类型
   * @returns 难度调整值（-2 到 +2）
   */
  getDifficultyAdjustment(strategy: ContentStrategy): number {
    const config = this.strategies.get(strategy);
    
    if (!config) {
      logger.error('[StrategyManager] 未知策略:', strategy);
      throw new Error(`Unknown strategy: ${strategy}`);
    }

    return config.difficultyAdjustment;
  }

  /**
   * 获取所有策略配置
   * 
   * @returns 所有策略配置的映射
   */
  getAllStrategies(): Map<ContentStrategy, StrategyConfig> {
    return new Map(this.strategies);
  }

  /**
   * 获取单个策略配置
   * 
   * @param strategy 策略类型
   * @returns 策略配置
   */
  getStrategy(strategy: ContentStrategy): StrategyConfig | undefined {
    return this.strategies.get(strategy);
  }

  /**
   * 获取策略选择的原因说明
   * 
   * @param strategy 策略类型
   * @returns 原因说明
   */
  getStrategyReason(strategy: ContentStrategy): string {
    return STRATEGY_REASONS[strategy] || '未知策略';
  }

  /**
   * 手动指定策略（用于调试或特殊场景）
   * 
   * @param strategy 策略类型
   * @returns 策略配置
   */
  forceStrategy(strategy: ContentStrategy): StrategyConfig {
    const config = this.strategies.get(strategy);
    
    if (!config) {
      logger.error('[StrategyManager] 强制指定未知策略:', strategy);
      throw new Error(`Unknown strategy: ${strategy}`);
    }

    logger.warn('[StrategyManager] 强制指定策略:', strategy);
    return config;
  }
}

// 导出单例实例
export const strategyManager = new StrategyManager();

// 导出默认
export default StrategyManager;
