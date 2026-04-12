/**
 * Memory Search Skill
 *
 * 检索用户学习历史和记忆
 * 借鉴 Qwen3.5-9B-ToolHub 的 read_memory 工具
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';

// 输入类型定义
export interface MemorySearchInput {
  userId: string;
  query: string;
  scope?: 'all' | 'learning-history' | 'conversations' | 'achievements' | 'progress' | 'preferences';
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  topK?: number;
  includeMetadata?: boolean;
}

// 输出类型定义
export interface MemorySearchOutput {
  results: Array<{
    type: string;
    content: any;
    relevance: number;
    timestamp: Date;
    metadata?: Record<string, any>;
  }>;
  summary: {
    totalFound: number;
    scopesSearched: string[];
    timeRange?: {
      start: Date;
      end: Date;
    };
  };
  insights?: {
    learningPatterns?: string[];
    weakPoints?: string[];
    strengths?: string[];
    recommendations?: string[];
  };
}

/**
 * Memory Search Skill 定义
 */
export const memorySearchDefinition: SkillDefinition = {
  name: 'memory-search',
  version: '1.0.0',
  category: 'retrieval',
  description: '检索用户学习历史、对话记录、成就、进度等记忆数据，支持智能分析和洞察生成',

  inputSchema: {
    type: 'object',
    properties: {
      userId: {
        type: 'string',
        description: '用户ID',
        required: true
      },
      query: {
        type: 'string',
        description: '搜索查询',
        required: true
      },
      scope: {
        type: 'string',
        description: '搜索范围: all|learning-history|conversations|achievements|progress|preferences',
        required: false,
        default: 'all'
      },
      timeRange: {
        type: 'object',
        description: '时间范围 {start, end}',
        required: false
      },
      topK: {
        type: 'number',
        description: '返回结果数量',
        required: false,
        default: 10
      },
      includeMetadata: {
        type: 'boolean',
        description: '是否包含元数据',
        required: false,
        default: true
      }
    }
  },

  outputSchema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        description: '搜索结果'
      },
      summary: {
        type: 'object',
        description: '搜索摘要'
      },
      insights: {
        type: 'object',
        description: '智能洞察'
      }
    }
  },

  capabilities: [
    'memory-retrieval',
    'learning-history',
    'progress-tracking',
    'pattern-analysis',
    'personalization'
  ],

  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * Memory Search Skill 实现
 */
export async function memorySearch(
  input: MemorySearchInput
): Promise<SkillExecutionResult<MemorySearchOutput>> {
  const startTime = Date.now();

  try {
    const {
      userId,
      query,
      scope = 'all',
      timeRange,
      topK = 10,
      includeMetadata = true
    } = input;

    // 验证输入
    if (!userId || !query) {
      return {
        success: false,
        error: {
          code: 'MISSING_PARAMS',
          message: '必须提供 userId 和 query'
        },
        duration: Date.now() - startTime
      };
    }

    // 确定搜索范围
    const scopesToSearch = determineSearchScopes(scope);

    // 执行搜索
    const allResults: MemorySearchOutput['results'] = [];

    for (const searchScope of scopesToSearch) {
      const scopeResults = await searchInScope(userId, query, searchScope, timeRange, topK);
      allResults.push(...scopeResults);
    }

    // 按相关性排序
    allResults.sort((a, b) => b.relevance - a.relevance);

    // 取前 topK 个
    const topResults = allResults.slice(0, topK);

    // 生成洞察
    const insights = generateInsights(topResults, query);

    // 构建输出
    const output: MemorySearchOutput = {
      results: includeMetadata ? topResults : topResults.map(r => ({
        type: r.type,
        content: r.content,
        relevance: r.relevance,
        timestamp: r.timestamp
      })),
      summary: {
        totalFound: allResults.length,
        scopesSearched: scopesToSearch,
        timeRange: timeRange ? {
          start: timeRange.start || new Date(0),
          end: timeRange.end || new Date()
        } : undefined
      },
      insights: insights
    };

    return {
      success: true,
      output,
      duration: Date.now() - startTime
    };

  } catch (error) {
    return {
      success: false,
      error: {
        code: 'SEARCH_ERROR',
        message: error instanceof Error ? error.message : '搜索失败'
      },
      duration: Date.now() - startTime
    };
  }
}

/**
 * 确定搜索范围
 */
function determineSearchScopes(scope: string): string[] {
  const scopeMap: Record<string, string[]> = {
    'all': ['learning-history', 'conversations', 'achievements', 'progress', 'preferences'],
    'learning-history': ['learning-history'],
    'conversations': ['conversations'],
    'achievements': ['achievements'],
    'progress': ['progress'],
    'preferences': ['preferences']
  };

  return scopeMap[scope] || scopeMap['all'];
}

/**
 * 在指定范围内搜索
 */
async function searchInScope(
  userId: string,
  query: string,
  scope: string,
  timeRange?: { start?: Date; end?: Date },
  limit: number = 10
): Promise<MemorySearchOutput['results']> {
  const results: MemorySearchOutput['results'] = [];

  // 扩展查询词
  const expandedQueries = expandQuery(query);

  switch (scope) {
    case 'learning-history':
      results.push(...await searchLearningHistory(userId, expandedQueries, timeRange, limit));
      break;
    case 'conversations':
      results.push(...await searchConversations(userId, expandedQueries, timeRange, limit));
      break;
    case 'achievements':
      results.push(...await searchAchievements(userId, expandedQueries, timeRange, limit));
      break;
    case 'progress':
      results.push(...await searchProgress(userId, expandedQueries, timeRange, limit));
      break;
    case 'preferences':
      results.push(...await searchPreferences(userId, expandedQueries, limit));
      break;
  }

  return results;
}

/**
 * 扩展查询词
 */
function expandQuery(query: string): string[] {
  const expansions = [query];

  // 学习相关同义词
  const synonyms: Record<string, string[]> = {
    '学习': ['掌握', '理解', '学会', '练习'],
    '课程': ['教程', '课', 'lesson', 'course'],
    '代码': ['程序', '脚本', '编程', 'coding'],
    '错误': ['bug', '问题', '异常', 'error'],
    '完成': ['做完', '结束', '通过', 'finish'],
    '困难': ['难', '卡住', '不会', 'struggle'],
    '擅长': ['熟练', '掌握', '强项', 'strength']
  };

  const words = query.split(/[\s,，、]+/);
  for (const word of words) {
    if (synonyms[word]) {
      expansions.push(...synonyms[word]);
    }
  }

  return [...new Set(expansions)];
}

/**
 * 搜索学习历史
 */
async function searchLearningHistory(
  userId: string,
  queries: string[],
  timeRange?: { start?: Date; end?: Date },
  limit: number = 10
): Promise<MemorySearchOutput['results']> {
  // 这里应该查询数据库
  // 简化实现，返回模拟数据
  const mockResults: MemorySearchOutput['results'] = [
    {
      type: 'learning-path',
      content: {
        pathName: 'Python 数据分析入门',
        completedTasks: 15,
        totalTasks: 20,
        currentStage: 2
      },
      relevance: 0.95,
      timestamp: new Date('2026-02-20'),
      metadata: {
        subject: 'python',
        difficulty: 'beginner'
      }
    },
    {
      type: 'task-completion',
      content: {
        taskName: 'Pandas 基础操作',
        score: 85,
        timeSpent: 45
      },
      relevance: 0.88,
      timestamp: new Date('2026-02-21'),
      metadata: {
        skill: 'pandas',
        difficulty: 'medium'
      }
    }
  ];

  return mockResults
    .filter(r => calculateRelevance(queries, JSON.stringify(r.content)) > 0.3)
    .slice(0, limit);
}

/**
 * 搜索对话记录
 */
async function searchConversations(
  userId: string,
  queries: string[],
  timeRange?: { start?: Date; end?: Date },
  limit: number = 10
): Promise<MemorySearchOutput['results']> {
  // 这里应该查询数据库中的对话记录
  const mockResults: MemorySearchOutput['results'] = [
    {
      type: 'conversation',
      content: {
        topic: 'Python 函数定义疑问',
        messages: [
          { role: 'user', text: 'def 和 lambda 有什么区别？' },
          { role: 'ai', text: 'def 用于定义命名函数...' }
        ]
      },
      relevance: 0.92,
      timestamp: new Date('2026-02-22'),
      metadata: {
        category: 'question',
        resolved: true
      }
    }
  ];

  return mockResults
    .filter(r => calculateRelevance(queries, JSON.stringify(r.content)) > 0.3)
    .slice(0, limit);
}

/**
 * 搜索成就记录
 */
async function searchAchievements(
  userId: string,
  queries: string[],
  timeRange?: { start?: Date; end?: Date },
  limit: number = 10
): Promise<MemorySearchOutput['results']> {
  const mockResults: MemorySearchOutput['results'] = [
    {
      type: 'achievement',
      content: {
        name: '初学者',
        description: '完成第一个学习任务',
        xp: 100
      },
      relevance: 0.75,
      timestamp: new Date('2026-02-15'),
      metadata: {
        category: 'milestone'
      }
    },
    {
      type: 'achievement',
      content: {
        name: '坚持者',
        description: '连续学习7天',
        xp: 200
      },
      relevance: 0.70,
      timestamp: new Date('2026-02-25'),
      metadata: {
        category: 'streak'
      }
    }
  ];

  return mockResults
    .filter(r => calculateRelevance(queries, JSON.stringify(r.content)) > 0.3)
    .slice(0, limit);
}

/**
 * 搜索进度记录
 */
async function searchProgress(
  userId: string,
  queries: string[],
  timeRange?: { start?: Date; end?: Date },
  limit: number = 10
): Promise<MemorySearchOutput['results']> {
  const mockResults: MemorySearchOutput['results'] = [
    {
      type: 'progress',
      content: {
        metric: 'knowledge-training-load',
        value: 1250,
        trend: 'up',
        period: 'weekly'
      },
      relevance: 0.85,
      timestamp: new Date('2026-03-01'),
      metadata: {
        chart: 'ktl-trend'
      }
    },
    {
      type: 'progress',
      content: {
        metric: 'learning-fatigue',
        value: 45,
        status: 'moderate',
        recommendation: '建议适当休息'
      },
      relevance: 0.80,
      timestamp: new Date('2026-03-01'),
      metadata: {
        alert: 'fatigue-warning'
      }
    }
  ];

  return mockResults
    .filter(r => calculateRelevance(queries, JSON.stringify(r.content)) > 0.3)
    .slice(0, limit);
}

/**
 * 搜索偏好设置
 */
async function searchPreferences(
  userId: string,
  queries: string[],
  limit: number = 10
): Promise<MemorySearchOutput['results']> {
  const mockResults: MemorySearchOutput['results'] = [
    {
      type: 'preference',
      content: {
        learningStyle: 'visual',
        preferredTime: 'evening',
        difficultyPreference: 'gradual',
        notificationEnabled: true
      },
      relevance: 0.90,
      timestamp: new Date('2026-02-01'),
      metadata: {
        category: 'settings'
      }
    }
  ];

  return mockResults
    .filter(r => calculateRelevance(queries, JSON.stringify(r.content)) > 0.3)
    .slice(0, limit);
}

/**
 * 计算相关性分数
 */
function calculateRelevance(queries: string[], content: string): number {
  const contentLower = content.toLowerCase();
  let score = 0;

  for (const query of queries) {
    const queryLower = query.toLowerCase();

    // 精确匹配
    if (contentLower.includes(queryLower)) {
      score += 0.5;
    }

    // 部分匹配
    const queryTerms = queryLower.split(/\s+/);
    for (const term of queryTerms) {
      if (term.length > 1 && contentLower.includes(term)) {
        score += 0.1;
      }
    }
  }

  return Math.min(score, 1);
}

/**
 * 生成洞察
 */
function generateInsights(
  results: MemorySearchOutput['results'],
  query: string
): MemorySearchOutput['insights'] {
  const insights: MemorySearchOutput['insights'] = {};

  // 分析学习模式
  const learningPatterns = analyzeLearningPatterns(results);
  if (learningPatterns.length > 0) {
    insights.learningPatterns = learningPatterns;
  }

  // 识别薄弱点
  const weakPoints = identifyWeakPoints(results);
  if (weakPoints.length > 0) {
    insights.weakPoints = weakPoints;
  }

  // 识别强项
  const strengths = identifyStrengths(results);
  if (strengths.length > 0) {
    insights.strengths = strengths;
  }

  // 生成建议
  const recommendations = generateRecommendations(results, query);
  if (recommendations.length > 0) {
    insights.recommendations = recommendations;
  }

  return insights;
}

/**
 * 分析学习模式
 */
function analyzeLearningPatterns(results: MemorySearchOutput['results']): string[] {
  const patterns: string[] = [];

  // 检查学习时间分布
  const progressResults = results.filter(r => r.type === 'progress');
  if (progressResults.length > 0) {
    patterns.push('有规律的学习进度追踪习惯');
  }

  // 检查对话频率
  const conversationResults = results.filter(r => r.type === 'conversation');
  if (conversationResults.length > 3) {
    patterns.push('经常通过提问解决疑问');
  }

  // 检查任务完成情况
  const taskResults = results.filter(r => r.type === 'task-completion');
  const completedTasks = taskResults.filter(r =>
    r.content.score && r.content.score >= 60
  );
  if (completedTasks.length > taskResults.length * 0.8) {
    patterns.push('任务完成率较高');
  }

  return patterns;
}

/**
 * 识别薄弱点
 */
function identifyWeakPoints(results: MemorySearchOutput['results']): string[] {
  const weakPoints: string[] = [];

  // 检查低分任务
  const lowScoreTasks = results.filter(r =>
    r.type === 'task-completion' &&
    r.content.score && r.content.score < 60
  );

  for (const task of lowScoreTasks) {
    if (task.content.taskName) {
      weakPoints.push(task.content.taskName);
    }
  }

  // 检查未解决的问题
  const unresolvedConversations = results.filter(r =>
    r.type === 'conversation' &&
    r.metadata && !r.metadata.resolved
  );

  if (unresolvedConversations.length > 0) {
    weakPoints.push('部分疑问尚未完全解决');
  }

  // 检查疲劳度
  const fatigueResults = results.filter(r =>
    r.type === 'progress' &&
    r.content.metric === 'learning-fatigue' &&
    r.content.value > 60
  );

  if (fatigueResults.length > 0) {
    weakPoints.push('近期学习疲劳度较高');
  }

  return weakPoints;
}

/**
 * 识别强项
 */
function identifyStrengths(results: MemorySearchOutput['results']): string[] {
  const strengths: string[] = [];

  // 检查高分任务
  const highScoreTasks = results.filter(r =>
    r.type === 'task-completion' &&
    r.content.score && r.content.score >= 90
  );

  if (highScoreTasks.length > 0) {
    const skills = highScoreTasks.map(t => t.metadata?.skill).filter(Boolean);
    if (skills.length > 0) {
      strengths.push(`擅长: ${[...new Set(skills)].join(', ')}`);
    }
  }

  // 检查成就
  const achievementResults = results.filter(r => r.type === 'achievement');
  if (achievementResults.length > 2) {
    strengths.push('学习动力强，已获得多个成就');
  }

  // 检查连续学习
  const streakResults = results.filter(r =>
    r.type === 'achievement' &&
    r.metadata?.category === 'streak'
  );

  if (streakResults.length > 0) {
    strengths.push('有良好的学习习惯，能够坚持');
  }

  return strengths;
}

/**
 * 生成建议
 */
function generateRecommendations(
  results: MemorySearchOutput['results'],
  query: string
): string[] {
  const recommendations: string[] = [];

  // 基于查询内容生成建议
  const queryLower = query.toLowerCase();

  if (queryLower.includes('困难') || queryLower.includes('难')) {
    recommendations.push('建议将复杂任务拆分为小步骤，逐步攻克');
    recommendations.push('可以回顾之前掌握的相关知识点，建立联系');
  }

  if (queryLower.includes('忘记') || queryLower.includes('记不住')) {
    recommendations.push('建议使用间隔重复法复习，加强记忆');
    recommendations.push('尝试将知识点应用到实际项目中');
  }

  if (queryLower.includes('时间') || queryLower.includes('忙')) {
    recommendations.push('建议利用碎片时间学习，每天15-30分钟');
    recommendations.push('可以调整学习路径，选择更紧凑的课程');
  }

  // 基于学习进度生成建议
  const progressResults = results.filter(r => r.type === 'progress');
  const fatigueResult = progressResults.find(r =>
    r.content.metric === 'learning-fatigue'
  );

  if (fatigueResult && fatigueResult.content.value > 50) {
    recommendations.push('检测到学习疲劳，建议适当休息，调整学习节奏');
  }

  // 基于薄弱点生成建议
  const weakPoints = identifyWeakPoints(results);
  if (weakPoints.length > 0) {
    recommendations.push(`针对薄弱点"${weakPoints[0]}"，建议进行专项练习`);
  }

  // 默认建议
  if (recommendations.length === 0) {
    recommendations.push('继续保持当前的学习节奏');
    recommendations.push('可以尝试挑战更高难度的任务');
  }

  return recommendations;
}

export default memorySearch;
