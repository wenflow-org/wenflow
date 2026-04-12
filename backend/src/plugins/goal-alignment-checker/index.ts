/**
 * Goal Alignment Checker Plugin
 *
 * 使用 LLM 进行语义反思，检查学习路径是否与用户目标对齐
 * 钩子：在 `path:generated` 事件触发
 */

import {
  AgentPlugin,
  AgentContext,
  AgentOutput
} from '../../agents/plugin-types';
import { getOpenAIClient, ChatMessage } from '../../gateway/openai-client';
import { getEventBus, LearningEvent } from '../../gateway/event-bus';
import { logger } from '../../utils/logger';

const THRESHOLD_SCORE = 70;

interface AlignmentCheckResult {
  score: number;
  knowledgeDistribution: {
    score: number;
    analysis: string;
    issues: string[];
  };
  cognitiveProgression: {
    score: number;
    analysis: string;
    issues: string[];
  };
  goalRelevance: {
    score: number;
    analysis: string;
    issues: string[];
  };
  suggestions: string[];
  fallback: boolean;
}

export const goalAlignmentChecker: AgentPlugin = {
  id: 'goal-alignment-checker',
  name: '目标对齐检查器',
  version: '1.0.0',
  description: '使用 LLM 语义反思检查学习路径与用户目标的对齐度',
  type: 'quality-evaluator',
  capabilities: [
    'alignment-check',
    'knowledge-distribution-analysis',
    'cognitive-progression-check',
    'goal-relevance-evaluation',
    'llm-reflection'
  ],

  config: {
    temperature: 0.3,
    maxTokens: 2000,
    systemPrompt: `你是学习路径质量评估专家，负责检查学习路径是否与用户目标对齐。

【评估维度】
1. 知识分布（Knowledge Distribution）
   - 检查知识点覆盖是否全面
   - 是否有遗漏的核心概念
   - 知识点之间的关联是否合理

2. 认知递进（Cognitive Progression）
   - 学习顺序是否符合认知规律（从简单到复杂）
   - 是否有跳跃或不合理的难度变化
   - 支架式学习是否合理

3. 目标关联（Goal Relevance）
   - 每个里程碑/任务是否与用户目标直接相关
   - 是否有偏离目标的冗余内容
   - 最终是否能达成用户的学习目标

【输出格式】
{
  "score": 75,
  "knowledgeDistribution": {
    "score": 80,
    "analysis": "分析说明",
    "issues": ["问题1", "问题2"]
  },
  "cognitiveProgression": {
    "score": 70,
    "analysis": "分析说明",
    "issues": ["问题1"]
  },
  "goalRelevance": {
    "score": 75,
    "analysis": "分析说明",
    "issues": ["问题1"]
  },
  "suggestions": ["建议1", "建议2"]
}

【评分标准】
- 每个维度 0-100 分
- 总分 = (知识分布 + 认知递进 + 目标关联) / 3
- 低于 70 分需要调整`,
    model: 'deepseek-chat',
    timeout: 60000,
    retries: 2
  },

  async initialize(): Promise<void> {
    const eventBus = getEventBus();
    eventBus.on('path:generated', async (event: LearningEvent) => {
      try {
        logger.info('[GoalAlignmentChecker] Received path:generated event', {
          pathId: event.data?.pathId,
          userId: event.userId
        });

        if (event.data?.path && event.data?.goal) {
          const result = await this.checkAlignment(
            event.data.path,
            event.data.goal,
            event.data.userContext || {}
          );

          if (result.score < THRESHOLD_SCORE) {
            await eventBus.emit({
              type: 'path:adjustment:request',
              source: 'goal-alignment-checker',
              userId: event.userId,
              data: {
                pathId: event.data.pathId,
                reason: 'alignment-check-failed',
                score: result.score,
                suggestions: result.suggestions,
                issues: [
                  ...result.knowledgeDistribution.issues,
                  ...result.cognitiveProgression.issues,
                  ...result.goalRelevance.issues
                ],
                details: result
              }
            });

            logger.warn('[GoalAlignmentChecker] Alignment check failed, adjustment requested', {
              score: result.score,
              suggestions: result.suggestions.length
            });
          }
        }
      } catch (error) {
        logger.error('[GoalAlignmentChecker] Event handler error:', error);
      }
    });

    logger.info('[GoalAlignmentChecker] Plugin initialized and subscribed to path:generated');
  },

  async execute(input: any, context: AgentContext): Promise<AgentOutput> {
    const startTime = Date.now();

    try {
      const { path, goal, userContext } = input;

      if (!path || !goal) {
        return {
          success: false,
          userVisible: '缺少必要参数：path 或 goal',
          error: 'Missing required parameters: path or goal',
          metadata: {
            agentId: this.id,
            agentName: this.name,
            generatedAt: new Date().toISOString(),
            duration: Date.now() - startTime
          }
        };
      }

      const result = await this.checkAlignment(path, goal, userContext || {});

      return {
        success: true,
        userVisible: result.score >= THRESHOLD_SCORE
          ? `路径对齐检查通过，得分：${result.score}/100`
          : `路径对齐检查未通过（${result.score}/100），建议调整`,
        internal: result,
        metadata: {
          agentId: this.id,
          agentName: this.name,
          confidence: result.score / 100,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };
    } catch (error: any) {
      logger.error('[GoalAlignmentChecker] Execute error:', error);

      const fallbackResult = this.fallbackCheck(input);

      return {
        success: true,
        userVisible: `降级对齐检查完成，得分：${fallbackResult.score}/100`,
        internal: fallbackResult,
        error: error.message,
        metadata: {
          agentId: this.id,
          agentName: this.name,
          confidence: 0.5,
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };
    }
  },

  async checkAlignment(
    path: any,
    goal: string,
    userContext: Record<string, any>
  ): Promise<AlignmentCheckResult> {
    const client = getOpenAIClient();

    const pathSummary = this.summarizePath(path);

    const messages: ChatMessage[] = [
      {
        role: 'system' as const,
        content: this.config!.systemPrompt!
      },
      {
        role: 'user' as const,
        content: `请检查以下学习路径是否与用户目标对齐：

【用户目标】
${goal}

【用户背景】
${JSON.stringify(userContext, null, 2)}

【学习路径概要】
${pathSummary}

请输出 JSON 格式的评估结果。`
      }
    ];

    const response = await client.chatCompletion({
      messages,
      temperature: this.config!.temperature,
      max_tokens: this.config!.maxTokens,
      model: this.config!.model
    });

    const content = response.choices[0]?.message.content || '';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: Math.max(0, Math.min(100, parsed.score || 0)),
          knowledgeDistribution: parsed.knowledgeDistribution || { score: 50, analysis: '', issues: [] },
          cognitiveProgression: parsed.cognitiveProgression || { score: 50, analysis: '', issues: [] },
          goalRelevance: parsed.goalRelevance || { score: 50, analysis: '', issues: [] },
          suggestions: parsed.suggestions || [],
          fallback: false
        };
      }
    } catch (parseError) {
      logger.warn('[GoalAlignmentChecker] JSON parse failed, using fallback');
    }

    return this.fallbackCheck({ path, goal });
  },

  summarizePath(path: any): string {
    if (!path || !path.milestones) {
      return '无路径数据';
    }

    const lines = [];
    lines.push(`路径名称：${path.name}`);
    lines.push(`总里程碑数：${path.totalMilestones}`);
    lines.push(`预计时长：${path.estimatedHours} 小时`);
    lines.push('');

    for (const milestone of path.milestones) {
      lines.push(`里程碑 ${milestone.stageNumber}: ${milestone.title}`);
      lines.push(`  目标：${milestone.goal || '无'}`);
      lines.push(`  预计：${milestone.estimatedHours || 0} 小时`);

      if (milestone.subtasks && milestone.subtasks.length > 0) {
        lines.push(`  子任务：`);
        for (const subtask of milestone.subtasks) {
          lines.push(`    - ${subtask.title} (${subtask.type}, ${subtask.estimatedMinutes}分钟)`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  },

  fallbackCheck(input: any): AlignmentCheckResult {
    const { path, goal } = input;

    let score = 50;
    const issues: string[] = [];
    const suggestions: string[] = [];

    if (!path || !path.milestones || path.milestones.length === 0) {
      issues.push('路径缺少里程碑');
      score -= 20;
    }

    if (!goal || goal.length < 10) {
      issues.push('目标描述过于简短');
      score -= 10;
    }

    if (path?.milestones) {
      const hasGoalKeywords = path.milestones.some(m =>
        milestoneContainsGoalKeywords(m, goal)
      );

      if (!hasGoalKeywords) {
        issues.push('里程碑与目标关键词关联不足');
        score -= 15;
      }
    }

    if (score < THRESHOLD_SCORE) {
      suggestions.push('建议增加与目标直接相关的里程碑');
      suggestions.push('建议完善目标描述，明确学习重点');
    }

    return {
      score: Math.max(0, score),
      knowledgeDistribution: {
        score: score,
        analysis: '降级评估：基于基础规则检查',
        issues: issues.filter(i => i.includes('知识') || i.includes('里程碑'))
      },
      cognitiveProgression: {
        score: score,
        analysis: '降级评估：无法进行深度认知分析',
        issues: []
      },
      goalRelevance: {
        score: score,
        analysis: '降级评估：基于关键词匹配',
        issues: issues.filter(i => i.includes('目标'))
      },
      suggestions,
      fallback: true
    };
  },

  destroy(): Promise<void> {
    logger.info('[GoalAlignmentChecker] Plugin destroyed');
    return Promise.resolve();
  }
};

function milestoneContainsGoalKeywords(milestone: any, goal: string): boolean {
  const goalKeywords = goal.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const milestoneText = `${milestone.title} ${milestone.goal || ''} ${milestone.description || ''}`.toLowerCase();

  return goalKeywords.some(keyword => milestoneText.includes(keyword));
}

export default goalAlignmentChecker;