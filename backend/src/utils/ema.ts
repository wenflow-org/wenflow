/**
 * EMA（指数移动平均）核心工具函数
 * 
 * 用于动态追踪学生表现基线，支持异常检测
 */

/**
 * EMA 基线数据类型
 */
export interface EMABaseline {
  /** 指数移动平均值 */
  ema: number
  /** 指数移动方差 */
  emVar: number
  /** 更新次数（用于判断数据是否充足） */
  updateCount?: number
}

/**
 * 更新 EMA 基线
 * 
 * 使用指数移动平均算法更新基线值和方差
 * 公式：
 * - newEma = alpha * newValue + (1 - alpha) * oldEma
 * - newEmVar = alpha * (newValue - newEma)^2 + (1 - alpha) * oldEmVar
 * 
 * @param baseline 当前基线 {ema, emVar, updateCount}
 * @param newValue 新观测值
 * @param alpha 平滑系数（默认 0.1，越小越稳定）
 *              - 较大值（如 0.3）：快速适应变化，但波动大
 *              - 较小值（如 0.05）：稳定，但响应慢
 * @returns 更新后的基线 {ema, emVar, updateCount}
 */
export function updateEMA(
  baseline: EMABaseline,
  newValue: number,
  alpha: number = 0.1
): EMABaseline {
  // 边界检查：alpha 必须在 (0, 1] 范围内
  if (alpha <= 0 || alpha > 1) {
    throw new Error('alpha 必须在 (0, 1] 范围内')
  }

  const { ema: oldEma, emVar: oldEmVar, updateCount = 0 } = baseline

  // 计算新的 EMA 值
  const newEma = alpha * newValue + (1 - alpha) * oldEma

  // 计算新的方差（使用新 EMA 值作为基准）
  const deviation = newValue - newEma
  const newEmVar = alpha * (deviation * deviation) + (1 - alpha) * oldEmVar

  return {
    ema: newEma,
    emVar: newEmVar,
    updateCount: updateCount + 1
  }
}

/**
 * 初始化 EMA 基线
 * 
 * 使用初始值创建基线，方差设为初始值的 10% 或最小值 1
 * 
 * @param initialValue 初始观测值
 * @param options 配置项
 * @param options.initialVar 初始方差（默认为 initialValue 的 10%）
 * @returns 初始化的基线
 */
export function initEMABaseline(
  initialValue: number,
  options: { initialVar?: number } = {}
): EMABaseline {
  const { initialVar } = options
  const calculatedVar = initialVar ?? Math.max(1, Math.abs(initialValue) * 0.1)

  return {
    ema: initialValue,
    emVar: calculatedVar,
    updateCount: 1
  }
}

/**
 * 计算 Z-Score（标准分数）
 * 
 * 用于判断当前值是否异常
 * Z-Score 表示当前值距离基线有多少个标准差
 * 
 * 判断标准：
 * - |Z| < 1: 正常范围（68% 的数据）
 * - 1 <= |Z| < 2: 轻微异常（95% 的数据）
 * - |Z| >= 2: 显著异常（99.7% 的数据）
 * 
 * @param value 当前值
 * @param baseline EMA 基线 {ema, emVar, updateCount}
 * @param options 配置项
 * @param options.minUpdates 最小更新次数（默认 5，少于此时返回 0）
 * @param options.minVariance 最小方差阈值（默认 0.001，避免除零）
 * @returns Z-Score 值（>2 表示异常，< -2 表示显著偏低）
 */
export function calculateZScore(
  value: number,
  baseline: EMABaseline,
  options: { minUpdates?: number; minVariance?: number } = {}
): number {
  const { minUpdates = 5, minVariance = 0.001 } = options
  const { ema, emVar, updateCount = 0 } = baseline

  // 如果数据量不足，返回 0（无法判断）
  if (updateCount < minUpdates) {
    return 0
  }

  // 如果方差太小，避免除零错误，返回 0
  if (emVar < minVariance) {
    return 0
  }

  // 计算标准差
  const stdDev = Math.sqrt(emVar)

  // 计算 Z-Score
  const zScore = (value - ema) / stdDev

  return zScore
}

/**
 * 判断值是否异常
 * 
 * @param value 当前值
 * @param baseline EMA 基线
 * @param threshold Z-Score 阈值（默认 2，即 95% 置信区间）
 * @returns 是否异常
 */
export function isAnomaly(
  value: number,
  baseline: EMABaseline,
  threshold: number = 2
): boolean {
  const zScore = calculateZScore(value, baseline)
  return Math.abs(zScore) >= threshold
}

/**
 * 批量更新 EMA 基线
 * 
 * @param baseline 当前基线
 * @param values 新观测值数组
 * @param alpha 平滑系数
 * @returns 更新后的基线
 */
export function batchUpdateEMA(
  baseline: EMABaseline,
  values: number[],
  alpha: number = 0.1
): EMABaseline {
  let current = baseline

  for (const value of values) {
    current = updateEMA(current, value, alpha)
  }

  return current
}

/**
 * 从历史数据计算 EMA 基线
 * 
 * @param values 历史观测值数组
 * @param alpha 平滑系数
 * @returns 计算后的基线
 */
export function computeEMAFromHistory(
  values: number[],
  alpha: number = 0.1
): EMABaseline {
  if (values.length === 0) {
    throw new Error('历史数据不能为空')
  }

  const initial = initEMABaseline(values[0])
  return batchUpdateEMA(initial, values.slice(1), alpha)
}
