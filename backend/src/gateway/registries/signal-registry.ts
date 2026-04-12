/**
 * Signal 注册表 - EduClaw Gateway
 * 
 * 注册和匹配各种学习信号
 */

import { LearningSignalType, LearningSignal } from '../../agents/protocol';

// 信号检测器
export interface SignalDetector {
  name: string;
  description: string;
  signalType: LearningSignalType;
  
  // 检测函数，返回信号强度 0-1，null 表示未检测到
  detect: (data: SignalData) => Promise<number | null>;
  
  // 阈值，超过此值才触发信号
  threshold: number;
}

// 信号数据
export interface SignalData {
  userId: string;
  sessionId?: string;
  
  // 进度数据
  progress?: {
    completionRate: number;
    timeSpent: number;
    tasksCompleted: number;
    tasksSkipped: number;
  };
  
  // 学习状态
  state?: {
    ktl: number; // Knowledge Training Load
    lf: number;  // Learning Fatigue
    lss: number; // Learning Stress Score
  };
  
  // 交互数据
  interactions?: {
    helpRequests: number;
    hintsUsed: number;
    incorrectAttempts: number;
    timeOnTask: number;
  };
  
  // 反馈数据
  feedback?: {
    subjectiveDifficulty: number; // 1-10
    satisfactionScore: number;    // 1-5
    comments?: string;
  };
  
  // 历史趋势
  trends?: {
    speedChange: number; // 正值加速，负值减速
    focusShifts: number; // 重点转移次数
    consistencyScore: number; // 一致性评分
  };
}

// 信号配置
export interface SignalConfig {
  cooldown: number; // 冷却时间（毫秒）
  minInterval: number; // 最小检测间隔
  aggregation: 'max' | 'average' | 'first'; // 多检测器聚合方式
}

/**
 * Signal 注册表实现
 */
export class SignalRegistry {
  private detectors: Map<LearningSignalType, SignalDetector[]> = new Map();
  private lastSignals: Map<string, Map<LearningSignalType, number>> = new Map(); // userId -> signalType -> timestamp
  private config: SignalConfig;

  constructor(config: Partial<SignalConfig> = {}) {
    this.config = {
      cooldown: 60000, // 默认 1 分钟冷却
      minInterval: 30000, // 默认 30 秒最小间隔
      aggregation: 'max',
      ...config
    };
    
    this.initializeDetectorMap();
  }

  private initializeDetectorMap(): void {
    const signalTypes: LearningSignalType[] = [
      'accelerating', 'decelerating', 'lane-change',
      'fatigue-high', 'frustration', 'mastery', 'struggling'
    ];
    signalTypes.forEach(type => this.detectors.set(type, []));
  }

  /**
   * 注册信号检测器
   */
  register(detector: SignalDetector): void {
    const detectors = this.detectors.get(detector.signalType);
    if (detectors) {
      detectors.push(detector);
    }
  }

  /**
   * 注销信号检测器
   */
  unregister(detectorName: string): boolean {
    for (const [type, detectors] of this.detectors) {
      const index = detectors.findIndex(d => d.name === detectorName);
      if (index !== -1) {
        detectors.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * 检测信号
   */
  async detect(data: SignalData): Promise<LearningSignal[]> {
    const signals: LearningSignal[] = [];
    const now = Date.now();

    for (const [signalType, detectors] of this.detectors) {
      // 检查冷却
      if (this.isInCooldown(data.userId, signalType, now)) {
        continue;
      }

      // 运行所有检测器
      const intensities: number[] = [];
      for (const detector of detectors) {
        try {
          const intensity = await detector.detect(data);
          if (intensity !== null && intensity >= detector.threshold) {
            intensities.push(intensity);
          }
        } catch (error) {
          console.error(`Signal detector ${detector.name} error:`, error);
        }
      }

      // 聚合结果
      if (intensities.length > 0) {
        const finalIntensity = this.aggregateIntensities(intensities);
        
        signals.push({
          type: signalType,
          intensity: finalIntensity,
          timestamp: new Date().toISOString(),
        });

        // 更新最后信号时间
        this.updateLastSignal(data.userId, signalType, now);
      }
    }

    return signals;
  }

  /**
   * 获取特定类型的检测器
   */
  getDetectors(signalType: LearningSignalType): SignalDetector[] {
    return this.detectors.get(signalType) || [];
  }

  /**
   * 获取所有检测器
   */
  getAllDetectors(): Map<LearningSignalType, SignalDetector[]> {
    return new Map(this.detectors);
  }

  /**
   * 检查冷却状态
   */
  private isInCooldown(userId: string, signalType: LearningSignalType, now: number): boolean {
    const userSignals = this.lastSignals.get(userId);
    if (!userSignals) return false;

    const lastTime = userSignals.get(signalType);
    if (!lastTime) return false;

    return (now - lastTime) < this.config.cooldown;
  }

  /**
   * 更新最后信号时间
   */
  private updateLastSignal(userId: string, signalType: LearningSignalType, timestamp: number): void {
    if (!this.lastSignals.has(userId)) {
      this.lastSignals.set(userId, new Map());
    }
    this.lastSignals.get(userId)!.set(signalType, timestamp);
  }

  /**
   * 聚合强度值
   */
  private aggregateIntensities(intensities: number[]): number {
    if (intensities.length === 0) return 0;

    switch (this.config.aggregation) {
      case 'max':
        return Math.max(...intensities);
      case 'average':
        return intensities.reduce((a, b) => a + b, 0) / intensities.length;
      case 'first':
        return intensities[0];
      default:
        return Math.max(...intensities);
    }
  }

  /**
   * 清理过期的冷却记录
   */
  cleanupExpiredCooldowns(maxAge: number = 3600000): void {
    const now = Date.now();
    for (const [userId, signals] of this.lastSignals) {
      for (const [signalType, timestamp] of signals) {
        if (now - timestamp > maxAge) {
          signals.delete(signalType);
        }
      }
      if (signals.size === 0) {
        this.lastSignals.delete(userId);
      }
    }
  }
}

// ============ 内置信号检测器 ============

/**
 * 加速检测器
 */
export const acceleratingDetector: SignalDetector = {
  name: 'speed-up-detector',
  description: '检测学习速度是否加快',
  signalType: 'accelerating',
  threshold: 0.6,
  detect: async (data: SignalData) => {
    if (!data.trends?.speedChange) return null;
    // 速度提升超过 30% 视为加速
    if (data.trends.speedChange > 0.3) {
      return Math.min(data.trends.speedChange, 1);
    }
    return null;
  }
};

/**
 * 减速检测器
 */
export const deceleratingDetector: SignalDetector = {
  name: 'slow-down-detector',
  description: '检测学习速度是否减慢',
  signalType: 'decelerating',
  threshold: 0.5,
  detect: async (data: SignalData) => {
    if (!data.trends?.speedChange) return null;
    // 速度下降超过 20% 视为减速
    if (data.trends.speedChange < -0.2) {
      return Math.min(Math.abs(data.trends.speedChange), 1);
    }
    return null;
  }
};

/**
 * 疲劳检测器
 */
export const fatigueDetector: SignalDetector = {
  name: 'fatigue-detector',
  description: '检测学习疲劳度',
  signalType: 'fatigue-high',
  threshold: 0.7,
  detect: async (data: SignalData) => {
    if (!data.state?.lf) return null;
    // LF 超过 70 视为高疲劳
    if (data.state.lf > 70) {
      return data.state.lf / 100;
    }
    return null;
  }
};

/**
 * 挣扎检测器
 */
export const strugglingDetector: SignalDetector = {
  name: 'struggle-detector',
  description: '检测学习困难',
  signalType: 'struggling',
  threshold: 0.6,
  detect: async (data: SignalData) => {
    if (!data.interactions) return null;
    
    const { helpRequests, hintsUsed, incorrectAttempts, timeOnTask } = data.interactions;
    
    // 综合评分：求助次数、提示使用、错误尝试
    const struggleScore = (
      (helpRequests * 0.3) +
      (hintsUsed * 0.3) +
      (incorrectAttempts * 0.4)
    ) / 10; // 归一化
    
    return Math.min(struggleScore, 1);
  }
};

/**
 * 掌握检测器
 */
export const masteryDetector: SignalDetector = {
  name: 'mastery-detector',
  description: '检测知识掌握',
  signalType: 'mastery',
  threshold: 0.8,
  detect: async (data: SignalData) => {
    if (!data.progress) return null;
    
    // 完成率高且无困难
    const completionRate = data.progress.completionRate;
    const incorrectAttempts = data.interactions?.incorrectAttempts || 0;
    
    if (completionRate > 0.9 && incorrectAttempts < 2) {
      return completionRate;
    }
    return null;
  }
};

/**
 * 变道检测器
 */
export const laneChangeDetector: SignalDetector = {
  name: 'lane-change-detector',
  description: '检测学习重点转移',
  signalType: 'lane-change',
  threshold: 0.5,
  detect: async (data: SignalData) => {
    if (!data.trends?.focusShifts) return null;
    // 重点转移次数超过阈值
    if (data.trends.focusShifts >= 3) {
      return Math.min(data.trends.focusShifts / 5, 1);
    }
    return null;
  }
};
