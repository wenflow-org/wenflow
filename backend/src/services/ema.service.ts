/**
 * EMA (Exponential Moving Average) 服务
 * 
 * 用于建立学生个人化动态基线
 * 
 * 核心公式:
 * EMA_t = α × X_t + (1-α) × EMA_{t-1}
 * EMVar_t = α × (X_t - EMA_t)² + (1-α) × EMVar_{t-1}
 * Z_t = (X_t - EMA_{t-1}) / √EMVar_{t-1}
 */

export interface EMABaseline {
  ema: number;      // 指数移动平均值
  emVar: number;    // 指数移动方差
  updateCount: number;
}

export interface EMAResult {
  baseline: EMABaseline;
  zScore: number;
  isAbnormal: boolean;
}

/**
 * EMA 配置
 */
export interface EMAConfig {
  /** 平滑系数 α (0-1)，默认 0.1 */
  alpha?: number;
  /** 异常阈值 Z-Score，默认 2.5 */
  abnormalThreshold?: number;
  /** 最小更新次数（少于该次数不计算 Z-Score） */
  minUpdates?: number;
}

const DEFAULT_CONFIG: EMAConfig = {
  alpha: 0.1,
  abnormalThreshold: 2.5,
  minUpdates: 5
};

/**
 * 更新 EMA 基线
 * 
 * @param baseline 当前基线
 * @param newValue 新观测值
 * @param config EMA 配置
 * @returns 更新后的基线
 */
export function updateEMA(
  baseline: EMABaseline,
  newValue: number,
  config: EMAConfig = DEFAULT_CONFIG
): EMABaseline {
  const alpha = config.alpha ?? 0.1;
  
  const newEma = alpha * newValue + (1 - alpha) * baseline.ema;
  const deviation = newValue - newEma;
  const newEmVar = alpha * (deviation * deviation) + (1 - alpha) * baseline.emVar;
  
  return {
    ema: newEma,
    emVar: newEmVar,
    updateCount: baseline.updateCount + 1
  };
}

/**
 * 计算 Z-Score（判断是否异常）
 * 
 * @param value 当前值
 * @param baseline EMA 基线
 * @param config EMA 配置
 * @returns Z-Score，如果数据不足则返回 0
 */
export function calculateZScore(
  value: number,
  baseline: EMABaseline,
  config: EMAConfig = DEFAULT_CONFIG
): number {
  const minUpdates = config.minUpdates ?? 5;
  
  // 数据不足，不判断
  if (baseline.updateCount < minUpdates) {
    return 0;
  }
  
  // 方差太小，避免除零
  if (baseline.emVar < 0.0001) {
    return 0;
  }
  
  const stdDev = Math.sqrt(baseline.emVar);
  return (value - baseline.ema) / stdDev;
}

/**
 * 处理新观测值并返回结果
 * 
 * @param baseline 当前基线
 * @param newValue 新观测值
 * @param config EMA 配置
 * @returns 包含更新后基线和 Z-Score 的结果
 */
export function processObservation(
  baseline: EMABaseline,
  newValue: number,
  config: EMAConfig = DEFAULT_CONFIG
): EMAResult {
  // 先计算 Z-Score（使用旧基线）
  const zScore = calculateZScore(newValue, baseline, config);
  
  // 再更新基线
  const newBaseline = updateEMA(baseline, newValue, config);
  
  // 判断是否异常
  const threshold = config.abnormalThreshold ?? 2.5;
  const isAbnormal = Math.abs(zScore) > threshold;
  
  return {
    baseline: newBaseline,
    zScore,
    isAbnormal
  };
}

/**
 * 初始化默认基线
 * 
 * @param metricType 指标类型
 * @returns 默认基线值
 */
export function initializeBaseline(metricType: string): EMABaseline {
  const defaults: Record<string, EMABaseline> = {
    responseTime: { ema: 10.0, emVar: 1.0, updateCount: 0 },
    messageLength: { ema: 50.0, emVar: 100.0, updateCount: 0 },
    interactionInterval: { ema: 5.0, emVar: 1.0, updateCount: 0 },
    aiScore: { ema: 0.5, emVar: 0.01, updateCount: 0 }
  };
  
  return defaults[metricType] || { ema: 0, emVar: 1, updateCount: 0 };
}
