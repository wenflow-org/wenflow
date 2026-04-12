/**
 * Progress Agent
 * 
 * 进度追踪与建议
 */

import {
  AgentDefinition,
  AgentInput,
  AgentOutput,
  AgentContext,
  LearningSignal,
  ProgressMetrics
} from '../protocol';
import { EventBus, getEventBus, LearningEvent } from '../../gateway/event-bus';
import { PrismaClient } from '@prisma/client';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { calculateCognitiveEngagement, CognitiveEngagementInput } from '../../services/learning/cognitive-engagement.service';

/**
 * Progress Agent 定义
 */
export const progressAgentDefinition: AgentDefinition = {
  id: 'progress-agent',
  name: '进度追踪Agent',
  version: '1.0.0',
  type: 'progress',
  category: 'standard',
  description: '追踪学习进度，检测学习信号，发布事件',
  
  capabilities: [
    'progress-tracking',
    'signal-detection',
    'fatigue-monitoring',
    'recommendation-generation'
  ],
  
  // 订阅的事件
  subscribes: [
    'task:started',
    'task:completed',
    'task:skipped',
    'learning:started',
    'learning:completed'
  ],
  
  // 发布的事件
  publishes: [
    'learning:speed:change',
    'learning:focus:shift',
    'learning:fatigue-high',
    'learning:struggle',
    'learning:mastery'
  ],
  
  inputSchema: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      action: { type: 'string' },
      taskId: { type: 'string' },
      data: { type: 'object' }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      progress: {
        type: 'object',
        properties: {
          signal: { type: 'object' },
          metrics: { type: 'object' },
          recommendations: { type: 'array' }
        }
      }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

// 衰减因子
const KTL_DECAY = 0.95; // 知识保持力衰减（42天半衰期）
const LF_DECAY = 0.70;  // 疲劳衰减（7天半衰期）

// 阈值配置
const THRESHOLDS = {
  fatigueHigh: 70,      // 高疲劳阈值
  acceleratingSpeed: 1.3, // 加速阈值
  deceleratingSpeed: 0.7, // 减速阈值
  masteryRate: 0.9      // 掌握阈值
};

/**
 * 生成学习报告（AI reasoning 和 suggestion）
 */
async function generateLearningReport(
  metrics: ProgressMetrics,
  signals: LearningSignal[],
  taskData: { taskTitle?: string; timeSpent?: number; difficulty?: number }
): Promise<{ reasoning: string; suggestion: string }> {
  const fallbackReasoning = '基于当前学习数据，你正在稳步推进学习进度。继续保持当前的学习节奏。';
  const fallbackSuggestion = '建议继续保持当前的学习节奏，遇到困难时及时回顾之前的知识点。';

  try {
    const client = getOpenAIClient();
    
    const signalDescriptions = signals.map(s => {
      const typeMap: Record<string, string> = {
        'fatigue-high': '疲劳度较高',
        'accelerating': '学习加速',
        'decelerating': '学习减速',
        'struggling': '遇到困难',
        'mastery': '掌握良好',
        'lane-change': '重点转移',
        'frustration': '感到挫折'
      };
      return `${typeMap[s.type] || s.type}: 强度 ${Math.round(s.intensity * 100)}%${s.context ? ` (${s.context})` : ''}`;
    }).join('；');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个学习分析专家，负责分析学员的学习数据并给出个性化的反馈。

你的任务：
1. 分析学员的学习指标（KTL/LSS/LF等）
2. 解读学习信号的含义
3. 用鼓励和专业的语气给出个性化建议

输出格式要求（JSON）：
{
  "reasoning": "用1-2句话解释学员当前的学习状态，包括进度、疲劳度、知识掌握情况",
  "suggestion": "用1-2句话给出具体的行动建议，帮助学员改进学习效果"
}

注意：
- 语气要亲切、鼓励，避免说教
- 建议要具体可执行
- 根据信号类型调整建议方向`
      },
      {
        role: 'user',
        content: `请分析以下学习数据：

任务信息：
- 任务名称：${taskData.taskTitle || '未知任务'}
- 学习时长：${taskData.timeSpent || 0} 分钟
- 主观难度：${taskData.difficulty || 5}/10

学习指标：
- 完成率：${Math.round(metrics.completionRate * 100)}%
- 知识训练负荷(KTL)：${metrics.ktl?.toFixed(1) || 0}
- 学习疲劳度(LF)：${metrics.lf?.toFixed(1) || 0}
- 学习压力(LSS)：${metrics.lss?.toFixed(1) || 0}

学习信号：
${signalDescriptions || '无明显信号'}

请给出分析报告（JSON格式）。`
      }
    ];

    const response = await client.chatCompletion({
      messages,
      temperature: 0.7,
      max_tokens: 300
    });

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
  } catch (error) {
    console.error('[Progress Agent] AI 调用失败，使用降级方案:', error);
    return { reasoning: fallbackReasoning, suggestion: fallbackSuggestion };
  }
}

/**
 * Progress Agent 处理函数
 */
export async function progressAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const eventBus = getEventBus();
  
  try {
    const userId = context.userId;
    const action = input.metadata?.action || 'check';
    const taskId = input.metadata?.taskId;
    const data = input.metadata?.data || {};
    
    // 获取当前进度数据
    const currentMetrics = await getCurrentMetrics(userId);
    
    // 根据动作更新进度
    let updatedMetrics: ProgressMetrics;
    let signals: LearningSignal[] = [];
    
    switch (action) {
      case 'task_complete':
        updatedMetrics = await recordTaskCompletion(userId, taskId, data, currentMetrics);
        signals = detectSignals(userId, updatedMetrics, data);
        break;
        
      case 'session_end':
        updatedMetrics = await recordSessionEnd(userId, data, currentMetrics);
        signals = detectSignals(userId, updatedMetrics, data);
        break;
        
      case 'check':
      default:
        updatedMetrics = currentMetrics;
        signals = detectSignals(userId, updatedMetrics, {});
    }
    
    // 发布检测到的信号事件
    for (const signal of signals) {
      const eventType = `learning:${signal.type}` as any;
      if (['learning:speed:change', 'learning:focus:shift', 'learning:fatigue:high', 
           'learning:struggle', 'learning:mastery'].includes(eventType)) {
        await eventBus.emit({
          type: eventType,
          source: 'progress-agent',
          userId,
          data: {
            intensity: signal.intensity,
            context: signal.context
          }
        });
      }
    }
    
    // 生成建议
    const recommendations = generateRecommendations(updatedMetrics, signals);
    
    // 生成问流 AI 学习报告（仅 task_complete 时）
    let reasoning: string | undefined;
    let suggestion: string | undefined;
    
    if (action === 'task_complete') {
      const report = await generateLearningReport(updatedMetrics, signals, {
        taskTitle: data.taskTitle,
        timeSpent: data.timeSpent,
        difficulty: data.subjectiveDifficulty
      });
      reasoning = report.reasoning;
      suggestion = report.suggestion;
    }

    return {
      success: true,
      progress: {
        signal: signals[0] || { type: 'struggling' as const, intensity: 0, timestamp: new Date().toISOString() },
        metrics: {
          ...updatedMetrics,
          reasoning,
          suggestion
        },
        recommendations
      },
      metadata: {
        agentId: 'progress-agent',
        agentName: '进度追踪Agent',
        agentType: 'progress',
        confidence: 0.9,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        agentId: 'progress-agent',
        agentName: '进度追踪Agent',
        agentType: 'progress',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

/**
 * 获取当前指标
 */
async function getCurrentMetrics(userId: string): Promise<ProgressMetrics> {
  // 简化版：返回默认值
  // 实际应该从数据库读取
  return {
    completionRate: 0,
    timeSpent: 0,
    ktl: 0,
    lf: 0,
    lss: 0
  };
}

/**
 * 记录任务完成
 */
async function recordTaskCompletion(
  userId: string,
  taskId: string | undefined,
  data: any,
  currentMetrics: ProgressMetrics
): Promise<ProgressMetrics> {
  const difficulty = data.difficulty || 1;
  const timeSpent = data.timeSpent || 30;
  const subjectiveDifficulty = data.subjectiveDifficulty || 5;
  
  // 计算 LSS (Learning Stress Score)
  const lss = calculateLSS(difficulty, timeSpent, subjectiveDifficulty);
  
  // 更新 KTL (Knowledge Training Load)
  const ktl = currentMetrics.ktl * KTL_DECAY + lss;
  
  // 更新 LF (Learning Fatigue)
  const lf = currentMetrics.lf * LF_DECAY + (lss * 0.5);
  
  // 更新完成率
  const completionRate = Math.min((currentMetrics.completionRate || 0) + 0.1, 1);
  
  // 计算认知参与度 (SKI/MKI/DKI)
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
    timeSpent: currentMetrics.timeSpent + timeSpent,
    ktl,
    lf,
    lss,
    ski: cognitiveEngagement.ski,
    mki: cognitiveEngagement.mki,
    dki: cognitiveEngagement.dki
  };
}

/**
 * 记录会话结束
 */
async function recordSessionEnd(
  userId: string,
  data: any,
  currentMetrics: ProgressMetrics
): Promise<ProgressMetrics> {
  const sessionDuration = data.duration || 0;
  const tasksCompleted = data.tasksCompleted || 0;
  
  // 更新疲劳度
  const lf = currentMetrics.lf * LF_DECAY + (sessionDuration * 0.1);
  
  return {
    ...currentMetrics,
    timeSpent: currentMetrics.timeSpent + sessionDuration,
    lf: Math.min(lf, 100)
  };
}

/**
 * 计算 LSS
 */
function calculateLSS(
  difficulty: number,
  timeSpent: number,
  subjectiveDifficulty: number
): number {
  // LSS = 难度 × 时长因子 × 主观难度因子
  const timeFactor = Math.min(timeSpent / 60, 2); // 标准化到60分钟
  const subjectiveFactor = subjectiveDifficulty / 5; // 标准化到5
  
  return Math.min(difficulty * timeFactor * subjectiveFactor * 10, 100);
}

/**
 * 检测学习信号
 */
function detectSignals(
  userId: string,
  metrics: ProgressMetrics,
  data: any
): LearningSignal[] {
  const signals: LearningSignal[] = [];
  const now = new Date().toISOString();
  
  // 检测高疲劳
  if (metrics.lf && metrics.lf > THRESHOLDS.fatigueHigh) {
    signals.push({
      type: 'fatigue-high',
      intensity: metrics.lf / 100,
      context: `疲劳度达到 ${metrics.lf.toFixed(1)}`,
      timestamp: now
    });
  }
  
  // 检测加速/减速
  const speedChange = data.speedChange || 0;
  if (speedChange > THRESHOLDS.acceleratingSpeed) {
    signals.push({
      type: 'accelerating',
      intensity: Math.min((speedChange - 1), 1),
      context: '学习速度明显加快',
      timestamp: now
    });
  } else if (speedChange < THRESHOLDS.deceleratingSpeed) {
    signals.push({
      type: 'decelerating',
      intensity: Math.min((1 - speedChange), 1),
      context: '学习速度明显减慢',
      timestamp: now
    });
  }
  
  // 检测掌握
  if (metrics.completionRate >= THRESHOLDS.masteryRate && (data.score || 0) > 80) {
    signals.push({
      type: 'mastery',
      intensity: metrics.completionRate,
      context: '知识掌握良好',
      timestamp: now
    });
  }
  
  // 检测困难
  if (data.attempts && data.attempts > 3) {
    signals.push({
      type: 'struggling',
      intensity: Math.min(data.attempts / 5, 1),
      context: `尝试了 ${data.attempts} 次仍未成功`,
      timestamp: now
    });
  }
  
  // 检测变道
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

/**
 * 生成建议
 */
function generateRecommendations(
  metrics: ProgressMetrics,
  signals: LearningSignal[]
): string[] {
  const recommendations: string[] = [];
  
  // 根据信号生成建议
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
  
  // 根据指标生成建议
  if (metrics.ktl && metrics.ktl < 20) {
    recommendations.push('建议增加学习量，当前进度较慢');
  } else if (metrics.ktl && metrics.ktl > 80) {
    recommendations.push('学习量较大，注意保持节奏');
  }
  
  // 去重
  return [...new Set(recommendations)].slice(0, 5);
}

/**
 * 订阅事件处理
 */
export function setupProgressAgentListeners(eventBus: EventBus, prisma: PrismaClient): void {
  // 监听任务完成事件
  eventBus.on('task:completed', async (event: LearningEvent) => {
    // 自动更新进度
    console.log(`[Progress Agent] Task completed: ${event.data.taskId}`);
  });
  
  // 监听学习会话结束
  eventBus.on('learning:completed', async (event: LearningEvent) => {
    // 计算会话指标
    console.log(`[Progress Agent] Session completed for user: ${event.userId}`);
  });
}

export default progressAgentHandler;
