import { getAPIGateway, CallerInfo } from '../../gateway/api-gateway';
import { getEventBus } from '../../gateway/event-bus';
import { calculateCognitiveEngagement, CognitiveEngagementInput } from '../learning/cognitive-engagement.service';
import type { LearningSignal, ProgressMetrics } from '../../agents/protocol';

const KTL_DECAY = 0.95;
const LF_DECAY = 0.7;

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
  reasoning?: string;
  suggestion?: string;
}

class LearnerProgressService {
  async evaluateTaskCompletion(userId: string, data: LearnerProgressTaskData): Promise<LearnerProgressResult> {
    const currentMetrics = this.getCurrentMetrics();
    const updatedMetrics = this.recordTaskCompletion(data, currentMetrics);
    const signals = this.detectSignals(updatedMetrics, data);
    const recommendations = this.generateRecommendations(updatedMetrics, signals);
    const report = await this.generateLearningReport(updatedMetrics, signals, {
      taskTitle: data.taskTitle,
      timeSpent: data.timeSpent,
      difficulty: data.subjectiveDifficulty ?? data.difficulty
    }, userId);

    return this.buildResult(updatedMetrics, signals, recommendations, report);
  }

  async evaluateLessonCompletion(
    userId: string,
    data: LearnerProgressSessionData & {
      performance?: {
        understanding?: number;
        frustrationLevel?: number;
      };
    }
  ): Promise<LearnerProgressResult> {
    const currentMetrics = this.getCurrentMetrics();
    const updatedMetrics = this.recordSessionEnd(data, currentMetrics);
    const signalInput = {
      ...data,
      score: data.score ?? ((data.performance?.understanding || 0) * 100),
      attempts: data.attempts ?? Math.max(0, Math.round((data.performance?.frustrationLevel || 0) / 2))
    };
    const signals = this.detectSignals(updatedMetrics, signalInput);
    const recommendations = this.generateRecommendations(updatedMetrics, signals);

    return this.buildResult(updatedMetrics, signals, recommendations);
  }

  async emitSignals(userId: string, signals: LearningSignal[]): Promise<void> {
    const eventBus = getEventBus();
    for (const signal of signals) {
      const eventType = `learning:${signal.type}` as const;
      if (!['learning:mastery', 'learning:struggle'].includes(eventType)
        && !eventType.startsWith('learning:fatigue')
        && !eventType.startsWith('learning:speed')) {
        continue;
      }

      await eventBus.emit({
        type: eventType as any,
        source: 'skill:learner-model',
        userId,
        data: {
          intensity: signal.intensity,
          context: signal.context
        }
      });
    }
  }

  private buildResult(
    metrics: ProgressMetrics,
    signals: LearningSignal[],
    recommendations: string[],
    report?: { reasoning?: string; suggestion?: string }
  ): LearnerProgressResult {
    const signal = signals[0] || { type: 'struggling' as const, intensity: 0, timestamp: new Date().toISOString() };
    return {
      signal,
      metrics: {
        ...metrics,
        reasoning: report?.reasoning,
        suggestion: report?.suggestion
      },
      recommendations,
      reasoning: report?.reasoning,
      suggestion: report?.suggestion
    };
  }

  private getCurrentMetrics(): ProgressMetrics {
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
    const ktl = (currentMetrics.ktl || 0) * KTL_DECAY + lss;
    const lf = (currentMetrics.lf || 0) * LF_DECAY + (lss * 0.5);
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
      ktl,
      lf,
      lss,
      ski: cognitiveEngagement.ski,
      mki: cognitiveEngagement.mki,
      dki: cognitiveEngagement.dki
    };
  }

  private recordSessionEnd(data: LearnerProgressSessionData, currentMetrics: ProgressMetrics): ProgressMetrics {
    const sessionDuration = data.duration || 0;
    const lf = (currentMetrics.lf || 0) * LF_DECAY + (sessionDuration * 0.1);
    return {
      ...currentMetrics,
      timeSpent: (currentMetrics.timeSpent || 0) + sessionDuration,
      lf: Math.min(lf, 100)
    };
  }

  private calculateLSS(difficulty: number, timeSpent: number, subjectiveDifficulty: number): number {
    const timeFactor = Math.min(timeSpent / 60, 2);
    const subjectiveFactor = subjectiveDifficulty / 5;
    return Math.min(difficulty * timeFactor * subjectiveFactor * 10, 100);
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

  private async generateLearningReport(
    metrics: ProgressMetrics,
    signals: LearningSignal[],
    taskData: { taskTitle?: string; timeSpent?: number; difficulty?: number },
    userId?: string
  ): Promise<{ reasoning: string; suggestion: string }> {
    const fallbackReasoning = '基于当前学习数据，你正在稳步推进学习进度。继续保持当前的学习节奏。';
    const fallbackSuggestion = '建议继续保持当前的学习节奏，遇到困难时及时回顾之前的知识点。';

    try {
      const gateway = getAPIGateway();
      const caller: CallerInfo = { agentId: 'skill:learner-model' };
      const signalDescriptions = signals.map((s) => {
        const typeMap: Record<string, string> = {
          'fatigue-high': '疲劳度较高',
          accelerating: '学习加速',
          decelerating: '学习减速',
          struggling: '遇到困难',
          mastery: '掌握良好',
          'lane-change': '重点转移',
          frustration: '感到挫折'
        };
        return `${typeMap[s.type] || s.type}: 强度 ${Math.round(s.intensity * 100)}%${s.context ? ` (${s.context})` : ''}`;
      }).join('；');

      const messages = [
        {
          role: 'system' as const,
          content: `你是学习者状态中心中的学习分析专家，负责分析学员的学习数据并给出个性化反馈。\n\n输出 JSON：{\n  "reasoning": "1-2 句话解释当前学习状态",\n  "suggestion": "1-2 句话给出具体行动建议"\n}\n\n要求：\n- 语气亲切、鼓励\n- 建议具体可执行\n- 不输出字段解释`
        },
        {
          role: 'user' as const,
          content: `请分析以下学习数据：\n\n任务信息：\n- 任务名称：${taskData.taskTitle || '未知任务'}\n- 学习时长：${taskData.timeSpent || 0} 分钟\n- 主观难度：${taskData.difficulty || 5}/10\n\n学习指标：\n- 完成率：${Math.round(metrics.completionRate * 100)}%\n- KTL：${metrics.ktl?.toFixed(1) || 0}\n- LF：${metrics.lf?.toFixed(1) || 0}\n- LSS：${metrics.lss?.toFixed(1) || 0}\n\n学习信号：\n${signalDescriptions || '无明显信号'}\n\n请输出 JSON。`
        }
      ];

      const response = await gateway.execute({ messages }, caller, { userId });
      const content = response.choices[0]?.message?.content || '';

      try {
        const parsed = JSON.parse(content);
        return {
          reasoning: parsed.reasoning || fallbackReasoning,
          suggestion: parsed.suggestion || fallbackSuggestion
        };
      } catch {
        const reasoningMatch = content.match(/"reasoning"\s*:\s*"([^"]+)"/);
        const suggestionMatch = content.match(/"suggestion"\s*:\s*"([^"]+)"/);
        return {
          reasoning: reasoningMatch?.[1] || fallbackReasoning,
          suggestion: suggestionMatch?.[1] || fallbackSuggestion
        };
      }
    } catch {
      return { reasoning: fallbackReasoning, suggestion: fallbackSuggestion };
    }
  }
}

export const learnerProgressService = new LearnerProgressService();
