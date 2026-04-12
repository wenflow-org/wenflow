import { PrismaClient } from '@prisma/client';
import { 
  updateEMA, 
  calculateZScore, 
  processObservation,
  initializeBaseline,
  EMABaseline 
} from './ema.service';

const prisma = new PrismaClient();

/**
 * 学生基线数据
 */
export interface StudentBaselineData {
  responseTime: EMABaseline;
  messageLength: EMABaseline;
  interactionInterval: EMABaseline;
  aiScore: EMABaseline;
}

/**
 * Z-Score 结果
 */
export interface ZScoreResult {
  responseTime: number;
  messageLength: number;
  interactionInterval: number;
  aiScore: number;
}

/**
 * 异常检测结果
 */
export interface AnomalyDetectionResult {
  hasAnomaly: boolean;
  anomalyMetrics: string[];
  zScores: ZScoreResult;
  reasoning: string;
}

/**
 * 学生基线服务
 * 
 * 管理学生的个人化动态基线（EMA）
 */
export class StudentBaselineService {
  
  /**
   * 获取或创建学生基线
   */
  async getOrCreateBaseline(userId: string): Promise<StudentBaselineData> {
    let baseline = await prisma.student_baselines.findUnique({
      where: { userId }
    });
    
    if (!baseline) {
      // 创建默认基线
      baseline = await prisma.student_baselines.create({
        data: {
          id: userId,
          userId,
          responseTimeEma: 10.0,
          responseTimeEmVar: 1.0,
          messageLengthEma: 50.0,
          messageLengthEmVar: 100.0,
          interactionIntervalEma: 5.0,
          interactionIntervalEmVar: 1.0,
          aiScoreEma: 0.5,
          aiScoreEmVar: 0.01,
          updateCount: 0
        }
      });
    }
    
    return {
      responseTime: {
        ema: baseline.responseTimeEma,
        emVar: baseline.responseTimeEmVar,
        updateCount: baseline.updateCount
      },
      messageLength: {
        ema: baseline.messageLengthEma,
        emVar: baseline.messageLengthEmVar,
        updateCount: baseline.updateCount
      },
      interactionInterval: {
        ema: baseline.interactionIntervalEma,
        emVar: baseline.interactionIntervalEmVar,
        updateCount: baseline.updateCount
      },
      aiScore: {
        ema: baseline.aiScoreEma,
        emVar: baseline.aiScoreEmVar,
        updateCount: baseline.updateCount
      }
    };
  }
  
  /**
   * 更新学生基线
   */
  async updateBaseline(
    userId: string,
    metrics: {
      responseTime?: number;
      messageLength?: number;
      interactionInterval?: number;
      aiScore?: number;
    }
  ): Promise<{
    baseline: StudentBaselineData;
    zScores: ZScoreResult;
    anomaly: AnomalyDetectionResult;
  }> {
    // 获取当前基线
    const currentBaseline = await this.getOrCreateBaseline(userId);
    
    // 处理每个指标
    const updatedBaseline: Partial<StudentBaselineData> = {};
    const zScores: Partial<ZScoreResult> = {};
    
    if (metrics.responseTime !== undefined) {
      const result = processObservation(currentBaseline.responseTime, metrics.responseTime);
      updatedBaseline.responseTime = result.baseline;
      zScores.responseTime = result.zScore;
    }
    
    if (metrics.messageLength !== undefined) {
      const result = processObservation(currentBaseline.messageLength, metrics.messageLength);
      updatedBaseline.messageLength = result.baseline;
      zScores.messageLength = result.zScore;
    }
    
    if (metrics.interactionInterval !== undefined) {
      const result = processObservation(currentBaseline.interactionInterval, metrics.interactionInterval);
      updatedBaseline.interactionInterval = result.baseline;
      zScores.interactionInterval = result.zScore;
    }
    
    if (metrics.aiScore !== undefined) {
      const result = processObservation(currentBaseline.aiScore, metrics.aiScore);
      updatedBaseline.aiScore = result.baseline;
      zScores.aiScore = result.zScore;
    }
    
    // 检测异常
    const anomaly = this.detectAnomalies(zScores as ZScoreResult);
    
    // 保存到数据库
    const finalBaseline = await prisma.student_baselines.update({
      where: { userId },
      data: {
        responseTimeEma: updatedBaseline.responseTime?.ema ?? currentBaseline.responseTime.ema,
        responseTimeEmVar: updatedBaseline.responseTime?.emVar ?? currentBaseline.responseTime.emVar,
        messageLengthEma: updatedBaseline.messageLength?.ema ?? currentBaseline.messageLength.ema,
        messageLengthEmVar: updatedBaseline.messageLength?.emVar ?? currentBaseline.messageLength.emVar,
        interactionIntervalEma: updatedBaseline.interactionInterval?.ema ?? currentBaseline.interactionInterval.ema,
        interactionIntervalEmVar: updatedBaseline.interactionInterval?.emVar ?? currentBaseline.interactionInterval.emVar,
        aiScoreEma: updatedBaseline.aiScore?.ema ?? currentBaseline.aiScore.ema,
        aiScoreEmVar: updatedBaseline.aiScore?.emVar ?? currentBaseline.aiScore.emVar,
        updateCount: (currentBaseline.responseTime.updateCount || 0) + 1
      }
    });
    
    return {
      baseline: {
        responseTime: {
          ema: finalBaseline.responseTimeEma,
          emVar: finalBaseline.responseTimeEmVar,
          updateCount: finalBaseline.updateCount
        },
        messageLength: {
          ema: finalBaseline.messageLengthEma,
          emVar: finalBaseline.messageLengthEmVar,
          updateCount: finalBaseline.updateCount
        },
        interactionInterval: {
          ema: finalBaseline.interactionIntervalEma,
          emVar: finalBaseline.interactionIntervalEmVar,
          updateCount: finalBaseline.updateCount
        },
        aiScore: {
          ema: finalBaseline.aiScoreEma,
          emVar: finalBaseline.aiScoreEmVar,
          updateCount: finalBaseline.updateCount
        }
      },
      zScores: zScores as ZScoreResult,
      anomaly
    };
  }
  
  /**
   * 检测异常
   */
  private detectAnomalies(zScores: ZScoreResult): AnomalyDetectionResult {
    const threshold = 2.5;
    const anomalyMetrics: string[] = [];
    
    if (Math.abs(zScores.responseTime) > threshold) {
      anomalyMetrics.push('responseTime');
    }
    
    if (Math.abs(zScores.messageLength) > threshold) {
      anomalyMetrics.push('messageLength');
    }
    
    if (Math.abs(zScores.interactionInterval) > threshold) {
      anomalyMetrics.push('interactionInterval');
    }
    
    if (Math.abs(zScores.aiScore) > threshold) {
      anomalyMetrics.push('aiScore');
    }
    
    const hasAnomaly = anomalyMetrics.length > 0;
    
    let reasoning = '';
    if (hasAnomaly) {
      const reasons: string[] = [];
      
      if (zScores.responseTime > threshold) {
        reasons.push('响应时间显著变慢');
      } else if (zScores.responseTime < -threshold) {
        reasons.push('响应时间显著变快');
      }
      
      if (zScores.messageLength > threshold) {
        reasons.push('消息长度显著变长');
      } else if (zScores.messageLength < -threshold) {
        reasons.push('消息长度显著变短');
      }
      
      reasoning = reasons.join('，');
    }
    
    return {
      hasAnomaly,
      anomalyMetrics,
      zScores,
      reasoning
    };
  }
  
  /**
   * 获取基线统计信息
   */
  async getBaselineStats(userId: string): Promise<{
    current: StudentBaselineData;
    isStable: boolean;
    confidence: number;
  }> {
    const baseline = await this.getOrCreateBaseline(userId);
    
    // 判断基线是否稳定（更新次数足够多）
    const isStable = baseline.responseTime.updateCount >= 10;
    
    // 计算置信度（基于更新次数）
    const confidence = Math.min(1.0, baseline.responseTime.updateCount / 20);
    
    return {
      current: baseline,
      isStable,
      confidence
    };
  }
}

// 导出单例
export const studentBaselineService = new StudentBaselineService();