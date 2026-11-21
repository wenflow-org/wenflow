import { calculateCognitiveEngagement, CognitiveEngagementInput } from '../learning/cognitive-engagement.service';
import { calculateLSS as calculateDisplayLss } from '../metrics/LearningMetricService';
import type { LearningSignal, ProgressMetrics } from '../../agents/protocol';

const THRESHOLDS = {
  fatigueHigh: 70,
  acceleratingSpeed: 1.3,
  deceleratingSpeed: 0.7,
  masteryRate: 0.9
} as const;

export interface LearnerProgressTaskData {
  taskTitle?: string;
  timeSpent?: number;
  difficulty?: number;
  subjectiveDifficulty?: number;
  estimatedTime?: number;
  accuracy?: number;
  score?: number;
  questionCount?: number;
  questionQuality?: number;
  originalQuestions?: number;
  insights?: number;
  attempts?: number;
  speedChange?: number;
  focusShift?: boolean;
}

export interface LearnerProgressSessionData {
  duration?: number;
  tasksCompleted?: number;
  score?: number;
  attempts?: number;
  speedChange?: number;
  focusShift?: boolean;
}

export interface LearnerProgressResult {
  signal: LearningSignal;
  metrics: ProgressMetrics;
  recommendations: string[];
  // 2026-11-21 止血：profile-progress-report 的唯一下游（completeTask 的 learningReport）
  // 前端零消费，但每次任务完成都白跑一次 LLM。服务层停调用，字段固定回传 null
  // 保住外部响应形状；提示词声明（prompts/core/profile-progress-report.yaml）保留以便回滚。
  reasoning: string | null;
  suggestion: string | null;
}

class LearnerProgressService {
  async evaluateTaskCompletion(userId: string, data: LearnerProgressTaskData): Promise<LearnerProgressResult> {
    const currentMetrics = this.getCurrentMetrics();
    const updatedMetrics = this.recordTaskCompletion(data, currentMetrics);
    const signals = this.detectSignals(updatedMetrics, data);
    const recommendations = this.generateRecommendations(updatedMetrics, signals);
    return this.buildResult(updatedMetrics, signals, recommendations);
  }

  private buildResult(
    metrics: ProgressMetrics,
    signals: LearningSignal[],
    recommendations: string[]
  ): LearnerProgressResult {
    const signal = signals[0] || { type: 'struggling' as const, intensity: 0, timestamp: new Date().toISOString() };
    return {
      signal,
      metrics,
      recommendations,
      // profile-progress-report 已停调用（前端零消费、白跑 LLM）：字段回传 null 保持响应形状
      reasoning: null,
      suggestion: null
    };
  }

  private getCurrentMetrics(): ProgressMetrics {
    // 单任务快照（不持久化）：权威的学习状态指标（KTL/LF/LSS）在 learning-state.service
    return {
      completionRate: 0,
      timeSpent: 0,
      ktl: 0,
      lf: 0,
      lss: 0
    };
  }

  private recordTaskCompletion(data: LearnerProgressTaskData, currentMetrics: ProgressMetrics): ProgressMetrics {
    const difficulty = data.difficulty || 1;
    const timeSpent = data.timeSpent || 30;
    const subjectiveDifficulty = data.subjectiveDifficulty || 5;
    const lss = this.calculateLSS(difficulty, timeSpent, subjectiveDifficulty);
    const completionRate = Math.min((currentMetrics.completionRate || 0) + 0.1, 1);

    const cognitiveEngagementInput: CognitiveEngagementInput = {
      accuracy: data.accuracy ?? (data.score ? data.score / 100 : 0.7),
      completionSpeed: data.estimatedTime ? data.estimatedTime / Math.max(timeSpent, 1) : 1,
      questionCount: data.questionCount ?? 0,
      questionQuality: data.questionQuality,
      originalQuestions: data.originalQuestions,
      insights: data.insights
    };
    const cognitiveEngagement = calculateCognitiveEngagement(cognitiveEngagementInput);

    return {
      completionRate,
      timeSpent: (currentMetrics.timeSpent || 0) + timeSpent,
      ktl: currentMetrics.ktl ?? 0,
      lf: currentMetrics.lf ?? 0,
      lss,
      ski: cognitiveEngagement.ski,
      mki: cognitiveEngagement.mki,
      dki: cognitiveEngagement.dki
    };
  }

  /**
   * 单任务快照的显示层 LSS（0-100 口径）。
   *
   * 2026-09-17 收敛（审计 §4.3）：此前这里是**第三套** LSS 公式
   * （`difficulty × min(timeSpent/60, 2) × subjectiveDifficulty/5 × 10`），
   * 与 `metrics/LearningMetricService.calculateLSS`（任务完成口径）和
   * `learning-state.service.calculateLSS`（状态真源，0-10 五因子）三者互不相同、同名却不同值。
   * 现改为**委托**任务完成口径的唯一显示层近似函数：显示层只有一套公式。
   * （调用点仍以权威 state 的 0-100 display 值优先，本函数只在"无权威记录"时兜底。）
   */
  private calculateLSS(difficulty: number, timeSpent: number, subjectiveDifficulty: number): number {
    return calculateDisplayLss(true, subjectiveDifficulty || difficulty, timeSpent);
  }

  private detectSignals(metrics: ProgressMetrics, data: Partial<LearnerProgressTaskData & LearnerProgressSessionData>): LearningSignal[] {
    const signals: LearningSignal[] = [];
    const now = new Date().toISOString();

    if (metrics.lf && metrics.lf > THRESHOLDS.fatigueHigh) {
      signals.push({
        type: 'fatigue-high',
        intensity: metrics.lf / 100,
        context: `疲劳度达到 ${metrics.lf.toFixed(1)}`,
        timestamp: now
      });
    }

    const speedChange = data.speedChange || 0;
    if (speedChange > THRESHOLDS.acceleratingSpeed) {
      signals.push({
        type: 'accelerating',
        intensity: Math.min(speedChange - 1, 1),
        context: '学习速度明显加快',
        timestamp: now
      });
    } else if (speedChange < THRESHOLDS.deceleratingSpeed && speedChange > 0) {
      signals.push({
        type: 'decelerating',
        intensity: Math.min(1 - speedChange, 1),
        context: '学习速度明显减慢',
        timestamp: now
      });
    }

    if (metrics.completionRate >= THRESHOLDS.masteryRate && (data.score || 0) > 80) {
      signals.push({
        type: 'mastery',
        intensity: metrics.completionRate,
        context: '知识掌握良好',
        timestamp: now
      });
    }

    if (data.attempts && data.attempts > 3) {
      signals.push({
        type: 'struggling',
        intensity: Math.min(data.attempts / 5, 1),
        context: `尝试了 ${data.attempts} 次仍未成功`,
        timestamp: now
      });
    }

    if (data.focusShift) {
      signals.push({
        type: 'lane-change',
        intensity: 0.6,
        context: '学习重点发生转移',
        timestamp: now
      });
    }

    return signals;
  }

  private generateRecommendations(metrics: ProgressMetrics, signals: LearningSignal[]): string[] {
    const recommendations: string[] = [];

    for (const signal of signals) {
      switch (signal.type) {
        case 'fatigue-high':
          recommendations.push('建议休息一下，保持学习效率');
          recommendations.push('可以尝试做一些轻松的复习活动');
          break;
        case 'accelerating':
          recommendations.push('学习状态很好，可以考虑增加挑战');
          break;
        case 'decelerating':
          recommendations.push('可能需要更多时间消化当前内容');
          recommendations.push('建议回顾之前的知识点');
          break;
        case 'struggling':
          recommendations.push('遇到困难是正常的，可以寻求帮助');
          recommendations.push('尝试分解问题，逐个击破');
          break;
        case 'mastery':
          recommendations.push('掌握得很好，可以进入下一阶段');
          recommendations.push('可以尝试更有挑战性的内容');
          break;
        case 'lane-change':
          recommendations.push('新的学习方向很有趣，继续探索');
          break;
      }
    }

    if (metrics.ktl && metrics.ktl < 20) {
      recommendations.push('建议增加学习量，当前进度较慢');
    } else if (metrics.ktl && metrics.ktl > 80) {
      recommendations.push('学习量较大，注意保持节奏');
    }

    return [...new Set(recommendations)].slice(0, 5);
  }
}

export const learnerProgressService = new LearnerProgressService();
