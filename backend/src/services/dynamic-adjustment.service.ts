/**
 * 动态调整服务
 * 
 * 协调信号检测、策略匹配和路径调整
 */

import { PrismaClient } from '@prisma/client';
import { EventBus, getEventBus, LearningEvent } from '../gateway/event-bus';
import { SignalRegistry, SignalData } from '../gateway/registries/signal-registry';
import { StrategyRegistry, StrategyContext } from '../gateway/registries/strategy-registry';
import { LearningSignal } from '../agents/protocol';
import { replanPath } from '../agents/path-agent';
import { adjustContentDifficulty } from '../agents/content-agent-v5';

// 内置检测器
import {
  acceleratingDetector,
  deceleratingDetector,
  fatigueDetector,
  strugglingDetector,
  masteryDetector,
  laneChangeDetector
} from '../gateway/registries/signal-registry';

// 内置策略
import {
  compressStrategy,
  extendStrategy,
  fatigueAdjustStrategy,
  challengeBoostStrategy,
  deviationResponseStrategy
} from '../gateway/registries/strategy-registry';

/**
 * 动态调整服务配置
 */
export interface DynamicAdjustmentConfig {
  enabled: boolean;
  checkInterval: number; // 检查间隔（毫秒）
  minSignalsForAdjustment: number; // 最小信号数才触发调整
  cooldownBetweenAdjustments: number; // 调整之间的冷却时间
}

const DEFAULT_CONFIG: DynamicAdjustmentConfig = {
  enabled: true,
  checkInterval: 60000, // 1分钟
  minSignalsForAdjustment: 1,
  cooldownBetweenAdjustments: 300000 // 5分钟
};

/**
 * 动态调整服务
 */
export class DynamicAdjustmentService {
  private prisma: PrismaClient;
  private eventBus: EventBus;
  private signalRegistry: SignalRegistry;
  private strategyRegistry: StrategyRegistry;
  private config: DynamicAdjustmentConfig;
  private lastAdjustmentTime: Map<string, number> = new Map();
  private userSignals: Map<string, LearningSignal[]> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    prisma: PrismaClient,
    config: Partial<DynamicAdjustmentConfig> = {}
  ) {
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = getEventBus();
    this.signalRegistry = new SignalRegistry();
    this.strategyRegistry = new StrategyRegistry();
    
    this.setupBuiltinComponents();
    this.setupEventListeners();
  }

  /**
   * 设置内置组件
   */
  private setupBuiltinComponents(): void {
    // 注册内置信号检测器
    this.signalRegistry.register(acceleratingDetector);
    this.signalRegistry.register(deceleratingDetector);
    this.signalRegistry.register(fatigueDetector);
    this.signalRegistry.register(strugglingDetector);
    this.signalRegistry.register(masteryDetector);
    this.signalRegistry.register(laneChangeDetector);
    
    // 注册内置策略
    this.strategyRegistry.register(compressStrategy);
    this.strategyRegistry.register(extendStrategy);
    this.strategyRegistry.register(fatigueAdjustStrategy);
    this.strategyRegistry.register(challengeBoostStrategy);
    this.strategyRegistry.register(deviationResponseStrategy);
  }

  /**
   * 设置事件监听
   */
  private setupEventListeners(): void {
    // 监听学习事件，收集信号
    const signalEvents = [
      'learning:started',
      'learning:completed',
      'task:started',
      'task:completed',
      'learning:speed:change',
      'learning:focus:shift'
    ];

    signalEvents.forEach(eventType => {
      this.eventBus.on(eventType as any, async (event: LearningEvent) => {
        await this.handleLearningEvent(event);
      });
    });
  }

  /**
   * 处理学习事件
   */
  private async handleLearningEvent(event: LearningEvent): Promise<void> {
    if (!event.userId) return;

    // 构建信号数据
    const signalData: SignalData = {
      userId: event.userId,
      sessionId: event.sessionId,
      progress: event.data.progress,
      state: event.data.state,
      interactions: event.data.interactions,
      trends: event.data.trends
    };

    // 检测信号
    const signals = await this.signalRegistry.detect(signalData);
    
    // 存储用户信号
    if (signals.length > 0) {
      const existingSignals = this.userSignals.get(event.userId) || [];
      this.userSignals.set(event.userId, [...existingSignals, ...signals]);
      
      // 触发调整检查
      await this.checkAndAdjust(event.userId);
    }
  }

  /**
   * 检查并执行调整
   */
  private async checkAndAdjust(userId: string): Promise<void> {
    if (!this.config.enabled) return;

    // 检查冷却时间
    const lastTime = this.lastAdjustmentTime.get(userId) || 0;
    if (Date.now() - lastTime < this.config.cooldownBetweenAdjustments) {
      return;
    }

    // 获取累积的信号
    const signals = this.userSignals.get(userId) || [];
    if (signals.length < this.config.minSignalsForAdjustment) {
      return;
    }

    // 获取用户上下文
    const context = await this.getUserContext(userId);
    if (!context) return;

    // 匹配策略
    const matchedStrategies = this.strategyRegistry.match(signals, context);
    if (matchedStrategies.length === 0) return;

    // 执行策略
    for (const strategy of matchedStrategies) {
      try {
        const result = await this.strategyRegistry.execute(strategy, context);
        
        if (result.success && result.adjustments) {
          await this.applyAdjustments(userId, result.adjustments, context);
          
          // 记录调整时间
          this.lastAdjustmentTime.set(userId, Date.now());
          
          // 清除已处理的信号
          this.userSignals.set(userId, []);
        }
      } catch (error) {
        console.error(`[DynamicAdjustment] Strategy execution error: ${error}`);
      }
    }
  }

  /**
   * 获取用户上下文
   */
  private async getUserContext(userId: string): Promise<StrategyContext | null> {
    try {
      const user = await this.prisma.users.findUnique({
        where: { id: userId },
        include: {
          learning_paths: {
            where: { /* active path condition */ },
            take: 1
          },
          learning_metrics: {
            orderBy: { calculatedAt: 'desc' },
            take: 1
          }
        }
      });

      if (!user) return null;

      const activePath = user.learning_paths[0];
      const latestMetrics = user.learning_metrics[0];

      return {
        userId,
        pathId: activePath?.id || '',
        currentWeek: 1, // TODO: 从实际数据获取
        pathStats: {
          totalWeeks: activePath?.totalMilestones || 0,
          completedWeeks: 0,
          totalTasks: 0,
          completedTasks: 0,
          skippedTasks: 0
        },
        userState: {
          level: user.currentLevel === 'beginner' ? 1 : 
                 user.currentLevel === 'intermediate' ? 2 : 
                 user.currentLevel === 'advanced' ? 3 : 1,
          xp: user.xp,
          ktl: latestMetrics?.ktl || 0,
          lf: latestMetrics?.lf || 0,
          lss: latestMetrics?.lss || 0
        },
        recentSignals: this.userSignals.get(userId) || []
      };
    } catch (error) {
      console.error('[DynamicAdjustment] Error getting user context:', error);
      return null;
    }
  }

  /**
   * 应用调整
   */
  private async applyAdjustments(
    userId: string,
    adjustments: NonNullable<import('../gateway/registries/strategy-registry').StrategyResult['adjustments']>,
    context: StrategyContext
  ): Promise<void> {
    // 发布调整事件
    await this.eventBus.emit({
      type: 'path:adjusted',
      source: 'dynamic-adjustment-service',
      userId,
      data: {
        adjustments,
        context: {
          pathId: context.pathId,
          currentWeek: context.currentWeek
        }
      }
    });

    // 如果有路径调整，通知 path-agent
    if (adjustments.weeksToAdd || adjustments.weeksToRemove) {
      // path-agent 会监听 path:adjusted 事件并执行重规划
    }

    // 如果有难度调整，通知 content-agent
    if (adjustments.difficultyLevel) {
      // content-agent 会监听并调整内容难度
    }
  }

  /**
   * 启动服务
   */
  start(): void {
    if (this.checkInterval) return;
    
    this.checkInterval = setInterval(() => {
      this.periodicCheck();
    }, this.config.checkInterval);
    
    console.log('[DynamicAdjustment] Service started');
  }

  /**
   * 停止服务
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    console.log('[DynamicAdjustment] Service stopped');
  }

  /**
   * 周期性检查
   */
  private async periodicCheck(): Promise<void> {
    // 清理过期的冷却记录
    const now = Date.now();
    for (const [userId, lastTime] of this.lastAdjustmentTime) {
      if (now - lastTime > this.config.cooldownBetweenAdjustments * 2) {
        this.lastAdjustmentTime.delete(userId);
      }
    }
    
    // 清理信号缓存
    this.signalRegistry.cleanupExpiredCooldowns();
  }

  /**
   * 手动触发调整
   */
  async triggerAdjustment(userId: string): Promise<void> {
    await this.checkAndAdjust(userId);
  }

  /**
   * 获取用户当前信号
   */
  getUserSignals(userId: string): LearningSignal[] {
    return this.userSignals.get(userId) || [];
  }

  /**
   * 清除用户信号
   */
  clearUserSignals(userId: string): void {
    this.userSignals.delete(userId);
  }
}

// 单例
let dynamicAdjustmentService: DynamicAdjustmentService | null = null;

/**
 * 创建动态调整服务
 */
export function createDynamicAdjustmentService(
  prisma: PrismaClient,
  config?: Partial<DynamicAdjustmentConfig>
): DynamicAdjustmentService {
  if (!dynamicAdjustmentService) {
    dynamicAdjustmentService = new DynamicAdjustmentService(prisma, config);
  }
  return dynamicAdjustmentService;
}

/**
 * 获取动态调整服务
 */
export function getDynamicAdjustmentService(): DynamicAdjustmentService {
  if (!dynamicAdjustmentService) {
    throw new Error('DynamicAdjustmentService not initialized');
  }
  return dynamicAdjustmentService;
}
