/**
 * Learning State Service - AI 原生授课模式核心服务
 * 负责三层状态追踪：LSS/KTL/LF/LSB 计算和数据采集
 * 
 * 核心公式：
 * - LSS (Learning Stress Score): 学习压力评分
 * - KTL (Knowledge Training Load): 知识训练负荷 (EWMA, λ=0.95, 42天半衰期)
 * - LF (Learning Fatigue): 学习疲劳度 (EWMA, λ=0.70, 7天半衰期)
 * - LSB (Learning State Balance) = KTL - LF: 学习状态平衡值
 */

import prisma from '../../config/database';
import { logger } from '../../utils/logger';

// EWMA 配置
const EWMA_CONFIG = {
  KTL_LAMBDA: 0.95,  // 42天衰减 (0.95^7 ≈ 0.698)
  LF_LAMBDA: 0.70,   // 7天衰减
};

// LSS 输入参数
export interface LSSInputs {
  difficulty: number;      // 任务难度 1-10
  cognitiveLoad: number;   // 认知负荷 1-10
  efficiency: number;      // 学习效率 0-1
  timeSpent: number;       // 实际用时(分钟)
  expectedTime: number;    // 预期用时(分钟)
  completionRate: number;  // 完成率 0-1
  taskType: 'reading' | 'practice' | 'project' | 'quiz';
}

// 学习状态指标
export interface LearningStateMetrics {
  lss: number;  // Learning Stress Score (0-10)
  ktl: number;  // Knowledge Training Load (0-10)
  lf: number;   // Learning Fatigue (0-10)
  lsb: number;  // Learning State Balance (-10 to +10)
  timestamp: Date;
}

export interface SessionScoreInput {
  sessionLss: number;
  durationMinutes: number;
  confidence?: number;
}

// 认知层级
export enum CognitiveLevel {
  REMEMBER = 'remember',      // 记忆
  UNDERSTAND = 'understand',  // 理解
  APPLY = 'apply',            // 应用
  ANALYZE = 'analyze',        // 分析
  EVALUATE = 'evaluate',      // 评估
  CREATE = 'create',          // 创造
}

// 对话分析结果
export interface DialogueAnalysis {
  cognitiveLevel: CognitiveLevel;
  understanding: number;       // 理解度 0-1
  confusionPoints: string[];   // 困惑点
  engagement: number;          // 参与度 0-1
  emotionalState: 'positive' | 'neutral' | 'frustrated' | 'confused';
}

// 干预类型
export type InterventionType = 
  | 'hint'           // 提示
  | 'explanation'    // 解释
  | 'example'        // 示例
  | 'simplification' // 简化
  | 'challenge'      // 挑战
  | 'break'          // 休息建议
  | 'encouragement'; // 鼓励

// 干预决策
export interface InterventionDecision {
  type: InterventionType;
  priority: number;        // 优先级 1-10
  content: string;         // 干预内容
  reasoning: string;       // 决策理由
}

export class LearningStateService {
  /**
   * 计算 LSS (Learning Stress Score)
   * 公式：LSS = (难度×0.3 + 认知负荷×0.3 + 效率惩罚×0.4) × 时间因子
   */
  calculateLSS(inputs: LSSInputs): number {
    const { difficulty, cognitiveLoad, efficiency, timeSpent, expectedTime, completionRate, taskType } = inputs;

    // 基础压力 = 难度×0.3 + 认知负荷×0.3
    let baseStress = difficulty * 0.3 + cognitiveLoad * 0.3;

    // 效率惩罚 (效率越低，压力越大)
    const efficiencyPenalty = (1 - efficiency) * 4; // 0-4
    baseStress += efficiencyPenalty;

    // 时间因子
    const timeRatio = expectedTime > 0 ? timeSpent / expectedTime : 1;
    let timeFactor = 1;
    if (timeRatio > 1.5) {
      timeFactor = 1.3; // 超时严重
    } else if (timeRatio > 1.2) {
      timeFactor = 1.1; // 轻微超时
    } else if (timeRatio < 0.5) {
      timeFactor = 0.9; // 完成太快
    }

    // 完成率调整
    const completionFactor = 0.7 + completionRate * 0.3; // 0.7-1.0

    // 任务类型调整
    const typeFactors: Record<string, number> = {
      reading: 0.9,
      practice: 1.0,
      project: 1.2,
      quiz: 1.1,
    };
    const typeFactor = typeFactors[taskType] || 1.0;

    // 最终 LSS
    const lss = baseStress * timeFactor * completionFactor * typeFactor;

    return Math.min(10, Math.max(0, lss)); // 限制在 0-10
  }

  /**
   * 计算 KTL (Knowledge Training Load)
   * 公式：KTL_t = λ × KTL_{t-1} + (1-λ) × LSS_t
   * λ = 0.95 (42天半衰期)
   */
  calculateKTL(previousKTL: number, currentLSS: number): number {
    const ktl = 
      EWMA_CONFIG.KTL_LAMBDA * previousKTL +
      (1 - EWMA_CONFIG.KTL_LAMBDA) * currentLSS;
    return Math.min(10, Math.max(0, ktl));
  }

  /**
   * 计算 LF (Learning Fatigue)
   * 公式：LF_t = λ_short × LF_{t-1} + (1-λ_short) × LSS_t
   * λ = 0.70 (7天半衰期)
   */
  calculateLF(previousLF: number, currentLSS: number): number {
    const lf = 
      EWMA_CONFIG.LF_LAMBDA * previousLF +
      (1 - EWMA_CONFIG.LF_LAMBDA) * currentLSS;
    return Math.min(10, Math.max(0, lf));
  }

  /**
   * 计算 LSB (Learning State Balance)
   * 公式：LSB = KTL - LF
   */
  calculateLSB(ktl: number, lf: number): number {
    const lsb = ktl - lf;
    return Math.max(-10, Math.min(10, lsb)); // 限制在 -10 到 +10
  }

  /**
   * 获取用户历史指标
   */
  async getPreviousMetrics(userId: string): Promise<LearningStateMetrics | null> {
    const latestRecord = await prisma.learning_metrics.findFirst({
      where: { userId },
      orderBy: { calculatedAt: 'desc' },
    });

    if (!latestRecord) return null;

    return {
      lss: latestRecord.lss ?? 0,
      ktl: latestRecord.ktl ?? 0,
      lf: latestRecord.lf ?? 0,
      lsb: latestRecord.lsb ?? 0,
      timestamp: latestRecord.calculatedAt,
    };
  }

  /**
   * 计算并更新学习状态
   */
  async calculateAndUpdate(
    userId: string,
    inputs: LSSInputs
  ): Promise<LearningStateMetrics> {
    // 1. 计算当前 LSS
    const currentLSS = this.calculateLSS(inputs);

    // 2. 获取历史指标
    const previousMetrics = await this.getPreviousMetrics(userId);

    // 3. 计算 KTL 和 LF
    const previousKTL = previousMetrics?.ktl ?? currentLSS;
    const previousLF = previousMetrics?.lf ?? currentLSS;

    const currentKTL = this.calculateKTL(previousKTL, currentLSS);
    const currentLF = this.calculateLF(previousLF, currentLSS);

    // 4. 计算 LSB
    const currentLSB = this.calculateLSB(currentKTL, currentLF);

    const metrics: LearningStateMetrics = {
      lss: currentLSS,
      ktl: currentKTL,
      lf: currentLF,
      lsb: currentLSB,
      timestamp: new Date(),
    };

    // 5. 保存到数据库
    await this.saveMetrics(userId, metrics, inputs);

    logger.info(`[LearningState] 用户 ${userId}: LSS=${currentLSS.toFixed(2)}, KTL=${currentKTL.toFixed(2)}, LF=${currentLF.toFixed(2)}, LSB=${currentLSB.toFixed(2)}`);

    return metrics;
  }

  /**
   * 使用会话评估分数更新学习状态
   * 场景：单节课由 LLM 给出 sessionLss，跨日期由确定性 EWMA 更新
   */
  async calculateAndUpdateFromSessionScore(
    userId: string,
    input: SessionScoreInput
  ): Promise<LearningStateMetrics> {
    const normalizedLss = Math.min(10, Math.max(0, input.sessionLss));
    const confidence = input.confidence === undefined
      ? 0.75
      : Math.min(1, Math.max(0.2, input.confidence));

    // 低置信度自动降权，避免单次评估抖动过大
    const confidenceWeightedLss = normalizedLss * confidence;

    const previousMetrics = await this.getPreviousMetrics(userId);
    const previousKTL = previousMetrics?.ktl ?? confidenceWeightedLss;
    const previousLF = previousMetrics?.lf ?? confidenceWeightedLss;

    const currentKTL = this.calculateKTL(previousKTL, confidenceWeightedLss);
    const currentLF = this.calculateLF(previousLF, confidenceWeightedLss);
    const currentLSB = this.calculateLSB(currentKTL, currentLF);

    const metrics: LearningStateMetrics = {
      lss: confidenceWeightedLss,
      ktl: currentKTL,
      lf: currentLF,
      lsb: currentLSB,
      timestamp: new Date(),
    };

    await this.saveMetrics(userId, metrics, {
      difficulty: Math.max(1, Math.min(10, confidenceWeightedLss)),
      cognitiveLoad: Math.max(1, Math.min(10, confidenceWeightedLss)),
      efficiency: confidence,
      timeSpent: input.durationMinutes,
      expectedTime: 15,
      completionRate: 1,
      taskType: 'practice',
    });

    logger.info(
      `[LearningState] 会话评分更新: user=${userId}, sessionLss=${normalizedLss.toFixed(2)}, confidence=${confidence.toFixed(2)}, weightedLss=${confidenceWeightedLss.toFixed(2)}, LSB=${currentLSB.toFixed(2)}`
    );

    return metrics;
  }

  /**
   * 保存指标到数据库
   */
  private async saveMetrics(
    userId: string,
    metrics: LearningStateMetrics,
    inputs: LSSInputs
  ): Promise<void> {
    // 获取现有的 lssHistory
    const existingRecord = await prisma.learning_metrics.findFirst({
      where: { userId },
      orderBy: { calculatedAt: 'desc' },
    });

    let lssHistory: Array<{ date: string; score: number }> = [];
    if (existingRecord?.lssHistory) {
      try {
        lssHistory = JSON.parse(existingRecord.lssHistory);
      } catch {
        lssHistory = [];
      }
    }

    // 添加新记录
    lssHistory.push({
      date: new Date().toISOString(),
      score: Math.round(metrics.lss * 10), // 转换为 0-100
    });

    // 只保留最近 30 条
    if (lssHistory.length > 30) {
      lssHistory = lssHistory.slice(-30);
    }

await prisma.learning_metrics.create({
      data: {
        id: `lm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        userId,
        metricType: 'learning_state',
        value: metrics.lss,
        lss: metrics.lss,
        ktl: metrics.ktl,
        lf: metrics.lf,
        lsb: metrics.lsb,
        lssCurrent: metrics.lss,
        ktlCurrent: metrics.ktl,
        lfCurrent: metrics.lf,
        lsbCurrent: metrics.lsb,
        lssHistory: JSON.stringify(lssHistory),
        calculatedAt: metrics.timestamp,
      },
    });
  }

  /**
   * 获取当前状态
   */
  async getCurrentState(userId: string): Promise<LearningStateMetrics | null> {
    return this.getPreviousMetrics(userId);
  }

  /**
   * 获取状态趋势（最近 N 天）
   */
  async getTrends(userId: string, days: number = 7): Promise<LearningStateMetrics[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const records = await prisma.learning_metrics.findMany({
      where: {
        userId,
        calculatedAt: { gte: since },
      },
      orderBy: { calculatedAt: 'asc' },
    });

    return records.map(r => ({
      lss: r.lss ?? 0,
      ktl: r.ktl ?? 0,
      lf: r.lf ?? 0,
      lsb: r.lsb ?? 0,
      timestamp: r.calculatedAt,
    }));
  }

  /**
   * 分析对话认知层级
   * 基于布鲁姆分类法 (Bloom's Taxonomy)
   */
  analyzeCognitiveLevel(studentMessage: string, contextMessage?: string): DialogueAnalysis {
    const message = studentMessage.toLowerCase();

    // 关键词映射到认知层级
    const levelKeywords: Record<CognitiveLevel, string[]> = {
      [CognitiveLevel.REMEMBER]: ['什么是', '定义', '记住', '列举', '名称', '概念'],
      [CognitiveLevel.UNDERSTAND]: ['为什么', '解释', '理解', '意思', '区别', '比较'],
      [CognitiveLevel.APPLY]: ['怎么用', '应用', '实践', '例子', '如何使用', '实现'],
      [CognitiveLevel.ANALYZE]: ['分析', '分解', '关系', '结构', '原理', '为什么这样'],
      [CognitiveLevel.EVALUATE]: ['评估', '判断', '优劣', '哪个更好', '建议', '推荐'],
      [CognitiveLevel.CREATE]: ['创造', '设计', '构建', '方案', '如果', '改进'],
    };

    // 困惑关键词
    const confusionKeywords = ['不懂', '不明白', '困惑', '疑惑', '为什么', '怎么', '错', '失败'];
    const confusionPoints: string[] = [];

    for (const keyword of confusionKeywords) {
      if (message.includes(keyword)) {
        confusionPoints.push(keyword);
      }
    }

    // 判断认知层级
    let detectedLevel: CognitiveLevel = CognitiveLevel.REMEMBER;
    let maxMatches = 0;

    for (const [level, keywords] of Object.entries(levelKeywords)) {
      const matches = keywords.filter(k => message.includes(k)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedLevel = level as CognitiveLevel;
      }
    }

    // 计算理解度（基于问题复杂度）
    const understanding = maxMatches > 0 ? Math.min(1, 0.3 + maxMatches * 0.2) : 0.5;

    // 计算参与度（基于消息长度和复杂度）
    const engagement = Math.min(1, studentMessage.length / 100);

    // 判断情绪状态
    let emotionalState: DialogueAnalysis['emotionalState'] = 'neutral';
    if (message.includes('谢谢') || message.includes('明白') || message.includes('懂了')) {
      emotionalState = 'positive';
    } else if (message.includes('难') || message.includes('不会') || message.includes('失败')) {
      emotionalState = 'frustrated';
    } else if (confusionPoints.length > 0) {
      emotionalState = 'confused';
    }

    return {
      cognitiveLevel: detectedLevel,
      understanding,
      confusionPoints,
      engagement,
      emotionalState,
    };
  }

  /**
   * 生成干预决策
   */
  generateIntervention(
    metrics: LearningStateMetrics,
    dialogueAnalysis: DialogueAnalysis,
    consecutiveErrors: number = 0
  ): InterventionDecision | null {
    const { lss, lsb, lf } = metrics;
    const { understanding, emotionalState, confusionPoints } = dialogueAnalysis;

    // 决策逻辑
    let intervention: InterventionDecision | null = null;

    // 高压力 + 负面情绪 → 简化内容
    if (lss > 7 && emotionalState === 'frustrated') {
      intervention = {
        type: 'simplification',
        priority: 9,
        content: '看起来这个内容对你有点难，让我们换一个更简单的角度来理解...',
        reasoning: '高压力且沮丧，需要降低难度',
      };
    }
    // 理解度低 → 解释
    else if (understanding < 0.4) {
      intervention = {
        type: 'explanation',
        priority: 8,
        content: '让我用另一种方式来解释这个概念...',
        reasoning: '理解度低，需要重新解释',
      };
    }
    // 困惑点 → 示例
    else if (confusionPoints.length > 0) {
      intervention = {
        type: 'example',
        priority: 7,
        content: `关于${confusionPoints[0]}，让我们看一个具体的例子...`,
        reasoning: '学生有具体困惑点',
      };
    }
    // 连续错误 → 提示
    else if (consecutiveErrors >= 2) {
      intervention = {
        type: 'hint',
        priority: 6,
        content: '这里有个小提示：注意观察...',
        reasoning: '连续错误，需要引导',
      };
    }
    // 高疲劳 → 休息建议
    else if (lf > 7) {
      intervention = {
        type: 'break',
        priority: 8,
        content: '你已经学习了很久，建议休息一下再继续...',
        reasoning: '疲劳度高，需要休息',
      };
    }
    // 状态好 + 理解度高 → 挑战
    else if (lsb > 3 && understanding > 0.8) {
      intervention = {
        type: 'challenge',
        priority: 5,
        content: '很好！让我们尝试一个更有挑战性的问题...',
        reasoning: '状态好，可以挑战',
      };
    }
    // 正面情绪 → 鼓励
    else if (emotionalState === 'positive') {
      intervention = {
        type: 'encouragement',
        priority: 3,
        content: '做得不错！继续保持...',
        reasoning: '正面反馈，巩固信心',
      };
    }

    return intervention;
  }

  /**
   * 生成学习建议
   */
  generateSuggestion(metrics: LearningStateMetrics): {
    type: 'fatigue' | 'lsb_negative' | 'efficiency_drop' | 'overstudy' | 'good';
    title: string;
    message: string;
  } {
    const { lss, ktl, lf, lsb } = metrics;

    // 高疲劳
    if (lf > 7) {
      return {
        type: 'fatigue',
        title: '需要休息',
        message: '你的学习疲劳度较高，建议休息后再继续。',
      };
    }

    // LSB 为负
    if (lsb < 0) {
      return {
        type: 'lsb_negative',
        title: '状态不佳',
        message: '当前疲劳超过知识积累，建议调整学习节奏。',
      };
    }

    // 过度学习
    if (ktl > 7 && lsb < 2) {
      return {
        type: 'overstudy',
        title: '需要巩固',
        message: '已掌握较多知识，建议通过练习巩固而非继续学习新内容。',
      };
    }

    // 状态良好
    if (lsb > 3 && lss < 5) {
      return {
        type: 'good',
        title: '状态良好',
        message: '你的学习状态很好，继续保持！',
      };
    }

    // 默认
    return {
      type: 'efficiency_drop',
      title: '注意效率',
      message: '当前学习效率一般，建议调整学习方法。',
    };
  }
}

// 导出单例
export const learningStateService = new LearningStateService();
export default learningStateService;
