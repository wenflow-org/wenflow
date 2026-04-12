// 学生基线服务
// 使用指数加权移动平均 (EMA) 追踪学生的响应模式基线
// 使用 student_baselines 表（conversationBaseline 表已废弃）

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { ExtractedMetrics } from '../../utils/metrics-extractor';

export interface BaselineMetrics {
  responseTimeMean: number
  responseTimeVar: number
  messageLengthMean: number
  messageLengthVar: number
  intervalMean: number
  intervalVar: number
}

export interface BaselineUpdateResult {
  baseline: BaselineMetrics
  zScores: {
    responseTime: number
    messageLength: number
    interactionInterval: number
  }
}

// EMA 衰减因子（0-1，越大越重视历史数据）
const EMA_ALPHA = 0.8

class StudentBaselineService {
  /**
   * 获取学生的当前基线（从 student_baselines 表）
   * @param userId 用户 ID
   */
  async getBaseline(userId: string): Promise<BaselineMetrics | null> {
    try {
      const userBaseline = await prisma.student_baselines.findUnique({
        where: { userId }
      })
      
      if (!userBaseline) {
        return null
      }
      
      return {
        responseTimeMean: userBaseline.responseTimeEma,
        responseTimeVar: userBaseline.responseTimeEmVar,
        messageLengthMean: userBaseline.messageLengthEma,
        messageLengthVar: userBaseline.messageLengthEmVar,
        intervalMean: userBaseline.interactionIntervalEma,
        intervalVar: userBaseline.interactionIntervalEmVar
      }
    } catch (error) {
      logger.error('获取学生基线失败:', error)
      return null
    }
  }
  
  /**
   * 更新学生基线（使用 EMA）
   * EMA 公式：new_mean = α * new_value + (1-α) * old_mean
   * new_var = α * (new_value - new_mean)² + (1-α) * old_var
   */
  async updateBaseline(
    userId: string,
    metrics: ExtractedMetrics
  ): Promise<BaselineUpdateResult> {
    try {
      // 获取当前基线
      let baseline = await this.getBaseline(userId)
      
      // 如果没有基线，使用初始值
      if (!baseline) {
        baseline = {
          responseTimeMean: metrics.responseTime,
          responseTimeVar: 1,
          messageLengthMean: metrics.messageLength,
          messageLengthVar: 1,
          intervalMean: metrics.interactionInterval,
          intervalVar: 1
        }
        
        // 创建新基线记录
        await prisma.student_baselines.create({
          data: {
            id: userId,
            userId,
            responseTimeEma: baseline.responseTimeMean,
            responseTimeEmVar: baseline.responseTimeVar,
            messageLengthEma: baseline.messageLengthMean,
            messageLengthEmVar: baseline.messageLengthVar,
            interactionIntervalEma: baseline.intervalMean,
            interactionIntervalEmVar: baseline.intervalVar,
            updatedAt: new Date()
          }
        })
        
        logger.info('创建新的学生基线', { userId })
      } else {
        // 使用 EMA 更新基线
        const oldMean = baseline
        const alpha = EMA_ALPHA
        
        // 更新均值
        const newRtMean = alpha * metrics.responseTime + (1 - alpha) * oldMean.responseTimeMean
        const newMlMean = alpha * metrics.messageLength + (1 - alpha) * oldMean.messageLengthMean
        const newIntMean = alpha * metrics.interactionInterval + (1 - alpha) * oldMean.intervalMean
        
        // 更新方差（使用新均值）
        const rtDiff = metrics.responseTime - newRtMean
        const mlDiff = metrics.messageLength - newMlMean
        const intDiff = metrics.interactionInterval - newIntMean
        
        const newRtVar = alpha * (rtDiff * rtDiff) + (1 - alpha) * oldMean.responseTimeVar
        const newMlVar = alpha * (mlDiff * mlDiff) + (1 - alpha) * oldMean.messageLengthVar
        const newIntVar = alpha * (intDiff * intDiff) + (1 - alpha) * oldMean.intervalVar
        
        baseline = {
          responseTimeMean: newRtMean,
          responseTimeVar: Math.max(newRtVar, 0.01),
          messageLengthMean: newMlMean,
          messageLengthVar: Math.max(newMlVar, 0.01),
          intervalMean: newIntMean,
          intervalVar: Math.max(newIntVar, 0.01)
        }
        
        // 更新数据库
        await prisma.student_baselines.update({
          where: { userId },
          data: {
            responseTimeEma: baseline.responseTimeMean,
            responseTimeEmVar: baseline.responseTimeVar,
            messageLengthEma: baseline.messageLengthMean,
            messageLengthEmVar: baseline.messageLengthVar,
            interactionIntervalEma: baseline.intervalMean,
            interactionIntervalEmVar: baseline.intervalVar,
            updateCount: { increment: 1 },
            updatedAt: new Date()
          }
        })
        
        logger.debug('学生基线已更新', { userId })
      }
      
      // 计算 Z-Score
      const zScores = this.calculateZScores(baseline, metrics)
      
      return {
        baseline,
        zScores
      }
    } catch (error) {
      logger.error('更新学生基线失败:', error)
      throw error
    }
  }
  
  /**
   * 计算 Z-Score
   * Z = (X - μ) / σ
   */
  private calculateZScores(
    baseline: BaselineMetrics,
    metrics: ExtractedMetrics
  ): {
    responseTime: number
    messageLength: number
    interactionInterval: number
  } {
    const rtStd = Math.sqrt(baseline.responseTimeVar)
    const mlStd = Math.sqrt(baseline.messageLengthVar)
    const intStd = Math.sqrt(baseline.intervalVar)
    
    return {
      responseTime: rtStd > 0 ? (metrics.responseTime - baseline.responseTimeMean) / rtStd : 0,
      messageLength: mlStd > 0 ? (metrics.messageLength - baseline.messageLengthMean) / mlStd : 0,
      interactionInterval: intStd > 0 ? (metrics.interactionInterval - baseline.intervalMean) / intStd : 0
    }
  }
  
  /**
   * 重置学生基线
   */
  async resetBaseline(userId: string): Promise<void> {
    try {
      await prisma.student_baselines.delete({
        where: { userId }
      })
      
      logger.info('学生基线已重置', { userId })
    } catch (error) {
      logger.error('重置学生基线失败:', error)
      throw error
    }
  }
}

export default new StudentBaselineService()
